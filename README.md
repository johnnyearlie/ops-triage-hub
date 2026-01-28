# Ops Triage Hub

**Ops Triage Hub** is a small end-to-end demo showcasing an operations-focused incident triage and management workflow.

It combines:
- A **FastAPI backend** (incident data, health scoring, KPIs, timelines)
- A **React (Vite) frontend** for visual triage, updates, and insights

This project is intentionally lightweight and opinionated. It is designed as:
- A personal demo
- A portfolio artefact
- A sandbox for ops + AI + UX experimentation

---

## ✨ What This Demo Shows
- Operational health scoring (Green / Amber / Red)
- Active vs resolved incident tracking
- Incident lifecycle management (open → investigating → mitigated → resolved)
- Timeline-based audit trail (status changes, notes, resolution context)
- Simple KPI reporting (MTTR, resolution counts, top resolvers)
- A clean, calm ops-focused UI (not a ticketing system clone)

Lightweight Intelligence (AI-Assisted)
This demo includes lightweight, explainable intelligence designed to support — not replace — operational decision-making.

Current capabilities include:
- AI-assisted incident triage (suggested priority, rationale, next steps)
- Ranked “What to do next” operational recommendations based on system health
- Deterministic, explainable logic suitable for high-trust ops environments

The emphasis is on calm decision support and transparency rather than automation or opaque “AI magic”.

This is **not** intended to be production-ready — it is a **conceptual ops demo**.

---

## 🧱 Tech Stack

### Backend
- Python 3
- FastAPI
- SQLite (local, file-based)
- Pydantic models

### Frontend
- React
- Vite
- Plain CSS (no UI framework)
- Fetch-based API calls

---

## 📂 Project Structure
ops-triage-hub/
├── app/                # FastAPI backend
│   └── main.py
├── ui/                 # React frontend (Vite)
│   ├── src/
│   │   └── App.jsx
│   └── index.html
├── requirements.txt
├── ops_triage.db       # Local SQLite DB (demo data)
└── README.md
---

## ▶️ Running the Demo Locally

### 1. Backend (FastAPI)

From the repo root:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload

Backend will run on:
http://127.0.0.1:8000

Interactive API docs:
http://127.0.0.1:8000/docs

2. Frontend (React UI)

In a second terminal:
cd ui
npm install
npm run dev

UI will run on:
http://localhost:5173
The Vite dev server proxies /api/* requests to the FastAPI backend

🧭 Demo Walkthrough Flow

Suggested order when demoing:
	1.	Operational Health
	•	View current health score (Green / Amber / Red)
	•	Read the generated summary
	2.	Active Incidents
	•	Select an incident from the active list
	•	Observe priority, status, and creation time
	3.	Update Incident
	•	Change status (e.g. investigating → mitigated → resolved)
	•	Add timeline notes
	•	Assign resolver + resolution notes when resolving
	•	Toggle the timeline view to see audit history
	4.	KPIs
	•	Adjust KPI window (7 / 30 / 90 days)
	•	Review MTTR and resolver stats
	5.	Create Incident
	•	Create a new incident
	•	Optionally run triage suggestions
	•	Watch it appear immediately in Active Incidents

⸻

🎯 Design Philosophy
	•	Calm, low-noise UI
	•	Ops-first mental model
	•	Timeline over comments
	•	Clear state transitions
	•	No unnecessary complexity

This is closer to an ops control surface than a ticketing tool.

⸻

🚧 Known Limitations
	•	No authentication
	•	Single-user demo
	•	SQLite only
	•	No background jobs
	•	No persistence guarantees

All intentional for v1.0.

⸻

📌 Status

v1.0 — Stable local demo

This version is considered complete for its current purpose.
Future work may include:
• Narrative explanations for health score changes
• Actor attribution per timeline event
• AI-generated incident and timeline summaries (LLM-assisted)

⸻

👤 Author

Built by Johnny Earlie
Berlin, Germany

⸻

📜 License

MIT — use freely for learning and experimentation.
