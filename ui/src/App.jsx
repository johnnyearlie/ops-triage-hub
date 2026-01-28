import React, { useEffect, useMemo, useState } from "react";

/**
 * Ops Triage Hub — Demo UI (dark theme)
 * - Uses Vite proxy: /api -> http://127.0.0.1:8000 (rewrite /api away)
 * - Endpoints expect backend routes like /ops/health, /ops/kpis, etc.
 */

const API = {
  health: "/api/ops/health",
  recs: "/api/ops/recommendations",
  summary: "/api/ops/recommendations/summary",
  active: "/api/ops/active-incidents",
  kpis: "/api/ops/kpis",
  incidents: "/api/incidents",
  triage: "/api/triage",
  timeline: (id) => `/api/incidents/${id}/timeline`,
  patchIncident: (id) => `/api/incidents/${id}`,
};

const PRIORITIES = ["P0", "P1", "P2", "P3"];
const STATUSES = ["open", "investigating", "mitigated", "resolved"];
const ROLES = ["On-call", "Ops Lead", "Support", "Engineering"];

const STATUS_TRANSITIONS = {
  open: ["investigating"],
  investigating: ["mitigated", "resolved"],
  mitigated: ["resolved"],
  resolved: [],
};

const THEME = {
  pageBg: "#0b1020",
  cardBg: "rgba(255,255,255,0.06)",
  cardBorder: "rgba(255,255,255,0.10)",
  subtleBorder: "rgba(255,255,255,0.12)",
  subtleText: "rgba(255,255,255,0.62)",
  text: "rgba(255,255,255,0.92)",
  heading: "rgba(255,255,255,0.92)",
  inputBg: "rgba(255,255,255,0.07)",
  inputBorder: "rgba(255,255,255,0.14)",
  inputBorderHover: "rgba(255,255,255,0.22)",
  buttonBg: "rgba(255,255,255,0.08)",
  buttonBgHover: "rgba(255,255,255,0.11)",
  primaryBg: "rgba(255,255,255,0.12)",
  primaryBgHover: "rgba(255,255,255,0.16)",
  dangerBg: "rgba(255, 90, 90, 0.12)",
  dangerBorder: "rgba(255, 90, 90, 0.28)",
  dangerText: "rgba(255, 210, 210, 0.92)",
  shadow: "0 10px 30px rgba(0,0,0,0.35)",
};

async function jfetch(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    data = text;
  }
  if (!res.ok) {
    const msg =
      (data &&
        data.detail &&
        (typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail))) ||
      (typeof data === "string" ? data : "Request failed");
    throw new Error(msg);
  }
  return data;
}

function Card({ title, right, children }) {
  return (
    <div
      style={{
        border: `1px solid ${THEME.cardBorder}`,
        borderRadius: 16,
        padding: 14,
        background: THEME.cardBg,
        boxShadow: THEME.shadow,
        backdropFilter: "blur(10px)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div style={{ fontWeight: 800, color: THEME.heading }}>{title}</div>
        {right}
      </div>
      <div style={{ marginTop: 10 }}>{children}</div>
    </div>
  );
}

function Pill({ children, tone = "neutral" }) {
  const tones = {
    red: { bg: "rgba(239,68,68,0.18)", border: "rgba(239,68,68,0.40)", text: "rgba(255,255,255,0.95)" },
    amber: { bg: "rgba(245,158,11,0.18)", border: "rgba(245,158,11,0.40)", text: "rgba(255,255,255,0.95)" },
    green: { bg: "rgba(34,197,94,0.18)", border: "rgba(34,197,94,0.40)", text: "rgba(255,255,255,0.95)" },
    neutral: { bg: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.14)", text: "rgba(255,255,255,0.92)" },
  };

  const t = tones[tone] || tones.neutral;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "2px 10px",
        borderRadius: 999,
        border: `1px solid ${t.border}`,
        background: t.bg,
        color: t.text,
        fontSize: 12,
        lineHeight: "18px",
        fontWeight: 700,
        letterSpacing: 0.2,
      }}
    >
      {children}
    </span>
  );
}

function Label({ children }) {
  return <div style={{ fontSize: 12, color: THEME.subtleText, marginBottom: 6 }}>{children}</div>;
}

function InputBaseStyle(disabled = false) {
  return {
    width: "100%",
    padding: 10,
    borderRadius: 12,
    border: `1px solid ${THEME.inputBorder}`,
    background: disabled ? "rgba(255,255,255,0.05)" : THEME.inputBg,
    color: THEME.text,
    outline: "none",
  };
}

function Select({ value, onChange, options, disabled }) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={{
        ...InputBaseStyle(disabled),
        cursor: disabled ? "not-allowed" : "pointer",
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.borderColor = THEME.inputBorderHover;
      }}
      onMouseLeave={(e) => {
        if (!disabled) e.currentTarget.style.borderColor = THEME.inputBorder;
      }}
    >
      {options.map((o) => (
        <option key={o} value={o} style={{ color: "#111" }}>
          {o}
        </option>
      ))}
    </select>
  );
}

function Button({ children, onClick, disabled, variant = "default", title }) {
  const isPrimary = variant === "primary";
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "10px 12px",
        borderRadius: 12,
        border: `1px solid ${THEME.subtleBorder}`,
        background: isPrimary ? THEME.primaryBg : THEME.buttonBg,
        color: THEME.text,
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 750,
        transition: "transform 0.06s ease, background 0.2s ease, border-color 0.2s ease",
        opacity: disabled ? 0.6 : 1,
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = isPrimary ? THEME.primaryBgHover : THEME.buttonBgHover;
        e.currentTarget.style.borderColor = THEME.inputBorderHover;
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = isPrimary ? THEME.primaryBg : THEME.buttonBg;
        e.currentTarget.style.borderColor = THEME.subtleBorder;
      }}
      onMouseDown={(e) => {
        if (!disabled) e.currentTarget.style.transform = "translateY(1px)";
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      {children}
    </button>
  );
}

export default function App() {
  // Data
  const [health, setHealth] = useState(null);
  const [summary, setSummary] = useState(null);
  const [recs, setRecs] = useState(null);
  const [active, setActive] = useState([]);
  const [resolved, setResolved] = useState([]);
  const [kpis, setKpis] = useState(null);

  // UI state
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // Create incident
  const [cTitle, setCTitle] = useState("");
  const [cDesc, setCDesc] = useState("");
  const [cPriority, setCPriority] = useState("P2");
  const [triage, setTriage] = useState(null);
  const [creating, setCreating] = useState(false);

  // Selection + update
  const [selectedId, setSelectedId] = useState("");
  const [timeline, setTimeline] = useState([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  const selectedIncident = useMemo(
    () => active.find((i) => i.id === selectedId) || resolved.find((i) => i.id === selectedId) || null,
    [active, resolved, selectedId]
  );

  // Timeline UX
  const [timelineCollapsed, setTimelineCollapsed] = useState(true); // default collapsed
  const TIMELINE_MAX_HEIGHT = 260;

  // Update fields
  const [uStatus, setUStatus] = useState("investigating");
  const [uPriority, setUPriority] = useState("");
  const [uResolvedBy, setUResolvedBy] = useState("On-call");
  const [uNotes, setUNotes] = useState("");
  const [uNote, setUNote] = useState("");
  const [updating, setUpdating] = useState(false);

  // KPI filters
  const [kpiDays, setKpiDays] = useState(90);
  const [resolverFilter, setResolverFilter] = useState("All");

  // Refresh only the update panel (keeps page stable)
  async function refreshSelected() {
    if (!selectedId) return;
    setErr("");
    try {
      const [a, resList] = await Promise.all([
        jfetch(API.active),
        jfetch(`${API.incidents}?status=resolved&days=${kpiDays}&limit=200`),
      ]);

      const nextActive = Array.isArray(a) ? a : [];
      const nextResolved = Array.isArray(resList) ? resList : [];

      setActive(nextActive);
      setResolved(nextResolved);

      const inc = nextActive.find((x) => x.id === selectedId) || nextResolved.find((x) => x.id === selectedId);

      if (inc) {
        setUStatus(inc.status || "investigating");
        setUPriority(inc.priority || "");
        setUResolvedBy(inc.resolved_by || "On-call");
        setUNotes(inc.resolution_notes || "");
      }

      await loadTimeline(selectedId);
    } catch (e) {
      setErr(e.message || "Failed to refresh selection");
    }
  }

  async function loadAll() {
    setErr("");
    setLoading(true);
    try {
      const [h, s, r, a, k] = await Promise.all([
        jfetch(API.health),
        jfetch(API.summary),
        jfetch(API.recs),
        jfetch(API.active),
        jfetch(`${API.kpis}?days=${kpiDays}`),
      ]);

      setHealth(h);
      setSummary(s);
      setRecs(r);
      setActive(Array.isArray(a) ? a : []);
      setKpis(k);

      const resList = await jfetch(`${API.incidents}?status=resolved&days=${kpiDays}&limit=200`);
      setResolved(Array.isArray(resList) ? resList : []);
    } catch (e) {
      setErr(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function loadTimeline(id) {
    if (!id) return;
    setTimelineLoading(true);
    try {
      const t = await jfetch(API.timeline(id));
      setTimeline(Array.isArray(t) ? t : []);
    } catch (e) {
      setTimeline([]);
      setErr(e.message || "Failed to load timeline");
    } finally {
      setTimelineLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const k = await jfetch(`${API.kpis}?days=${kpiDays}`);
        setKpis(k);
        const resList = await jfetch(`${API.incidents}?status=resolved&days=${kpiDays}&limit=200`);
        setResolved(Array.isArray(resList) ? resList : []);
      } catch (e) {
        setErr(e.message || "Failed to refresh KPIs");
      }
    })();
  }, [kpiDays]);

  async function runTriage() {
    setErr("");
    setTriage(null);
    try {
      const out = await jfetch(API.triage, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: cTitle.trim(), description: cDesc.trim() }),
      });
      setTriage(out);
      if (out?.suggested_priority && PRIORITIES.includes(out.suggested_priority)) {
        setCPriority(out.suggested_priority);
      }
    } catch (e) {
      setErr(e.message || "Triage failed");
    }
  }
  async function createIncident() {
    setErr("");
    setCreating(true);
    try {
      if (!triage && cTitle.trim().length >= 3 && cDesc.trim().length >= 10) {
        await runTriage();
      }

      const out = await jfetch(API.incidents, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: cTitle.trim(),
          description: cDesc.trim(),
          priority: cPriority,
        }),
      });

      setCTitle("");
      setCDesc("");
      setCPriority("P2");
      setTriage(null);

      await loadAll();
      if (out?.id) {
        setSelectedId(out.id);
        setTimelineCollapsed(true);
        await loadTimeline(out.id);
      }
    } catch (e) {
      setErr(e.message || "Create failed");
    } finally {
      setCreating(false);
    }
  }

  function allowedNextStatuses(from) {
    return [from, ...(STATUS_TRANSITIONS[from] || [])];
  }

  async function selectIncident(id) {
    setSelectedId(id);
    setTimelineCollapsed(true);

    const inc = active.find((x) => x.id === id) || resolved.find((x) => x.id === id);
    if (inc) {
      setUStatus(inc.status || "investigating");
      setUPriority(inc.priority || "");
      setUResolvedBy(inc.resolved_by || "On-call");
      setUNotes(inc.resolution_notes || "");
      setUNote("");
    }
    await loadTimeline(id);
  }

  async function updateIncident() {
    if (!selectedId) return;
    setErr("");
    setUpdating(true);
    try {
      const body = { status: uStatus };

      if (uPriority && PRIORITIES.includes(uPriority)) body.priority = uPriority;
      if (uNote.trim().length > 0) body.note = uNote.trim();

      if (uStatus === "resolved") {
        body.resolved_by = uResolvedBy;
        body.resolution_notes = uNotes;
      }

      await jfetch(API.patchIncident(selectedId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      setUNote("");
      await loadAll();
      await loadTimeline(selectedId);
    } catch (e) {
      setErr(e.message || "Update failed");
    } finally {
      setUpdating(false);
    }
  }

  const invalidResolve = uStatus === "resolved" && (!uResolvedBy || uNotes.trim().length === 0);
  const allowedStatusesForSelected = selectedIncident ? allowedNextStatuses(selectedIncident.status) : STATUSES;

  const topResolvers = kpis?.top_resolvers || [];
  const resolvedFiltered =
    resolverFilter === "All"
      ? resolved
      : resolved.filter((i) => (i.resolved_by || "Unassigned") === resolverFilter);

  const resolverOptions = useMemo(() => {
    const rolesFromKpi = topResolvers.map((r) => r.role);
    const rolesFromResolved = Array.from(
      new Set(resolved.map((i) => (i.resolved_by || "Unassigned").trim() || "Unassigned"))
    );
    return Array.from(new Set(["All", ...rolesFromKpi, ...rolesFromResolved]));
  }, [topResolvers, resolved]);

  const Page = {
    padding: 18,
    minHeight: "100vh",
    background:
      "radial-gradient(1200px 600px at 20% 10%, rgba(55, 135, 255, 0.18), transparent 60%), radial-gradient(900px 500px at 80% 20%, rgba(30, 200, 160, 0.12), transparent 55%), #0b1020",
    color: THEME.text,
  };

  const Container = {
    maxWidth: 1120,
    margin: "0 auto",
    display: "grid",
    gap: 14,
  };

  const SectionGrid = (cols) => ({
    display: "grid",
    gridTemplateColumns: cols,
    gap: 14,
    alignItems: "start",
  });

  const RowTile = (isSelected = false) => ({
    padding: 10,
    borderRadius: 14,
    border: `1px solid ${THEME.subtleBorder}`,
    background: isSelected ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.06)",
    display: "grid",
    gap: 6,
  });

  return (
    <div style={Page}>
      <div style={Container}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: 0.2 }}>Ops Triage Hub</div>
            <div style={{ fontSize: 12, color: THEME.subtleText, marginTop: 2 }}>
              Local demo • Health, incidents, recommendations, KPIs
            </div>
          </div>
          <Button onClick={loadAll} disabled={loading} variant="primary">
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>

        {err ? (
          <div
            style={{
              padding: 12,
              borderRadius: 14,
              background: THEME.dangerBg,
              border: `1px solid ${THEME.dangerBorder}`,
              color: THEME.dangerText,
              boxShadow: THEME.shadow,
            }}
          >
            <div style={{ fontWeight: 900, marginBottom: 4 }}>Error</div>
            <div style={{ fontSize: 13 }}>{err}</div>
          </div>
        ) : null}

        <div style={SectionGrid("1.25fr 1fr")}>
          <Card
            title="Operational Health"
            right={
              health?.score?.status ? (
                <Pill tone={String(health.score.status).toLowerCase()}>
                  {String(health.score.status).toUpperCase()}
                </Pill>
              ) : null
            }
          >
            <div style={{ fontSize: 13, color: THEME.subtleText }}>{summary?.summary || "—"}</div>

            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              <div>
                <Label>Active incidents</Label>
                <div style={{ fontSize: 18, fontWeight: 900 }}>{health?.active_total ?? "—"}</div>
              </div>
              <div>
                <Label>SLA breached</Label>
                <div style={{ fontSize: 18, fontWeight: 900 }}>{health?.breached_total ?? "—"}</div>
              </div>
              <div>
                <Label>MTTR avg (7d)</Label>
                <div style={{ fontSize: 18, fontWeight: 900 }}>
                  {health?.mttr?.avg_minutes != null ? `${health.mttr.avg_minutes}m` : "—"}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>What to do next</div>
              <div style={{ display: "grid", gap: 8 }}>
                {(recs?.recommendations || []).slice(0, 3).map((r) => (
                  <div
                    key={r.rank}
                    style={{
                      padding: 10,
                      borderRadius: 12,
                      border: `1px solid ${THEME.subtleBorder}`,
                      background: "rgba(255,255,255,0.06)",
                    }}
                  >
                    <div style={{ fontWeight: 900 }}>{r.title}</div>
                    <div style={{ fontSize: 12, color: THEME.subtleText, marginTop: 4 }}>{r.why}</div>
                  </div>
                ))}
                {!recs?.recommendations?.length ? (
                  <div style={{ fontSize: 12, color: THEME.subtleText }}>No recommendations available.</div>
                ) : null}
              </div>
            </div>
          </Card>

          <Card title="KPIs">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <Label>Window (days)</Label>
                <Select value={String(kpiDays)} onChange={(v) => setKpiDays(Number(v))} options={["7", "30", "90"]} />
              </div>
              <div>
                <Label>Resolved total</Label>
                <div style={{ fontSize: 18, fontWeight: 900, paddingTop: 8 }}>{kpis?.resolved_count ?? "—"}</div>
              </div>
            </div>

            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              <div>
                <Label>P0 resolved</Label>
                <div style={{ fontSize: 18, fontWeight: 900 }}>{kpis?.p0_resolved_count ?? "—"}</div>
              </div>
              <div>
                <Label>Avg MTTR</Label>
                <div style={{ fontSize: 18, fontWeight: 900 }}>
                  {kpis?.avg_mttr_minutes != null ? `${kpis.avg_mttr_minutes}m` : "—"}
                </div>
              </div>
              <div>
                <Label>Top resolvers</Label>
                <div style={{ fontSize: 12, color: THEME.subtleText, paddingTop: 8 }}>
                  {topResolvers.length ? `${topResolvers[0].role} (${topResolvers[0].resolved})` : "—"}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div style={{ fontWeight: 900 }}>Resolvers</div>
                <div style={{ width: 220 }}>
                  <Select value={resolverFilter} onChange={setResolverFilter} options={resolverOptions} />
                </div>
              </div>

              <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                {(topResolvers.length
                  ? topResolvers
                  : resolverOptions
                      .filter((x) => x !== "All")
                      .map((role) => ({
                        role,
                        resolved: resolved.filter((i) => (i.resolved_by || "Unassigned") === role).length,
                      })))
                  .filter((x) => resolverFilter === "All" || x.role === resolverFilter)
                  .slice(0, 6)
                  .map((x) => (
                    <div
                      key={x.role}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "8px 10px",
                        borderRadius: 12,
                        border: `1px solid ${THEME.subtleBorder}`,
                        background: "rgba(255,255,255,0.06)",
                      }}
                    >
                      <div style={{ fontWeight: 800 }}>{x.role}</div>
                      <div style={{ fontVariantNumeric: "tabular-nums" }}>{x.resolved}</div>
                    </div>
                  ))}
              </div>
            </div>
          </Card>
        </div>

        <div style={SectionGrid("1fr 1fr")}>
          <Card title="Create incident (triage-assisted)">
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <Label>Title</Label>
                <input
                  value={cTitle}
                  onChange={(e) => setCTitle(e.target.value)}
                  placeholder="e.g. Checkout failing for DE customers"
                  style={InputBaseStyle(false)}
                />
              </div>

              <div>
                <Label>Description</Label>
                <textarea
                  value={cDesc}
                  onChange={(e) => setCDesc(e.target.value)}
                  placeholder="What’s happening? Impact? When did it start?"
                  rows={5}
                  style={{ ...InputBaseStyle(false), resize: "vertical" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <Label>Priority</Label>
                  <Select value={cPriority} onChange={setCPriority} options={PRIORITIES} />
                </div>
                <div style={{ display: "grid", alignContent: "end", gap: 8 }}>
                  <Button
                    onClick={runTriage}
                    disabled={cTitle.trim().length < 3 || cDesc.trim().length < 10}
                    title="POST /triage"
                  >
                    Run triage
                  </Button>
                </div>
              </div>

              {triage ? (
                <div
                  style={{
                    padding: 10,
                    borderRadius: 14,
                    border: `1px solid ${THEME.subtleBorder}`,
                    background: "rgba(255,255,255,0.06)",
                  }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <Pill>Suggested: {triage.suggested_priority}</Pill>
                    <div style={{ fontSize: 12, color: THEME.subtleText }}>{triage.rationale}</div>
                  </div>
                  <div style={{ marginTop: 8, fontWeight: 900, fontSize: 13 }}>Next steps</div>
                  <ul style={{ marginTop: 6, paddingLeft: 18, fontSize: 13, color: THEME.text }}>
                    {(triage.next_steps || []).slice(0, 5).map((s, idx) => (
                      <li key={idx}>{s}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <Button
                onClick={createIncident}
                disabled={creating || cTitle.trim().length < 3 || cDesc.trim().length < 10}
                variant="primary"
                title="POST /incidents"
              >
                {creating ? "Creating…" : "Create incident"}
              </Button>
            </div>
          </Card>
                  <Card
            title="Update incident"
            right={
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={refreshSelected}
                  disabled={!selectedId || updating || timelineLoading}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: "rgba(255,255,255,0.06)",
                    cursor: !selectedId ? "not-allowed" : "pointer",
                    fontWeight: 650,
                  }}
                >
                  Refresh
                </button>

                <button
                  type="button"
                  onClick={() => setTimelineCollapsed((v) => !v)}
                  disabled={!selectedId}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: "rgba(255,255,255,0.06)",
                    cursor: !selectedId ? "not-allowed" : "pointer",
                    fontWeight: 650,
                  }}
                >
                  {timelineCollapsed ? "Show timeline" : "Hide timeline"}
                </button>
              </div>
            }
          >
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <Label>Status</Label>
                  <Select
                    value={uStatus}
                    onChange={setUStatus}
                    options={selectedIncident ? allowedStatusesForSelected : STATUSES}
                  />
                  {selectedIncident && allowedStatusesForSelected.length <= 1 ? (
                    <div style={{ fontSize: 12, color: THEME.subtleText, marginTop: 6 }}>
                      No forward transitions from <b>{selectedIncident.status}</b>.
                    </div>
                  ) : null}
                </div>

                <div>
                  <Label>Priority (optional)</Label>
                  <Select value={uPriority || "P2"} onChange={setUPriority} options={PRIORITIES} />
                  <div style={{ fontSize: 12, color: THEME.subtleText, marginTop: 6 }}>
                    You can adjust priority at any stage (logged).
                  </div>
                </div>
              </div>

              <div>
                <Label>Add a note (any stage)</Label>
                <textarea
                  value={uNote}
                  onChange={(e) => setUNote(e.target.value)}
                  placeholder="Quick note for timeline (optional)"
                  rows={2}
                  style={{ ...InputBaseStyle(false), resize: "vertical" }}
                />
              </div>

              {uStatus === "resolved" ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <Label>Resolved by (required)</Label>
                    <Select value={uResolvedBy} onChange={setUResolvedBy} options={ROLES} />
                  </div>
                  <div>
                    <Label>Resolution notes (required)</Label>
                    <input
                      value={uNotes}
                      onChange={(e) => setUNotes(e.target.value)}
                      placeholder="Short summary of fix + follow-ups"
                      style={InputBaseStyle(false)}
                    />
                  </div>
                </div>
              ) : null}

              <Button
                onClick={updateIncident}
                disabled={updating || !selectedId || invalidResolve}
                variant="primary"
                title="PATCH /incidents/:id"
              >
                {updating ? "Updating…" : "Update incident"}
              </Button>

              {invalidResolve ? (
                <div style={{ fontSize: 12, color: "rgba(255, 170, 170, 0.95)" }}>
                  To resolve: choose <b>Resolved by</b> and add <b>Resolution notes</b>.
                </div>
              ) : null}

              {!timelineCollapsed ? (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontWeight: 900 }}>Timeline</div>

                  {timelineLoading ? (
                    <div style={{ fontSize: 12, color: THEME.subtleText, marginTop: 6 }}>
                      Loading timeline…
                    </div>
                  ) : (
                    <div
                      style={{
                        marginTop: 8,
                        display: "grid",
                        gap: 6,
                        maxHeight: TIMELINE_MAX_HEIGHT,
                        overflow: "auto",
                        paddingRight: 4,
                      }}
                    >
                      {(timeline || []).slice(0, 50).map((t) => (
                        <div
                          key={t.id}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 12,
                            border: `1px solid ${THEME.subtleBorder}`,
                            background: "rgba(255,255,255,0.06)",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                            <div style={{ fontWeight: 900, fontSize: 13 }}>{t.event_type}</div>
                            <div style={{ fontSize: 12, color: THEME.subtleText }}>{t.created_at}</div>
                          </div>

                          {t.old_value || t.new_value ? (
                            <div style={{ marginTop: 4, fontSize: 12, color: THEME.subtleText }}>
                              {t.old_value ? (
                                <span>
                                  from <b style={{ color: THEME.text }}>{t.old_value}</b>{" "}
                                </span>
                              ) : null}
                              {t.new_value ? (
                                <span>
                                  to <b style={{ color: THEME.text }}>{t.new_value}</b>
                                </span>
                              ) : null}
                            </div>
                          ) : null}

                          {t.note || t.message ? (
                            <div style={{ marginTop: 6, fontSize: 12, color: THEME.text, whiteSpace: "pre-wrap" }}>
                              {t.note || t.message}
                            </div>
                          ) : null}
                        </div>
                      ))}

                      {!timeline?.length ? (
                        <div style={{ fontSize: 12, color: THEME.subtleText }}>No timeline events yet.</div>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </Card>
        </div>

        <div style={SectionGrid("1fr 1fr")}>
          <Card title={`Active incidents (${active.length})`}>
            <div style={{ display: "grid", gap: 8 }}>
              {active.slice(0, 50).map((i) => (
                <div key={i.id} style={RowTile(selectedId === i.id)}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                    <div style={{ fontWeight: 900 }}>{i.title}</div>
                    <Button onClick={() => selectIncident(i.id)} disabled={false} title="Select incident">
                      Select
                    </Button>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <Pill>{i.priority}</Pill>
                    <Pill>{i.status}</Pill>
                    <span style={{ fontSize: 12, color: THEME.subtleText }}>{i.created_at}</span>
                  </div>
                </div>
              ))}
              {!active.length ? (
                <div style={{ fontSize: 12, color: THEME.subtleText }}>No active incidents.</div>
              ) : null}
            </div>
          </Card>

          <Card title={`Resolved incidents (${resolvedFiltered.length})`} right={<Pill>Window: {kpiDays}d</Pill>}>
            <div style={{ display: "grid", gap: 8 }}>
              {resolvedFiltered.slice(0, 50).map((i) => (
                <div key={i.id} style={RowTile(selectedId === i.id)}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                    <div style={{ fontWeight: 900 }}>{i.title}</div>
                    <Button onClick={() => selectIncident(i.id)} disabled={false}>
                      Select
                    </Button>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <Pill>{i.priority}</Pill>
                    <Pill>{i.status}</Pill>
                    <Pill>{i.resolved_by || "Unassigned"}</Pill>
                    <span style={{ fontSize: 12, color: THEME.subtleText }}>{i.resolved_at || i.updated_at}</span>
                  </div>
                </div>
              ))}
              {!resolvedFiltered.length ? (
                <div style={{ fontSize: 12, color: THEME.subtleText }}>
                  No resolved incidents for this window/filter.
                </div>
              ) : null}
            </div>
          </Card>
        </div>

        <div style={{ fontSize: 12, color: THEME.subtleText, paddingBottom: 12 }}>
          Note: “Who opened/investigated/mitigated/closed” needs an actor field on each timeline event. Right now we
          support the simplest path: <b>resolved_by</b> + timeline notes.
        </div>
      </div>
    </div>
  );
} 