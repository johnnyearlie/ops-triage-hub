from __future__ import annotations

import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# =========================================
# Config
# =========================================
DB_PATH = "ops_triage.db"

PRIORITIES = ["P0", "P1", "P2", "P3"]
STATUSES = ["open", "investigating", "mitigated", "resolved"]
ROLES = ["On-call", "Ops Lead", "Support", "Engineering"]

SLA_MINUTES = {"P0": 30, "P1": 120, "P2": 480, "P3": 1440}

BREACH_THRESHOLD_TOTAL = 5
AGING_THRESHOLD_24H = 5

STATUS_TRANSITIONS = {
    "open": ["investigating"],
    "investigating": ["mitigated", "resolved"],
    "mitigated": ["resolved"],
    "resolved": [],
}

SEED_IF_EMPTY = True

# =========================================
# Helpers (timezone-safe)
# =========================================
def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def dt_to_iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def iso_to_dt(s: Optional[str]) -> Optional[datetime]:
    """
    Parse ISO strings that may be naive ("2026-...") or aware ("...+00:00"/"Z"),
    and normalize to timezone-aware UTC.
    """
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def minutes_between(a: datetime, b: datetime) -> int:
    if a.tzinfo is None:
        a = a.replace(tzinfo=timezone.utc)
    if b.tzinfo is None:
        b = b.replace(tzinfo=timezone.utc)
    return int((b - a).total_seconds() // 60)


def normalize_priority(p: str) -> str:
    p = (p or "").strip().upper()
    if p not in PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority '{p}'. Must be one of {PRIORITIES}")
    return p


def normalize_status(s: str) -> str:
    s = (s or "").strip().lower()
    if s not in STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{s}'. Must be one of {STATUSES}")
    return s


def normalize_role(r: str) -> str:
    r = (r or "").strip()
    if r not in ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid resolved_by '{r}'. Must be one of {ROLES}")
    return r


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


# =========================================
# DB init + migrations
# =========================================
def _has_column(conn: sqlite3.Connection, table: str, col: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(r["name"] == col for r in rows)


def init_db() -> None:
    conn = db()
    cur = conn.cursor()

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS incidents (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            priority TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'open',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT '',
            resolved_at TEXT,
            resolved_by TEXT,
            resolution_notes TEXT
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS timeline (
            id TEXT PRIMARY KEY,
            incident_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            created_at TEXT NOT NULL,
            old_value TEXT,
            new_value TEXT,
            FOREIGN KEY(incident_id) REFERENCES incidents(id)
        )
        """
    )

    # --- Migrate existing DBs (add missing columns safely) ---
    if not _has_column(conn, "incidents", "status"):
        cur.execute("ALTER TABLE incidents ADD COLUMN status TEXT NOT NULL DEFAULT 'open'")
    if not _has_column(conn, "incidents", "updated_at"):
        cur.execute("ALTER TABLE incidents ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''")
    if not _has_column(conn, "incidents", "resolution_notes"):
        cur.execute("ALTER TABLE incidents ADD COLUMN resolution_notes TEXT")
    if not _has_column(conn, "incidents", "resolved_at"):
        cur.execute("ALTER TABLE incidents ADD COLUMN resolved_at TEXT")
    if not _has_column(conn, "incidents", "resolved_by"):
        cur.execute("ALTER TABLE incidents ADD COLUMN resolved_by TEXT")

    conn.commit()
    conn.close()


def add_timeline(conn: sqlite3.Connection, incident_id: str, event_type: str, old: Any = None, new: Any = None) -> None:
    tid = str(uuid.uuid4())
    now = dt_to_iso(utcnow())
    conn.execute(
        """
        INSERT INTO timeline (id, incident_id, event_type, created_at, old_value, new_value)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (tid, incident_id, event_type, now, None if old is None else str(old), None if new is None else str(new)),
    )


def _row_get(row: sqlite3.Row, key: str, default=None):
    try:
        return row[key]
    except Exception:
        return default


def incident_row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": _row_get(row, "id"),
        "title": _row_get(row, "title"),
        "description": _row_get(row, "description"),
        "priority": _row_get(row, "priority"),
        "status": _row_get(row, "status"),
        "created_at": _row_get(row, "created_at"),
        "updated_at": _row_get(row, "updated_at"),
        "resolved_at": _row_get(row, "resolved_at"),
        "resolved_by": _row_get(row, "resolved_by"),
        "resolution_notes": _row_get(row, "resolution_notes"),
    }


def seed_realistic_incidents_if_empty() -> None:
    if not SEED_IF_EMPTY:
        return

    conn = db()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) AS c FROM incidents")
    count = int(cur.fetchone()["c"])
    if count > 0:
        conn.close()
        return

    now = utcnow()
    examples = [
        ("Checkout failing for DE customers", "Spike in 500s on /checkout for DE. Suspect recent release.", "P0", "open", now - timedelta(hours=3)),
        ("eSIM activation delays", "Activation API returning 202 for >10 minutes. Users stuck on pending.", "P1", "open", now - timedelta(hours=6)),
        ("Billing portal slow", "Billing portal latency > 3s for EU region. DB contention suspected.", "P2", "open", now - timedelta(days=2, hours=5)),
        ("Support queue backlog", "Support queue building; SLA at risk for low priority tickets.", "P3", "open", now - timedelta(days=1, hours=2)),
        ("Partner webhook retries", "Partner webhook endpoint returns intermittent 429; retries causing duplicates.", "P2", "open", now - timedelta(days=4)),
        ("Roaming profile mismatch", "Roaming profile mismatch for subset of devices. Needs manual correction.", "P1", "open", now - timedelta(days=3, hours=8)),
        ("Payment provider rate-limit", "Provider throttling increased; mitigation could be traffic shaping.", "P0", "open", now - timedelta(days=1, hours=10)),
        ("Invoice generation stuck", "Nightly invoice job stuck at step 3/7. Manual run possible.", "P2", "open", now - timedelta(days=7)),
    ]

    for title, desc, prio, status, created_at in examples:
        iid = str(uuid.uuid4())
        created_iso = dt_to_iso(created_at)
        conn.execute(
            """
            INSERT INTO incidents (id, title, description, priority, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (iid, title, desc, prio, status, created_iso, created_iso),
        )
        add_timeline(conn, iid, "created", None, f"{prio} {status}")

    conn.commit()
    conn.close()


def backfill_resolved_fields() -> None:
    """
    If you have legacy rows where status='resolved' but resolved_at is missing,
    set resolved_at from updated_at (or created_at as last resort).
    """
    conn = db()
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE incidents
        SET resolved_at = COALESCE(NULLIF(resolved_at,''), NULLIF(updated_at,''), created_at)
        WHERE status='resolved' AND (resolved_at IS NULL OR resolved_at = '')
        """
    )
    conn.commit()
    conn.close()
    # =========================================
# API Models
# =========================================
class IncidentCreate(BaseModel):
    title: str = Field(min_length=3, max_length=120)
    description: str = Field(min_length=10, max_length=5000)
    priority: str = Field(default="P2")


class IncidentPatch(BaseModel):
    status: str
    priority: Optional[str] = None
    resolved_by: Optional[str] = None
    resolution_notes: Optional[str] = None
    note: Optional[str] = None  # free-text note at any stage


class TriageRequest(BaseModel):
    title: str = Field(min_length=3, max_length=120)
    description: str = Field(min_length=10, max_length=5000)


class TriageResponse(BaseModel):
    suggested_priority: str
    next_steps: List[str]
    rationale: str


# =========================================
# App
# =========================================
app = FastAPI(title="Ops Triage Hub API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    init_db()
    seed_realistic_incidents_if_empty()
    backfill_resolved_fields()


@app.get("/health")
def healthcheck() -> Dict[str, str]:
    return {"status": "ok"}


# =========================================
# Incidents
# =========================================
@app.post("/incidents")
def create_incident(payload: IncidentCreate) -> Dict[str, Any]:
    prio = normalize_priority(payload.priority)
    now = utcnow()
    iid = str(uuid.uuid4())

    conn = db()
    conn.execute(
        """
        INSERT INTO incidents (id, title, description, priority, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (iid, payload.title.strip(), payload.description.strip(), prio, "open", dt_to_iso(now), dt_to_iso(now)),
    )
    add_timeline(conn, iid, "created", None, f"{prio} open")
    conn.commit()
    conn.close()

    return {"id": iid}


@app.get("/incidents")
def list_incidents(
    status: Optional[str] = Query(default=None),
    days: int = Query(default=7, ge=1, le=365),
    limit: int = Query(default=50, ge=1, le=200),
) -> List[Dict[str, Any]]:
    conn = db()
    where = []
    params: List[Any] = []

    if status:
        s = normalize_status(status)
        where.append("status = ?")
        params.append(s)
        if s == "resolved":
            cutoff = utcnow() - timedelta(days=days)
            where.append("COALESCE(NULLIF(resolved_at,''), NULLIF(updated_at,''), created_at) >= ?")
            params.append(dt_to_iso(cutoff))

    q = "SELECT * FROM incidents"
    if where:
        q += " WHERE " + " AND ".join(where)

    if status and status.lower() == "resolved":
        q += " ORDER BY COALESCE(NULLIF(resolved_at,''), NULLIF(updated_at,''), created_at) DESC"
    else:
        q += " ORDER BY created_at DESC"

    q += " LIMIT ?"
    params.append(limit)

    rows = conn.execute(q, tuple(params)).fetchall()
    conn.close()
    return [incident_row_to_dict(r) for r in rows]


@app.get("/ops/active-incidents")
def active_incidents(limit: int = Query(default=200, ge=1, le=500)) -> List[Dict[str, Any]]:
    conn = db()
    rows = conn.execute(
        """
        SELECT * FROM incidents
        WHERE status != 'resolved'
        ORDER BY created_at DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    conn.close()
    return [incident_row_to_dict(r) for r in rows]
@app.patch("/incidents/{incident_id}")
def patch_incident(incident_id: str, payload: IncidentPatch) -> Dict[str, Any]:
    new_status = normalize_status(payload.status)

    conn = db()
    row = conn.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Incident not found")

    old_status = row["status"]
    allowed = STATUS_TRANSITIONS.get(old_status, [])
    if new_status != old_status and new_status not in allowed:
        conn.close()
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status transition: {old_status} → {new_status}. Allowed: {allowed}",
        )
     # OPTIONAL: priority change (log to timeline)
    if payload.priority:
        new_prio = normalize_priority(payload.priority)
        old_prio = row["priority"]
        if new_prio != old_prio:
            add_timeline(conn, incident_id, "priority_changed", old_prio, new_prio)
            conn.execute(
                "UPDATE incidents SET priority = ?, updated_at = ? WHERE id = ?",
                (new_prio, dt_to_iso(utcnow()), incident_id),
            )
            row = conn.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone()   
    # OPTIONAL: free-text note at any stage
    if payload.note and payload.note.strip():
        add_timeline(conn, incident_id, "note", None, payload.note.strip())
    now = utcnow()

    # Start from current DB values (so partial patches work)
    resolved_at = row["resolved_at"]
    resolved_by = row["resolved_by"]
    resolution_notes = row["resolution_notes"]
    priority = row["priority"]

    # Optional: priority change at any stage
    if payload.priority is not None:
        new_prio = normalize_priority(payload.priority)
        if new_prio != priority:
            add_timeline(conn, incident_id, "resolution_notes", None, resolution_notes)
            priority = new_prio

    # Optional: add a free-text note at any stage (timeline only)
    if payload.note is not None and payload.note.strip():
        add_timeline(conn, incident_id, "note_added", None, payload.note.strip())

    # Resolving requires metadata
    if new_status == "resolved" and old_status != "resolved":
        if not payload.resolved_by:
            conn.close()
            raise HTTPException(status_code=400, detail="resolved_by is required when resolving")
        if not payload.resolution_notes or not payload.resolution_notes.strip():
            conn.close()
            raise HTTPException(status_code=400, detail="resolution_notes is required when resolving")

        resolved_by = normalize_role(payload.resolved_by)
        resolution_notes = payload.resolution_notes.strip()
        resolved_at = dt_to_iso(now)

        add_timeline(conn, incident_id, "resolved_by", row["resolved_by"], resolved_by)
        add_timeline(conn, incident_id, "resolution_notes", None, "added")
        add_timeline(conn, incident_id, "resolved_at", row["resolved_at"], resolved_at)

    # Status change timeline
    if new_status != old_status:
        add_timeline(conn, incident_id, "status_changed", old_status, new_status)

    conn.execute(
        """
        UPDATE incidents
        SET priority = ?, status = ?, updated_at = ?, resolved_at = ?, resolved_by = ?, resolution_notes = ?
        WHERE id = ?
        """,
        (priority, new_status, dt_to_iso(now), resolved_at, resolved_by, resolution_notes, incident_id),
    )
    conn.commit()

    out = conn.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone()
    conn.close()
    return incident_row_to_dict(out)


@app.get("/incidents/{incident_id}/timeline")
def incident_timeline(incident_id: str) -> List[Dict[str, Any]]:
    conn = db()
    exists = conn.execute("SELECT 1 FROM incidents WHERE id = ?", (incident_id,)).fetchone()
    if not exists:
        conn.close()
        raise HTTPException(status_code=404, detail="Incident not found")

    rows = conn.execute(
        """
        SELECT * FROM timeline
        WHERE incident_id = ?
        ORDER BY created_at DESC
        """,
        (incident_id,),
    ).fetchall()
    conn.close()

    return [
        {
            "id": r["id"],
            "incident_id": r["incident_id"],
            "event_type": r["event_type"],
            "created_at": r["created_at"],
            "old_value": r["old_value"],
            "new_value": r["new_value"],
        }
        for r in rows
    ]
# =========================================
# Health + Recommendations
# =========================================
@dataclass
class BreachView:
    id: str
    title: str
    priority: str
    status: str
    created_at: str
    age_minutes: int
    sla_minutes: int
    overdue_minutes: int


def compute_breaches(now: datetime, incidents: List[Dict[str, Any]]) -> List[BreachView]:
    out: List[BreachView] = []
    for inc in incidents:
        created = iso_to_dt(inc["created_at"]) or now
        age = minutes_between(created, now)
        sla = SLA_MINUTES.get(inc["priority"], 1440)
        overdue = max(0, age - sla)
        if overdue > 0 and inc["status"] != "resolved":
            out.append(
                BreachView(
                    id=inc["id"],
                    title=inc["title"],
                    priority=inc["priority"],
                    status=inc["status"],
                    created_at=inc["created_at"],
                    age_minutes=age,
                    sla_minutes=sla,
                    overdue_minutes=overdue,
                )
            )
    out.sort(key=lambda x: x.overdue_minutes, reverse=True)
    return out


def aging_buckets(now: datetime, incidents: List[Dict[str, Any]]) -> Dict[str, int]:
    b = {"lt_15m": 0, "m15_60": 0, "h1_4": 0, "h4_24": 0, "gte_24h": 0}
    for inc in incidents:
        if inc["status"] == "resolved":
            continue
        created = iso_to_dt(inc["created_at"]) or now
        age = minutes_between(created, now)
        if age < 15:
            b["lt_15m"] += 1
        elif age < 60:
            b["m15_60"] += 1
        elif age < 240:
            b["h1_4"] += 1
        elif age < 1440:
            b["h4_24"] += 1
        else:
            b["gte_24h"] += 1
    return b


@app.get("/ops/health")
def ops_health() -> Dict[str, Any]:
    now = utcnow()

    conn = db()
    rows = conn.execute("SELECT * FROM incidents WHERE status != 'resolved'").fetchall()
    conn.close()

    incidents = [incident_row_to_dict(r) for r in rows]
    breaches = compute_breaches(now, incidents)
    breached_total = len(breaches)
    active_total = len(incidents)
    buckets = aging_buckets(now, incidents)

    reasons: List[Dict[str, Any]] = []

    p0_breaches = [b for b in breaches if b.priority == "P0"]
    if p0_breaches:
        reasons.append(
            {
                "code": "sla_breach_p0",
                "label": f"{len(p0_breaches)} P0 SLA breach(es)",
                "top_incidents": [b.__dict__ for b in p0_breaches[:3]],
            }
        )

    if breached_total >= BREACH_THRESHOLD_TOTAL:
        reasons.append(
            {
                "code": "sla_breaches_total",
                "label": f"{breached_total} total SLA breaches (>= {BREACH_THRESHOLD_TOTAL})",
                "top_incidents": [b.__dict__ for b in breaches[:3]],
            }
        )

    if buckets["gte_24h"] >= AGING_THRESHOLD_24H:
        reasons.append(
            {
                "code": "aging_24h",
                "label": f"{buckets['gte_24h']} incidents aged 24h+ (>= {AGING_THRESHOLD_24H})",
                "top_incidents": [b.__dict__ for b in breaches[:3]] if breaches else [],
            }
        )

    status = "green"
    if any(r["code"] == "sla_breach_p0" for r in reasons):
        status = "red"
    elif reasons:
        status = "amber"

    # MTTR (resolved in last 7 days)
    conn = db()
    cutoff = utcnow() - timedelta(days=7)
    mttr_rows = conn.execute(
        """
        SELECT created_at, resolved_at
        FROM incidents
        WHERE status = 'resolved'
          AND resolved_at IS NOT NULL
          AND resolved_at >= ?
        """,
        (dt_to_iso(cutoff),),
    ).fetchall()
    conn.close()

    mttrs: List[int] = []
    for r in mttr_rows:
        cdt = iso_to_dt(r["created_at"])
        rdt = iso_to_dt(r["resolved_at"])
        if cdt and rdt and rdt >= cdt:
            mttrs.append(minutes_between(cdt, rdt))

    mttr_avg = int(sum(mttrs) / len(mttrs)) if mttrs else None

    return {
        "generated_at": dt_to_iso(now),
        "active_total": active_total,
        "aging_buckets": buckets,
        "sla": SLA_MINUTES,
        "breached_total": breached_total,
        "breached": [b.__dict__ for b in breaches[:100]],
        "mttr": {"window_days": 7, "resolved_count": len(mttrs), "avg_minutes": mttr_avg},
        "score": {"status": status, "reasons": reasons},
    }


def make_recommendations(health: Dict[str, Any], top_n: int) -> List[Dict[str, Any]]:
    reasons = health.get("score", {}).get("reasons", [])
    breaches = health.get("breached", [])

    recs: List[Dict[str, Any]] = []
    rank = 1

    def top_overdue(n: int) -> List[Dict[str, Any]]:
        return breaches[:n] if isinstance(breaches, list) else []

    p0_reason = next((r for r in reasons if r.get("code") == "sla_breach_p0"), None)
    if p0_reason:
        targets = (p0_reason.get("top_incidents") or [])[:top_n]
        recs.append(
            {
                "rank": rank,
                "action_type": "resolve_p0_breaches",
                "title": f"Triage top {min(top_n, len(targets))} P0 SLA breach(es)",
                "why": "P0 SLA breaches are the strongest driver of RED status and should be handled immediately.",
                "expected_impact": "High (often RED → AMBER when cleared)",
                "suggested_owner_role": "On-call / Incident Commander",
                "playbook": [
                    "Assign an owner",
                    "Confirm blast radius",
                    "Mitigate (rollback/flag/shift traffic)",
                    "Communicate updates",
                    "Resolve + write resolution notes",
                ],
                "target_incidents": targets,
            }
        )
        rank += 1

    total_reason = next((r for r in reasons if r.get("code") == "sla_breaches_total"), None)
    if total_reason:
        targets = top_overdue(top_n)
        recs.append(
            {
                "rank": rank,
                "action_type": "resolve_top_breaches",
                "title": f"Clear the top {min(top_n, len(targets))} most overdue SLA breaches",
                "why": "Reducing the largest overdue breaches lowers risk quickly and stabilizes throughput.",
                "expected_impact": "Medium–High",
                "suggested_owner_role": "Ops Lead / Triage Captain",
                "playbook": [
                    "Confirm each breach is real work (dedupe noise)",
                    "Escalate blockers",
                    "Convert repeats into Problem tickets",
                    "Resolve or reclassify with clear notes",
                ],
                "target_incidents": targets,
            }
        )
        rank += 1

    aging_reason = next((r for r in reasons if r.get("code") == "aging_24h"), None)
    if aging_reason:
        targets = top_overdue(top_n) if breaches else []
        recs.append(
            {
                "rank": rank,
                "action_type": "cleanup_aged_backlog",
                "title": "Reduce the 24h+ backlog (close, downgrade, or convert to Problems)",
                "why": "Aged incidents often represent stalled work or unclear ownership; cleaning these improves signal quality.",
                "expected_impact": "Medium",
                "suggested_owner_role": "Ops / Support Lead",
                "playbook": [
                    "Backlog triage",
                    "Close duplicates / invalids",
                    "Downgrade low-impact items",
                    "Assign owner + next action",
                    "Convert systemic repeats into Problems",
                ],
                "target_incidents": targets,
            }
        )
        rank += 1

    recs.append(
        {
            "rank": rank,
            "action_type": "improve_closure_hygiene",
            "title": "Improve closure hygiene (resolution notes + valid transitions)",
            "why": "Consistent notes/transitions improve learning loops and KPI confidence.",
            "expected_impact": "Low–Medium",
            "suggested_owner_role": "Ops Lead",
            "playbook": [
                "Require resolution notes on resolve",
                "Encourage investigating/mitigated steps",
                "Review repeats weekly",
            ],
            "target_incidents": [],
        }
    )

    return recs


@app.get("/ops/recommendations")
def ops_recommendations(top_n: int = Query(default=3, ge=1, le=10)) -> Dict[str, Any]:
    h = ops_health()
    recs = make_recommendations(h, top_n=top_n)
    return {
        "generated_at": dt_to_iso(utcnow()),
        "health_status": h["score"]["status"],
        "recommendations": recs,
    }


@app.get("/ops/recommendations/summary")
def ops_recommendations_summary() -> Dict[str, Any]:
    h = ops_health()
    status = h["score"]["status"]
    reasons = h["score"]["reasons"]

    if not reasons:
        summary = "Operational health is GREEN — no key risk triggers detected."
    else:
        parts = [r["label"] for r in reasons]
        summary = f"Operational health is {status.upper()} — " + "; ".join(parts) + "."
        if status == "red":
            summary += " Immediate action required."

    return {"generated_at": dt_to_iso(utcnow()), "health_status": status, "summary": summary}


# =========================================
# KPIs
# =========================================
@app.get("/ops/kpis")
def ops_kpis(days: int = Query(default=7, ge=1, le=90)) -> Dict[str, Any]:
    """
    KPIs derived from incidents table.

    Uses:
      - incidents.created_at
      - incidents.status
      - incidents.resolved_at
      - incidents.resolved_by
    """
    cutoff = utcnow() - timedelta(days=days)

    conn = db()
    rows = conn.execute(
        """
        SELECT id, priority, created_at, resolved_at, resolved_by
        FROM incidents
        WHERE status = 'resolved'
          AND COALESCE(NULLIF(resolved_at,''), NULLIF(updated_at,''), created_at) >= ?
        """,
        (dt_to_iso(cutoff),),
    ).fetchall()
    conn.close()

    resolved_count = len(rows)
    p0_resolved_count = 0
    mttrs: List[int] = []
    by_role: Dict[str, int] = {}

    for r in rows:
        if r["priority"] == "P0":
            p0_resolved_count += 1

        cdt = iso_to_dt(r["created_at"])
        rdt = iso_to_dt(r["resolved_at"]) if r["resolved_at"] else None
        if cdt and rdt and rdt >= cdt:
            mttrs.append(minutes_between(cdt, rdt))

        role = (r["resolved_by"] or "").strip() or "Unassigned"
        by_role[role] = by_role.get(role, 0) + 1

    avg_mttr = int(sum(mttrs) / len(mttrs)) if mttrs else None

    top_resolvers = sorted(
        [{"role": k, "resolved": v} for k, v in by_role.items()],
        key=lambda x: x["resolved"],
        reverse=True,
    )[:5]

    return {
        "generated_at": dt_to_iso(utcnow()),
        "window_days": days,
        "resolved_count": resolved_count,
        "p0_resolved_count": p0_resolved_count,
        "avg_mttr_minutes": avg_mttr,
        "top_resolvers": top_resolvers,
    }


# =========================================
# AI Triage (demo rules)
# =========================================
def triage_rules(title: str, desc: str) -> Tuple[str, List[str], str]:
    text = f"{title}\n{desc}".lower()

    p0_hits = ["checkout", "payment", "outage", "500", "down", "failed", "critical", "sev0", "p0"]
    p1_hits = ["activation", "delay", "degraded", "latency", "timeout", "sev1", "p1"]
    p2_hits = ["slow", "backlog", "retry", "webhook", "billing", "p2"]

    def count(hits: List[str]) -> int:
        return sum(1 for h in hits if h in text)

    s0, s1, s2 = count(p0_hits), count(p1_hits), count(p2_hits)

    if s0 >= 2 or ("outage" in text) or ("payment" in text and "failed" in text):
        return (
            "P0",
            [
                "Assign an owner (On-call)",
                "Confirm blast radius + impacted customers",
                "Mitigate (rollback/feature flag/traffic shift)",
                "Post status update + next update time",
                "Resolve with notes + follow-ups",
            ],
            "Signals indicate critical customer impact / outage risk.",
        )

    if s1 >= 2 or ("activation" in text and "delay" in text):
        return (
            "P1",
            [
                "Confirm symptoms + metrics (latency/errors)",
                "Engage owning team; check recent changes",
                "Apply mitigation and monitor recovery",
                "Communicate externally if needed",
                "Create follow-up if recurring",
            ],
            "Signals indicate degraded service impacting user experience and SLAs.",
        )

    if s2 >= 1:
        return (
            "P2",
            [
                "Validate incident is actionable (not duplicate/noise)",
                "Assign ownership + next action",
                "Check breach risk and adjust priority if needed",
                "Convert repeats into Problem ticket",
            ],
            "Signals suggest operational risk/backlog pressure rather than immediate outage.",
        )

    return (
        "P3",
        [
            "Capture context + repro steps",
            "Assign to backlog with acceptance criteria",
            "Review in weekly ops cadence",
        ],
        "Signals suggest low urgency; track for hygiene and prevent future issues.",
    )


@app.post("/triage", response_model=TriageResponse)
def triage(payload: TriageRequest) -> TriageResponse:
    prio, steps, rationale = triage_rules(payload.title, payload.description)
    return TriageResponse(suggested_priority=prio, next_steps=steps, rationale=rationale)