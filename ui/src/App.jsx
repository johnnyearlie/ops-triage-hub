import React, { useEffect, useMemo, useState } from "react";
import ReportOperationalIssue from "./components/ReportOperationalIssue";
import "./App.css";

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
  addEvidence: (id) => `/api/incidents/${id}/evidence`,
  assistant: "/api/ai/assistant",
  resolutionRecipients: (id) => `/api/incidents/${id}/resolution/recipients`,
  resolutionMessage: "/api/ai/resolution-message",
  markResolutionCommunicated: (id) => `/api/incidents/${id}/resolution/communicate`,
  stakeholders: (id) => `/api/incidents/${id}/stakeholders`,
};

const PRIORITIES = ["P0", "P1", "P2", "P3"];
const STATUSES = ["open", "investigating", "mitigated", "resolved"];
const ROLES = ["Operations Lead", "Engineering", "Customer Support", "Sales", "Product", "Finance", "Marketing", "HR / People", "Leadership", "On-call", "Ops Lead", "Support"];

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

function formatTimelineEvent(eventType) {
  const labels = {
    created: "Incident created",
    initial_triage_generated: "Initial triage generated",
    ai_assessment_generated: "AI assessment generated",
    priority_changed: "Priority changed",
    status_changed: "Status changed",
    owner_assigned: "Incident owner assigned",
    note_added: "Note added",
    evidence_added: "Incident information added",
    resolution_started: "Resolution work started",
    stakeholders_notified: "Stakeholders notified",
    resolution_communicated: "Resolution communicated",
    resolved_by: "Resolver recorded",
    resolution_notes: "Resolution notes added",
    resolved_at: "Incident resolved",
  };
  return labels[eventType] || String(eventType || "Activity").replaceAll("_", " ");
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

function formatDurationMinutes(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < 0) return "—";

  const rounded = Math.round(minutes);
  const days = Math.floor(rounded / 1440);
  const hours = Math.floor((rounded % 1440) / 60);
  const mins = rounded % 60;

  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function incidentWithinDays(incident, days) {
  const source = incident?.resolved_at || incident?.updated_at || incident?.created_at;
  const date = new Date(source || 0);
  if (Number.isNaN(date.getTime())) return true;
  const ageMs = Date.now() - date.getTime();
  return ageMs <= Number(days) * 86_400_000;
}

function signalColorForTone(tone) {
  if (tone === "red") return "#DC2626";
  if (tone === "amber") return "#D97706";
  if (tone === "green") return "#16A34A";
  return "#2563EB";
}

function loadStoredAssessment(incidentId) {
  if (!incidentId || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`ops-triage-ai-assessment:${incidentId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveStoredAssessment(incidentId, result) {
  if (!incidentId || !result || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`ops-triage-ai-assessment:${incidentId}`, JSON.stringify(result));
  } catch {
    // Local persistence is a V1 demo convenience only; assessment generation still succeeds.
  }
}

function tokenUsageFor(result) {
  const usage = result?.usage || result?.token_usage || result?.response_usage || null;
  if (!usage) return null;

  const total = Number(
    usage.total_tokens ?? usage.total ?? usage.tokens ?? usage.totalTokens ?? NaN
  );
  const input = Number(
    usage.input_tokens ?? usage.prompt_tokens ?? usage.input ?? usage.inputTokens ?? NaN
  );
  const output = Number(
    usage.output_tokens ?? usage.completion_tokens ?? usage.output ?? usage.outputTokens ?? NaN
  );

  if (!Number.isFinite(total) && !Number.isFinite(input) && !Number.isFinite(output)) return null;
  return {
    total: Number.isFinite(total) ? total : null,
    input: Number.isFinite(input) ? input : null,
    output: Number.isFinite(output) ? output : null,
  };
}

function parseTimelineAllocation(event) {
  if (event?.event_type !== "owner_assigned" || !event?.new_value) return null;

  try {
    return JSON.parse(event.new_value);
  } catch {
    return null;
  }
}


function journeyStateFor(incident, timeline = []) {
  const eventTypes = new Set((timeline || []).map((event) => event.event_type));
  const hasOwner = Boolean(incident?.owner_team) || eventTypes.has("owner_assigned");
  const stakeholdersNotified =
    eventTypes.has("stakeholders_notified") ||
    (timeline || []).some((event) => {
      if (event?.event_type !== "note_added") return false;
      const stakeholderText = `${event?.new_value || ""} ${event?.note || ""} ${event?.message || ""}`.toLowerCase();
      return stakeholderText.includes("stakeholders notified:");
    });
  const resolved = incident?.status === "resolved" || eventTypes.has("resolved_at");

  return [
    { key: "reported", label: "Reported", detail: "Incident entered the operational queue", complete: true, active: incident?.status === "open" && !hasOwner },
    { key: "investigating", label: "Investigating", detail: "Operational review is underway", complete: incident?.status !== "open" || eventTypes.has("status_changed"), active: incident?.status === "investigating" && !hasOwner },
    { key: "owner", label: "Owner Assigned", detail: hasOwner ? `${incident?.owner_team || "Incident owner"}${incident?.owner_name ? ` — ${incident.owner_name}` : ""}` : "Awaiting accountable owner", complete: hasOwner, active: hasOwner && !stakeholdersNotified && !resolved },
    { key: "stakeholders", label: "Stakeholders", detail: stakeholdersNotified ? "Communication recorded" : "Communication not yet recorded", complete: stakeholdersNotified, active: stakeholdersNotified && !resolved },
    { key: "resolved", label: "Resolved", detail: resolved ? "Operational lifecycle complete" : "Awaiting Operations closure", complete: resolved, active: resolved },
  ];
}

function IncidentJourney({ incident, timeline }) {
  const steps = journeyStateFor(incident, timeline);
  const currentIndex = Math.max(0, steps.reduce((latest, step, index) => (step.complete || step.active ? index : latest), 0));

  return (
    <div className="oth-journey" aria-label="Incident journey">
      <div className="oth-journey-track" aria-hidden="true">
        <div className="oth-journey-track-fill" style={{ width: `${(currentIndex / Math.max(steps.length - 1, 1)) * 100}%` }} />
      </div>
      {steps.map((step, index) => {
        const state = step.complete ? "complete" : step.active ? "active" : "pending";
        return (
          <div className={`oth-journey-step oth-journey-step--${state}`} key={step.key}>
            <div className="oth-journey-marker" aria-hidden="true">{step.complete ? "✓" : index + 1}</div>
            <div className="oth-journey-copy">
              <div className="oth-journey-label">{step.label}</div>
              <div className="oth-journey-detail">{step.detail}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CompactIncidentJourney({ incident, timeline }) {
  const steps = journeyStateFor(incident, timeline);

  return (
    <div className="oth-compact-journey" aria-label="Incident lifecycle progress">
      {steps.map((step, index) => {
        const state = step.complete ? "complete" : step.active ? "active" : "pending";
        return (
          <React.Fragment key={step.key}>
            <div className={`oth-compact-step oth-compact-step--${state}`}>
              <div className="oth-compact-marker" aria-hidden="true">
                {step.complete ? "✓" : index + 1}
              </div>
              <div className="oth-compact-label">{step.label}</div>
            </div>
            {index < steps.length - 1 ? (
              <div className={`oth-compact-connector oth-compact-connector--${step.complete ? "complete" : "pending"}`} aria-hidden="true" />
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
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
  const baseBorder = disabled ? "1px solid #D9E2EC" : "1px solid #2563EB";

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "8px 11px",
        borderRadius: 9,
        border: baseBorder,
        background: baseBackground,
        color: baseColor,
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 700,
        boxShadow: disabled ? "none" : isPrimary ? "0 1px 2px rgba(15,23,42,0.08)" : "none",
        transition: "transform 0.06s ease, background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease",
        opacity: disabled ? 0.72 : 1,
      }}
      onMouseEnter={(event) => {
        if (disabled) return;
        event.currentTarget.style.background = isPrimary ? THEME.primaryBgHover : THEME.buttonBgHover;
        if (isPrimary) event.currentTarget.style.boxShadow = "0 2px 5px rgba(15,23,42,0.12)";
      }}
      onMouseLeave={(event) => {
        if (disabled) return;
        event.currentTarget.style.background = isPrimary ? THEME.primaryBg : "#FFFFFF";
        event.currentTarget.style.boxShadow = isPrimary ? "0 1px 2px rgba(15,23,42,0.08)" : "none";
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
        padding: "5px 10px",
        borderRadius: 8,
        border: disabled ? "1px solid #D9E2EC" : "1px solid #2563EB",
        background: disabled ? "#F3F6FA" : "#FFFFFF",
        color: disabled ? "#9CA3AF" : "#2563EB",
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 650,
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
        padding: "8px 11px",
        borderRadius: 9,
        border: disabled ? "1px solid #E5E7EB" : "1px solid #DC2626",
        background: disabled ? "#F3F4F6" : "#FFFFFF",
        color: disabled ? "#9CA3AF" : "#B91C1C",
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 700,
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
  const [evidenceCategory, setEvidenceCategory] = useState("New information");
  const [evidenceText, setEvidenceText] = useState("");
  const [addingEvidence, setAddingEvidence] = useState(false);
  const [evidenceSuccess, setEvidenceSuccess] = useState("");
  const [evidenceError, setEvidenceError] = useState("");
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
  const [allocationNote, setAllocationNote] = useState("");
  const [chooseDifferentOwner, setChooseDifferentOwner] = useState(false);
  const [allocating, setAllocating] = useState(false);
  const [allocationError, setAllocationError] = useState("");
  const [allocationSuccess, setAllocationSuccess] = useState("");
  const [stakeholderNotifications, setStakeholderNotifications] = useState({
    "Operations Lead": true,
    Engineering: true,
    "Customer Support": true,
    Sales: false,
    Product: false,
    Finance: false,
    Marketing: false,
    "HR / People": false,
    Leadership: false,
  });
  const [notifyingStakeholders, setNotifyingStakeholders] = useState(false);
  const [notificationSuccess, setNotificationSuccess] = useState("");
  const [notificationError, setNotificationError] = useState("");
  const [stakeholderNote, setStakeholderNote] = useState("");
  const [closureNotes, setClosureNotes] = useState("");
  const [resolutionSource, setResolutionSource] = useState("");
  const [originalResolutionNote, setOriginalResolutionNote] = useState("");
  const [savingResolutionRecord, setSavingResolutionRecord] = useState(false);
  const [resolutionRecordSuccess, setResolutionRecordSuccess] = useState("");
  const [resolutionRecipients, setResolutionRecipients] = useState([]);
  const [resolutionMessage, setResolutionMessage] = useState("");
  const [generatingResolutionMessage, setGeneratingResolutionMessage] = useState(false);
  const [resolutionMessageError, setResolutionMessageError] = useState("");
  const [markingCommunicated, setMarkingCommunicated] = useState(false);
  const [closingIncident, setClosingIncident] = useState(false);
  const [closureError, setClosureError] = useState("");
  const [closureSuccess, setClosureSuccess] = useState("");

  const [kpiDays, setKpiDays] = useState(90);
  const [resolverFilter, setResolverFilter] = useState("All");
  const [attentionFilter, setAttentionFilter] = useState("All");
  const [lifecycleFilter, setLifecycleFilter] = useState("All");
  const [incidentSort, setIncidentSort] = useState("Operational Attention");
  const [expandedIncidentId, setExpandedIncidentId] = useState("");
  const [healthSectionOpen, setHealthSectionOpen] = useState(true);
  const [standupSectionOpen, setStandupSectionOpen] = useState(true);
  const [revenueSectionOpen, setRevenueSectionOpen] = useState(true);
  const [activeSectionOpen, setActiveSectionOpen] = useState(true);
  const [resolvedSectionOpen, setResolvedSectionOpen] = useState(false);
  const [archiveSectionOpen, setArchiveSectionOpen] = useState(false);
  const [resolvedSearch, setResolvedSearch] = useState("");
  const [archiveSearch, setArchiveSearch] = useState("");
  const [archivedIds, setArchivedIds] = useState(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem("ops-triage-archived-incidents");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const [workspaceSection, setWorkspaceSection] = useState("investigation");

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
        jfetch(`${API.incidents}?status=resolved&days=365&limit=200`),
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
        jfetch(`${API.incidents}?status=resolved&days=365&limit=200`),
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
        setClosureNotes(incident.resolution_notes || "");
        setResolutionSource(incident.resolution_source || "");
        setOriginalResolutionNote(incident.original_resolution_note || "");
        setResolutionMessage(incident.resolution_communication || "");
        if (Array.isArray(incident.resolution_recipients) && incident.resolution_recipients.length) setResolutionRecipients(incident.resolution_recipients);
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
          jfetch(`${API.incidents}?status=resolved&days=365&limit=200`),
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
    const nextStatuses = [status, ...(STATUS_TRANSITIONS[status] || [])];
    return nextStatuses.filter((nextStatus) => nextStatus !== "resolved");
  }

  async function selectIncident(id) {
    setSelectedId(id);
    setTimelineCollapsed(true);
    setUpdateSuccess(false);
    setConfirmDelete(false);
    setDeleteSuccess(false);
    setAiResult(loadStoredAssessment(id));
    setAiError("");
    setEvidenceCategory("New information");
    setEvidenceText("");
    setEvidenceSuccess("");
    setEvidenceError("");
    setChooseDifferentOwner(false);
    setAllocationError("");
    setAllocationSuccess("");
    setAllocationNote("");
    setNotificationError("");
    setNotificationSuccess("");
    setStakeholderNote("");
    const incidentForResolution = active.find((item) => item.id === id) || resolved.find((item) => item.id === id);
    setClosureNotes(incidentForResolution?.resolution_notes || "");
    setResolutionSource(incidentForResolution?.resolution_source || "");
    setOriginalResolutionNote(incidentForResolution?.original_resolution_note || "");
    setResolutionRecordSuccess("");
    setResolutionRecipients(Array.isArray(incidentForResolution?.resolution_recipients) ? incidentForResolution.resolution_recipients : []);
    setResolutionMessage(incidentForResolution?.resolution_communication || "");
    setResolutionMessageError("");
    setClosureError("");
    setClosureSuccess("");
    setStakeholderNotifications({
      "Operations Lead": true,
      Engineering: true,
      "Customer Support": true,
      Sales: false,
      Product: false,
      Finance: false,
      Marketing: false,
      "HR / People": false,
      Leadership: false,
    });

    const incident = active.find((item) => item.id === id) || resolved.find((item) => item.id === id);
    setWorkspaceSection(incident?.status === "resolved" ? "resolution" : "investigation");
    if (incident) {
      setUStatus(incident.status || "investigating");
      setUPriority(incident.priority || "");
      setUResolvedBy(incident.resolved_by || "On-call");
      setUNotes(incident.resolution_notes || "");
      setUNote("");
    }

    await loadTimeline(id);
  }

  useEffect(() => {
    if (selectedId && workspaceSection === "resolution") loadResolutionRecipients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, workspaceSection]);

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


  async function addIncidentEvidence() {
    if (!selectedId || !evidenceText.trim()) return;
    setAddingEvidence(true);
    setEvidenceError("");
    setEvidenceSuccess("");
    try {
      await jfetch(API.addEvidence(selectedId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: evidenceCategory,
          information: evidenceText.trim(),
          added_by: "Operations Manager",
        }),
      });
      setEvidenceText("");
      setEvidenceSuccess("New incident information added to the operational record.");
      await loadAll();
      await loadTimeline(selectedId);
    } catch (error) {
      setEvidenceError(error.message || "Incident information could not be added.");
    } finally {
      setAddingEvidence(false);
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

      const summary = result?.summary || null;
      const failureText = `${summary?.executive_summary || ""} ${summary?.business_impact || ""}`.toLowerCase();
      const looksLikeProviderFailure =
        !summary ||
        failureText.includes("unable to generate the ai operational assessment") ||
        failureText.includes("error code: 520") ||
        failureText.includes("cloudflare") ||
        failureText.includes("unknown_origin_error");

      if (looksLikeProviderFailure) {
        setAiResult(null);
        setAiError(
          "AI Operational Assessment is temporarily unavailable. The incident can still be investigated, assigned, coordinated and resolved manually. Please retry the assessment."
        );
        return;
      }

      setAiResult(result);
      saveStoredAssessment(selectedId, result);
      const recommendedOwner = result?.summary?.recommended_incident_owner?.owner;
      if (recommendedOwner && ROLES.includes(recommendedOwner)) {
        setAllocationTeam(recommendedOwner);
      }
      setChooseDifferentOwner(false);
      setAllocationError("");
      setAllocationSuccess("");
    } catch (error) {
      setAiResult(null);
      setAiError(
        "AI Operational Assessment is temporarily unavailable. The incident can still be investigated, assigned, coordinated and resolved manually. Please retry the assessment."
      );
    } finally {
      setAiLoading(false);
    }
  }

  async function allocateIncident(useRecommendation) {
    if (!selectedId || !selectedIncident) return;

    const recommendedOwner = aiResult?.summary?.recommended_incident_owner?.owner;
    const ownerTeam = useRecommendation ? recommendedOwner : allocationTeam;

    if (!ownerTeam || !ROLES.includes(ownerTeam)) {
      setAllocationError("Choose a valid incident owner.");
      return;
    }

    setAllocating(true);
    setAllocationError("");
    setAllocationSuccess("");

    try {
      const baseReason = useRecommendation
        ? aiResult?.summary?.recommended_incident_owner?.reason ||
          "AI owner recommendation accepted after Operations Manager review."
        : aiResult?.summary
          ? "Operations Manager selected an owner manually after reviewing the AI operational assessment."
          : "Operations Manager assigned an incident owner without requiring an AI assessment.";
      const reason = allocationNote.trim()
        ? `${baseReason} Coordination note: ${allocationNote.trim()}`
        : baseReason;

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

      if (selectedIncident.status === "open") {
        await jfetch(API.patchIncident(selectedId), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "investigating",
            note: `Operational coordination started. ${ownerTeam} assigned as incident owner.`,
          }),
        });
        setUStatus("investigating");
      }

      await loadAll();
      await loadTimeline(selectedId);
      setChooseDifferentOwner(false);
      setAllocationNote("");
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

  async function notifyStakeholders() {
    if (!selectedId || !selectedIncident) return;

    const recipients = Object.entries(stakeholderNotifications)
      .filter(([, selected]) => selected)
      .map(([name]) => name);

    if (!recipients.length) {
      setNotificationError("Select at least one stakeholder to notify.");
      setNotificationSuccess("");
      return;
    }

    setNotifyingStakeholders(true);
    setNotificationError("");
    setNotificationSuccess("");

    try {
      const statusForCoordination = selectedIncident.status === "open" ? "investigating" : selectedIncident.status;
      await jfetch(API.stakeholders(selectedId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients,
          note: stakeholderNote.trim() || null,
          recorded_by: "Operations Manager",
        }),
      });

      setUStatus(statusForCoordination);
      await loadAll();
      await loadTimeline(selectedId);
      setStakeholderNote("");
      setNotificationSuccess(`Notification recorded for ${recipients.join(", ")}.`);
    } catch (error) {
      setNotificationError(error.message || "Stakeholder notification could not be recorded.");
    } finally {
      setNotifyingStakeholders(false);
    }
  }

  async function saveResolutionRecord() {
    if (!selectedId || !selectedIncident) return;

    if (!resolutionSource.trim() || !originalResolutionNote.trim() || !closureNotes.trim()) {
      setClosureError("Add the resolution source, original resolution note/message, and resolution summary before saving.");
      setResolutionRecordSuccess("");
      return;
    }

    setSavingResolutionRecord(true);
    setClosureError("");
    setResolutionRecordSuccess("");

    try {
      await jfetch(API.patchIncident(selectedId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: selectedIncident.status || "investigating",
          resolution_source: resolutionSource.trim(),
          original_resolution_note: originalResolutionNote.trim(),
          resolution_notes: closureNotes.trim(),
        }),
      });

      await loadAll();
      await loadTimeline(selectedId);
      setResolutionRecordSuccess("Resolution evidence and Operations summary saved.");
    } catch (error) {
      setClosureError(error.message || "Resolution record could not be saved.");
    } finally {
      setSavingResolutionRecord(false);
    }
  }

  async function loadResolutionRecipients() {
    if (!selectedId) return;
    try {
      const result = await jfetch(API.resolutionRecipients(selectedId));
      setResolutionRecipients(Array.isArray(result?.recipients) ? result.recipients : []);
    } catch (error) {
      setResolutionMessageError(error.message || "Resolution recipients could not be loaded.");
    }
  }

  async function generateResolutionCommunication() {
    if (!selectedId) return;
    setGeneratingResolutionMessage(true);
    setResolutionMessageError("");
    try {
      // Save the current human-authored evidence/summary first so AI only uses the reviewed record.
      await jfetch(API.patchIncident(selectedId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: selectedIncident.status || "investigating",
          resolution_source: resolutionSource.trim(),
          original_resolution_note: originalResolutionNote.trim(),
          resolution_notes: closureNotes.trim(),
        }),
      });
      const [recipientResult, result] = await Promise.all([
        jfetch(API.resolutionRecipients(selectedId)),
        jfetch(API.resolutionMessage, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ incident_id: selectedId }),
        }),
      ]);
      setResolutionRecipients(Array.isArray(recipientResult?.recipients) ? recipientResult.recipients : []);
      setResolutionMessage(result?.message || "");
      setResolutionRecordSuccess("Resolution evidence and Operations summary saved.");
    } catch (error) {
      setResolutionMessageError(error.message || "Resolution message could not be generated.");
    } finally {
      setGeneratingResolutionMessage(false);
    }
  }

  async function markResolutionAsCommunicated() {
    if (!selectedId || !resolutionMessage.trim() || !resolutionRecipients.length) return;
    setMarkingCommunicated(true);
    setResolutionMessageError("");
    try {
      await jfetch(API.patchIncident(selectedId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: selectedIncident.status || "investigating",
          resolution_source: resolutionSource.trim(),
          original_resolution_note: originalResolutionNote.trim(),
          resolution_notes: closureNotes.trim(),
        }),
      });
      const result = await jfetch(API.markResolutionCommunicated(selectedId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: resolutionMessage.trim(),
          recipients: resolutionRecipients,
          communicated_by: "Operations Manager",
        }),
      });
      const incident = result?.incident;
      if (incident) {
        setResolutionMessage(incident.resolution_communication || resolutionMessage.trim());
        setResolutionRecipients(Array.isArray(incident.resolution_recipients) ? incident.resolution_recipients : resolutionRecipients);
      }
      await loadAll();
      await loadTimeline(selectedId);
    } catch (error) {
      setResolutionMessageError(error.message || "Resolution communication could not be recorded.");
    } finally {
      setMarkingCommunicated(false);
    }
  }

  async function closeOperationalLifecycle() {
    if (!selectedId || !selectedIncident) return;

    if (!selectedIncident.owner_team) {
      setClosureError("Assign an incident owner before closing the incident.");
      return;
    }
    if (!resolutionSource.trim() || !originalResolutionNote.trim() || !closureNotes.trim()) {
      setClosureError("Complete the resolution evidence and Operations summary before closing the incident.");
      return;
    }
    if (!selectedIncident.resolution_communicated_at) {
      setClosureError("Mark the resolution communication as communicated before closing the incident.");
      return;
    }

    setClosingIncident(true);
    setClosureError("");
    setClosureSuccess("");
    try {
      await jfetch(API.patchIncident(selectedId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "resolved",
          resolution_notes: closureNotes.trim(),
          resolution_source: resolutionSource.trim(),
          original_resolution_note: originalResolutionNote.trim(),
        }),
      });
      setUStatus("resolved");
      setUResolvedBy("Operations Manager");
      setUNotes(closureNotes.trim());
      await loadAll();
      await loadTimeline(selectedId);
      setClosureSuccess("Incident closed. It has left the active queue and is now available in Resolved Incidents.");
    } catch (error) {
      setClosureError(error.message || "Incident could not be closed.");
    } finally {
      setClosingIncident(false);
    }
  }

  function persistArchivedIds(nextIds) {
    setArchivedIds(nextIds);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem("ops-triage-archived-incidents", JSON.stringify(nextIds));
      } catch {
        // V1 demo archive state remains in-memory if localStorage is unavailable.
      }
    }
  }

  function archiveIncident(id) {
    if (!id || archivedIds.includes(id)) return;
    persistArchivedIds([...archivedIds, id]);
  }

  function restoreArchivedIncident(id) {
    persistArchivedIds(archivedIds.filter((item) => item !== id));
  }

  function openActivitySection() {
    setWorkspaceSection("activity");
    if (selectedId) loadTimeline(selectedId);
  }

  const selectedReadOnly = selectedIncident?.status === "resolved";
  const invalidResolve = uStatus === "resolved" && (!uResolvedBy || uNotes.trim().length === 0);
  const allowedStatusesForSelected = selectedIncident ? allowedNextStatuses(selectedIncident.status) : STATUSES;

  const topResolvers = kpis?.top_resolvers || [];
  const resolvedSearchTerm = resolvedSearch.trim().toLowerCase();
  const archiveSearchTerm = archiveSearch.trim().toLowerCase();
  const historicalResolved = resolved.filter((incident) => !incidentWithinDays(incident, 90));
  const historicalIds = new Set(historicalResolved.map((incident) => incident.id));

  const resolvedFiltered = resolved.filter((incident) => {
    if (archivedIds.includes(incident.id) || historicalIds.has(incident.id)) return false;
    if (!incidentWithinDays(incident, kpiDays)) return false;
    if (resolverFilter !== "All" && (incident.resolved_by || "Unassigned") !== resolverFilter) return false;
    if (!resolvedSearchTerm) return true;
    const source = `${incident.title || ""} ${incident.description || ""} ${incident.owner_team || ""} ${incident.resolved_by || ""}`.toLowerCase();
    return source.includes(resolvedSearchTerm);
  });

  const archivedFiltered = resolved.filter((incident) => {
    const archived = archivedIds.includes(incident.id) || historicalIds.has(incident.id);
    if (!archived) return false;
    if (!archiveSearchTerm) return true;
    const source = `${incident.title || ""} ${incident.description || ""} ${incident.owner_team || ""} ${incident.resolved_by || ""}`.toLowerCase();
    return source.includes(archiveSearchTerm);
  });

  const resolverOptions = useMemo(() => {
    const fromKpis = topResolvers.map((item) => item.role);
    const fromResolved = Array.from(
      new Set(resolved.map((item) => (item.resolved_by || "Unassigned").trim() || "Unassigned"))
    );
    return Array.from(new Set(["All", ...fromKpis, ...fromResolved]));
  }, [topResolvers, resolved]);

  function parseReportedContext(description = "") {
    const lines = String(description || "").split("\n");
    const metadata = {};
    const bodyLines = [];
    let readingMetadata = true;

    for (const line of lines) {
      if (readingMetadata && line.trim() === "") {
        readingMetadata = false;
        continue;
      }

      if (readingMetadata) {
        const separatorIndex = line.indexOf(":");
        if (separatorIndex > 0) {
          const key = line.slice(0, separatorIndex).trim().toLowerCase();
          const value = line.slice(separatorIndex + 1).trim();
          metadata[key] = value;
          continue;
        }
      }

      bodyLines.push(line);
    }

    return {
      reporter: metadata["reported by"] || "Not recorded",
      role: metadata.role || "Not recorded",
      department: metadata.department || "Not recorded",
      businessArea: metadata["business area"] || "Not recorded",
      attentionRequested: metadata["immediate attention requested"] || "Standard",
      description: bodyLines.join("\n").trim() || String(description || "").trim(),
    };
  }

  function reportedContextFor(incident) {
    const legacy = parseReportedContext(incident?.description || "");
    return {
      reporter: incident?.reporter_name || legacy.reporter,
      role: incident?.reporter_role || legacy.role,
      department: incident?.reporter_department || legacy.department,
      contact: incident?.reporter_contact || "Not recorded",
      reportSource: incident?.report_source || "Not recorded",
      sourceReference: incident?.source_reference || "Not recorded",
      originalReport: incident?.original_report || "Not recorded",
      businessArea: incident?.business_area || legacy.businessArea,
      // New intake records persist reporter urgency explicitly. Keep the legacy
      // description parser only as a fallback for older demo records.
      attentionRequested: incident?.reporter_attention || legacy.attentionRequested,
      description: incident?.description || legacy.description,
    };
  }

  function operationalSignalsFor(incident) {
    if (incident?.initial_triage?.operational_risk) {
      return [incident.initial_triage.operational_risk];
    }
    const context = reportedContextFor(incident);
    const source = `${incident?.title || ""} ${context.description || ""} ${context.businessArea || ""}`.toLowerCase();
    const signals = [];

    if (/(customer|shopper|client|store|retail|checkout|portal)/.test(source)) {
      signals.push("Customer-facing service disruption detected");
    }
    if (/(payment|card reader|terminal|checkout|transaction|revenue|sales)/.test(source)) {
      signals.push("Potential revenue impact identified");
    }
    if (/(payment|visa|mastercard|card reader|terminal|processor|acquirer)/.test(source)) {
      signals.push("Payment services referenced");
    }
    if (/(multiple|across|stores|locations|market|regional|country|countries|multi-site)/.test(source)) {
      signals.push("Multi-site operational issue");
    }
    if (/(authentication|login|identity|sso|access)/.test(source)) {
      signals.push("Authentication or access issue detected");
    }
    if (/(down|offline|unavailable|outage|failed|failure|critical)/.test(source)) {
      signals.push("Possible business-critical service disruption");
    }

    if (!signals.length) {
      signals.push("Operational review required");
    }

    return signals.slice(0, 5);
  }

  function operationalAttentionFor(incident) {
    const context = reportedContextFor(incident);
    const criticalRequested =
      String(context.attentionRequested || "").toLowerCase() === "critical";

    // Reporter-assessed Critical is an intake signal, not a final incident
    // priority. On the dashboard it means Operations should review it now.
    if (criticalRequested) {
      return {
        key: "Immediate Review",
        label: "Immediate Review",
        tone: "red",
        rank: 2,
        dot: "●",
      };
    }

    // Keep the V1/demo attention model deliberately simple. Operations can
    // confirm priority in the incident workspace after investigation.
    return {
      key: "Standard",
      label: "Standard",
      tone: "green",
      rank: 1,
      dot: "●",
    };
  }

  const dashboardIncidents = useMemo(() => {
    const filtered = active.filter((incident) => {
      const attention = operationalAttentionFor(incident);
      const attentionMatches =
        attentionFilter === "All" || attention.key === attentionFilter;
      const lifecycleMatches =
        lifecycleFilter === "All" || incident.status === lifecycleFilter;
      return attentionMatches && lifecycleMatches;
    });

    return [...filtered].sort((a, b) => {
      if (incidentSort === "Newest") {
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      }
      if (incidentSort === "Oldest") {
        return new Date(a.created_at || 0) - new Date(b.created_at || 0);
      }

      const attentionDifference =
        operationalAttentionFor(b).rank - operationalAttentionFor(a).rank;

      if (attentionDifference !== 0) return attentionDifference;
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
  }, [active, attentionFilter, lifecycleFilter, incidentSort]);

  function mttrMinutesForPeriod() {
    const candidate =
      kpis?.avg_mttr_minutes ??
      kpis?.average_mttr_minutes ??
      kpis?.avg_mttr ??
      kpis?.mttr?.avg_minutes ??
      (kpiDays === 7 ? health?.mttr?.avg_minutes : null);
    const value = Number(candidate);
    return Number.isFinite(value) ? value : null;
  }

  function standupPoints() {
    // V1 demo: three focused operational priorities for the daily stand-up.
    const immediateIncident = [...active]
      .filter((incident) => operationalAttentionFor(incident).key === "Immediate Review")
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0];

    return [
      {
        title: "Restore sales order processing",
        detail: immediateIncident
          ? `${immediateIncident.title} · Immediate Review`
          : "Critical revenue-blocking incident · Operations review required",
      },
      {
        title: "Complete pricing QA for Product",
        detail: "Confirm pricing accuracy before release to protect conversion and customer experience",
      },
      {
        title: "Review MQL → SQL conversion",
        detail: "Conversion down 8% · 5 rejected MQLs require Lead Quality Review",
      },
    ];
  }

  function attentionItems() {
    const breaches = Array.isArray(health?.breached) ? health.breached : [];
    const aged = Number(health?.aging_buckets?.gte_24h ?? 0);
    const items = [];

    // The Ops Manager should see genuinely urgent reported incidents first.
    // Reporter-assessed Critical maps to Immediate Review until Operations
    // confirms the final operational priority in the incident workspace.
    const immediate = [...active]
      .filter((incident) => operationalAttentionFor(incident).key === "Immediate Review")
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    immediate.forEach((incident) => {
      if (items.length >= 3) return;
      const context = reportedContextFor(incident);
      const department = context.department && context.department !== "Not recorded"
        ? context.department
        : "Reported incident";
      items.push({
        title: incident.title,
        detail: `${department} · ${formatDateTime(incident.created_at)}`,
        tone: "red",
        label: "Immediate Review",
      });
    });

    if (items.length < 3 && breaches.length > 0) {
      const mostOverdue = breaches[0];
      items.push({
        title: `${breaches.length} SLA breach${breaches.length === 1 ? "" : "es"}`,
        detail: mostOverdue
          ? `Highest overdue: ${formatDurationMinutes(mostOverdue.overdue_minutes)}`
          : "Review breached incidents",
        tone: "amber",
        label: "Review",
      });
    }

    if (items.length < 3 && aged > 0) {
      items.push({
        title: `${aged} incident${aged === 1 ? "" : "s"} aged 24h+`,
        detail: "Backlog review required",
        tone: "amber",
        label: "Review",
      });
    }

    if (!items.length) {
      items.push({
        title: "No immediate exceptions",
        detail: "No immediate-review incidents, SLA breaches or 24h+ backlog currently require attention",
        tone: "green",
        label: "Clear",
      });
    }

    return items.slice(0, 3);
  }

  const Page = {
    minHeight: "100vh",
    background: THEME.pageBg,
    color: THEME.text,
  };

  const Container = {
    margin: "0 auto",
    display: "grid",
    gap: 14,
  };

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

  if (currentView === "dashboard") {
    return (
      <div style={Page} className="oth-page">
        <div style={Container} className="oth-container">
          <div className="oth-dashboard-header" style={{ borderBottom: `1px solid ${THEME.subtleBorder}` }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: -0.3 }}>
                Ops Triage Hub
              </div>
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

          <Card
            title="Operational Health KPIs"
            right={
              <div style={{ width: 96 }}>
                <Select
                  value={String(kpiDays)}
                  onChange={(value) => setKpiDays(Number(value))}
                  options={["7", "30", "90"]}
                />
              </div>
            }
          >
            <div className="oth-kpi-grid">
              {[
                ["Active incidents", health?.active_total ?? active.length],
                ["SLA breached", health?.breached_total ?? "—"],
                [
                  "SLA attainment",
                  kpis?.sla_attainment_pct != null
                    ? `${Math.round(Number(kpis.sla_attainment_pct))}%`
                    : kpis?.resolved_total != null && kpis?.sla_breached_total != null && Number(kpis.resolved_total) > 0
                      ? `${Math.round(((Number(kpis.resolved_total) - Number(kpis.sla_breached_total)) / Number(kpis.resolved_total)) * 100)}%`
                      : "—",
                ],
                ["Resolved", kpis?.resolved_total ?? kpis?.resolved_count ?? "—"],
                ["MTTR", formatDurationMinutes(mttrMinutesForPeriod())],
              ].map(([label, value]) => (
                <div className="oth-kpi-tile" key={label}>
                  <Label>{label}{label === "MTTR" ? ` (${kpiDays}d)` : ""}</Label>
                  <div style={{ fontSize: 22, fontWeight: 900 }}>{value}</div>
                </div>
              ))}
            </div>
          </Card>

          <div className="oth-dashboard-pair">
            <Card title="Morning Stand-Up Focus">
              <div className="oth-summary-list">
                {standupPoints().map((point, index) => (
                  <div className="oth-summary-item" key={`${point.title}-${index}`}>
                    <div className="oth-summary-index">{index + 1}</div>
                    <div>
                      <div style={{ fontWeight: 900, color: THEME.heading }}>{point.title}</div>
                      <div style={{ marginTop: 3, fontSize: 12, color: THEME.subtleText }}>{point.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Needs Attention">
              <div className="oth-summary-list">
                {attentionItems().map((item, index) => (
                  <div className="oth-attention-item" key={`${item.title}-${index}`}>
                    <Pill tone={item.tone}>{item.label}</Pill>
                    <div>
                      <div style={{ fontWeight: 900, color: THEME.heading }}>{item.title}</div>
                      <div style={{ marginTop: 3, fontSize: 12, color: THEME.subtleText }}>{item.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <Card title="Revenue Forecast" right={<div style={{ fontWeight: 900, color: THEME.heading }}>92%</div>}>
            <div className="oth-target-progress">
              <div style={{ fontSize: 13, fontWeight: 800, color: THEME.heading, whiteSpace: "nowrap" }}>
                €920k forecast / €1m target
              </div>
              <div className="oth-progress-track" aria-label="Revenue forecast: 92 percent of Q1 target">
                <div className="oth-progress-fill" style={{ width: "92%" }} />
              </div>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: THEME.subtleText }}>
              €80k forecast gap · Q1
            </div>
          </Card>

          <Card
            title={`Active Incidents (${dashboardIncidents.length})`}
            right={
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {activeSectionOpen ? (
                  <>
                <div style={{ minWidth: 180 }}>
                  <Label>Operational Attention</Label>
                  <Select
                    value={attentionFilter}
                    onChange={setAttentionFilter}
                    options={["All", "Immediate Review", "Standard"]}
                  />
                </div>
                <div style={{ minWidth: 160 }}>
                  <Label>Lifecycle Status</Label>
                  <Select
                    value={lifecycleFilter}
                    onChange={setLifecycleFilter}
                    options={["All", "open", "investigating"]}
                  />
                </div>
                <div style={{ minWidth: 190 }}>
                  <Label>Sort</Label>
                  <Select
                    value={incidentSort}
                    onChange={setIncidentSort}
                    options={["Operational Attention", "Newest", "Oldest"]}
                  />
                </div>
                  </>
                ) : null}
                <SmallActionButton onClick={() => setActiveSectionOpen((current) => !current)}>
                  {activeSectionOpen ? "Collapse" : "Expand"}
                </SmallActionButton>
              </div>
            }
          >
            {activeSectionOpen ? (
              <>
            <div style={{ fontSize: 12, color: THEME.subtleText, marginBottom: 10 }}>
              Summary first. Expand an incident only when you are ready to review its operational context.
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              {dashboardIncidents.map((incident) => {
                const attention = operationalAttentionFor(incident);
                const isExpanded = expandedIncidentId === incident.id;
                const context = reportedContextFor(incident);
                const signals = operationalSignalsFor(incident);

                return (
                  <div
                    key={incident.id}
                    style={{
                      borderRadius: 14,
                      border: isExpanded ? "2px solid #2563EB" : `1px solid ${THEME.subtleBorder}`,
                      background: isExpanded ? "#F8FBFF" : "#FFFFFF",
                      boxShadow: isExpanded
                        ? "0 8px 20px rgba(37,99,235,0.10)"
                        : "0 1px 3px rgba(15,23,42,0.04)",
                      overflow: "hidden",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedIncidentId((current) =>
                          current === incident.id ? "" : incident.id
                        )
                      }
                      style={{
                        width: "100%",
                        padding: 13,
                        border: 0,
                        background: "transparent",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "auto 1fr auto",
                          gap: 12,
                          alignItems: "center",
                        }}
                      >
                        <Pill tone={attention.tone}>
                          <span style={{ marginRight: 6 }}>{attention.dot}</span>
                          {attention.label}
                        </Pill>

                        <div>
                          <div style={{ fontWeight: 900, color: THEME.heading }}>
                            {incident.title}
                          </div>
                          <div
                            style={{
                              marginTop: 5,
                              display: "flex",
                              gap: 8,
                              flexWrap: "wrap",
                              alignItems: "center",
                              fontSize: 12,
                              color: THEME.subtleText,
                            }}
                          >
                            <span>{incident.status}</span>
                            <span>•</span>
                            <span>{formatDateTime(incident.created_at)}</span>
                            {incident.owner_team ? (
                              <>
                                <span>•</span>
                                <span>Owner: {incident.owner_team}</span>
                              </>
                            ) : null}
                          </div>
                        </div>

                        <div style={{ color: "#2563EB", fontWeight: 900 }}>
                          {isExpanded ? "Hide details ↑" : "Expand ↓"}
                        </div>
                      </div>
                    </button>

                    {isExpanded ? (
                      <div
                        style={{
                          padding: "0 13px 13px",
                          display: "grid",
                          gridTemplateColumns: "0.95fr 1.05fr",
                          gap: 10,
                        }}
                      >
                        <div
                          style={{
                            padding: 12,
                            borderRadius: 12,
                            border: `1px solid ${THEME.subtleBorder}`,
                            background: "#FFFFFF",
                          }}
                        >
                          <div style={{ fontWeight: 900, color: THEME.heading }}>
                            Report Details
                          </div>

                          <div
                            style={{
                              marginTop: 10,
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr",
                              gap: 10,
                              fontSize: 12,
                            }}
                          >
                            <div>
                              <Label>Reported by</Label>
                              <div style={{ fontWeight: 800 }}>{context.reporter}</div>
                            </div>
                            <div>
                              <Label>Department</Label>
                              <div style={{ fontWeight: 800 }}>{context.department}</div>
                            </div>
                            <div>
                              <Label>Role</Label>
                              <div style={{ fontWeight: 800 }}>{context.role}</div>
                            </div>
                            <div>
                              <Label>Business area</Label>
                              <div style={{ fontWeight: 800 }}>{context.businessArea}</div>
                            </div>
                          </div>

                          <div style={{ marginTop: 12 }}>
                            <Label>Description</Label>
                            <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                              {context.description || "No description recorded."}
                            </div>
                          </div>
                        </div>

                        <div
                          style={{
                            padding: 12,
                            borderRadius: 12,
                            border: "1px solid #BFDBFE",
                            background: "#EFF6FF",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 10,
                              alignItems: "center",
                            }}
                          >
                            <div style={{ fontWeight: 900, color: "#1E3A8A" }}>
                              Operational Risks
                            </div>
                            <Pill tone={attention.tone}>{attention.label}</Pill>
                          </div>

                          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                            {signals.map((signal, index) => (
                              <div
                                key={`${incident.id}-signal-${index}`}
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "20px 1fr",
                                  gap: 8,
                                  fontSize: 13,
                                  lineHeight: 1.45,
                                  color: "#1E3A8A",
                                }}
                              >
                                <div style={{ fontWeight: 900, color: signalColorForTone(attention.tone) }}>⚠</div>
                                <div>{signal}</div>
                              </div>
                            ))}
                          </div>

                          <div
                            style={{
                              marginTop: 12,
                              paddingTop: 10,
                              borderTop: "1px solid #BFDBFE",
                              fontSize: 12,
                              lineHeight: 1.5,
                              color: "#1E3A8A",
                            }}
                          >
                            Operational Risks assist initial review. Operational decisions remain
                            the responsibility of the Operations Team.
                          </div>

                          <div style={{ marginTop: 12 }}>
                            <Button
                              onClick={async () => {
                                await selectIncident(incident.id);
                                setCurrentView("workspace");
                              }}
                              variant="primary"
                            >
                              Investigate Incident
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}

              {!dashboardIncidents.length ? (
                <div
                  style={{
                    padding: 18,
                    borderRadius: 12,
                    border: "1px dashed #CBD5E1",
                    background: "#F8FAFC",
                    color: THEME.subtleText,
                    textAlign: "center",
                  }}
                >
                  No incidents match the current filter.
                </div>
              ) : null}
            </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: THEME.subtleText }}>
                Active Incidents is collapsed. Expand to review the operational queue.
              </div>
            )}
          </Card>

          <Card
            title={`Resolved Incidents (${resolvedFiltered.length})`}
            right={
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Pill>{kpiDays}-Day Reporting Period</Pill>
                <SmallActionButton onClick={() => setResolvedSectionOpen((current) => !current)}>
                  {resolvedSectionOpen ? "Collapse" : "Expand"}
                </SmallActionButton>
              </div>
            }
          >
            {resolvedSectionOpen ? (
              <div style={{ display: "grid", gap: 8 }}>
                <input
                  value={resolvedSearch}
                  onChange={(event) => setResolvedSearch(event.target.value)}
                  placeholder="Search resolved incidents, owners or keywords"
                  style={InputBaseStyle(false)}
                />
              {resolvedFiltered.slice(0, 10).map((incident) => (
                <div
                  key={incident.id}
                  style={{
                    padding: 10,
                    borderRadius: 12,
                    border: `1px solid ${THEME.subtleBorder}`,
                    background: "#F8FAFC",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 850 }}>{incident.title}</div>
                    <div style={{ marginTop: 4, fontSize: 12, color: THEME.subtleText }}>
                      Resolved by {incident.resolved_by || "Unassigned"} •{" "}
                      {formatDateTime(incident.resolved_at || incident.updated_at)}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <Pill tone="green">Resolved</Pill>
                    <SmallActionButton
                      onClick={async () => {
                        await selectIncident(incident.id);
                        setCurrentView("workspace");
                      }}
                    >
                      Review
                    </SmallActionButton>
                    <SmallActionButton onClick={() => archiveIncident(incident.id)}>
                      Archive
                    </SmallActionButton>
                  </div>
                </div>
              ))}

              {!resolvedFiltered.length ? (
                <div style={{ fontSize: 12, color: THEME.subtleText }}>
                  No resolved incidents for this reporting period.
                </div>
              ) : null}
            </div>
            ) : (
              <div style={{ fontSize: 12, color: THEME.subtleText }}>
                Resolved Incidents is collapsed. Expand to review completed work.
              </div>
            )}
          </Card>

          <Card
            title={`Archived Incidents (${archivedFiltered.length})`}
            right={
              <SmallActionButton onClick={() => setArchiveSectionOpen((current) => !current)}>
                {archiveSectionOpen ? "Collapse" : "Expand"}
              </SmallActionButton>
            }
          >
            {archiveSectionOpen ? (
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 12, color: THEME.subtleText, lineHeight: 1.5 }}>
                  Historical incidents remain searchable and reviewable without crowding the day-to-day operational queue.
                </div>
                <input
                  value={archiveSearch}
                  onChange={(event) => setArchiveSearch(event.target.value)}
                  placeholder="Search archived incidents"
                  style={InputBaseStyle(false)}
                />

                {archivedFiltered.slice(0, 25).map((incident) => {
                  const manuallyArchived = archivedIds.includes(incident.id);
                  return (
                    <div
                      key={incident.id}
                      style={{
                        padding: 10,
                        borderRadius: 12,
                        border: `1px solid ${THEME.subtleBorder}`,
                        background: "#F8FAFC",
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 850 }}>{incident.title}</div>
                        <div style={{ marginTop: 4, fontSize: 12, color: THEME.subtleText }}>
                          Resolved by {incident.resolved_by || "Unassigned"} • {formatDateTime(incident.resolved_at || incident.updated_at)}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                        <Pill>{manuallyArchived ? "Archived" : "Historical"}</Pill>
                        <SmallActionButton
                          onClick={async () => {
                            await selectIncident(incident.id);
                            setCurrentView("workspace");
                          }}
                        >
                          Review
                        </SmallActionButton>
                        {manuallyArchived && incidentWithinDays(incident, 90) ? (
                          <SmallActionButton onClick={() => restoreArchivedIncident(incident.id)}>
                            Restore
                          </SmallActionButton>
                        ) : null}
                      </div>
                    </div>
                  );
                })}

                {!archivedFiltered.length ? (
                  <div style={{ fontSize: 12, color: THEME.subtleText }}>
                    No archived incidents match the current search.
                  </div>
                ) : null}

                <div style={{ fontSize: 11, color: THEME.subtleText }}>
                  V1 demo note: explicit archive choices and saved AI assessments are retained locally in this browser; incident records remain sourced from the API.
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: THEME.subtleText }}>
                Archived Incidents is collapsed. Expand to search historical operational records.
              </div>
            )}
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div style={Page} className="oth-page">
      <div style={Container} className="oth-container">
        <div
          className="oth-workspace-header"
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            alignItems: "center",
            paddingBottom: 12,
            borderBottom: `1px solid ${THEME.subtleBorder}`,
          }}
        >
          <div>
            <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: 0.2 }}>
              Ops Triage Hub
            </div>
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
              Incident Workspace
            </div>
            <div style={{ fontSize: 12, color: THEME.subtleText, marginTop: 4 }}>
              Investigate, coordinate and resolve one operational incident at a time.
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Button
              onClick={() => {
                setCurrentView("dashboard");
                loadAll();
              }}
            >
              ← Active Incidents
            </Button>
            <Button onClick={refreshSelected} disabled={!selectedId || loading} variant="primary">
              {loading ? "Refreshing…" : "Refresh Incident"}
            </Button>
          </div>
        </div>

        {workspaceSection !== "activity" ? (
          <div className="oth-compact-journey-wrap">
            <CompactIncidentJourney incident={selectedIncident} timeline={timeline} />
          </div>
        ) : null}

        <div
          style={{
            position: "sticky",
            top: 8,
            zIndex: 20,
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            padding: 8,
            borderRadius: 12,
            border: `1px solid ${THEME.cardBorder}`,
            background: "rgba(245,248,252,0.96)",
            boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
          }}
        >
          {[
            ["investigation", "Investigation"],
            ["ai", "AI Assessment"],
            ["coordination", "Coordination"],
            ["resolution", "Resolution"],
            ["activity", "Activity"],
          ].map(([key, label]) => (
            <Button
              key={key}
              onClick={() => {
                setWorkspaceSection(key);
                if (key === "activity" && selectedId) loadTimeline(selectedId);
              }}
              variant={workspaceSection === key ? "primary" : "default"}
            >
              {label}
            </Button>
          ))}
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

        {selectedIncident ? (
          <div
            style={{
              padding: 12,
              borderRadius: 14,
              border: `1px solid ${THEME.cardBorder}`,
              background: "#FFFFFF",
              boxShadow: THEME.shadow,
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: THEME.subtleText, textTransform: "uppercase", letterSpacing: 0.4 }}>
                Selected Incident
              </div>
              <div style={{ marginTop: 3, fontSize: 16, fontWeight: 900, color: THEME.heading }}>
                {selectedIncident.title}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <Pill>{selectedIncident.priority}</Pill>
              <Pill>{selectedIncident.status}</Pill>
              {selectedIncident.owner_team ? (
                <Pill tone="green">Owner: {selectedIncident.owner_team}{selectedIncident.owner_name ? ` — ${selectedIncident.owner_name}` : ""}</Pill>
              ) : (
                <Pill tone="amber">Owner not assigned</Pill>
              )}
              {selectedReadOnly ? <Pill tone="green">Read-only record</Pill> : null}
            </div>
          </div>
        ) : null}

        {selectedIncident ? (
          <>
            <div style={{ display: workspaceSection === "investigation" ? "block" : "none" }}>
            <Card
              title="Incident Investigation"
              right={
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Pill>{selectedIncident.priority}</Pill>
                  <Pill>{selectedIncident.status}</Pill>
                  {selectedIncident.owner_team ? (
                    <Pill tone="green">Owner: {selectedIncident.owner_team}</Pill>
                  ) : (
                    <Pill tone="amber">Owner not assigned</Pill>
                  )}
                  {selectedReadOnly ? <Pill tone="green">Read-only record</Pill> : null}
                </div>
              }
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.05fr 0.95fr",
                  gap: 12,
                  alignItems: "stretch",
                }}
              >
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
                      fontSize: 12,
                      fontWeight: 800,
                      color: "#2563EB",
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                    }}
                  >
                    Incident selected
                  </div>
                  <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900, color: THEME.heading }}>
                    {selectedIncident.title}
                  </div>

                  <div
                    style={{
                      marginTop: 14,
                      display: "grid",
                      gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                      gap: 10,
                    }}
                  >
                    <div>
                      <Label>Reported by</Label>
                      <div style={{ fontSize: 13, fontWeight: 800 }}>
                        {reportedContextFor(selectedIncident).reporter}
                      </div>
                    </div>
                    <div>
                      <Label>Department</Label>
                      <div style={{ fontSize: 13, fontWeight: 800 }}>
                        {reportedContextFor(selectedIncident).department}
                      </div>
                    </div>
                    <div>
                      <Label>Business area</Label>
                      <div style={{ fontSize: 13, fontWeight: 800 }}>
                        {reportedContextFor(selectedIncident).businessArea}
                      </div>
                    </div>
                    <div>
                      <Label>Reported</Label>
                      <div style={{ fontSize: 13, fontWeight: 800 }}>
                        {formatDateTime(selectedIncident.created_at)}
                      </div>
                    </div>
                  </div>

                  <div className="oth-provenance-grid" style={{ marginTop: 12 }}>
                    <div><Label>Contact</Label><div style={{ fontSize: 13, fontWeight: 800 }}>{reportedContextFor(selectedIncident).contact}</div></div>
                    <div><Label>Source</Label><div style={{ fontSize: 13, fontWeight: 800 }}>{reportedContextFor(selectedIncident).reportSource}</div></div>
                    <div><Label>Source reference</Label><div style={{ fontSize: 13, fontWeight: 800 }}>{reportedContextFor(selectedIncident).sourceReference}</div></div>
                  </div>

                  {reportedContextFor(selectedIncident).originalReport !== "Not recorded" ? (
                    <div style={{ marginTop: 14 }}>
                      <Label>Original report or message</Label>
                      <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", padding: 10, borderRadius: 10, background: "#F8FAFC", border: `1px solid ${THEME.subtleBorder}` }}>
                        {reportedContextFor(selectedIncident).originalReport}
                      </div>
                    </div>
                  ) : null}

                  <div style={{ marginTop: 14 }}>
                    <Label>Reported issue</Label>
                    <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                      {reportedContextFor(selectedIncident).description ||
                        "No issue description was recorded."}
                    </div>
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
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      alignItems: "center",
                    }}
                  >
                    <div style={{ fontWeight: 900, color: "#1E3A8A" }}>
                      Operational Risks
                    </div>
                    <Pill tone={operationalAttentionFor(selectedIncident).tone}>
                      {operationalAttentionFor(selectedIncident).label}
                    </Pill>
                  </div>

                  <div style={{ marginTop: 11, display: "grid", gap: 8 }}>
                    {operationalSignalsFor(selectedIncident).map((signal, index) => (
                      <div
                        key={`${selectedIncident.id}-workspace-signal-${index}`}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "20px 1fr",
                          gap: 8,
                          fontSize: 13,
                          lineHeight: 1.5,
                          color: "#1E3A8A",
                        }}
                      >
                        <div style={{ fontWeight: 900, color: signalColorForTone(operationalAttentionFor(selectedIncident).tone) }}>⚠</div>
                        <div>{signal}</div>
                      </div>
                    ))}
                  </div>

                  {selectedIncident.initial_triage ? (
                    <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #BFDBFE" }}>
                      <div style={{ fontSize: 12, fontWeight: 900, color: "#1E3A8A", textTransform: "uppercase", letterSpacing: 0.4 }}>Initial operational review</div>
                      <div style={{ marginTop: 6, fontSize: 13, fontWeight: 850, color: "#1E3A8A" }}>Suggested priority: {selectedIncident.initial_triage.suggested_priority || "Review"}</div>
                      <div style={{ marginTop: 5, fontSize: 13, lineHeight: 1.5, color: "#1E3A8A" }}>{selectedIncident.initial_triage.reason}</div>
                      <div style={{ marginTop: 7, fontSize: 12, color: "#1E3A8A" }}>Source: {selectedIncident.initial_triage_source || "Recorded assessment"} · Operations confirmation required</div>
                    </div>
                  ) : null}
                  <div
                    style={{
                      marginTop: 12,
                      paddingTop: 10,
                      borderTop: "1px solid #BFDBFE",
                      fontSize: 12,
                      lineHeight: 1.5,
                      color: "#1E3A8A",
                    }}
                  >
                    Operational Risks assist initial review. Operational decisions remain the
                    responsibility of the Operations Team.
                  </div>
                </div>
              </div>
            </Card>
            </div>

            <div style={{ display: workspaceSection === "investigation" || workspaceSection === "ai" ? "grid" : "none", gridTemplateColumns: "1fr", gap: 10, alignItems: "start" }}>
          <div style={{ display: workspaceSection === "investigation" ? "block" : "none" }}>
          <Card
            title={selectedReadOnly ? "Resolved incident record" : "Update incident"}
            right={
              <div style={{ display: "flex", gap: 8 }}>
                <SmallActionButton
                  onClick={refreshSelected}
                  disabled={!selectedId || updating || timelineLoading}
                >
                  Refresh
                </SmallActionButton>
                <SmallActionButton
                  onClick={openActivitySection}
                  disabled={!selectedId}
                >
                  View Activity
                </SmallActionButton>
              </div>
            }
          >
            <div style={{ display: "grid", gap: 10 }}>
              {selectedReadOnly ? (
                <div style={{ padding: 10, borderRadius: 10, background: "#F0FDF4", border: "1px solid #A7F3D0", color: "#166534", fontSize: 12, fontWeight: 800 }}>
                  ✓ Read-only resolved incident. Historical evidence, AI assessment and Activity History remain available for review.
                </div>
              ) : null}
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
                    disabled={!selectedIncident || selectedReadOnly}
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
                    disabled={!selectedIncident || selectedReadOnly}
                  />
                  <div style={{ fontSize: 12, color: THEME.subtleText, marginTop: 6 }}>
                    Priority can be adjusted at any stage and is recorded in Activity History.
                  </div>
                </div>
              </div>

              <div style={{ padding: 12, borderRadius: 12, border: "1px solid #BFDBFE", background: "#F8FBFF" }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#2563EB", textTransform: "uppercase", letterSpacing: 0.4 }}>Add Incident Information</div>
                <div style={{ marginTop: 5, fontSize: 12, color: THEME.subtleText, lineHeight: 1.5 }}>
                  Add new evidence as it becomes available. The original report is preserved; each update is timestamped in Activity History and becomes available to future AI assessments.
                </div>
                <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "220px 1fr", gap: 10, alignItems: "start" }}>
                  <div>
                    <Label>Information type</Label>
                    <Select
                      value={evidenceCategory}
                      onChange={(value) => {
                        setEvidenceCategory(value);
                        setEvidenceSuccess("");
                        setEvidenceError("");
                      }}
                      options={["New information", "Investigation finding", "Customer impact", "Technical finding", "Workaround", "External update"]}
                      disabled={!selectedIncident || selectedReadOnly || addingEvidence}
                    />
                  </div>
                  <div>
                    <Label>New operational information</Label>
                    <textarea
                      value={evidenceText}
                      onChange={(event) => {
                        setEvidenceText(event.target.value);
                        setEvidenceSuccess("");
                        setEvidenceError("");
                      }}
                      placeholder="What has been learned since the incident was reported?"
                      rows={3}
                      disabled={!selectedIncident || selectedReadOnly || addingEvidence}
                      style={{ ...InputBaseStyle(!selectedIncident || selectedReadOnly || addingEvidence), resize: "vertical" }}
                    />
                  </div>
                </div>
                <div style={{ marginTop: 10 }}>
                  <Button onClick={addIncidentEvidence} disabled={!selectedIncident || selectedReadOnly || addingEvidence || !evidenceText.trim()} variant="primary">
                    {addingEvidence ? "Adding…" : "Add to Incident Record"}
                  </Button>
                </div>
                {evidenceSuccess ? <div style={{ marginTop: 8, fontSize: 12, color: "#166534", fontWeight: 750 }}>✓ {evidenceSuccess}</div> : null}
                {evidenceError ? <div style={{ marginTop: 8, fontSize: 12, color: THEME.dangerText }}>{evidenceError}</div> : null}
              </div>

              {uStatus === "resolved" ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <Label>Resolved by (required)</Label>
                    <Select value={uResolvedBy} onChange={setUResolvedBy} options={ROLES} disabled={selectedReadOnly} />
                  </div>
                  <div>
                    <Label>Resolution notes (required)</Label>
                    <input
                      value={uNotes}
                      onChange={(event) => setUNotes(event.target.value)}
                      placeholder="Short summary of the resolution and follow-up actions"
                      disabled={selectedReadOnly}
                      style={InputBaseStyle(selectedReadOnly)}
                    />
                  </div>
                </div>
              ) : null}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Button
                  onClick={updateIncident}
                  disabled={updating || deleting || !selectedId || invalidResolve || selectedReadOnly}
                  variant="default"
                >
                  {updating ? "Updating…" : "Update incident"}
                </Button>

                <DangerButton
                  onClick={() => setConfirmDelete(true)}
                  disabled={!selectedIncident || updating || deleting || selectedReadOnly}
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
                    onClick={openActivitySection}
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

            </div>
          </Card>
          </div>

          <div style={{ display: workspaceSection === "ai" ? "block" : "none" }}>
          <Card
            title="AI Operations Assistant"
            right={<Pill tone="green">Decision support</Pill>}
          >
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ fontSize: 13, color: THEME.subtleText, lineHeight: 1.55 }}>
                Generate an AI Operational Assessment from the selected incident, Activity History and
                available operational evidence. The assistant distinguishes facts, inferences,
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
                {aiLoading
                  ? "AI Assistant is reviewing…"
                  : aiResult?.summary
                    ? "Regenerate AI Operational Assessment"
                    : "Generate AI Operational Assessment"}
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
                                  : String(aiResult.summary.assessment_reliability || "").toLowerCase() === "limited"
                                    ? "red"
                                    : "neutral"
                            }
                          >
                            {["strong", "moderate", "limited"].includes(
                              String(aiResult.summary.assessment_reliability || "").toLowerCase()
                            )
                              ? aiResult.summary.assessment_reliability
                              : "Not assessed"}
                          </Pill>
                        </div>
                      </div>

                      <div>
                        <div style={{ fontWeight: 900, color: THEME.heading }}>Assessment Rationale</div>
                        <div style={{ marginTop: 7, fontSize: 13, lineHeight: 1.65 }}>
                          {aiResult.summary.assessment_rationale ||
                            aiResult.summary.confidence_reason ||
                            "Assessment reliability was not explicitly stated. Review the supporting evidence and missing information before acting on this assessment."}
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
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #BFDBFE", fontSize: 11, fontWeight: 700, color: "#475569" }}>
                  {tokenUsageFor(aiResult)
                    ? `AI usage · ${tokenUsageFor(aiResult).total != null ? `${tokenUsageFor(aiResult).total.toLocaleString()} tokens` : "token total unavailable"}${tokenUsageFor(aiResult).input != null ? ` · ${tokenUsageFor(aiResult).input.toLocaleString()} input` : ""}${tokenUsageFor(aiResult).output != null ? ` · ${tokenUsageFor(aiResult).output.toLocaleString()} output` : ""}`
                    : "AI usage · This assessment response did not include token counts. No estimate is shown."}
                </div>
              </div>
            </div>
          </Card>
          </div>
            </div>

            <div
              style={{
                display: workspaceSection === "coordination" ? "block" : "none",
                padding: 16,
                borderRadius: 16,
                border: "2px solid #2563EB",
                background: "#F8FBFF",
                boxShadow: THEME.shadow,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 12, color: "#2563EB", fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Operational Coordination
                  </div>
                  <div style={{ marginTop: 4, fontSize: 20, fontWeight: 900, color: THEME.heading }}>
                    Coordinate the response with or without AI
                  </div>
                </div>
                <Pill tone="green">Operations remains accountable</Pill>
              </div>

              <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "0.95fr 1.05fr", gap: 12 }}>
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ padding: 14, borderRadius: 12, border: "1px solid #BFDBFE", background: "#EFF6FF" }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "#1E3A8A", textTransform: "uppercase" }}>
                      AI Recommendation — Optional
                    </div>

                    {aiResult?.summary?.recommended_incident_owner?.owner ? (
                      <>
                        <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "start" }}>
                          <div>
                            <div style={{ fontSize: 20, fontWeight: 900, color: THEME.heading }}>
                              {aiResult.summary.recommended_incident_owner.owner}
                            </div>
                            <div style={{ marginTop: 7, fontSize: 13, lineHeight: 1.6, color: THEME.text }}>
                              {aiResult.summary.recommended_incident_owner.reason || "No owner recommendation rationale was returned."}
                            </div>
                          </div>
                          <Pill
                            tone={
                              String(aiResult.summary.recommended_incident_owner?.recommendation_reliability || "").toLowerCase() === "strong"
                                ? "green"
                                : String(aiResult.summary.recommended_incident_owner?.recommendation_reliability || "").toLowerCase() === "moderate"
                                  ? "amber"
                                  : String(aiResult.summary.recommended_incident_owner?.recommendation_reliability || "").toLowerCase() === "limited"
                                    ? "red"
                                    : "neutral"
                            }
                          >
                            {["strong", "moderate", "limited"].includes(
                              String(aiResult.summary.recommended_incident_owner?.recommendation_reliability || "").toLowerCase()
                            )
                              ? `${aiResult.summary.recommended_incident_owner.recommendation_reliability} confidence`
                              : "Not assessed"}
                          </Pill>
                        </div>

                        {!selectedIncident?.owner_team ? (
                          <div style={{ marginTop: 12 }}>
                            <Button
                              onClick={() => {
                                const recommendedOwner = aiResult?.summary?.recommended_incident_owner?.owner;
                                if (recommendedOwner && ROLES.includes(recommendedOwner)) {
                                  setAllocationTeam(recommendedOwner);
                                  setChooseDifferentOwner(false);
                                  setAllocationError("");
                                  setAllocationSuccess("");
                                }
                              }}
                              disabled={allocating}
                              variant="primary"
                            >
                              ✓ Accept AI Recommendation
                            </Button>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.55, color: THEME.text }}>
                        No AI owner recommendation has been generated. Operations can assign an owner manually now, or use the AI assessment as optional decision support.
                      </div>
                    )}
                  </div>

                  <div style={{ padding: 14, borderRadius: 12, border: `1px solid ${THEME.subtleBorder}`, background: "#FFFFFF" }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: THEME.subtleText, textTransform: "uppercase" }}>
                      Step 1 — Incident Owner
                    </div>

                    {selectedIncident?.owner_team ? (
                      <>
                        <div style={{ marginTop: 6, fontSize: 18, fontWeight: 900, color: THEME.heading }}>
                          {selectedIncident.owner_team}{selectedIncident.owner_name ? ` — ${selectedIncident.owner_name}` : ""}
                        </div>
                        <div style={{ marginTop: 8 }}>
                          <Pill tone="green">✓ Owner assigned</Pill>
                        </div>
                        <div style={{ marginTop: 8, fontSize: 12, color: THEME.subtleText, lineHeight: 1.5 }}>
                          Assigned {formatDateTime(selectedIncident.owner_assigned_at)} by {selectedIncident.owner_assigned_by || "Operations Manager"}.
                        </div>
                      </>
                    ) : (
                      <div style={{ marginTop: 10, display: "grid", gap: 9 }}>
                        <div>
                          <Label>Owner Team</Label>
                          <Select value={allocationTeam} onChange={setAllocationTeam} options={ROLES} />
                        </div>
                        <div>
                          <Label>Owner Name (optional)</Label>
                          <input
                            value={allocationName}
                            onChange={(event) => setAllocationName(event.target.value)}
                            placeholder="e.g. Dave Smith"
                            style={InputBaseStyle(false)}
                          />
                        </div>
                        <div>
                          <Label>Assignment note (optional)</Label>
                          <textarea
                            value={allocationNote}
                            onChange={(event) => setAllocationNote(event.target.value)}
                            placeholder="Why is this owner being assigned, or what should they investigate?"
                            rows={3}
                            style={{ ...InputBaseStyle(false), resize: "vertical" }}
                          />
                        </div>
                        <Button
                          onClick={() => allocateIncident(false)}
                          disabled={allocating}
                          variant="primary"
                        >
                          {allocating ? "Assigning…" : `Assign ${allocationTeam}`}
                        </Button>
                      </div>
                    )}

                    {allocationSuccess ? (
                      <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: "#ECFDF5", border: "1px solid #A7F3D0", color: "#065F46", fontSize: 12, fontWeight: 700 }}>
                        ✓ {allocationSuccess}
                      </div>
                    ) : null}

                    {allocationError ? (
                      <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: THEME.dangerBg, border: `1px solid ${THEME.dangerBorder}`, color: THEME.dangerText, fontSize: 13 }}>
                        {allocationError}
                      </div>
                    ) : null}

                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${THEME.subtleBorder}` }}>
                      <Label>Current Status</Label>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <Pill tone={selectedIncident.status === "investigating" ? "amber" : "neutral"}>{selectedIncident.status}</Pill>
                        {selectedIncident.status === "investigating" ? (
                          <span style={{ fontSize: 12, color: THEME.subtleText }}>Response is actively being coordinated.</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ padding: 14, borderRadius: 12, border: `1px solid ${THEME.subtleBorder}`, background: "#FFFFFF" }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: THEME.subtleText, textTransform: "uppercase" }}>
                    Step 2 — Stakeholder Communications
                  </div>
                  <div style={{ marginTop: 5, fontSize: 13, color: THEME.text, lineHeight: 1.5 }}>
                    Record who needs visibility. This is separate from incident ownership and can include any affected business area.
                  </div>

                  <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {Object.keys(stakeholderNotifications).map((stakeholder) => (
                      <label
                        key={stakeholder}
                        style={{
                          display: "flex",
                          gap: 9,
                          alignItems: "center",
                          padding: "8px 10px",
                          borderRadius: 10,
                          border: `1px solid ${THEME.subtleBorder}`,
                          background: stakeholderNotifications[stakeholder] ? "#F0FDF4" : "#F8FAFC",
                          cursor: selectedReadOnly ? "not-allowed" : "pointer",
                          fontSize: 13,
                          fontWeight: 750,
                          opacity: selectedReadOnly ? 0.75 : 1,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={stakeholderNotifications[stakeholder]}
                          disabled={selectedReadOnly}
                          onChange={(event) =>
                            setStakeholderNotifications((current) => ({
                              ...current,
                              [stakeholder]: event.target.checked,
                            }))
                          }
                        />
                        <span>{stakeholderNotifications[stakeholder] ? "✓ " : ""}{stakeholder}</span>
                      </label>
                    ))}
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <Label>Coordination note (optional)</Label>
                    <textarea
                      value={stakeholderNote}
                      onChange={(event) => setStakeholderNote(event.target.value)}
                      placeholder="What do stakeholders need to know or do?"
                      rows={3}
                      disabled={selectedReadOnly}
                      style={{ ...InputBaseStyle(selectedReadOnly), resize: "vertical" }}
                    />
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <Button
                      onClick={notifyStakeholders}
                      disabled={notifyingStakeholders || !selectedIncident?.owner_team || selectedIncident?.status === "resolved"}
                      variant="primary"
                    >
                      {notifyingStakeholders ? "Recording communications…" : "Record Stakeholder Notifications"}
                    </Button>
                  </div>


                  {notificationSuccess ? (
                    <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: "#ECFDF5", border: "1px solid #A7F3D0", color: "#065F46", fontSize: 12, fontWeight: 700 }}>
                      ✓ {notificationSuccess}
                    </div>
                  ) : null}

                  {notificationError ? (
                    <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: THEME.dangerBg, border: `1px solid ${THEME.dangerBorder}`, color: THEME.dangerText, fontSize: 12 }}>
                      {notificationError}
                    </div>
                  ) : null}

                  <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${THEME.subtleBorder}`, fontSize: 12, color: THEME.subtleText, lineHeight: 1.55 }}>
                    V1 records ownership, status changes, stakeholder notifications and operational notes in Activity History. Rich contributor work logs and evidence attachments remain a V2 enhancement.
                  </div>
                </div>
              </div>
            </div>

            <div
              style={{
                display: workspaceSection === "resolution" ? "block" : "none",
                padding: 16,
                borderRadius: 16,
                border: selectedIncident?.status === "resolved" ? "2px solid #22C55E" : "2px solid #0F766E",
                background: selectedIncident?.status === "resolved" ? "#F0FDF4" : "#F0FDFA",
                boxShadow: THEME.shadow,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 12, color: selectedIncident?.status === "resolved" ? "#166534" : "#0F766E", fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Resolution & Close
                  </div>
                  <div style={{ marginTop: 4, fontSize: 20, fontWeight: 900, color: THEME.heading }}>
                    Close the operational loop
                  </div>
                </div>
                <Pill tone={selectedIncident?.status === "resolved" ? "green" : "amber"}>
                  {selectedIncident?.status === "resolved" ? "✓ Incident closed" : "Operations approval required"}
                </Pill>
              </div>


              {selectedIncident?.status === "resolved" ? (
                <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                  <div style={{ padding: 14, borderRadius: 12, border: "1px solid #A7F3D0", background: "#FFFFFF" }}>
                    <div style={{ fontWeight: 900, color: "#166534" }}>✓ Operational lifecycle complete</div>
                    <div style={{ marginTop: 7, fontSize: 13, lineHeight: 1.6, color: THEME.text }}>
                      The incident is resolved, removed from the active operational queue and retained in Resolved Incidents for reporting and future reference.
                    </div>
                    <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div>
                        <Label>Resolved by</Label>
                        <div style={{ fontSize: 13, fontWeight: 800 }}>
                          {selectedIncident.resolved_by || "Operations Manager"}
                        </div>
                        <div style={{ marginTop: 5, fontSize: 12, color: THEME.subtleText }}>
                          {formatDateTime(selectedIncident.resolved_at || selectedIncident.updated_at)}
                        </div>
                      </div>
                      <div>
                        <Label>Resolution summary</Label>
                        <div style={{ fontSize: 13, fontWeight: 800 }}>
                          {selectedIncident.resolution_notes || closureNotes || "Resolution recorded"}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{ padding: 14, borderRadius: 12, border: `1px solid ${THEME.subtleBorder}`, background: "#FFFFFF" }}>
                    <Label>Resolution source</Label>
                    <div style={{ fontSize: 13, fontWeight: 800 }}>{selectedIncident.resolution_source || "—"}</div>
                    <div style={{ marginTop: 10 }}><Label>Original resolution note/message</Label></div>
                    <div style={{ fontSize: 13, lineHeight: 1.55 }}>{selectedIncident.original_resolution_note || "—"}</div>
                    <div style={{ marginTop: 10 }}><Label>Resolution notification recipients</Label></div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {(selectedIncident.resolution_recipients || []).map((recipient) => <Pill key={recipient}>{recipient}</Pill>)}
                    </div>
                    <div style={{ marginTop: 10 }}><Label>Communicated resolution message</Label></div>
                    <div style={{ fontSize: 13, lineHeight: 1.55 }}>{selectedIncident.resolution_communication || "—"}</div>
                  </div>

                  {closureSuccess ? (
                    <div style={{ padding: 11, borderRadius: 10, background: "#DCFCE7", border: "1px solid #86EFAC", color: "#166534", fontSize: 12, fontWeight: 800 }}>
                      ✓ {closureSuccess}
                    </div>
                  ) : null}

                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <Button
                      onClick={() => {
                        setCurrentView("dashboard");
                        loadAll();
                      }}
                      variant="primary"
                    >
                      ← Return to Active Incidents
                    </Button>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
                  <div style={{ padding: 14, borderRadius: 12, border: `1px solid ${THEME.subtleBorder}`, background: "#FFFFFF" }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: "#0F766E", textTransform: "uppercase", letterSpacing: 0.4 }}>
                      Resolution evidence
                    </div>
                    <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                      <div>
                        <Label>Resolution source (required)</Label>
                        <input
                          value={resolutionSource}
                          onChange={(event) => {
                            setResolutionSource(event.target.value);
                            if (closureError) setClosureError("");
                          }}
                          placeholder="#engineering Slack channel, Slack DM — Maya Chan, Jira ENG-284…"
                          disabled={closingIncident || savingResolutionRecord || Boolean(selectedIncident?.resolution_communicated_at)}
                          style={InputBaseStyle(closingIncident || savingResolutionRecord || Boolean(selectedIncident?.resolution_communicated_at))}
                        />
                      </div>
                      <div>
                        <Label>Original resolution note/message (required)</Label>
                        <textarea
                          value={originalResolutionNote}
                          onChange={(event) => {
                            setOriginalResolutionNote(event.target.value);
                            if (closureError) setClosureError("");
                          }}
                          placeholder="Paste the original message from Engineering or the team that completed the fix."
                          rows={4}
                          disabled={closingIncident || savingResolutionRecord || Boolean(selectedIncident?.resolution_communicated_at)}
                          style={{ ...InputBaseStyle(closingIncident || savingResolutionRecord || Boolean(selectedIncident?.resolution_communicated_at)), resize: "vertical" }}
                        />
                        <div style={{ marginTop: 6, fontSize: 12, color: THEME.subtleText }}>
                          Preserve the original response as evidence. Operations translates it into the summary below.
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <Label>Resolution summary (required)</Label>
                    <textarea
                      value={closureNotes}
                      onChange={(event) => {
                        setClosureNotes(event.target.value);
                        if (closureError) setClosureError("");
                      }}
                      placeholder="Summarise what was done to resolve the incident and the confirmed outcome in clear operational language."
                      rows={4}
                      disabled={closingIncident || savingResolutionRecord || Boolean(selectedIncident?.resolution_communicated_at)}
                      style={{ ...InputBaseStyle(closingIncident || savingResolutionRecord || Boolean(selectedIncident?.resolution_communicated_at)), resize: "vertical" }}
                    />
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    {resolutionRecordSuccess ? (
                      <div style={{ fontSize: 12, fontWeight: 800, color: "#166534" }}>✓ {resolutionRecordSuccess}</div>
                    ) : null}
                    <Button
                      onClick={saveResolutionRecord}
                      disabled={savingResolutionRecord || closingIncident || Boolean(selectedIncident?.resolution_communicated_at) || !resolutionSource.trim() || !originalResolutionNote.trim() || !closureNotes.trim()}
                    >
                      {savingResolutionRecord ? "Saving…" : "Save resolution record"}
                    </Button>
                  </div>

                  <div style={{ padding: 14, borderRadius: 12, border: `1px solid ${THEME.subtleBorder}`, background: "#FFFFFF" }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: "#0F766E", textTransform: "uppercase", letterSpacing: 0.4 }}>
                      Resolution notification
                    </div>
                    <div style={{ marginTop: 8, fontSize: 12, color: THEME.subtleText }}>
                      Recipients are carried forward from the original reporter and stakeholders already coordinated during the incident.
                    </div>
                    <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {resolutionRecipients.length ? resolutionRecipients.map((recipient) => <Pill key={recipient}>{recipient}</Pill>) : <span style={{ fontSize: 12, color: THEME.subtleText }}>No recorded recipients found.</span>}
                    </div>

                    <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
                      <Button
                        onClick={generateResolutionCommunication}
                        disabled={generatingResolutionMessage || closingIncident || Boolean(selectedIncident?.resolution_communicated_at) || !resolutionSource.trim() || !originalResolutionNote.trim() || !closureNotes.trim()}
                      >
                        {generatingResolutionMessage ? "Generating…" : "Generate resolution message"}
                      </Button>
                    </div>

                    <div style={{ marginTop: 10 }}>
                      <Label>Resolution message (AI-assisted, human approval required)</Label>
                      <textarea
                        value={resolutionMessage}
                        onChange={(event) => setResolutionMessage(event.target.value)}
                        placeholder="Generate a suggested message, then review and edit it before communicating."
                        rows={5}
                        disabled={closingIncident || Boolean(selectedIncident?.resolution_communicated_at)}
                        style={{ ...InputBaseStyle(closingIncident || Boolean(selectedIncident?.resolution_communicated_at)), resize: "vertical" }}
                      />
                    </div>

                    {resolutionMessageError ? (
                      <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: THEME.dangerBg, border: `1px solid ${THEME.dangerBorder}`, color: THEME.dangerText, fontSize: 12 }}>
                        {resolutionMessageError}
                      </div>
                    ) : null}

                    {selectedIncident?.resolution_communicated_at ? (
                      <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: "#DCFCE7", border: "1px solid #86EFAC", color: "#166534", fontSize: 12, fontWeight: 800 }}>
                        ✓ Marked as communicated by {selectedIncident.resolution_communicated_by || "Operations Manager"} · {formatDateTime(selectedIncident.resolution_communicated_at)}. Message locked as the communication record.
                      </div>
                    ) : (
                      <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
                        <Button
                          onClick={markResolutionAsCommunicated}
                          disabled={markingCommunicated || !resolutionMessage.trim() || !resolutionRecipients.length}
                          variant="primary"
                        >
                          {markingCommunicated ? "Recording…" : "Mark as communicated"}
                        </Button>
                      </div>
                    )}
                  </div>

                  {!selectedIncident?.owner_team ? (
                    <div style={{ padding: 10, borderRadius: 10, background: "#FFFBEB", border: "1px solid #FCD34D", color: "#92400E", fontSize: 12, fontWeight: 700 }}>
                      Assign an incident owner in Operational Coordination before closing the incident.
                    </div>
                  ) : null}

                  {closureError ? (
                    <div style={{ padding: 10, borderRadius: 10, background: THEME.dangerBg, border: `1px solid ${THEME.dangerBorder}`, color: THEME.dangerText, fontSize: 12 }}>
                      {closureError}
                    </div>
                  ) : null}

                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center" }}>
                    <div style={{ fontSize: 12, color: THEME.subtleText, lineHeight: 1.5 }}>
                      The resolution becomes part of the permanent operational record, is added to Activity History, and moves the incident from Active Incidents to Resolved Incidents.
                    </div>
                    <Button
                      onClick={closeOperationalLifecycle}
                      disabled={closingIncident || !selectedIncident?.owner_team || !selectedIncident?.resolution_communicated_at || !closureNotes.trim()}
                      variant="primary"
                    >
                      {closingIncident ? "Resolving Incident…" : "✓ Resolve Incident"}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: workspaceSection === "activity" ? "block" : "none" }}>
              <Card
                title="Activity History"
                right={
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <Pill>{timeline.length} events</Pill>
                    <SmallActionButton onClick={() => selectedId && loadTimeline(selectedId)} disabled={timelineLoading}>
                      {timelineLoading ? "Refreshing…" : "Refresh Activity"}
                    </SmallActionButton>
                  </div>
                }
              >
                <div style={{ fontSize: 12, color: THEME.subtleText, marginBottom: 10, lineHeight: 1.5 }}>
                  Full operational trace for this incident, including status and priority changes, ownership decisions, stakeholder communications and notes.
                </div>

                {timelineLoading ? (
                  <div style={{ padding: 14, color: THEME.subtleText }}>Loading activity…</div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {(timeline || []).slice(0, 100).map((event) => {
                      const allocation = parseTimelineAllocation(event);
                      let evidence = null;
                      if (event.event_type === "evidence_added" && event.new_value) {
                        try { evidence = JSON.parse(event.new_value); } catch { evidence = null; }
                      }
                      let resolutionWork = null;
                      if (event.event_type === "resolution_started" && event.new_value) {
                        try { resolutionWork = JSON.parse(event.new_value); } catch { resolutionWork = null; }
                      }
                      let aiActivityText = null;
                      if (event.event_type === "ai_assessment_generated") {
                        try {
                          const meta = JSON.parse(event.new_value || "{}");
                          const model = meta.model ? String(meta.model).replace(/^gpt-/, "GPT-") : "AI";
                          const tokens = meta.usage?.total_tokens;
                          aiActivityText = `${meta.source || "OpenAI"} ${model}${tokens ? ` · ${Number(tokens).toLocaleString()} tokens` : ""}`;
                        } catch {
                          aiActivityText = "AI operational assessment generated";
                        }
                      }
                      return (
                        <div
                          key={event.id}
                          style={{
                            padding: 12,
                            borderRadius: 12,
                            border: `1px solid ${THEME.subtleBorder}`,
                            background: "#F8FAFC",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                            <div style={{ fontWeight: 900, fontSize: 13 }}>{formatTimelineEvent(event.event_type)}</div>
                            <div style={{ fontSize: 12, color: THEME.subtleText }}>{formatDateTime(event.created_at)}</div>
                          </div>

                          {allocation ? (
                            <div style={{ marginTop: 8, display: "grid", gap: 4, fontSize: 12, color: THEME.text }}>
                              <div>
                                Owner: <b>{allocation.owner_team}</b>{allocation.owner_name ? ` — ${allocation.owner_name}` : ""}
                              </div>
                              <div>Allocated by: <b>{allocation.allocated_by}</b></div>
                              <div>{allocation.decision}</div>
                              <div style={{ color: THEME.subtleText }}>{allocation.reason}</div>
                            </div>
                          ) : null}

                          {evidence ? (
                            <div style={{ marginTop: 7, fontSize: 12, color: THEME.text, lineHeight: 1.5 }}>
                              <div><b>{evidence.category}</b> · added by {evidence.added_by}</div>
                              <div style={{ marginTop: 3 }}>{evidence.information}</div>
                            </div>
                          ) : null}

                          {resolutionWork ? (
                            <div style={{ marginTop: 7, fontSize: 12, color: THEME.text, lineHeight: 1.5 }}>
                              <div><b>{resolutionWork.owner}</b> · recorded by {resolutionWork.recorded_by}</div>
                              <div style={{ marginTop: 3 }}>{resolutionWork.action}</div>
                            </div>
                          ) : null}

                          {aiActivityText ? (
                            <div style={{ marginTop: 6, fontSize: 12, color: THEME.subtleText }}>{aiActivityText}</div>
                          ) : null}

                          {!allocation && !evidence && !resolutionWork && !aiActivityText && (event.old_value || event.new_value) ? (
                            <div style={{ marginTop: 6, fontSize: 12, color: THEME.subtleText }}>
                              {event.old_value ? <span>from <b style={{ color: THEME.text }}>{event.old_value}</b> </span> : null}
                              {event.new_value ? <span>to <b style={{ color: THEME.text }}>{event.new_value}</b></span> : null}
                            </div>
                          ) : null}

                          {event.note || event.message ? (
                            <div style={{ marginTop: 7, fontSize: 12, color: THEME.text, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                              {event.note || event.message}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}

                    {!timeline.length ? (
                      <div style={{ padding: 18, borderRadius: 12, border: "1px dashed #CBD5E1", background: "#F8FAFC", color: THEME.subtleText, textAlign: "center" }}>
                        No activity has been recorded yet.
                      </div>
                    ) : null}
                  </div>
                )}
              </Card>
            </div>
          </>
        ) : (
          <Card title="Incident Workspace">
            <div
              style={{
                padding: 22,
                borderRadius: 14,
                border: "1px dashed #CBD5E1",
                background: "#F8FAFC",
                color: THEME.subtleText,
                textAlign: "center",
              }}
            >
              No incident is selected. Return to Active Incidents and choose an incident to investigate.
              <div style={{ marginTop: 14 }}>
                <Button onClick={() => setCurrentView("dashboard")} variant="primary">
                  ← Active Incidents
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
