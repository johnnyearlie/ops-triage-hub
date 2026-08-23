# Ops Triage Hub

**Operational Decision Support for growing teams**

Ops Triage Hub is a working V1 portfolio prototype that turns operational incidents into a structured, accountable workflow — from the first report through investigation, coordination and resolution.

It combines structured operational workflows with AI-assisted decision support while keeping operational judgement and control with the human operator.

## 🎥 Product Walkthrough

**Watch the complete Ops Triage Hub V1 walkthrough:**

https://youtu.be/cCa3qeFOU7c

The walkthrough follows a realistic incident from initial reporting through AI-assisted triage, investigation, reassessment, ownership, stakeholder coordination and final resolution.

**Portfolio:** https://www.johnnyearlie.com  
**Source:** https://github.com/johnnyearlie/ops-triage-hub

---

## What Ops Triage Hub Does

Operational incidents often arrive through fragmented channels, leaving Operations to reconstruct context, determine priority, coordinate ownership, keep stakeholders informed and maintain a reliable record of what happened.

Ops Triage Hub brings that work into one incident lifecycle:

**Report → Initial AI Triage → Investigation → AI Operational Assessment → New Evidence & Reassessment → Ownership → Stakeholder Coordination → Resolution**

Activity History retains the evidence, decisions and actions generated throughout that lifecycle.

The aim is not to automate the Operations Manager out of the process. AI provides structured recommendations and analysis; the human operator reviews the evidence and remains responsible for operational decisions.

---

## Core V1 Workflow

### 1. Report an Operational Issue

The reporter records the original issue, source, urgency and supporting context.

The original report becomes part of the incident record and remains available as the investigation develops.

### 2. Initial AI Triage

AI analyses the reported evidence and provides:

- Suggested priority
- Operational rationale
- Business impact
- Recommended next steps

The recommendation is decision support. Operations confirms the priority and decides whether the incident moves into investigation.

### 3. Investigation

Once confirmed, the incident moves into active investigation.

Operations can add new evidence without replacing the information already recorded, allowing the incident record to develop as the team learns more.

### 4. AI Operational Assessment

A deeper assessment structures the available evidence into:

- Executive Summary
- Business impact
- Recommended actions
- Operational risks
- Assumptions
- Missing information
- Assessment reliability

The assessment explicitly separates established information from uncertainty rather than presenting every inference as fact.

### 5. Evidence & Reassessment

As new evidence becomes available, Operations can regenerate the assessment against the updated operational picture.

This allows recommendations and understanding to change as the facts change while retaining the history of how the incident developed.

### 6. Ownership

OTH can recommend the most appropriate team based on the incident evidence.

The recommendation remains optional. Operations reviews it before assigning a named owner and recording accountability.

### 7. Stakeholder Coordination

Ownership and communication are tracked separately.

Operations records which stakeholders require visibility, creating a structured record of who was coordinated and why.

### 8. Resolution

When the responsible team confirms the fix:

- Original resolution evidence is retained
- Operations records a plain-language Resolution Summary
- Previously coordinated stakeholders can be carried into resolution communication
- OTH prepares an editable AI-assisted closure message
- Operations reviews and approves what is communicated
- The incident can then be marked resolved

Resolved incidents are protected from further operational editing while remaining available for review.

### 9. Activity History

Activity History preserves the sequence of evidence, decisions and actions across the incident lifecycle, creating an operational audit trail that remains available after closure.

---

## AI as Decision Support

AI is intentionally positioned as a supporting capability rather than an autonomous decision-maker.

Across the V1 workflow it can assist with:

- Initial incident triage
- Operational assessment
- Identification of missing information and assumptions
- Reassessment as new evidence arrives
- Ownership recommendations
- Resolution communication

Recommendations remain reviewable and editable where appropriate.

The design principle is:

**AI supports the decision. Operations owns the decision.**

---

## Operational Dashboard

The dashboard provides a shared view of operational health and current work, including:

- Operational Health
- Morning Stand-Up Focus
- Needs Attention
- Revenue Forecast
- Active Incidents
- Resolved Incidents
- Incident status and priority
- Incident review and Activity History

The interface is intentionally designed as an operational control surface rather than a conventional ticketing-system clone.

---

## Tech Stack

### Application

- **React**
- **Vite**
- **JavaScript**
- **HTML / CSS**
- **Python**
- **FastAPI**
- **SQLite**
- **OpenAI API**

### Product & Demo

- **Figma**
- **DaVinci Resolve**

---

## Project Structure

```text
ops-triage-hub/
├── app/
│   ├── main.py
│   ├── ai.py
│   └── prompts.py
├── ui/
│   ├── src/
│   │   ├── App.jsx
│   │   └── components/
│   └── index.html
├── requirements.txt
├── ops_triage.db
└── README.md
```

---

## Running Locally

### Backend

From the repository root:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Backend:

```text
http://127.0.0.1:8000
```

Interactive API documentation:

```text
http://127.0.0.1:8000/docs
```

### Frontend

In a second terminal:

```bash
cd ui
npm install
npm run dev
```

Frontend:

```text
http://localhost:5173
```

The Vite development server proxies `/api/*` requests to the FastAPI backend.

---

## Design Principles

- Operations first, technology second
- Human accountability for operational decisions
- Preserve original evidence
- Add context rather than overwrite history
- Make uncertainty visible
- Reassess when the evidence changes
- Separate ownership from communication
- Maintain an auditable incident history
- Keep the interface calm and operationally focused

---

## V1 Scope & Limitations

Ops Triage Hub V1 is a portfolio prototype, not a production incident-management platform.

Current limitations include:

- No authentication or role-based access control
- Single-user/local demo environment
- SQLite persistence
- No external Slack, CRM or monitoring integrations
- No background job infrastructure
- No production deployment architecture

These constraints are intentional for the V1 prototype.

---

## Status

**V1 complete.**

The complete incident lifecycle is implemented and demonstrated in the product walkthrough.

The project is intended to demonstrate operational problem-solving, workflow design, human-centred AI decision support and the translation of those ideas into a working full-stack prototype.

---

## Author

**Johnny Earlie**  
Operations & Process Improvement  
Berlin, Germany

Portfolio: https://www.johnnyearlie.com

---

## License

Copyright
© 2026 Johnny Earlie. All rights reserved.
Ops Triage Hub is a portfolio project. The source code is publicly available for review and demonstration purposes.
