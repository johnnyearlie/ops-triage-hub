import React, { useMemo, useState } from "react";

const ROLES = [
  "Customer Support Advisor",
  "Sales Executive",
  "Account Manager",
  "Software Engineer",
  "Product Manager",
  "Finance Analyst",
  "Marketing Executive",
  "Operations",
  "Other",
];

const DEPARTMENTS = [
  "Customer Support",
  "Sales",
  "Engineering",
  "Product",
  "Marketing",
  "Finance",
  "Operations",
  "HR",
  "Other",
];

const BUSINESS_AREAS = [
  "Payments",
  "Customer Portal",
  "CRM",
  "Authentication",
  "Website",
  "Retail",
  "Infrastructure",
  "Internal Systems",
  "Other",
];

const THEME = {
  pageBg: "#F5F8FC",
  cardBg: "#FFFFFF",
  cardBorder: "#D8E3EC",
  subtleBorder: "#E4EBF2",
  text: "#1F2937",
  heading: "#0F172A",
  subtleText: "#64748B",
  inputBorder: "#CBD5E1",
  primaryBg: "#2563EB",
  primaryBgHover: "#1D4ED8",
  successBg: "#ECFDF5",
  successBorder: "#A7F3D0",
  successText: "#065F46",
  warningBg: "#FFFBEB",
  warningBorder: "#FCD34D",
  warningText: "#92400E",
  dangerBg: "#FEF2F2",
  dangerBorder: "#FCA5A5",
  dangerText: "#B91C1C",
  shadow: "0 12px 32px rgba(15,23,42,0.08)",
};

function FieldLabel({ children, required = false }) {
  return (
    <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 750, color: THEME.heading }}>
      {children}{required ? <span style={{ color: "#DC2626" }}> *</span> : null}
    </label>
  );
}

function inputStyle() {
  return {
    width: "100%",
    boxSizing: "border-box",
    padding: "11px 12px",
    borderRadius: 10,
    border: `1px solid ${THEME.inputBorder}`,
    background: "#FFFFFF",
    color: THEME.text,
    fontSize: 14,
    outline: "none",
  };
}

function BrandHeader({ onOpenDashboard }) {
  return (
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, paddingBottom: 22, borderBottom: `1px solid ${THEME.subtleBorder}` }}>
      <div>
        <div style={{ fontSize: 26, lineHeight: 1.1, fontWeight: 900, color: THEME.heading, letterSpacing: "-0.02em" }}>
          Ops Triage Hub
        </div>
        <div style={{ marginTop: 5, fontSize: 13, fontWeight: 800, color: "#2563EB", letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Operational Decision Support
        </div>
        <div style={{ marginTop: 7, maxWidth: 560, fontSize: 14, lineHeight: 1.55, color: THEME.subtleText }}>
          Helping Operations teams make better decisions when it matters most.
        </div>
      </div>

      <button
        type="button"
        onClick={onOpenDashboard}
        style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #2563EB", background: "#FFFFFF", color: "#2563EB", fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" }}
      >
        Operations Dashboard
      </button>
    </header>
  );
}

export default function ReportOperationalIssue({ onOpenDashboard }) {
  const [reporterName, setReporterName] = useState("");
  const [role, setRole] = useState(ROLES[0]);
  const [department, setDepartment] = useState(DEPARTMENTS[0]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [businessArea, setBusinessArea] = useState(BUSINESS_AREAS[0]);
  const [attention, setAttention] = useState("standard");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(null);

  const valid = useMemo(
    () =>
      reporterName.trim().length >= 2 &&
      title.trim().length >= 3 &&
      description.trim().length >= 10 &&
      Boolean(role) &&
      Boolean(department) &&
      Boolean(businessArea),
    [reporterName, title, description, role, department, businessArea]
  );

  async function submitIssue(event) {
    event.preventDefault();
    if (!valid || submitting) return;

    setSubmitting(true);
    setError("");

    try {
      const reportingContext = [
        `Reported by: ${reporterName.trim()}`,
        `Role: ${role}`,
        `Department: ${department}`,
        `Business area: ${businessArea}`,
        `Immediate attention requested: ${attention === "critical" ? "Critical" : "Standard"}`,
        "",
        description.trim(),
      ].join("\n");

      const response = await fetch("/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: reportingContext,
          priority: attention === "critical" ? "P1" : "P2",
        }),
      });

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }

      if (!response.ok) {
        const message =
          data && typeof data === "object" && data.detail
            ? typeof data.detail === "string"
              ? data.detail
              : JSON.stringify(data.detail)
            : typeof data === "string"
              ? data
              : "Unable to report the operational issue.";
        throw new Error(message);
      }

      setSubmitted({
        id: data?.id || "",
        title: title.trim(),
        reporterName: reporterName.trim(),
      });
    } catch (submitError) {
      setError(submitError.message || "Unable to report the operational issue.");
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setReporterName("");
    setRole(ROLES[0]);
    setDepartment(DEPARTMENTS[0]);
    setTitle("");
    setDescription("");
    setBusinessArea(BUSINESS_AREAS[0]);
    setAttention("standard");
    setError("");
    setSubmitted(null);
  }

  return (
    <div style={{ minHeight: "100vh", padding: "28px 18px 44px", background: THEME.pageBg, color: THEME.text }}>
      <div style={{ maxWidth: 920, margin: "0 auto" }}>
        <BrandHeader onOpenDashboard={onOpenDashboard} />

        <main style={{ marginTop: 28 }}>
          {submitted ? (
            <section style={{ padding: 28, borderRadius: 18, border: `1px solid ${THEME.successBorder}`, background: THEME.successBg, boxShadow: THEME.shadow }}>
              <div style={{ width: 42, height: 42, borderRadius: "50%", display: "grid", placeItems: "center", background: "#D1FAE5", color: THEME.successText, fontSize: 22, fontWeight: 900 }}>
                ✓
              </div>

              <h1 style={{ margin: "18px 0 0", fontSize: 26, color: THEME.heading }}>Operational issue reported</h1>

              <p style={{ margin: "10px 0 0", lineHeight: 1.65, color: THEME.successText }}>
                <strong>{submitted.title}</strong> has been submitted to Operations by <strong>{submitted.reporterName}</strong>.
              </p>

              <div style={{ marginTop: 18, padding: 16, borderRadius: 12, border: `1px solid ${THEME.successBorder}`, background: "#FFFFFF", display: "grid", gap: 7 }}>
                <div style={{ fontSize: 12, color: THEME.subtleText }}>Status</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: THEME.heading }}>Open</div>
                <div style={{ fontSize: 13, color: THEME.subtleText }}>The issue is awaiting Operations review.</div>
                {submitted.id ? <div style={{ marginTop: 5, fontSize: 12, color: THEME.subtleText }}>Reference: {submitted.id}</div> : null}
              </div>

              <div style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button type="button" onClick={onOpenDashboard} style={{ padding: "11px 16px", borderRadius: 10, border: "2px solid #2563EB", background: THEME.primaryBg, color: "#FFFFFF", fontWeight: 850, cursor: "pointer" }}>
                  Open Operations Dashboard
                </button>

                <button type="button" onClick={resetForm} style={{ padding: "11px 16px", borderRadius: 10, border: "1px solid #2563EB", background: "#FFFFFF", color: "#2563EB", fontWeight: 800, cursor: "pointer" }}>
                  Report another issue
                </button>
              </div>
            </section>
          ) : (
            <>
              <section style={{ marginBottom: 22 }}>
                <div style={{ display: "inline-flex", padding: "5px 9px", borderRadius: 999, border: "1px solid #BFDBFE", background: "#EFF6FF", color: "#1D4ED8", fontSize: 12, fontWeight: 800 }}>
                  Internal reporting portal
                </div>

                <h1 style={{ margin: "14px 0 0", fontSize: 30, lineHeight: 1.15, color: THEME.heading, letterSpacing: "-0.02em" }}>
                  Report Operational Issue
                </h1>

                <p style={{ margin: "10px 0 0", maxWidth: 720, lineHeight: 1.65, color: THEME.subtleText }}>
                  Provide a clear account of what has happened. Operations will review the submission,
                  assess operational priority and coordinate the appropriate response.
                </p>
              </section>

              <form onSubmit={submitIssue}>
                <div style={{ border: `1px solid ${THEME.cardBorder}`, borderRadius: 18, background: THEME.cardBg, boxShadow: THEME.shadow, overflow: "hidden" }}>
                  <section style={{ padding: 22 }}>
                    <h2 style={{ margin: 0, fontSize: 18, color: THEME.heading }}>Reporter Information</h2>

                    <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr", gap: 14 }}>
                      <div>
                        <FieldLabel required>Full Name</FieldLabel>
                        <input value={reporterName} onChange={(event) => setReporterName(event.target.value)} placeholder="e.g. Sarah Jones" style={inputStyle()} />
                      </div>

                      <div>
                        <FieldLabel required>Role</FieldLabel>
                        <select value={role} onChange={(event) => setRole(event.target.value)} style={inputStyle()}>
                          {ROLES.map((item) => <option key={item} value={item}>{item}</option>)}
                        </select>
                      </div>

                      <div>
                        <FieldLabel required>Department</FieldLabel>
                        <select value={department} onChange={(event) => setDepartment(event.target.value)} style={inputStyle()}>
                          {DEPARTMENTS.map((item) => <option key={item} value={item}>{item}</option>)}
                        </select>
                      </div>
                    </div>
                  </section>

                  <section style={{ padding: 22, borderTop: `1px solid ${THEME.subtleBorder}` }}>
                    <h2 style={{ margin: 0, fontSize: 18, color: THEME.heading }}>Operational Issue</h2>

                    <div style={{ marginTop: 16, display: "grid", gap: 14 }}>
                      <div>
                        <FieldLabel required>Issue Title</FieldLabel>
                        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Retail payment card readers offline across 124 stores" style={inputStyle()} />
                      </div>

                      <div>
                        <FieldLabel required>Description</FieldLabel>
                        <textarea
                          value={description}
                          onChange={(event) => setDescription(event.target.value)}
                          placeholder="Describe what happened, when it started, who is affected and any known workarounds."
                          rows={6}
                          style={{ ...inputStyle(), resize: "vertical", lineHeight: 1.5 }}
                        />
                        <div style={{ marginTop: 7, fontSize: 12, color: THEME.subtleText }}>
                          Include what happened, when it started, which customers or teams are affected and whether any workaround is available.
                        </div>
                      </div>

                      <div style={{ maxWidth: 360 }}>
                        <FieldLabel required>Business Area</FieldLabel>
                        <select value={businessArea} onChange={(event) => setBusinessArea(event.target.value)} style={inputStyle()}>
                          {BUSINESS_AREAS.map((item) => <option key={item} value={item}>{item}</option>)}
                        </select>
                      </div>
                    </div>
                  </section>

                  <section style={{ padding: 22, borderTop: `1px solid ${THEME.subtleBorder}` }}>
                    <h2 style={{ margin: 0, fontSize: 18, color: THEME.heading }}>Immediate Operations Attention</h2>

                    <p style={{ margin: "8px 0 0", fontSize: 13, color: THEME.subtleText }}>
                      Does this require immediate Operations attention?
                    </p>

                    <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      {[
                        { value: "standard", title: "Standard", description: "Operations will review and prioritise the issue." },
                        { value: "critical", title: "Critical", description: "Immediate review may be required." },
                      ].map((option) => {
                        const selected = attention === option.value;
                        return (
                          <label key={option.value} style={{ display: "grid", gridTemplateColumns: "22px 1fr", gap: 10, padding: 14, borderRadius: 12, border: selected ? "2px solid #2563EB" : `1px solid ${THEME.inputBorder}`, background: selected ? "#EFF6FF" : "#FFFFFF", cursor: "pointer" }}>
                            <input type="radio" name="attention" value={option.value} checked={selected} onChange={() => setAttention(option.value)} style={{ marginTop: 3 }} />
                            <span>
                              <span style={{ display: "block", fontWeight: 850, color: THEME.heading }}>{option.title}</span>
                              <span style={{ display: "block", marginTop: 4, fontSize: 12, lineHeight: 1.45, color: THEME.subtleText }}>{option.description}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>

                    {attention === "critical" ? (
                      <div style={{ marginTop: 14, padding: 14, borderRadius: 12, border: `1px solid ${THEME.warningBorder}`, background: THEME.warningBg, color: THEME.warningText, fontSize: 13, lineHeight: 1.6 }}>
                        <strong>Critical incidents should only be reported when there is evidence of severe customer, revenue or operational impact.</strong>{" "}
                        If unsure, select Standard and Operations will review the incident.
                      </div>
                    ) : null}
                  </section>

                  <section style={{ padding: 22, borderTop: `1px solid ${THEME.subtleBorder}`, background: "#F8FAFC" }}>
                    {error ? (
                      <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, border: `1px solid ${THEME.dangerBorder}`, background: THEME.dangerBg, color: THEME.dangerText, fontSize: 13 }}>
                        {error}
                      </div>
                    ) : null}

                    <button
                      type="submit"
                      disabled={!valid || submitting}
                      style={{ width: "100%", padding: "12px 16px", borderRadius: 10, border: !valid || submitting ? "1px solid #D9E2EC" : "2px solid #2563EB", background: !valid || submitting ? "#E9EEF5" : THEME.primaryBg, color: !valid || submitting ? "#94A3B8" : "#FFFFFF", fontWeight: 900, cursor: !valid || submitting ? "not-allowed" : "pointer" }}
                      onMouseEnter={(event) => { if (valid && !submitting) event.currentTarget.style.background = THEME.primaryBgHover; }}
                      onMouseLeave={(event) => { if (valid && !submitting) event.currentTarget.style.background = THEME.primaryBg; }}
                    >
                      {submitting ? "Reporting issue…" : "Report Operational Issue"}
                    </button>

                    {!valid ? (
                      <div style={{ marginTop: 9, textAlign: "center", fontSize: 12, color: THEME.subtleText }}>
                        Complete all required fields to submit the issue.
                      </div>
                    ) : null}
                  </section>
                </div>
              </form>

              <aside style={{ marginTop: 18, padding: 15, borderRadius: 12, border: `1px solid ${THEME.subtleBorder}`, background: "#FFFFFF", color: THEME.subtleText, fontSize: 12, lineHeight: 1.6 }}>
                <strong style={{ color: THEME.heading }}>Demo notice:</strong> In a production environment,
                incident reporting could be initiated from multiple sources including an internal portal,
                Slack integration, Microsoft Teams, monitoring systems or a lightweight desktop widget.
                For demonstration purposes, the workflow begins in this simplified internal reporting portal.
              </aside>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
