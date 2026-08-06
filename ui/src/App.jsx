import React, { useEffect, useMemo, useState } from "react";
import ReportOperationalIssue from "./components/ReportOperationalIssue";

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
  allocateIncident: (id) => `/api/incidents/${id}/allocate`,
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

function parseTimelineAllocation(event) {
  if (event?.event_type !== "owner_assigned" || !event?.new_value) return null;

  try {
    return JSON.parse(event.new_value);
  } catch {
    return null;
  }
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
  const [currentView, setCurrentView] = useState("report");
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

  const [allocationTeam, setAllocationTeam] = useState("Ops Lead");
  const [allocationName, setAllocationName] = useState("");
  const [chooseDifferentOwner, setChooseDifferentOwner] = useState(false);
  const [allocating, setAllocating] = useState(false);
  const [allocationError, setAllocationError] = useState("");
  const [allocationSuccess, setAllocationSuccess] = useState("");

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
    setChooseDifferentOwner(false);
    setAllocationError("");
    setAllocationSuccess("");

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
      const recommendedOwner = result?.summary?.recommended_incident_owner?.owner;
      if (recommendedOwner && ROLES.includes(recommendedOwner)) {
        setAllocationTeam(recommendedOwner);
      }
      setChooseDifferentOwner(false);
      setAllocationError("");
      setAllocationSuccess("");
    } catch (error) {
      setAiError(error.message || "AI Assistant request failed");
    } finally {
      setAiLoading(false);
    }
  }

  async function allocateIncident(useRecommendation) {
    if (!selectedId || !selectedIncident || !aiResult?.summary) return;

    const recommendedOwner = aiResult.summary.recommended_incident_owner?.owner;
    const ownerTeam = useRecommendation ? recommendedOwner : allocationTeam;

    if (!ownerTeam || !ROLES.includes(ownerTeam)) {
      setAllocationError("Choose a valid incident owner.");
      return;
    }

    setAllocating(true);
    setAllocationError("");
    setAllocationSuccess("");

    try {
      const reason = useRecommendation
        ? aiResult.summary.recommended_incident_owner?.reason ||
          "AI owner recommendation accepted after Operations Manager review."
        : "Operations Manager selected a different owner after reviewing the AI operational assessment.";

      await jfetch(API.allocateIncident(selectedId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner_team: ownerTeam,
          owner_name: useRecommendation ? null : allocationName.trim() || null,
          allocated_by: "Operations Manager",
          reason,
          recommendation_accepted: useRecommendation,
        }),
      });

      await loadAll();
      await loadTimeline(selectedId);
      setTimelineCollapsed(false);
      setChooseDifferentOwner(false);
      const recordedOwnerName = useRecommendation ? "" : allocationName.trim();
      setAllocationSuccess(
        `${ownerTeam}${recordedOwnerName ? ` — ${recordedOwnerName}` : ""} is now the recorded incident owner.`
      );
    } catch (error) {
      setAllocationError(error.message || "Incident allocation failed");
    } finally {
      setAllocating(false);
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

  if (currentView === "report") {
    return (
      <ReportOperationalIssue
        onOpenDashboard={() => {
          setCurrentView("dashboard");
          loadAll();
        }}
      />
    );
  }

  return (
    <div style={Page}>
      <div style={Container}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: 0.2 }}>Ops Triage Hub</div>
            <div
              style={{
                marginTop: 3,
                fontSize: 11,
                fontWeight: 800,
                color: "#2563EB",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
            >
              Operational Decision Support
            </div>
            <div style={{ fontSize: 12, color: THEME.subtleText, marginTop: 4 }}>
              Helping Operations teams make better decisions when it matters most.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Button onClick={() => setCurrentView("report")}>Report Issue</Button>
            <Button onClick={loadAll} disabled={loading} variant="primary">
              {loading ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
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

        <div style={SectionGrid("1.2fr 1fr")}>
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

        <div style={SectionGrid("0.9fr 1.1fr")}>
          <Card title="Revenue Performance" right={<Pill tone="green">Q1 Forecast</Pill>}>
            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                  <div>
                    <Label>Q1 revenue progress</Label>
                    <div style={{ fontSize: 24, fontWeight: 900, color: THEME.heading }}>€420,000</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <Label>Target</Label>
                    <div style={{ fontSize: 16, fontWeight: 900, color: THEME.heading }}>€1,000,000</div>
                  </div>
                </div>

                <div
                  style={{
                    marginTop: 12,
                    height: 12,
                    borderRadius: 999,
                    background: "#E2E8F0",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: "42%",
                      height: "100%",
                      borderRadius: 999,
                      background: "#2563EB",
                    }}
                  />
                </div>

                <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontSize: 12, color: THEME.subtleText }}>
                    42% of quarterly target achieved
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 900, color: "#166534" }}>
                    On track
                  </div>
                </div>
              </div>

              <div
                style={{
                  padding: 12,
                  borderRadius: 12,
                  border: "1px solid #BFDBFE",
                  background: "#EFF6FF",
                  color: "#1E3A8A",
                  fontSize: 13,
                  lineHeight: 1.55,
                }}
              >
                Revenue context helps Operations assess the wider business impact of customer-facing incidents,
                service disruption and delayed delivery.
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
                    padding: 10,
                    borderRadius: 12,
                    border: `1px solid ${THEME.subtleBorder}`,
                    background: "#F8FAFC",
                  }}
                >
                  <Label>Current quarter</Label>
                  <div style={{ fontSize: 14, fontWeight: 900 }}>Q1</div>
                </div>

                <div
                  style={{
                    padding: 10,
                    borderRadius: 12,
                    border: `1px solid ${THEME.subtleBorder}`,
                    background: "#F8FAFC",
                  }}
                >
                  <Label>Forecast status</Label>
                  <div style={{ fontSize: 14, fontWeight: 900, color: "#166534" }}>On track</div>
                </div>
              </div>
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
                    {selectedIncident.owner_team ? (
                      <Pill tone="green">Owner: {selectedIncident.owner_team}</Pill>
                    ) : null}
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
                      {(timeline || []).slice(0, 50).map((event) => {
                        const allocation = parseTimelineAllocation(event);

                        return (
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

                          {allocation ? (
                            <div
                              style={{
                                marginTop: 7,
                                display: "grid",
                                gap: 4,
                                fontSize: 12,
                                color: THEME.text,
                              }}
                            >
                              <div>
                                Owner: <b>{allocation.owner_team}</b>
                                {allocation.owner_name ? ` — ${allocation.owner_name}` : ""}
                              </div>
                              <div>
                                Allocated by: <b>{allocation.allocated_by}</b>
                              </div>
                              <div>{allocation.decision}</div>
                              <div style={{ color: THEME.subtleText }}>{allocation.reason}</div>
                            </div>
                          ) : null}

                          {!allocation && (event.old_value || event.new_value) ? (
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
                        );
                      })}

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
                Generate an AI Operational Assessment from the selected incident, Activity History and
                rule-based operational evidence. The assistant distinguishes facts, inferences,
                missing information and recommended actions for human review.
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
                    padding: 14,
                    borderRadius: 14,
                    background: "#EFF6FF",
                    border: "1px solid #BFDBFE",
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      color: "#2563EB",
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                    }}
                  >
                    Incident selected for analysis
                  </div>
                  <div style={{ marginTop: 5, fontSize: 16, fontWeight: 900, color: THEME.heading }}>
                    {selectedIncident.title}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 9, flexWrap: "wrap" }}>
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
                {aiLoading ? "AI Assistant is reviewing…" : "Generate AI Operational Assessment"}
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
                  <div style={{ fontWeight: 900 }}>AI Assistant unavailable</div>
                  <div style={{ marginTop: 4 }}>{aiError}</div>
                </div>
              ) : null}

              {aiResult?.summary ? (
                <div style={{ display: "grid", gap: 12 }}>
                  <div
                    style={{
                      padding: 16,
                      borderRadius: 14,
                      border: `1px solid ${THEME.cardBorder}`,
                      background: "#FFFFFF",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        alignItems: "flex-start",
                        flexWrap: "wrap",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: 12,
                            color: "#2563EB",
                            fontWeight: 800,
                            textTransform: "uppercase",
                            letterSpacing: 0.5,
                          }}
                        >
                          Executive Operations Report
                        </div>
                        <div style={{ marginTop: 5, fontSize: 18, fontWeight: 900, color: THEME.heading }}>
                          {selectedIncident?.title || "Selected incident"}
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <Pill>{selectedIncident?.priority || "—"}</Pill>
                        <Pill>{selectedIncident?.status || "—"}</Pill>
                      </div>
                    </div>

                    <div
                      style={{
                        marginTop: 14,
                        paddingTop: 12,
                        borderTop: `1px solid ${THEME.subtleBorder}`,
                        display: "grid",
                        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                        gap: 12,
                      }}
                    >
                      <div>
                        <Label>Generated</Label>
                        <div style={{ fontSize: 13, fontWeight: 800 }}>
                          {formatDateTime(aiResult.generated_at)}
                        </div>
                      </div>
                      <div>
                        <Label>Model</Label>
                        <div style={{ fontSize: 13, fontWeight: 800 }}>
                          {aiResult.model || "GPT-5.5"}
                        </div>
                      </div>
                      <div>
                        <Label>Source</Label>
                        <div style={{ fontSize: 13, fontWeight: 800 }}>
                          {aiResult.source || "OpenAI"}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      padding: 14,
                      borderRadius: 14,
                      border: `1px solid ${THEME.subtleBorder}`,
                      background: "#FFFFFF",
                    }}
                  >
                    <div style={{ fontWeight: 900, color: THEME.heading }}>Executive Summary</div>
                    <div style={{ marginTop: 7, fontSize: 13, lineHeight: 1.65 }}>
                      {aiResult.summary.executive_summary || "No executive summary was returned."}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: 14,
                      borderRadius: 14,
                      border: `1px solid ${THEME.subtleBorder}`,
                      background: "#FFFFFF",
                    }}
                  >
                    <div style={{ fontWeight: 900, color: THEME.heading }}>Business Impact</div>
                    <div style={{ marginTop: 7, fontSize: 13, lineHeight: 1.65 }}>
                      {aiResult.summary.business_impact || "No business impact assessment was returned."}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: 14,
                      borderRadius: 14,
                      border: "1px solid #BFDBFE",
                      background: "#EFF6FF",
                    }}
                  >
                    <div style={{ fontWeight: 900, color: "#1E3A8A" }}>Recommended Actions</div>
                    <div style={{ marginTop: 9, display: "grid", gap: 8 }}>
                      {(aiResult.summary.recommended_actions || []).map((action, index) => (
                        <div
                          key={index}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "22px 1fr",
                            gap: 8,
                            alignItems: "start",
                            fontSize: 13,
                            lineHeight: 1.55,
                            color: "#1E3A8A",
                          }}
                        >
                          <div style={{ fontWeight: 900 }}>✓</div>
                          <div>{action}</div>
                        </div>
                      ))}
                      {!aiResult.summary.recommended_actions?.length ? (
                        <div style={{ fontSize: 13, color: THEME.subtleText }}>
                          No recommended actions were returned.
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: 14,
                      borderRadius: 14,
                      border: "1px solid #FCD34D",
                      background: "#FFFBEB",
                    }}
                  >
                    <div style={{ fontWeight: 900, color: "#92400E" }}>Operational Risks</div>
                    <div style={{ marginTop: 9, display: "grid", gap: 8 }}>
                      {(aiResult.summary.operational_risks || aiResult.summary.risks || []).map((risk, index) => (
                        <div
                          key={index}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "22px 1fr",
                            gap: 8,
                            alignItems: "start",
                            fontSize: 13,
                            lineHeight: 1.55,
                            color: "#78350F",
                          }}
                        >
                          <div style={{ fontWeight: 900 }}>!</div>
                          <div>{risk}</div>
                        </div>
                      ))}
                      {!(aiResult.summary.operational_risks || aiResult.summary.risks || []).length ? (
                        <div style={{ fontSize: 13, color: "#92400E" }}>
                          No operational risks were returned.
                        </div>
                      ) : null}
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
                        padding: 14,
                        borderRadius: 14,
                        border: `1px solid ${THEME.subtleBorder}`,
                        background: "#F8FAFC",
                      }}
                    >
                      <div style={{ fontWeight: 900, color: THEME.heading }}>Missing Information</div>
                      <div style={{ marginTop: 9, display: "grid", gap: 8 }}>
                        {(aiResult.summary.missing_information || []).map((item, index) => (
                          <div
                            key={index}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "22px 1fr",
                              gap: 8,
                              alignItems: "start",
                              fontSize: 13,
                              lineHeight: 1.55,
                            }}
                          >
                            <div style={{ fontWeight: 900, color: "#475569" }}>?</div>
                            <div>{item}</div>
                          </div>
                        ))}
                        {!aiResult.summary.missing_information?.length ? (
                          <div style={{ fontSize: 13, color: THEME.subtleText }}>
                            No missing information was identified.
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div
                      style={{
                        padding: 14,
                        borderRadius: 14,
                        border: `1px solid ${THEME.subtleBorder}`,
                        background: "#F8FAFC",
                      }}
                    >
                      <div style={{ fontWeight: 900, color: THEME.heading }}>Assumptions</div>
                      <div style={{ marginTop: 9, display: "grid", gap: 8 }}>
                        {(aiResult.summary.assumptions || []).map((item, index) => (
                          <div
                            key={index}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "14px 1fr",
                              gap: 8,
                              alignItems: "start",
                              fontSize: 13,
                              lineHeight: 1.55,
                            }}
                          >
                            <div style={{ fontWeight: 900, color: "#64748B" }}>•</div>
                            <div>{item}</div>
                          </div>
                        ))}
                        {!aiResult.summary.assumptions?.length ? (
                          <div style={{ fontSize: 13, color: THEME.subtleText }}>
                            No assumptions were identified.
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      padding: 14,
                      borderRadius: 14,
                      border: "1px solid #BBF7D0",
                      background: "#F0FDF4",
                    }}
                  >
                    <div style={{ fontWeight: 900, color: "#166534" }}>Long-Term Considerations</div>
                    <div style={{ marginTop: 9, display: "grid", gap: 8 }}>
                      {(aiResult.summary.long_term_considerations || []).map((item, index) => (
                        <div
                          key={index}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "14px 1fr",
                            gap: 8,
                            alignItems: "start",
                            fontSize: 13,
                            lineHeight: 1.55,
                            color: "#166534",
                          }}
                        >
                          <div style={{ fontWeight: 900 }}>•</div>
                          <div>{item}</div>
                        </div>
                      ))}
                      {!aiResult.summary.long_term_considerations?.length ? (
                        <div style={{ fontSize: 13, color: "#166534" }}>
                          No long-term considerations were returned.
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: 14,
                      borderRadius: 14,
                      border: `1px solid ${THEME.subtleBorder}`,
                      background: "#FFFFFF",
                    }}
                  >
                    <div style={{ fontWeight: 900, color: THEME.heading }}>Stakeholders</div>
                    <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {(aiResult.summary.stakeholders || []).map((stakeholder, index) => (
                        <Pill key={index}>{stakeholder}</Pill>
                      ))}
                      {!aiResult.summary.stakeholders?.length ? (
                        <div style={{ fontSize: 13, color: THEME.subtleText }}>
                          No stakeholders were returned.
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: 14,
                      borderRadius: 14,
                      border: "1px solid #BFDBFE",
                      background: "#EFF6FF",
                    }}
                  >
                    <div style={{ fontWeight: 900, color: "#1E3A8A" }}>
                      AI Recommended Incident Owner
                    </div>

                    <div
                      style={{
                        marginTop: 10,
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        gap: 12,
                        alignItems: "start",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 18, fontWeight: 900, color: THEME.heading }}>
                          {aiResult.summary.recommended_incident_owner?.owner || "No recommendation"}
                        </div>
                        <div style={{ marginTop: 7, fontSize: 13, lineHeight: 1.6 }}>
                          {aiResult.summary.recommended_incident_owner?.reason ||
                            "No owner recommendation rationale was returned."}
                        </div>
                      </div>

                      <Pill
                        tone={
                          String(
                            aiResult.summary.recommended_incident_owner?.recommendation_reliability || ""
                          ).toLowerCase() === "strong"
                            ? "green"
                            : String(
                                  aiResult.summary.recommended_incident_owner?.recommendation_reliability || ""
                                ).toLowerCase() === "moderate"
                              ? "amber"
                              : "red"
                        }
                      >
                        {aiResult.summary.recommended_incident_owner?.recommendation_reliability ||
                          "Limited"}{" "}
                        reliability
                      </Pill>
                    </div>

                    {selectedIncident?.owner_team ? (
                      <div
                        style={{
                          marginTop: 12,
                          padding: 12,
                          borderRadius: 12,
                          background: "#ECFDF5",
                          border: "1px solid #A7F3D0",
                          color: "#065F46",
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase" }}>
                          Current recorded owner
                        </div>
                        <div style={{ marginTop: 4, fontSize: 16, fontWeight: 900 }}>
                          {selectedIncident.owner_team}
                          {selectedIncident.owner_name ? ` — ${selectedIncident.owner_name}` : ""}
                        </div>
                        <div style={{ marginTop: 5, fontSize: 12 }}>
                          Assigned {formatDateTime(selectedIncident.owner_assigned_at)} by{" "}
                          {selectedIncident.owner_assigned_by || "Operations Manager"}
                        </div>
                      </div>
                    ) : (
                      <div style={{ marginTop: 12, display: "grid", gap: 9 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
                          <Button
                            onClick={() => allocateIncident(true)}
                            disabled={
                              allocating ||
                              !aiResult.summary.recommended_incident_owner?.owner
                            }
                            variant="primary"
                          >
                            {allocating
                              ? "Allocating…"
                              : `Allocate to ${
                                  aiResult.summary.recommended_incident_owner?.owner || "Recommended Owner"
                                }`}
                          </Button>

                          <Button
                            onClick={() => {
                              setChooseDifferentOwner((current) => !current);
                              setAllocationError("");
                            }}
                            disabled={allocating}
                          >
                            Choose Different Owner
                          </Button>
                        </div>

                        {chooseDifferentOwner ? (
                          <div
                            style={{
                              padding: 12,
                              borderRadius: 12,
                              background: "#FFFFFF",
                              border: `1px solid ${THEME.subtleBorder}`,
                              display: "grid",
                              gap: 9,
                            }}
                          >
                            <div>
                              <Label>Owner Team</Label>
                              <Select
                                value={allocationTeam}
                                onChange={setAllocationTeam}
                                options={ROLES}
                              />
                            </div>

                            <div>
                              <Label>Owner Name (optional)</Label>
                              <input
                                value={allocationName}
                                onChange={(event) => setAllocationName(event.target.value)}
                                placeholder="e.g. Sarah Jones"
                                style={InputBaseStyle(false)}
                              />
                            </div>

                            <Button
                              onClick={() => allocateIncident(false)}
                              disabled={allocating}
                              variant="primary"
                            >
                              {allocating ? "Allocating…" : `Allocate to ${allocationTeam}`}
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    )}

                    {allocationError ? (
                      <div
                        style={{
                          marginTop: 10,
                          padding: 10,
                          borderRadius: 10,
                          background: THEME.dangerBg,
                          border: `1px solid ${THEME.dangerBorder}`,
                          color: THEME.dangerText,
                          fontSize: 13,
                        }}
                      >
                        {allocationError}
                      </div>
                    ) : null}

                    {allocationSuccess ? (
                      <div
                        style={{
                          marginTop: 10,
                          padding: 10,
                          borderRadius: 10,
                          background: "#ECFDF5",
                          border: "1px solid #A7F3D0",
                          color: "#065F46",
                          fontSize: 13,
                          fontWeight: 700,
                        }}
                      >
                        ✓ {allocationSuccess}
                      </div>
                    ) : null}
                  </div>

                  <div
                    style={{
                      padding: 14,
                      borderRadius: 14,
                      border: `1px solid ${THEME.subtleBorder}`,
                      background: "#FFFFFF",
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "160px 1fr",
                        gap: 14,
                        alignItems: "start",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 900, color: THEME.heading }}>Assessment Reliability</div>
                        <div style={{ marginTop: 9 }}>
                          <Pill
                            tone={
                              String(aiResult.summary.assessment_reliability || "").toLowerCase() === "strong"
                                ? "green"
                                : String(aiResult.summary.assessment_reliability || "").toLowerCase() === "moderate"
                                  ? "amber"
                                  : "red"
                            }
                          >
                            {aiResult.summary.assessment_reliability || "Not stated"}
                          </Pill>
                        </div>
                      </div>

                      <div>
                        <div style={{ fontWeight: 900, color: THEME.heading }}>Assessment Rationale</div>
                        <div style={{ marginTop: 7, fontSize: 13, lineHeight: 1.65 }}>
                          {aiResult.summary.assessment_rationale ||
                            aiResult.summary.confidence_reason ||
                            "No assessment rationale was returned."}
                        </div>
                      </div>
                    </div>
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
                  {aiResult?.source
                    ? `Generated using ${aiResult.source}${aiResult.model ? ` ${aiResult.model}` : ""}`
                    : "AI Operations Assistant"}
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
                    {incident.owner_team ? <Pill tone="green">Owner: {incident.owner_team}</Pill> : null}
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
