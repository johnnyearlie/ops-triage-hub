# Ops Triage Hub — Sprint 7 Commit 2.7 Review

**Date:** 10 August 2026  
**Status:** Scope review complete — ready to lock before implementation  
**Purpose:** Final functional refinement of V1 before demo polish and release.

## Product decision

V1 is now feature-complete enough to demonstrate the end-to-end operational lifecycle.

The goal of Commit 2.7 is **not** to redesign Ops Triage Hub or extend the architecture. It is to improve clarity, navigation, auditability, reporting credibility, and demo usability.

V2 can begin after V1 is released.

## Locked V1 workflow

**Report Operational Issue**  
→ **AI Initial Assessment / Operational Signals**  
→ **Operations Dashboard**  
→ **Incident Investigation**  
→ **AI Operational Assessment**  
→ **Operational Coordination**  
→ **Resolution & Close**  
→ **Resolved / Archived Incident History**

Core principle:
- Stakeholders report.
- AI highlights operational signals.
- Operations decides.
- AI analyses.
- Operations coordinates.
- Humans remain accountable.

# Commit 2.7 — Final Functional Refinement

## 1. Incident Workspace section navigation — MUST HAVE
Add persistent section navigation:

**Investigation | AI Assessment | Coordination | Resolution | Activity**

Purpose:
- Reduce excessive scrolling.
- Make visually similar areas easier to distinguish.
- Preserve the existing workflow order.
- Make the demo easier to follow without restructuring the AI report.

## 2. Lightweight AI initial assessment — MUST HAVE
Replace the current rule-based initial attention logic with a lightweight AI call after an issue is submitted.

The AI must:
- identify potential customer impact;
- identify potential revenue impact;
- identify payment/authentication/multi-site/service signals;
- return an initial attention signal.

The AI must **not**:
- assign P0–P3 operational priority;
- decide ownership;
- escalate an incident;
- replace Operations judgement.

Suggested UI label:

**AI Initial Assessment — Immediate Review / Review Soon / Standard Review**

Operational priority remains an Operations decision.

## 3. Operational Signal colour consistency — MUST HAVE
Correlate hazard/signal icon colour with the initial attention signal:
- **Immediate Review** → red
- **Review Soon** → amber
- **Standard Review** → green

Apply consistently on:
- Operations Dashboard expanded incident view;
- Incident Investigation screen.

## 4. Resolved incident review — MUST HAVE
Resolved incidents must remain reviewable.

A resolved incident should open in read-only mode and retain access to:
- report details;
- Activity History;
- AI Operational Assessment;
- AI recommended owner;
- actual assigned owner;
- stakeholder coordination record;
- resolution details.

## 5. Incident archive — MUST HAVE
Add an archive mechanism so the main Resolved Incidents list does not grow indefinitely.

Model:

**Active Incidents → Resolved Incidents → Archived Incidents**

Archived incidents remain searchable/viewable, are not deleted, and retain the full operational record and AI assessment.

## 6. Operational Health KPIs — MUST HAVE
Rename:

**Operational Health** → **Operational Health KPIs**

Add reporting-period controls:

**7 days | 30 days | 90 days**

Metrics should reflect the selected period where technically supported.

## 7. Human-readable MTTR — MUST HAVE
Avoid raw minute values such as:

**21456m**

Display long durations in a readable format, for example:

**14d 21h 36m**

A final demo-data sanity pass must ensure KPI values look operationally credible.

## 8. Morning Stand-up provenance — DEMO POLISH
Explain where the stand-up context could originate without claiming an integration that has not been built.

Suggested wording:

> Stand-up context can be ingested from existing collaboration and meeting-summary tools via API. Demo data shown here represents an imported morning operations summary.

Do not claim a live Notion, Slack, Teams, or other integration unless it exists.

## 9. AI token usage — DEMO POLISH
Add subtle AI usage metadata in the footer.

Example:

**AI usage · 1,842 tokens · Assessment generated 13:24**

Purpose:
- demonstrate responsible AI-cost awareness;
- provide transparency without distracting from operational work.

## 10. Incident Workspace pre-assessment balance — DEMO POLISH
Balance the initial heights/layout of:
- **Update Incident**
- **AI Operations Assistant**

before the AI report is generated.

After generation, the AI report may naturally become much longer.

## 11. Dashboard card balance — DEMO POLISH
Balance the heights/layout of:
- **Revenue Performance**
- **Operational Priorities**

Goal:
- improve visual hierarchy;
- reduce uneven whitespace;
- make the dashboard feel deliberate and finished.

## 12. Demo scenario integrity check — MUST HAVE BEFORE RECORDING
Run one reference incident through the entire lifecycle and verify that all data tells one consistent story.

Reference scenario:

**Retail payment card readers offline across 124 stores**

Check consistency across:
- reporter;
- role/department;
- business area;
- description;
- AI Initial Assessment;
- operational attention;
- operational priority;
- revenue impact;
- AI Operational Assessment;
- recommended owner;
- accepted/manual owner;
- stakeholder notifications;
- Activity History;
- resolution;
- MTTR;
- Operational Health KPIs;
- Resolved Incidents;
- archive.

Avoid contradictions such as the description saying Engineering is investigating while the recorded owner is Ops Lead unless that distinction is intentional and explained.

# Future enhancement — NOT V1

## Real-time cross-screen synchronisation
In a production implementation, the Operations Dashboard should update in real time when an incident is changed in another workspace or browser tab.

Possible future technologies:
- WebSockets;
- server-sent events;
- database realtime subscriptions.

For the V1 demo, returning to the dashboard and refreshing is acceptable.

# Explicitly out of scope for Commit 2.7
Do not:
- redesign the architecture;
- alter the core AI Operational Assessment prompt unless technically necessary;
- add new product modules;
- add real-time synchronisation;
- add live Slack/Teams/Notion integrations;
- expand beyond the end-to-end operational lifecycle already completed.

# V1 completion principle

**The demo is now more valuable than another six months of feature development.**

Commit 2.7 should finish the V1 experience, after which the project moves to:

1. Demo polish
2. Demo scenario validation
3. Video production
4. Portfolio release
5. V2 backlog
