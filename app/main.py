from __future__ import annotations

import json
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.ai import generate_ai_summary, generate_initial_triage, generate_resolution_message

# =========================================
# Config
# =========================================
DB_PATH = "ops_triage.db"

PRIORITIES = ["P0", "P1", "P2", "P3"]
STATUSES = ["open", "investigating", "mitigated", "resolving", "resolved"]
ROLES = ["Operations Lead", "Engineering", "Customer Support", "Sales", "Product", "Finance", "Marketing", "HR / People", "Leadership", "On-call", "Ops Lead", "Support"]

SLA_MINUTES = {"P0": 30, "P1": 120, "P2": 480, "P3": 1440}

BREACH_THRESHOLD_TOTAL = 5
AGING_THRESHOLD_24H = 5

STATUS_TRANSITIONS = {
    "open": ["investigating"],
    "investigating": ["mitigated", "resolved"],
    "mitigated": ["resolved"],
    "resolving": ["resolved"],
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
            resolution_notes TEXT,
            resolution_source TEXT,
            original_resolution_note TEXT,
            resolution_communication TEXT,
            resolution_communicated_at TEXT,
            resolution_communicated_by TEXT,
            resolution_recipients TEXT,
            owner_team TEXT,
            owner_name TEXT,
            owner_assigned_at TEXT,
            owner_assigned_by TEXT,
            owner_assignment_reason TEXT,
            recommendation_accepted INTEGER NOT NULL DEFAULT 0,
            reporter_name TEXT,
            reporter_role TEXT,
            reporter_department TEXT,
            reporter_contact TEXT,
            report_source TEXT,
            source_reference TEXT,
            original_report TEXT,
            business_area TEXT,
            reporter_attention TEXT,
            initial_triage_json TEXT,
            initial_triage_source TEXT,
            initial_triage_generated_at TEXT,
            initial_triage_model TEXT
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
    if not _has_column(conn, "incidents", "resolution_source"):
        cur.execute("ALTER TABLE incidents ADD COLUMN resolution_source TEXT")
    if not _has_column(conn, "incidents", "original_resolution_note"):
        cur.execute("ALTER TABLE incidents ADD COLUMN original_resolution_note TEXT")
    if not _has_column(conn, "incidents", "resolution_communication"):
        cur.execute("ALTER TABLE incidents ADD COLUMN resolution_communication TEXT")
    if not _has_column(conn, "incidents", "resolution_communicated_at"):
        cur.execute("ALTER TABLE incidents ADD COLUMN resolution_communicated_at TEXT")
    if not _has_column(conn, "incidents", "resolution_communicated_by"):
        cur.execute("ALTER TABLE incidents ADD COLUMN resolution_communicated_by TEXT")
    if not _has_column(conn, "incidents", "resolution_recipients"):
        cur.execute("ALTER TABLE incidents ADD COLUMN resolution_recipients TEXT")
    if not _has_column(conn, "incidents", "resolved_at"):
        cur.execute("ALTER TABLE incidents ADD COLUMN resolved_at TEXT")
    if not _has_column(conn, "incidents", "resolved_by"):
        cur.execute("ALTER TABLE incidents ADD COLUMN resolved_by TEXT")
    if not _has_column(conn, "incidents", "owner_team"):
        cur.execute("ALTER TABLE incidents ADD COLUMN owner_team TEXT")
    if not _has_column(conn, "incidents", "owner_name"):
        cur.execute("ALTER TABLE incidents ADD COLUMN owner_name TEXT")
    if not _has_column(conn, "incidents", "owner_assigned_at"):
        cur.execute("ALTER TABLE incidents ADD COLUMN owner_assigned_at TEXT")
    if not _has_column(conn, "incidents", "owner_assigned_by"):
        cur.execute("ALTER TABLE incidents ADD COLUMN owner_assigned_by TEXT")
    if not _has_column(conn, "incidents", "owner_assignment_reason"):
        cur.execute("ALTER TABLE incidents ADD COLUMN owner_assignment_reason TEXT")
    if not _has_column(conn, "incidents", "recommendation_accepted"):
        cur.execute("ALTER TABLE incidents ADD COLUMN recommendation_accepted INTEGER NOT NULL DEFAULT 0")
    if not _has_column(conn, "incidents", "reporter_name"):
        cur.execute("ALTER TABLE incidents ADD COLUMN reporter_name TEXT")
    if not _has_column(conn, "incidents", "reporter_role"):
        cur.execute("ALTER TABLE incidents ADD COLUMN reporter_role TEXT")
    if not _has_column(conn, "incidents", "reporter_department"):
        cur.execute("ALTER TABLE incidents ADD COLUMN reporter_department TEXT")
    if not _has_column(conn, "incidents", "reporter_contact"):
        cur.execute("ALTER TABLE incidents ADD COLUMN reporter_contact TEXT")
    if not _has_column(conn, "incidents", "report_source"):
        cur.execute("ALTER TABLE incidents ADD COLUMN report_source TEXT")
    if not _has_column(conn, "incidents", "source_reference"):
        cur.execute("ALTER TABLE incidents ADD COLUMN source_reference TEXT")
    if not _has_column(conn, "incidents", "original_report"):
        cur.execute("ALTER TABLE incidents ADD COLUMN original_report TEXT")
    if not _has_column(conn, "incidents", "business_area"):
        cur.execute("ALTER TABLE incidents ADD COLUMN business_area TEXT")
    if not _has_column(conn, "incidents", "reporter_attention"):
        cur.execute("ALTER TABLE incidents ADD COLUMN reporter_attention TEXT")
    if not _has_column(conn, "incidents", "initial_triage_json"):
        cur.execute("ALTER TABLE incidents ADD COLUMN initial_triage_json TEXT")
    if not _has_column(conn, "incidents", "initial_triage_source"):
        cur.execute("ALTER TABLE incidents ADD COLUMN initial_triage_source TEXT")
    if not _has_column(conn, "incidents", "initial_triage_generated_at"):
        cur.execute("ALTER TABLE incidents ADD COLUMN initial_triage_generated_at TEXT")
    if not _has_column(conn, "incidents", "initial_triage_model"):
        cur.execute("ALTER TABLE incidents ADD COLUMN initial_triage_model TEXT")

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


def _parse_json_object(value: Optional[str]) -> Optional[Dict[str, Any]]:
    if not value:
        return None
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


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
        "resolution_source": _row_get(row, "resolution_source"),
        "original_resolution_note": _row_get(row, "original_resolution_note"),
        "resolution_communication": _row_get(row, "resolution_communication"),
        "resolution_communicated_at": _row_get(row, "resolution_communicated_at"),
        "resolution_communicated_by": _row_get(row, "resolution_communicated_by"),
        "resolution_recipients": json.loads(_row_get(row, "resolution_recipients") or "[]"),
        "owner_team": _row_get(row, "owner_team"),
        "owner_name": _row_get(row, "owner_name"),
        "owner_assigned_at": _row_get(row, "owner_assigned_at"),
        "owner_assigned_by": _row_get(row, "owner_assigned_by"),
        "owner_assignment_reason": _row_get(row, "owner_assignment_reason"),
        "recommendation_accepted": bool(_row_get(row, "recommendation_accepted", 0)),
        "reporter_name": _row_get(row, "reporter_name"),
        "reporter_role": _row_get(row, "reporter_role"),
        "reporter_department": _row_get(row, "reporter_department"),
        "reporter_contact": _row_get(row, "reporter_contact"),
        "report_source": _row_get(row, "report_source"),
        "source_reference": _row_get(row, "source_reference"),
        "original_report": _row_get(row, "original_report"),
        "business_area": _row_get(row, "business_area"),
        "reporter_attention": _row_get(row, "reporter_attention"),
        "initial_triage": _parse_json_object(_row_get(row, "initial_triage_json")),
        "initial_triage_source": _row_get(row, "initial_triage_source"),
        "initial_triage_generated_at": _row_get(row, "initial_triage_generated_at"),
        "initial_triage_model": _row_get(row, "initial_triage_model"),
    }


def seed_realistic_incidents_if_empty() -> None:
    if not SEED_IF_EMPTY:
        return

    conn = db()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) AS c FROM incidents")
    if int(cur.fetchone()["c"]) > 0:
        conn.close()
        return

    now = utcnow()

    active_incidents = [
        (
            "Payment processing delays affecting enterprise customers",
            "A small number of enterprise customers are experiencing intermittent payment processing delays. Engineering is investigating.",
            "P0","open", now - timedelta(minutes=45),
        ),
        (
            "Customer onboarding requests delayed",
            "New customer onboarding requests are taking longer than expected because of increased demand.",
            "P1","investigating", now - timedelta(hours=2),
        ),
        (
            "Increased customer support response times",
            "Higher than normal ticket volumes are impacting first response times.",
            "P1","open", now - timedelta(hours=5),
        ),
        (
            "Reporting dashboard refresh delayed",
            "Scheduled reporting refresh completed later than expected. Data remains accurate.",
            "P2","open", now - timedelta(days=1, hours=3),
        ),
        (
            "Internal knowledge base update required",
            "Several internal support articles require review following the latest product release.",
            "P3","open", now - timedelta(days=2),
        ),
    ]

    for title, desc, prio, status, created_at in active_incidents:
        iid = str(uuid.uuid4())
        created_iso = dt_to_iso(created_at)
        conn.execute(
            """
            INSERT INTO incidents
            (id, title, description, priority, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (iid, title, desc, prio, status, created_iso, created_iso),
        )
        add_timeline(conn, iid, "created", None, f"{prio} {status}")

    resolved_titles = [
        "Email delivery delays resolved",
        "Authentication timeout resolved",
        "CRM synchronisation restored",
        "Scheduled platform maintenance completed",
        "Search indexing restored",
        "User provisioning backlog cleared",
        "Customer notification issue resolved",
        "Reporting export issue resolved",
    ]

    resolvers = ["Engineering", "Support", "Ops Lead", "On-call"]

    for i in range(41):
        title = resolved_titles[i % len(resolved_titles)]
        created_at = now - timedelta(days=(i % 7), hours=(i % 8) + 3)
        resolved_at = created_at + timedelta(minutes=35 + (i % 6) * 10)
        iid = str(uuid.uuid4())

        conn.execute(
            """
            INSERT INTO incidents
            (id,title,description,priority,status,created_at,updated_at,resolved_at,resolved_by,resolution_notes)
            VALUES (?,?,?,?,?,?,?,?,?,?)
            """,
            (
                iid,
                title,
                "Resolved as part of normal operational activity.",
                ["P1","P2","P2","P3"][i % 4],
                "resolved",
                dt_to_iso(created_at),
                dt_to_iso(resolved_at),
                dt_to_iso(resolved_at),
                resolvers[i % len(resolvers)],
                "Issue resolved and monitored successfully.",
            ),
        )

        add_timeline(conn, iid, "created", None, "created")
        add_timeline(conn, iid, "resolved", "investigating", "resolved")

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
    reporter_name: Optional[str] = None
    reporter_role: Optional[str] = None
    reporter_department: Optional[str] = None
    reporter_contact: Optional[str] = None
    report_source: Optional[str] = None
    source_reference: Optional[str] = None
    original_report: Optional[str] = None
    business_area: Optional[str] = None
    reporter_attention: Optional[str] = None


class IncidentPatch(BaseModel):
    status: str
    priority: Optional[str] = None
    resolved_by: Optional[str] = None
    resolution_notes: Optional[str] = None
    resolution_source: Optional[str] = None
    original_resolution_note: Optional[str] = None
    note: Optional[str] = None  # free-text note at any stage


class TriageRequest(BaseModel):
    title: str = Field(min_length=3, max_length=120)
    description: str = Field(min_length=10, max_length=5000)


class TriageResponse(BaseModel):
    suggested_priority: str
    next_steps: List[str]
    rationale: str


class AIAssistantRequest(BaseModel):
    incident_id: str = Field(min_length=1)


class ResolutionMessageRequest(BaseModel):
    incident_id: str = Field(min_length=1)


class ResolutionCommunicationRequest(BaseModel):
    message: str = Field(min_length=1, max_length=5000)
    recipients: List[str] = Field(min_length=1)
    communicated_by: str = Field(default="Operations Manager", min_length=1, max_length=120)


class IncidentAllocationRequest(BaseModel):
    owner_team: str
    owner_name: Optional[str] = None
    allocated_by: str = Field(default="Operations Manager", min_length=1, max_length=120)
    reason: str = Field(default="Owner assigned by Operations Manager", min_length=1, max_length=5000)
    recommendation_accepted: bool = False


class IncidentEvidenceRequest(BaseModel):
    category: str = Field(min_length=1, max_length=120)
    information: str = Field(min_length=1, max_length=5000)
    added_by: str = Field(default="Operations Manager", min_length=1, max_length=120)


class StakeholderNotificationRequest(BaseModel):
    recipients: List[str] = Field(min_length=1)
    note: Optional[str] = Field(default=None, max_length=5000)
    recorded_by: str = Field(default="Operations Manager", min_length=1, max_length=120)


class ResolutionStartedRequest(BaseModel):
    action: str = Field(min_length=1, max_length=5000)
    owner: str = Field(min_length=1, max_length=120)
    recorded_by: str = Field(default="Operations Manager", min_length=1, max_length=120)


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
    """
    Persist the reported incident first, then attempt lightweight AI triage.

    AI is decision support only: it never prevents incident creation and it
    does not silently overwrite the provisional priority supplied at intake.
    """
    prio = normalize_priority(payload.priority)
    now = utcnow()
    now_iso = dt_to_iso(now)
    iid = str(uuid.uuid4())

    def clean(value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        return value or None

    incident_values = {
        "reporter_name": clean(payload.reporter_name),
        "reporter_role": clean(payload.reporter_role),
        "reporter_department": clean(payload.reporter_department),
        "reporter_contact": clean(payload.reporter_contact),
        "report_source": clean(payload.report_source),
        "source_reference": clean(payload.source_reference),
        "original_report": clean(payload.original_report),
        "business_area": clean(payload.business_area),
        "reporter_attention": clean(payload.reporter_attention),
    }

    conn = db()
    try:
        conn.execute(
            """
            INSERT INTO incidents (
                id, title, description, priority, status, created_at, updated_at,
                reporter_name, reporter_role, reporter_department, reporter_contact,
                report_source, source_reference, original_report, business_area,
                reporter_attention
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                iid,
                payload.title.strip(),
                payload.description.strip(),
                prio,
                "open",
                now_iso,
                now_iso,
                incident_values["reporter_name"],
                incident_values["reporter_role"],
                incident_values["reporter_department"],
                incident_values["reporter_contact"],
                incident_values["report_source"],
                incident_values["source_reference"],
                incident_values["original_report"],
                incident_values["business_area"],
                incident_values["reporter_attention"],
            ),
        )
        add_timeline(conn, iid, "created", None, f"{prio} open")
        conn.commit()
    except Exception:
        conn.rollback()
        raise

    # Build the persisted incident context used by the lightweight triage.
    row = conn.execute("SELECT * FROM incidents WHERE id = ?", (iid,)).fetchone()
    incident_data = incident_row_to_dict(row)

    triage_result: Dict[str, Any]
    triage_summary: Dict[str, Any]
    triage_source: str
    triage_model: Optional[str]
    triage_generated_at: str

    try:
        triage_result = generate_initial_triage(incident_data)
        triage_summary = triage_result.get("summary") or {}
        if not isinstance(triage_summary, dict) or not triage_summary:
            raise ValueError("Initial AI triage returned no structured summary.")
        triage_source = str(triage_result.get("source") or "OpenAI")
        triage_model = triage_result.get("model")
        triage_generated_at = str(triage_result.get("generated_at") or dt_to_iso(utcnow()))
    except Exception:
        fallback_priority, fallback_steps, fallback_reason = triage_rules(
            payload.title.strip(),
            payload.description.strip(),
        )
        triage_summary = {
            "suggested_priority": fallback_priority,
            "operational_risk": fallback_reason,
            "reason": fallback_reason,
            "suggested_first_action": (
                fallback_steps[0] if fallback_steps else "Review the incident evidence."
            ),
            "missing_information": [],
        }
        triage_source = "Rule-based fallback"
        triage_model = None
        triage_generated_at = dt_to_iso(utcnow())

    # Normalise the persisted lightweight triage contract.
    suggested_priority = str(triage_summary.get("suggested_priority") or "P2").upper()
    if suggested_priority not in PRIORITIES:
        suggested_priority = "P2"
    triage_summary["suggested_priority"] = suggested_priority

    missing_information = triage_summary.get("missing_information")
    if not isinstance(missing_information, list):
        missing_information = []
    triage_summary["missing_information"] = [
        str(item).strip()
        for item in missing_information
        if str(item).strip()
    ][:3]

    triage_json = json.dumps(triage_summary, ensure_ascii=False)

    conn.execute(
        """
        UPDATE incidents
        SET initial_triage_json = ?,
            initial_triage_source = ?,
            initial_triage_generated_at = ?,
            initial_triage_model = ?,
            updated_at = ?
        WHERE id = ?
        """,
        (
            triage_json,
            triage_source,
            triage_generated_at,
            triage_model,
            dt_to_iso(utcnow()),
            iid,
        ),
    )

    # Keep the visible timeline value concise/human-readable while preserving
    # the full assessment in the incident record.
    add_timeline(
        conn,
        iid,
        "initial_triage_generated",
        None,
        f"{triage_source} · suggested {suggested_priority}",
    )
    conn.commit()

    return {
        "id": iid,
        "initial_triage": triage_summary,
        "initial_triage_source": triage_source,
        "initial_triage_generated_at": triage_generated_at,
        "initial_triage_model": triage_model,
    }


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

    now = utcnow()
    priority = row["priority"]
    resolved_at = row["resolved_at"]
    resolved_by = row["resolved_by"]
    resolution_notes = row["resolution_notes"]
    resolution_source = _row_get(row, "resolution_source")
    original_resolution_note = _row_get(row, "original_resolution_note")
    resolution_communication = _row_get(row, "resolution_communication")
    resolution_communicated_at = _row_get(row, "resolution_communicated_at")
    resolution_communicated_by = _row_get(row, "resolution_communicated_by")
    resolution_recipients = _row_get(row, "resolution_recipients")

    if payload.priority is not None:
        new_prio = normalize_priority(payload.priority)
        if new_prio != priority:
            add_timeline(conn, incident_id, "priority_changed", priority, new_prio)
            priority = new_prio

    if payload.note is not None and payload.note.strip():
        add_timeline(conn, incident_id, "note_added", None, payload.note.strip())

    # Resolution evidence and Operations summary can be saved while the incident
    # remains investigating. This does not advance the lifecycle.
    if payload.resolution_source is not None:
        resolution_source = payload.resolution_source.strip() or None
    if payload.original_resolution_note is not None:
        original_resolution_note = payload.original_resolution_note.strip() or None
    if payload.resolution_notes is not None and new_status != "resolved":
        resolution_notes = payload.resolution_notes.strip() or None

    if new_status == "resolved" and old_status != "resolved":
        if not resolution_source or not original_resolution_note or not (payload.resolution_notes or resolution_notes):
            conn.close()
            raise HTTPException(status_code=400, detail="Complete and save the resolution evidence and summary before resolving")
        if not resolution_communication or not resolution_communicated_at:
            conn.close()
            raise HTTPException(status_code=400, detail="Mark the resolution communication as communicated before resolving")

        # V1: Operations owns the final closure decision. Authentication is not
        # part of the demo, so the acting user is recorded consistently here.
        resolved_by = "Operations Manager"
        resolution_notes = (payload.resolution_notes or resolution_notes).strip()
        resolved_at = dt_to_iso(now)
        add_timeline(conn, incident_id, "resolved_by", row["resolved_by"], resolved_by)
        add_timeline(conn, incident_id, "resolution_notes", None, resolution_notes)
        add_timeline(conn, incident_id, "resolved_at", row["resolved_at"], resolved_at)

    if new_status != old_status:
        add_timeline(conn, incident_id, "status_changed", old_status, new_status)

    conn.execute(
        """
        UPDATE incidents
        SET priority = ?, status = ?, updated_at = ?, resolved_at = ?, resolved_by = ?,
            resolution_notes = ?, resolution_source = ?, original_resolution_note = ?,
            resolution_communication = ?, resolution_communicated_at = ?, resolution_communicated_by = ?, resolution_recipients = ?
        WHERE id = ?
        """,
        (priority, new_status, dt_to_iso(now), resolved_at, resolved_by,
         resolution_notes, resolution_source, original_resolution_note,
         resolution_communication, resolution_communicated_at, resolution_communicated_by, resolution_recipients, incident_id),
    )
    conn.commit()

    out = conn.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone()
    conn.close()
    return incident_row_to_dict(out)


def _resolution_recipients(conn: sqlite3.Connection, incident: sqlite3.Row) -> List[str]:
    """Reporter plus stakeholders already coordinated. Supports legacy V1 note events."""
    recipients: List[str] = []
    reporter = (_row_get(incident, "reporter_name") or "").strip()
    if reporter:
        recipients.append(f"Original reporter — {reporter}")

    events = conn.execute(
        "SELECT event_type, new_value FROM timeline WHERE incident_id = ? ORDER BY created_at ASC",
        (incident["id"],),
    ).fetchall()
    for event in events:
        value = event["new_value"] or ""
        if event["event_type"] == "stakeholders_notified":
            parsed = _parse_json_object(value) or {}
            for item in parsed.get("recipients", []):
                name = str(item).strip()
                if name and name not in recipients:
                    recipients.append(name)
        elif event["event_type"] == "note_added" and value.startswith("Stakeholders notified:"):
            # Compatibility for incidents coordinated before the structured endpoint was wired in.
            first = value.split(". Incident status:", 1)[0]
            raw = first.replace("Stakeholders notified:", "", 1)
            for item in raw.split(","):
                name = item.strip()
                if name and name not in recipients:
                    recipients.append(name)
    return recipients


@app.get("/incidents/{incident_id}/resolution/recipients")
def get_resolution_recipients(incident_id: str) -> Dict[str, Any]:
    conn = db()
    try:
        incident = conn.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone()
        if not incident:
            raise HTTPException(status_code=404, detail="Incident not found")
        return {"recipients": _resolution_recipients(conn, incident)}
    finally:
        conn.close()


@app.post("/ai/resolution-message")
def ai_resolution_message(payload: ResolutionMessageRequest) -> Dict[str, Any]:
    conn = db()
    try:
        incident = conn.execute("SELECT * FROM incidents WHERE id = ?", (payload.incident_id,)).fetchone()
        if not incident:
            raise HTTPException(status_code=404, detail="Incident not found")
        data = incident_row_to_dict(incident)
        if not data.get("resolution_source") or not data.get("original_resolution_note") or not data.get("resolution_notes"):
            raise HTTPException(status_code=400, detail="Save the resolution evidence and Operations summary before generating the message")
        recipients = _resolution_recipients(conn, incident)
        return generate_resolution_message(data, recipients)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Resolution message assistant unavailable: {exc}") from exc
    finally:
        conn.close()


@app.post("/incidents/{incident_id}/resolution/communicate")
def mark_resolution_communicated(incident_id: str, payload: ResolutionCommunicationRequest) -> Dict[str, Any]:
    message = payload.message.strip()
    recipients = [str(item).strip() for item in payload.recipients if str(item).strip()]
    if not message:
        raise HTTPException(status_code=400, detail="Resolution communication message is required")
    if not recipients:
        raise HTTPException(status_code=400, detail="Resolution communication recipients are required")

    conn = db()
    try:
        incident = conn.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone()
        if not incident:
            raise HTTPException(status_code=404, detail="Incident not found")
        if incident["status"] == "resolved":
            raise HTTPException(status_code=400, detail="Resolved incidents are read-only")
        if not _row_get(incident, "resolution_source") or not _row_get(incident, "original_resolution_note") or not _row_get(incident, "resolution_notes"):
            raise HTTPException(status_code=400, detail="Save the resolution evidence and Operations summary first")
        if _row_get(incident, "resolution_communicated_at"):
            raise HTTPException(status_code=400, detail="Resolution communication is already locked")

        communicated_at = dt_to_iso(utcnow())
        communicated_by = payload.communicated_by.strip()
        recipients_json = json.dumps(recipients, ensure_ascii=False)
        conn.execute(
            """UPDATE incidents SET resolution_communication = ?, resolution_communicated_at = ?,
               resolution_communicated_by = ?, resolution_recipients = ?, updated_at = ? WHERE id = ?""",
            (message, communicated_at, communicated_by, recipients_json, communicated_at, incident_id),
        )
        add_timeline(conn, incident_id, "resolution_communicated", None, json.dumps({
            "recipients": recipients,
            "message": message,
            "communicated_by": communicated_by,
            "communicated_at": communicated_at,
        }, ensure_ascii=False))
        conn.commit()
        updated = conn.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone()
        return {"success": True, "incident": incident_row_to_dict(updated)}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Resolution communication could not be recorded: {exc}") from exc
    finally:
        conn.close()


@app.post("/incidents/{incident_id}/evidence")
def add_incident_evidence(incident_id: str, payload: IncidentEvidenceRequest) -> Dict[str, Any]:
    """
    Append new operational information to an existing incident without
    altering the immutable intake/provenance record.

    Evidence is stored in Activity History as structured JSON so it:
      - survives refresh/reopening and the full incident lifecycle,
      - remains human-readable in the current frontend,
      - is automatically available to future AI assessments because the
        assistant already receives the incident timeline.
    """
    category = payload.category.strip()
    information = payload.information.strip()
    added_by = payload.added_by.strip()

    if not category:
        raise HTTPException(status_code=400, detail="category is required")
    if not information:
        raise HTTPException(status_code=400, detail="information is required")
    if not added_by:
        raise HTTPException(status_code=400, detail="added_by is required")

    conn = db()
    try:
        incident = conn.execute(
            "SELECT * FROM incidents WHERE id = ?",
            (incident_id,),
        ).fetchone()

        if not incident:
            raise HTTPException(status_code=404, detail="Incident not found")

        if incident["status"] == "resolved":
            raise HTTPException(
                status_code=400,
                detail="Resolved incidents are read-only; restore/reopen before adding new information.",
            )

        evidence_record = {
            "category": category,
            "information": information,
            "added_by": added_by,
        }

        # Deliberately append to the timeline only. Reporter/provenance fields,
        # original_report and the original description are never overwritten.
        add_timeline(
            conn,
            incident_id,
            "evidence_added",
            None,
            json.dumps(evidence_record, ensure_ascii=False),
        )

        now_iso = dt_to_iso(utcnow())
        conn.execute(
            "UPDATE incidents SET updated_at = ? WHERE id = ?",
            (now_iso, incident_id),
        )
        conn.commit()

        updated = conn.execute(
            "SELECT * FROM incidents WHERE id = ?",
            (incident_id,),
        ).fetchone()

        return {
            "success": True,
            "incident": incident_row_to_dict(updated),
            "evidence": evidence_record,
            "recorded_at": now_iso,
        }
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Incident information could not be added: {exc}",
        ) from exc
    finally:
        conn.close()


@app.post("/incidents/{incident_id}/stakeholders")
def record_stakeholder_notifications(
    incident_id: str,
    payload: StakeholderNotificationRequest,
) -> Dict[str, Any]:
    """
    Record stakeholder coordination as a structured Activity History event.
    This replaces the earlier generic note string while leaving the incident
    status/ownership model unchanged.
    """
    recipients = [str(item).strip() for item in payload.recipients if str(item).strip()]
    if not recipients:
        raise HTTPException(status_code=400, detail="Select at least one stakeholder.")

    note = payload.note.strip() if payload.note and payload.note.strip() else None
    recorded_by = payload.recorded_by.strip()

    conn = db()
    try:
        incident = conn.execute(
            "SELECT * FROM incidents WHERE id = ?",
            (incident_id,),
        ).fetchone()
        if not incident:
            raise HTTPException(status_code=404, detail="Incident not found")
        if incident["status"] == "resolved":
            raise HTTPException(status_code=400, detail="Resolved incidents are read-only")
        if not _row_get(incident, "owner_team"):
            raise HTTPException(status_code=400, detail="Assign an incident owner before recording stakeholder coordination.")

        event = {
            "recipients": recipients,
            "note": note,
            "recorded_by": recorded_by,
        }
        add_timeline(
            conn,
            incident_id,
            "stakeholders_notified",
            None,
            json.dumps(event, ensure_ascii=False),
        )

        # Preserve the existing V1 behaviour: entering coordination moves a
        # newly-open incident into the investigating operational state.
        if incident["status"] == "open":
            add_timeline(conn, incident_id, "status_changed", "open", "investigating")
            conn.execute(
                "UPDATE incidents SET status = ?, updated_at = ? WHERE id = ?",
                ("investigating", dt_to_iso(utcnow()), incident_id),
            )
        else:
            conn.execute(
                "UPDATE incidents SET updated_at = ? WHERE id = ?",
                (dt_to_iso(utcnow()), incident_id),
            )

        conn.commit()
        updated = conn.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone()
        return {
            "success": True,
            "incident": incident_row_to_dict(updated),
            "stakeholders": event,
        }
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Stakeholder coordination could not be recorded: {exc}") from exc
    finally:
        conn.close()


@app.post("/incidents/{incident_id}/allocate")
def allocate_incident(incident_id: str, payload: IncidentAllocationRequest) -> Dict[str, Any]:
    """
    Assign accountable ownership to an incident and record the decision
    in Activity History.
    """
    owner_team = normalize_role(payload.owner_team)
    owner_name = payload.owner_name.strip() if payload.owner_name and payload.owner_name.strip() else None
    allocated_by = payload.allocated_by.strip()
    reason = payload.reason.strip()
    assigned_at = dt_to_iso(utcnow())

    conn = db()
    try:
        row = conn.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Incident not found")

        if row["status"] == "resolved":
            raise HTTPException(status_code=400, detail="Resolved incidents cannot be reassigned")

        previous_team = _row_get(row, "owner_team")
        previous_name = _row_get(row, "owner_name")
        previous_display = (
            f"{previous_team} — {previous_name}"
            if previous_team and previous_name
            else previous_team
        )
        new_display = f"{owner_team} — {owner_name}" if owner_name else owner_team
        is_reassignment = bool(previous_team)

        if is_reassignment and previous_display == new_display:
            raise HTTPException(status_code=400, detail="Choose a different owner before confirming the handoff")

        conn.execute(
            """
            UPDATE incidents
            SET owner_team = ?,
                owner_name = ?,
                owner_assigned_at = ?,
                owner_assigned_by = ?,
                owner_assignment_reason = ?,
                recommendation_accepted = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                owner_team,
                owner_name,
                assigned_at,
                allocated_by,
                reason,
                1 if payload.recommendation_accepted else 0,
                assigned_at,
                incident_id,
            ),
        )

        if is_reassignment:
            decision = "Incident owner reassigned by Operations Manager"
            event_type = "owner_changed"
        else:
            decision = (
                "AI recommendation accepted by Operations Manager"
                if payload.recommendation_accepted
                else "Owner assigned manually by Operations Manager"
            )
            event_type = "owner_assigned"

        add_timeline(
            conn,
            incident_id,
            event_type,
            previous_display if is_reassignment else None,
            json.dumps(
                {
                    "owner_team": owner_team,
                    "owner_name": owner_name,
                    "previous_owner": previous_display,
                    "allocated_by": allocated_by,
                    "assigned_at": assigned_at,
                    "reason": reason,
                    "decision": decision,
                    "recommendation_accepted": payload.recommendation_accepted,
                },
                ensure_ascii=False,
            ),
        )

        conn.commit()
        updated = conn.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone()
        return incident_row_to_dict(updated)
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Incident allocation failed: {exc}") from exc
    finally:
        conn.close()


@app.delete("/incidents/{incident_id}")
def delete_incident(incident_id: str) -> Dict[str, Any]:
    conn = db()
    try:
        row = conn.execute("SELECT id, title FROM incidents WHERE id = ?", (incident_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Incident not found")

        # Hard delete is acceptable for this local portfolio demo.
        # A production implementation should normally use soft deletion
        # so the audit record can be retained.
        conn.execute("DELETE FROM timeline WHERE incident_id = ?", (incident_id,))
        conn.execute("DELETE FROM incidents WHERE id = ?", (incident_id,))
        conn.commit()

        return {
            "success": True,
            "deleted_incident_id": incident_id,
            "deleted_incident_title": row["title"],
        }
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=500, detail="Failed to delete incident") from exc
    finally:
        conn.close()


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
        status = "amber"
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
                "title": "Prioritise the critical incident",
                "why": "Resolving the current critical incident will reduce operational risk and improve overall service health.",
                "expected_impact": "High — reduces operational risk and improves service health.",
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
            "action_type": "Improve incident documentation",
            "title": "Improve incident documentation",
            "why": "Consistent documentation improves reporting, knowledge sharing and operational visibility..",
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
        summary = "Operational health is GREEN — no key operational risks detected."
    else:
        parts = [r["label"] for r in reasons]

        if status == "red":
            summary = (
                "Operational health is AMBER — "
                "Operations remain stable, although one critical incident requires immediate attention."
            )
        else:
            summary = (
                f"Operational health is {status.upper()} — "
                + "; ".join(parts)
                + "."
            )

    return {
        "generated_at": dt_to_iso(utcnow()),
        "health_status": status,
        "summary": summary,
    }


# =========================================
# AI Operations Assistant
# =========================================
@app.post("/ai/assistant")
def ai_assistant(payload: AIAssistantRequest) -> Dict[str, Any]:
    """
    Generate an AI Operational Assessment and record the generation event
    in the incident Activity History. Operational decisions remain human-owned.
    """
    conn = db()
    try:
        incident = conn.execute(
            "SELECT * FROM incidents WHERE id = ?",
            (payload.incident_id,),
        ).fetchone()

        if not incident:
            raise HTTPException(status_code=404, detail="Incident not found")

        timeline_rows = conn.execute(
            """
            SELECT event_type, created_at, old_value, new_value
            FROM timeline
            WHERE incident_id = ?
            ORDER BY created_at ASC
            LIMIT 100
            """,
            (payload.incident_id,),
        ).fetchall()

        incident_data = incident_row_to_dict(incident)
        timeline_data = [dict(row) for row in timeline_rows]

        result = generate_ai_summary(incident_data, timeline_data)

        summary = result.get("summary") if isinstance(result, dict) else None
        if not summary:
            raise HTTPException(
                status_code=502,
                detail="AI Operational Assessment did not return a valid structured summary.",
            )

        audit_value = json.dumps(
            {
                "model": result.get("model"),
                "source": result.get("source"),
                "generated_at": result.get("generated_at"),
                "usage": result.get("usage"),
            }
        )
        add_timeline(
            conn,
            payload.incident_id,
            "ai_assessment_generated",
            None,
            audit_value,
        )
        conn.commit()

        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"AI Operational Assessment unavailable: {exc}",
        )
    finally:
        conn.close()


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
    resolved_under_24h_count = 0
    resolved_under_48h_count = 0
    resolved_within_sla_count = 0
    sla_eligible_count = 0
    mttrs: List[int] = []
    by_role: Dict[str, int] = {}

    for r in rows:
        if r["priority"] == "P0":
            p0_resolved_count += 1

        cdt = iso_to_dt(r["created_at"])
        rdt = iso_to_dt(r["resolved_at"]) if r["resolved_at"] else None
        if cdt and rdt and rdt >= cdt:
            resolution_minutes = minutes_between(cdt, rdt)
            mttrs.append(resolution_minutes)

            if resolution_minutes < 24 * 60:
                resolved_under_24h_count += 1
            if resolution_minutes < 48 * 60:
                resolved_under_48h_count += 1

            # SLA attainment is measured across resolved incidents in the
            # selected reporting window. Each incident is assessed against
            # the SLA associated with its priority.
            sla_minutes = SLA_MINUTES.get(r["priority"])
            if sla_minutes is not None:
                sla_eligible_count += 1
                if resolution_minutes <= sla_minutes:
                    resolved_within_sla_count += 1

        role = (r["resolved_by"] or "").strip() or "Unassigned"
        by_role[role] = by_role.get(role, 0) + 1

    avg_mttr = int(sum(mttrs) / len(mttrs)) if mttrs else None
    sla_attainment_pct = (
        round((resolved_within_sla_count / sla_eligible_count) * 100, 1)
        if sla_eligible_count
        else None
    )

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
        "resolved_under_24h_count": resolved_under_24h_count,
        "resolved_under_48h_count": resolved_under_48h_count,
        "resolved_within_sla_count": resolved_within_sla_count,
        "sla_eligible_count": sla_eligible_count,
        "sla_attainment_pct": sla_attainment_pct,
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
