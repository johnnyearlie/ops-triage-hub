import React, { useEffect, useMemo, useState } from "react";

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
  deleteIncident: (id) => `/api/incidents/${id}`,
  assistant: "/api/ai/assistant",
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
  pageBg: "#F5F8FC",
  cardBg: "#FFFFFF",
  cardBorder: "#D8E3EC",
  subtleBorder: "#E4EBF2",
  text: "#1F2937",
  heading: "#0F172A",
  subtleText: "#64748B",
  inputBg: "#FFFFFF",
  inputBorder: "#CBD5E1",
  inputBorderHover: "#2563EB",
  buttonBg: "#FFFFFF",
  buttonBgHover: "#EEF4FF",
  primaryBg: "#2563EB",
  primaryBgHover: "#1D4ED8",
  dangerBg: "#FEF2F2",
  dangerBorder: "#FCA5A5",
  dangerText: "#B91C1C",
  shadow: "0 8px 24px rgba(15,23,42,0.08)",
};

async function jfetch(url, opts) {
  const response = await fetch(url, opts);
  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!response.ok) {
    const message =
      (data &&
        data.detail &&
        (typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail))) ||
      (typeof data === "string" ? data : "Request failed");
    throw new Error(message);
  }

  return data;
}

function formatDateTime(isoString) {
  if (!isoString) return "—";

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "—";

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today - target) / 86_400_000);

  const time = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  if (diffDays === 0) return `Today · ${time}`;
  if (diffDays === 1) return `Yesterday · ${time}`;

  return `${date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  })} · ${time}`;
}

function Card({ title, right, children }) {
  return (
    <div
      style={{
        border: `1px solid ${THEME.cardBorder}`,
        borderRadius: 16,
        padding: 12,
        background: THEME.cardBg,
        boxShadow: THEME.shadow,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
        }}
      >
        <div style={{ fontWeight: 800, color: THEME.heading }}>{title}</div>
        {right}
      </div>
      <div style={{ marginTop: 8 }}>{children}</div>
    </div>
  );
}

function Pill({ children, tone = "neutral" }) {
  const tones = {
    red: { bg: "#FEE2E2", border: "#EF4444", text: "#B91C1C" },
    amber: { bg: "#FEF3C7", border: "#F59E0B", text: "#B45309" },
    green: { bg: "#DCFCE7", border: "#22C55E", text: "#166534" },
    neutral: { bg: "#F8FAFC", border: "#CBD5E1", text: "#475569" },
  };
  const selectedTone = tones[tone] || tones.neutral;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 10px",
        borderRadius: 999,
        border: `1px solid ${selectedTone.border}`,
        background: selectedTone.bg,
        color: selectedTone.text,
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
    background: disabled ? "#F3F6FA" : THEME.inputBg,
    color: THEME.text,
    outline: "none",
    boxSizing: "border-box",
  };
}

function Select({ value, onChange, options, disabled = false }) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      style={{
        ...InputBaseStyle(disabled),
        cursor: disabled ? "not-allowed" : "pointer",
      }}
      onMouseEnter={(event) => {
        if (!disabled) event.currentTarget.style.borderColor = THEME.inputBorderHover;
      }}
      onMouseLeave={(event) => {
        if (!disabled) event.currentTarget.style.borderColor = THEME.inputBorder;
      }}
    >
      {options.map((option) => (
        <option key={option} value={option} style={{ color: "#111" }}>
          {option}
        </option>
      ))}
    </select>
  );
}

function Button({ children, onClick, disabled = false, variant = "default", title }) {
  const isPrimary = variant === "primary";

  const baseBackground = disabled ? "#F3F6FA" : isPrimary ? THEME.primaryBg : "#FFFFFF";
  const baseColor = disabled ? "#9CA3AF" : isPrimary ? "#FFFFFF" : "#2563EB";
  const baseBorder = disabled ? "1px solid #D9E2EC" : "2px solid #2563EB";

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "10px 12px",
        borderRadius: 12,
        border: baseBorder,
        background: baseBackground,
        color: baseColor,
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 750,
        transition: "transform 0.06s ease, background 0.2s ease, border-color 0.2s ease",
        opacity: disabled ? 0.72 : 1,
      }}
      onMouseEnter={(event) => {
        if (disabled) return;
        event.currentTarget.style.background = isPrimary ? THEME.primaryBgHover : THEME.buttonBgHover;
      }}
      onMouseLeave={(event) => {
        if (disabled) return;
        event.currentTarget.style.background = isPrimary ? THEME.primaryBg : "#FFFFFF";
      }}
      onMouseDown={(event) => {
        if (!disabled) event.currentTarget.style.transform = "translateY(1px)";
      }}
      onMouseUp={(event) => {
        event.currentTarget.style.transform = "translateY(0)";
      }}
    >
      {children}
    </button>
  );
}

function SmallActionButton({ children, onClick, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "6px 12px",
        borderRadius: 10,
        border: disabled ? "1px solid #D9E2EC" : "1px solid #2563EB",
        background: disabled ? "#F3F6FA" : "#FFFFFF",
        color: disabled ? "#9CA3AF" : "#2563EB",
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 700,
        transition: "all 0.2s ease",
      }}
    >
      {children}
    </button>
  );
}

function DangerButton({ children, onClick, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "10px 12px",
        borderRadius: 12,
        border: disabled ? "1px solid #E5E7EB" : "2px solid #DC2626",
        background: disabled ? "#F3F4F6" : "#FFFFFF",
        color: disabled ? "#9CA3AF" : "#B91C1C",
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 750,
        transition: "background 0.2s ease, transform 0.06s ease",
      }}
      onMouseEnter={(event) => {
        if (!disabled) event.currentTarget.style.background = "#FEF2F2";
      }}
      onMouseLeave={(event) => {
        if (!disabled) event.currentTarget.style.background = "#FFFFFF";
      }}
      onMouseDown={(event) => {
        if (!disabled) event.currentTarget.style.transform = "translateY(1px)";
      }}
      onMouseUp={(event) => {
        event.currentTarget.style.transform = "translateY(0)";
      }}
    >
      {children}
    </button>
  );
}

export default function App() {
  const [health, setHealth] = useState(null);
  const [summary, setSummary] = useState(null);
  const [recs, setRecs] = useState(null);
  const [active, setActive] = useState([]);
  const [resolved, setResolved] = useState([]);
  const [kpis, setKpis] = useState(null);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [cTitle, setCTitle] = useState("");
  const [cDesc, setCDesc] = useState("");
  const [cPriority, setCPriority] = useState("P2");
  const [triage, setTriage] = useState(null);
  const [creating, setCreating] = useState(false);

  const [selectedId, setSelectedId] = useState("");
  const [timeline, setTimeline] = useState([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineCollapsed, setTimelineCollapsed] = useState(true);

  const [uStatus, setUStatus] = useState("investigating");
  const [uPriority, setUPriority] = useState("");
  const [uResolvedBy, setUResolvedBy] = useState("On-call");
  const [uNotes, setUNotes] = useState("");
  const [uNote, setUNote] = useState("");
  const [updating, setUpdating] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteSuccess, setDeleteSuccess] = useState(false);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [aiError, setAiError] = useState("");

  const [kpiDays, setKpiDays] = useState(90);
  const [resolverFilter, setResolverFilter] = useState("All");

  const TIMELINE_MAX_HEIGHT = 260;

  const selectedIncident = useMemo(
    () => active.find((item) => item.id === selectedId) || resolved.find((item) => item.id === selectedId) || null,
    [active, resolved, selectedId]
  );

  async function loadTimeline(id) {
    if (!id) return;
    setTimelineLoading(true);
    try {
      const data = await jfetch(API.timeline(id));
      setTimeline(Array.isArray(data) ? data : []);
    } catch (error) {
      setTimeline([]);
      setErr(error.message || "Failed to load activity");
    } finally {
      setTimelineLoading(false);
    }
  }

  async function loadAll() {
    setErr("");
    setLoading(true);
    try {
      const [nextHealth, nextSummary, nextRecs, nextActive, nextKpis, nextResolved] = await Promise.all([
        jfetch(API.health),
        jfetch(API.summary),
        jfetch(API.recs),
        jfetch(API.active),
        jfetch(`${API.kpis}?days=${kpiDays}`),
        jfetch(`${API.incidents}?status=resolved&days=${kpiDays}&limit=200`),
      ]);

      setHealth(nextHealth);
      setSummary(nextSummary);
      setRecs(nextRecs);
      setActive(Array.isArray(nextActive) ? nextActive : []);
      setKpis(nextKpis);
      setResolved(Array.isArray(nextResolved) ? nextResolved : []);
    } catch (error) {
      setErr(error.message || "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }

  async function refreshSelected() {
    if (!selectedId) return;
    setErr("");
    try {
      const [nextActive, nextResolved] = await Promise.all([
        jfetch(API.active),
        jfetch(`${API.incidents}?status=resolved&days=${kpiDays}&limit=200`),
      ]);

      const activeList = Array.isArray(nextActive) ? nextActive : [];
      const resolvedList = Array.isArray(nextResolved) ? nextResolved : [];
      setActive(activeList);
      setResolved(resolvedList);

      const incident = activeList.find((item) => item.id === selectedId) || resolvedList.find((item) => item.id === selectedId);
      if (incident) {
        setUStatus(incident.status || "investigating");
        setUPriority(incident.priority || "");
        setUResolvedBy(incident.resolved_by || "On-call");
        setUNotes(incident.resolution_notes || "");
      }

      await loadTimeline(selectedId);
    } catch (error) {
      setErr(error.message || "Failed to refresh selected incident");
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [nextKpis, nextResolved] = await Promise.all([
          jfetch(`${API.kpis}?days=${kpiDays}`),
          jfetch(`${API.incidents}?status=resolved&days=${kpiDays}&limit=200`),
        ]);
        setKpis(nextKpis);
        setResolved(Array.isArray(nextResolved) ? nextResolved : []);
      } catch (error) {
        setErr(error.message || "Failed to refresh KPI reporting period");
      }
    })();
  }, [kpiDays]);

  async function runTriage() {
    setErr("");
    setTriage(null);
    try {
      const result = await jfetch(API.triage, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: cTitle.trim(), description: cDesc.trim() }),
      });

      setTriage(result);
      if (result?.suggested_priority && PRIORITIES.includes(result.suggested_priority)) {
        setCPriority(result.suggested_priority);
      }
    } catch (error) {
      setErr(error.message || "Operational assessment failed");
    }
  }

  async function createIncident() {
    setErr("");
    setCreating(true);
    try {
      const result = await jfetch(API.incidents, {
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
      if (result?.id) {
        setSelectedId(result.id);
        setTimelineCollapsed(true);
        setUpdateSuccess(false);
        await loadTimeline(result.id);
      }
    } catch (error) {
      setErr(error.message || "Incident creation failed");
    } finally {
      setCreating(false);
    }
  }

  function allowedNextStatuses(status) {
    return [status, ...(STATUS_TRANSITIONS[status] || [])];
  }

  async function selectIncident(id) {
    setSelectedId(id);
    setTimelineCollapsed(true);
    setUpdateSuccess(false);
    setConfirmDelete(false);
    setDeleteSuccess(false);
    setAiResult(null);
    setAiError("");

    const incident = active.find((item) => item.id === id) || resolved.find((item) => item.id === id);
    if (incident) {
      setUStatus(incident.status || "investigating");
      setUPriority(incident.priority || "");
      setUResolvedBy(incident.resolved_by || "On-call");
      setUNotes(incident.resolution_notes || "");
      setUNote("");
    }

    await loadTimeline(id);
  }

  async function updateIncident() {
    if (!selectedId) return;

    setErr("");
    setUpdating(true);
    setUpdateSuccess(false);

    try {
      const body = { status: uStatus };

      if (uPriority && PRIORITIES.includes(uPriority)) body.priority = uPriority;
      if (uNote.trim()) body.note = uNote.trim();

      if (uStatus === "resolved") {
        body.resolved_by = uResolvedBy;
        body.resolution_notes = uNotes.trim();
      }

      await jfetch(API.patchIncident(selectedId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      setUNote("");
      await loadAll();
      await loadTimeline(selectedId);
      setUpdateSuccess(true);

      window.setTimeout(() => {
        setUpdateSuccess(false);
      }, 4000);
    } catch (error) {
      setErr(error.message || "Incident update failed");
    } finally {
      setUpdating(false);
    }
  }


  async function deleteIncident() {
    if (!selectedId || !selectedIncident) return;

    setErr("");
    setDeleting(true);
    setDeleteSuccess(false);

    try {
      await jfetch(API.deleteIncident(selectedId), { method: "DELETE" });

      setSelectedId("");
      setTimeline([]);
      setTimelineCollapsed(true);
      setConfirmDelete(false);
      setUpdateSuccess(false);
      setUStatus("investigating");
      setUPriority("");
      setUResolvedBy("On-call");
      setUNotes("");
      setUNote("");
      setAiResult(null);
      setAiError("");

      await loadAll();
      setDeleteSuccess(true);

      window.setTimeout(() => {
        setDeleteSuccess(false);
      }, 4000);
    } catch (error) {
      setErr(error.message || "Incident deletion failed");
    } finally {
      setDeleting(false);
    }
  }


  async function askAIAssistant() {
    if (!selectedId || !selectedIncident) return;

    setErr("");
    setAiError("");
    setAiLoading(true);
    setAiResult(null);

    try {
      const result = await jfetch(API.assistant, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incident_id: selectedId }),
      });

      setAiResult(result);
    } catch (error) {
      setAiError(error.message || "AI Assistant request failed");
    } finally {
      setAiLoading(false);
    }
  }

  const invalidResolve = uStatus === "resolved" && (!uResolvedBy || uNotes.trim().length === 0);
  const allowedStatusesForSelected = selectedIncident ? allowedNextStatuses(selectedIncident.status) : STATUSES;

  const topResolvers = kpis?.top_resolvers || [];
  const resolvedFiltered =
    resolverFilter === "All"
      ? resolved
      : resolved.filter((item) => (item.resolved_by || "Unassigned") === resolverFilter);

  const resolverOptions = useMemo(() => {
    const fromKpis = topResolvers.map((item) => item.role);
    const fromResolved = Array.from(
      new Set(resolved.map((item) => (item.resolved_by || "Unassigned").trim() || "Unassigned"))
    );
    return Array.from(new Set(["All", ...fromKpis, ...fromResolved]));
  }, [topResolvers, resolved]);

  const Page = {
    padding: 18,
    minHeight: "100vh",
    background: THEME.pageBg,
    color: THEME.text,
  };

  const Container = {
    maxWidth: 1120,
    margin: "0 auto",
    display: "grid",
    gap: 14,
  };

  const SectionGrid = (columns) => ({
    display: "grid",
    gridTemplateColumns: columns,
    gap: 10,
    alignItems: "start",
  });

  const RowTile = (isSelected = false) => ({
    padding: 12,
    borderRadius: 14,
    border: isSelected ? "2px solid #2563EB" : `1px solid ${THEME.subtleBorder}`,
    background: isSelected ? "#EFF6FF" : THEME.cardBg,
    boxShadow: isSelected ? "0 8px 20px rgba(37,99,235,0.12)" : "0 1px 3px rgba(0,0,0,0.04)",
    transition: "all 0.18s ease",
    display: "grid",
    gap: 8,
  });

  const createTitleValid = cTitle.trim().length >= 3;
  const createDescriptionValid = cDesc.trim().length >= 10;

  return (
    <div style={Page}>
      <div style={Container}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: 0.2 }}>Ops Triage Hub</div>
            <div style={{ fontSize: 12, color: THEME.subtleText, marginTop: 2 }}>
              Operational health, incidents, insights and KPIs
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
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Operational Insights</div>
              <div style={{ display: "grid", gap: 8 }}>
                {(recs?.recommendations || []).slice(0, 3).map((recommendation) => (
                  <div
                    key={recommendation.rank}
                    style={{
                      padding: 10,
                      borderRadius: 12,
                      border: `1px solid ${THEME.subtleBorder}`,
                      background: "#F8FAFC",
                    }}
                  >
                    <div style={{ fontWeight: 900 }}>{recommendation.title}</div>
                    <div style={{ fontSize: 12, color: THEME.subtleText, marginTop: 4 }}>
                      {recommendation.why}
                    </div>
                  </div>
                ))}
                {!recs?.recommendations?.length ? (
                  <div style={{ fontSize: 12, color: THEME.subtleText }}>No operational insights available.</div>
                ) : null}
              </div>
            </div>
          </Card>

          <Card title="KPIs">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <Label>Reporting Period</Label>
                <Select value={String(kpiDays)} onChange={(value) => setKpiDays(Number(value))} options={["7", "30", "90"]} />
              </div>
              <div>
                <Label>Resolved total</Label>
                <div style={{ fontSize: 18, fontWeight: 900, paddingTop: 8 }}>{kpis?.resolved_count ?? "—"}</div>
              </div>
            </div>

            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              <div>
                <Label>Critical Incidents Resolved</Label>
                <div style={{ fontSize: 18, fontWeight: 900 }}>{kpis?.p0_resolved_count ?? "—"}</div>
              </div>
              <div>
                <Label>Avg MTTR</Label>
                <div style={{ fontSize: 18, fontWeight: 900 }}>
                  {kpis?.avg_mttr_minutes != null ? `${kpis.avg_mttr_minutes}m` : "—"}
                </div>
              </div>
              <div>
                <Label>Top Resolvers</Label>
                <div style={{ fontSize: 12, color: THEME.subtleText, paddingTop: 8 }}>
                  {topResolvers.length ? `${topResolvers[0].role} (${topResolvers[0].resolved})` : "—"}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div style={{ fontWeight: 900 }}>Assigned Resolvers</div>
                <div style={{ width: 220 }}>
                  <Select value={resolverFilter} onChange={setResolverFilter} options={resolverOptions} />
                </div>
              </div>

              <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                {(topResolvers.length
                  ? topResolvers
                  : resolverOptions
                      .filter((option) => option !== "All")
                      .map((role) => ({
                        role,
                        resolved: resolved.filter((item) => (item.resolved_by || "Unassigned") === role).length,
                      })))
                  .filter((item) => resolverFilter === "All" || item.role === resolverFilter)
                  .slice(0, 6)
                  .map((item) => (
                    <div
                      key={item.role}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "8px 10px",
                        borderRadius: 12,
                        border: `1px solid ${THEME.subtleBorder}`,
                        background: "#F8FAFC",
                      }}
                    >
                      <div style={{ fontWeight: 800 }}>{item.role}</div>
                      <div style={{ fontVariantNumeric: "tabular-nums" }}>{item.resolved}</div>
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
                  onChange={(event) => setCTitle(event.target.value)}
                  placeholder="e.g. Checkout failing for DE customers"
                  style={InputBaseStyle(false)}
                />
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 12,
                    color: cTitle.length === 0 ? THEME.subtleText : createTitleValid ? "#16A34A" : "#D97706",
                  }}
                >
                  {cTitle.length === 0
                    ? "Title must be at least 3 characters."
                    : createTitleValid
                      ? "✓ Title looks good"
                      : `Title (${cTitle.trim().length} / 3)`}
                </div>
              </div>

              <div>
                <Label>Description</Label>
                <textarea
                  value={cDesc}
                  onChange={(event) => setCDesc(event.target.value)}
                  placeholder="What is happening? What is the business impact? When did it start?"
                  rows={5}
                  style={{ ...InputBaseStyle(false), resize: "vertical" }}
                />
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 12,
                    color: cDesc.length === 0 ? THEME.subtleText : createDescriptionValid ? "#16A34A" : "#D97706",
                  }}
                >
                  {cDesc.length === 0
                    ? "Description must be at least 10 characters."
                    : createDescriptionValid
                      ? "✓ Description looks good"
                      : `Description (${cDesc.trim().length} / 10)`}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <Label>Priority</Label>
                  <Select value={cPriority} onChange={setCPriority} options={PRIORITIES} />
                </div>
                <div style={{ display: "grid", alignContent: "end" }}>
                  <Button onClick={runTriage} disabled={!createTitleValid || !createDescriptionValid}>
                    Run operational assessment
                  </Button>
                </div>
              </div>

              {triage ? (
                <div
                  style={{
                    padding: 10,
                    borderRadius: 14,
                    border: `1px solid ${THEME.subtleBorder}`,
                    background: "#F8FAFC",
                  }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <Pill>Suggested: {triage.suggested_priority}</Pill>
                    <div style={{ fontSize: 12, color: THEME.subtleText }}>{triage.rationale}</div>
                  </div>
                  <div style={{ marginTop: 8, fontWeight: 900, fontSize: 13 }}>Recommended next steps</div>
                  <ul style={{ marginTop: 6, paddingLeft: 18, fontSize: 13, color: THEME.text }}>
                    {(triage.next_steps || []).slice(0, 5).map((step, index) => (
                      <li key={index}>{step}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <Button
                onClick={createIncident}
                disabled={creating || !createTitleValid || !createDescriptionValid}
                variant="primary"
              >
                {creating ? "Creating…" : "Create incident"}
              </Button>

              {!createTitleValid || !createDescriptionValid ? (
                <div style={{ fontSize: 12, color: THEME.subtleText, textAlign: "center" }}>
                  Complete the required fields to create an incident.
                </div>
              ) : null}
            </div>
          </Card>

          <div style={{ display: "grid", gap: 10 }}>
          <Card
            title="Update incident"
            right={
              <div style={{ display: "flex", gap: 8 }}>
                <SmallActionButton
                  onClick={refreshSelected}
                  disabled={!selectedId || updating || timelineLoading}
                >
                  Refresh
                </SmallActionButton>
                <SmallActionButton
                  onClick={() => setTimelineCollapsed((current) => !current)}
                  disabled={!selectedId}
                >
                  {timelineCollapsed ? "View Activity" : "Hide Activity"}
                </SmallActionButton>
              </div>
            }
          >
            <div style={{ display: "grid", gap: 10 }}>
              {selectedIncident ? (
                <div
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    background: "#EFF6FF",
                    border: "1px solid #BFDBFE",
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#2563EB",
                      textTransform: "uppercase",
                      letterSpacing: 0.4,
                    }}
                  >
                    Currently Editing
                  </div>
                  <div style={{ marginTop: 4, fontSize: 18, fontWeight: 800, color: THEME.text }}>
                    {selectedIncident.title}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <Pill>{selectedIncident.priority}</Pill>
                    <Pill>{selectedIncident.status}</Pill>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    border: "1px dashed #CBD5E1",
                    background: "#F8FAFC",
                    color: THEME.subtleText,
                    textAlign: "center",
                  }}
                >
                  Select an incident to begin editing.
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <Label>Status</Label>
                  <Select
                    value={uStatus}
                    onChange={setUStatus}
                    options={selectedIncident ? allowedStatusesForSelected : STATUSES}
                    disabled={!selectedIncident}
                  />
                  {selectedIncident && allowedStatusesForSelected.length <= 1 ? (
                    <div style={{ fontSize: 12, color: THEME.subtleText, marginTop: 6 }}>
                      No forward transitions from <b>{selectedIncident.status}</b>.
                    </div>
                  ) : null}
                </div>

                <div>
                  <Label>Priority</Label>
                  <Select
                    value={uPriority || "P2"}
                    onChange={setUPriority}
                    options={PRIORITIES}
                    disabled={!selectedIncident}
                  />
                  <div style={{ fontSize: 12, color: THEME.subtleText, marginTop: 6 }}>
                    Priority can be adjusted at any stage and is recorded in Activity History.
                  </div>
                </div>
              </div>

              <div>
                <Label>Add a note</Label>
                <textarea
                  value={uNote}
                  onChange={(event) => setUNote(event.target.value)}
                  placeholder="Add an operational note (optional)"
                  rows={2}
                  disabled={!selectedIncident}
                  style={{ ...InputBaseStyle(!selectedIncident), resize: "vertical" }}
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
                      onChange={(event) => setUNotes(event.target.value)}
                      placeholder="Short summary of the resolution and follow-up actions"
                      style={InputBaseStyle(false)}
                    />
                  </div>
                </div>
              ) : null}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Button
                  onClick={updateIncident}
                  disabled={updating || deleting || !selectedId || invalidResolve}
                  variant="default"
                >
                  {updating ? "Updating…" : "Update incident"}
                </Button>

                <DangerButton
                  onClick={() => setConfirmDelete(true)}
                  disabled={!selectedIncident || updating || deleting}
                >
                  Delete incident
                </DangerButton>
              </div>

              {confirmDelete && selectedIncident ? (
                <div
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    background: "#FEF2F2",
                    border: "1px solid #FCA5A5",
                    color: "#7F1D1D",
                  }}
                >
                  <div style={{ fontWeight: 900 }}>Delete this incident?</div>
                  <div style={{ marginTop: 6, fontSize: 13 }}>
                    You are about to permanently delete <b>{selectedIncident.title}</b> and its Activity History.
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12 }}>This action cannot be undone.</div>

                  <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <SmallActionButton onClick={() => setConfirmDelete(false)} disabled={deleting}>
                      Cancel
                    </SmallActionButton>
                    <DangerButton onClick={deleteIncident} disabled={deleting}>
                      {deleting ? "Deleting…" : "Delete incident"}
                    </DangerButton>
                  </div>
                </div>
              ) : null}

              {deleteSuccess ? (
                <div
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    background: "#ECFDF5",
                    border: "1px solid #A7F3D0",
                    color: "#065F46",
                    fontWeight: 700,
                  }}
                >
                  ✓ Incident deleted successfully.
                </div>
              ) : null}

              {updateSuccess ? (
                <div
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    background: "#ECFDF5",
                    border: "1px solid #A7F3D0",
                    color: "#065F46",
                    fontWeight: 700,
                  }}
                >
                  ✓ Incident updated successfully.
                  <button
                    type="button"
                    onClick={() => setTimelineCollapsed(false)}
                    style={{
                      display: "block",
                      marginTop: 7,
                      padding: 0,
                      border: 0,
                      background: "transparent",
                      color: "#047857",
                      cursor: "pointer",
                      fontWeight: 800,
                    }}
                  >
                    View Activity →
                  </button>
                </div>
              ) : null}

              {invalidResolve ? (
                <div style={{ fontSize: 12, color: THEME.dangerText }}>
                  To resolve this incident, choose <b>Resolved by</b> and add <b>Resolution notes</b>.
                </div>
              ) : null}

              {!timelineCollapsed ? (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontWeight: 900 }}>Activity History</div>

                  {timelineLoading ? (
                    <div style={{ fontSize: 12, color: THEME.subtleText, marginTop: 6 }}>
                      Loading activity…
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
                      {(timeline || []).slice(0, 50).map((event) => (
                        <div
                          key={event.id}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 12,
                            border: `1px solid ${THEME.subtleBorder}`,
                            background: "#F8FAFC",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                            <div style={{ fontWeight: 900, fontSize: 13 }}>{event.event_type}</div>
                            <div style={{ fontSize: 12, color: THEME.subtleText }}>
                              {formatDateTime(event.created_at)}
                            </div>
                          </div>

                          {event.old_value || event.new_value ? (
                            <div style={{ marginTop: 4, fontSize: 12, color: THEME.subtleText }}>
                              {event.old_value ? (
                                <span>
                                  from <b style={{ color: THEME.text }}>{event.old_value}</b>{" "}
                                </span>
                              ) : null}
                              {event.new_value ? (
                                <span>
                                  to <b style={{ color: THEME.text }}>{event.new_value}</b>
                                </span>
                              ) : null}
                            </div>
                          ) : null}

                          {event.note || event.message ? (
                            <div style={{ marginTop: 6, fontSize: 12, color: THEME.text, whiteSpace: "pre-wrap" }}>
                              {event.note || event.message}
                            </div>
                          ) : null}
                        </div>
                      ))}

                      {!timeline.length ? (
                        <div style={{ fontSize: 12, color: THEME.subtleText }}>No activity has been recorded yet.</div>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </Card>


          <Card
            title="AI Operations Assistant"
            right={<Pill tone="green">Decision support</Pill>}
          >
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ fontSize: 13, color: THEME.subtleText, lineHeight: 1.55 }}>
                Use the AI Assistant to summarise the selected incident, explain its likely business
                impact and prepare clear operational next steps.
              </div>

              {!selectedIncident ? (
                <div
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    border: "1px dashed #CBD5E1",
                    background: "#F8FAFC",
                    color: THEME.subtleText,
                    textAlign: "center",
                  }}
                >
                  Select an incident before asking the AI Assistant.
                </div>
              ) : (
                <div
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    background: "#EFF6FF",
                    border: "1px solid #BFDBFE",
                  }}
                >
                  <div style={{ fontSize: 12, color: "#2563EB", fontWeight: 800 }}>
                    INCIDENT CONTEXT
                  </div>
                  <div style={{ marginTop: 4, fontWeight: 900 }}>{selectedIncident.title}</div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                    <Pill>{selectedIncident.priority}</Pill>
                    <Pill>{selectedIncident.status}</Pill>
                  </div>
                </div>
              )}

              <Button
                onClick={askAIAssistant}
                disabled={!selectedIncident || aiLoading}
                variant="primary"
              >
                {aiLoading ? "AI Assistant is reviewing…" : "Ask AI Assistant"}
              </Button>

              {aiError ? (
                <div
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    background: THEME.dangerBg,
                    border: `1px solid ${THEME.dangerBorder}`,
                    color: THEME.dangerText,
                    fontSize: 13,
                  }}
                >
                  {aiError}
                </div>
              ) : null}

              {aiResult?.summary ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 12,
                      border: `1px solid ${THEME.subtleBorder}`,
                      background: "#F8FAFC",
                    }}
                  >
                    <div style={{ fontWeight: 900 }}>Executive Summary</div>
                    <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.55 }}>
                      {aiResult.summary.executive_summary}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: 12,
                      borderRadius: 12,
                      border: `1px solid ${THEME.subtleBorder}`,
                      background: "#F8FAFC",
                    }}
                  >
                    <div style={{ fontWeight: 900 }}>Business Impact</div>
                    <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.55 }}>
                      {aiResult.summary.business_impact}
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        padding: 12,
                        borderRadius: 12,
                        border: `1px solid ${THEME.subtleBorder}`,
                        background: "#F8FAFC",
                      }}
                    >
                      <div style={{ fontWeight: 900 }}>Recommended Actions</div>
                      <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.55 }}>
                        {(aiResult.summary.recommended_actions || []).map((action, index) => (
                          <li key={index}>{action}</li>
                        ))}
                      </ul>
                    </div>

                    <div
                      style={{
                        padding: 12,
                        borderRadius: 12,
                        border: `1px solid ${THEME.subtleBorder}`,
                        background: "#F8FAFC",
                      }}
                    >
                      <div style={{ fontWeight: 900 }}>Stakeholders to Inform</div>
                      <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.55 }}>
                        {(aiResult.summary.stakeholders || []).map((stakeholder, index) => (
                          <li key={index}>{stakeholder}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div
                    style={{
                      padding: 12,
                      borderRadius: 12,
                      border: "1px solid #FCD34D",
                      background: "#FFFBEB",
                    }}
                  >
                    <div style={{ fontWeight: 900, color: "#92400E" }}>Operational Risks</div>
                    <ul
                      style={{
                        margin: "8px 0 0",
                        paddingLeft: 18,
                        fontSize: 13,
                        lineHeight: 1.55,
                        color: "#78350F",
                      }}
                    >
                      {(aiResult.summary.risks || []).map((risk, index) => (
                        <li key={index}>{risk}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}

              <div
                style={{
                  padding: 14,
                  borderRadius: 12,
                  border: "2px solid #2563EB",
                  background: "#EFF6FF",
                  color: "#1E3A8A",
                  lineHeight: 1.5,
                }}
              >
                <div style={{ fontWeight: 900 }}>
                  {aiResult?.source === "openai"
                    ? "Generated using OpenAI"
                    : "OpenAI integration preview"}
                </div>
                <div style={{ marginTop: 6, fontSize: 13, fontWeight: 700 }}>
                  AI-generated summaries are intended to support operational decision-making.
                </div>
                <div style={{ marginTop: 4, fontSize: 13, fontWeight: 900 }}>
                  Operational decisions remain the responsibility of authorised personnel.
                </div>
              </div>
            </div>
          </Card>
        </div>
        </div>

        <div style={SectionGrid("1fr 1fr")}>
          <Card title={`Active incidents (${active.length})`}>
            <div style={{ display: "grid", gap: 8 }}>
              {active.slice(0, 50).map((incident) => (
                <div
                  key={incident.id}
                  style={RowTile(selectedId === incident.id)}
                  onMouseEnter={(event) => {
                    if (selectedId === incident.id) return;
                    event.currentTarget.style.transform = "translateY(-2px)";
                    event.currentTarget.style.boxShadow = "0 6px 18px rgba(0,0,0,0.08)";
                  }}
                  onMouseLeave={(event) => {
                    if (selectedId === incident.id) return;
                    event.currentTarget.style.transform = "translateY(0)";
                    event.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)";
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                    <div style={{ fontWeight: 900 }}>{incident.title}</div>
                    <Button
                      onClick={() => selectIncident(incident.id)}
                      variant={selectedId === incident.id ? "primary" : "default"}
                    >
                      {selectedId === incident.id ? "✓ Selected" : "Select"}
                    </Button>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <Pill>{incident.priority}</Pill>
                    <Pill>{incident.status}</Pill>
                    <span style={{ fontSize: 12, color: THEME.subtleText }}>
                      {formatDateTime(incident.created_at)}
                    </span>
                  </div>
                </div>
              ))}

              {!active.length ? (
                <div style={{ fontSize: 12, color: THEME.subtleText }}>No active incidents.</div>
              ) : null}
            </div>
          </Card>

          <Card
            title={`Resolved incidents (${resolvedFiltered.length})`}
            right={<Pill>{kpiDays}-Day Reporting Period</Pill>}
          >
            <div style={{ display: "grid", gap: 8 }}>
              {resolvedFiltered.slice(0, 5).map((incident) => (
                <div
                  key={incident.id}
                  style={RowTile(selectedId === incident.id)}
                  onMouseEnter={(event) => {
                    if (selectedId === incident.id) return;
                    event.currentTarget.style.transform = "translateY(-2px)";
                    event.currentTarget.style.boxShadow = "0 6px 18px rgba(0,0,0,0.08)";
                  }}
                  onMouseLeave={(event) => {
                    if (selectedId === incident.id) return;
                    event.currentTarget.style.transform = "translateY(0)";
                    event.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)";
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                    <div style={{ fontWeight: 900 }}>{incident.title}</div>
                    <Button
                      onClick={() => selectIncident(incident.id)}
                      variant={selectedId === incident.id ? "primary" : "default"}
                    >
                      {selectedId === incident.id ? "✓ Selected" : "Select"}
                    </Button>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <Pill>{incident.priority}</Pill>
                    <Pill>{incident.status}</Pill>
                    <Pill>{incident.resolved_by || "Unassigned"}</Pill>
                    <span style={{ fontSize: 12, color: THEME.subtleText }}>
                      {formatDateTime(incident.resolved_at || incident.updated_at)}
                    </span>
                  </div>
                </div>
              ))}

              {!resolvedFiltered.length ? (
                <div style={{ fontSize: 12, color: THEME.subtleText }}>
                  No resolved incidents for this reporting period.
                </div>
              ) : null}

              {resolvedFiltered.length > 5 ? (
                <div style={{ marginTop: 10, textAlign: "center", fontSize: 12, color: THEME.subtleText }}>
                  Displaying the 5 most recent resolved incidents
                </div>
              ) : null}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
