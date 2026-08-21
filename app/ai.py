"""
Ops Triage Hub
AI Operations Assistant

Responsible for:

- Loading the OpenAI client
- Building operational context
- Calling GPT-5.5
- Returning structured JSON

This module intentionally contains no FastAPI routes.
"""

import json
import os
import time

from dotenv import load_dotenv
from openai import OpenAI

from app.prompts import AI_SYSTEM_PROMPT, AI_RESPONSE_SCHEMA
from app.initial_triage_prompt import INITIAL_TRIAGE_SYSTEM_PROMPT, INITIAL_TRIAGE_RESPONSE_SCHEMA

load_dotenv()

client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY")
)


def build_ai_context(incident: dict, timeline: list) -> str:
    """
    Converts an incident and timeline into structured text for GPT.
    """

    timeline_text = ""

    for event in timeline:
        timeline_text += (
            f"- {event.get('event_type', 'Unknown')} | "
            f"{event.get('created_at', '')}\n"
        )

        if event.get("message"):
            timeline_text += f"  Message: {event['message']}\n"

        if event.get("note"):
            timeline_text += f"  Note: {event['note']}\n"

        if event.get("old_value") is not None:
            timeline_text += f"  Previous: {event['old_value']}\n"

        if event.get("new_value") is not None:
            timeline_text += f"  Current: {event['new_value']}\n"

    return f"""
INCIDENT

Title:
{incident.get("title")}

Description:
{incident.get("description")}

Priority:
{incident.get("priority")}

Status:
{incident.get("status")}

Created:
{incident.get("created_at")}

Timeline

{timeline_text}
"""


def generate_ai_summary(incident: dict, timeline: list) -> dict:
    """
    Generate an operational assessment using GPT-5.5.

    Returns the structured summary together with model/source metadata and
    provider token usage when OpenAI returns it.
    """
    from datetime import datetime, timezone

    context = build_ai_context(incident, timeline)

    response = None
    last_error = None

    for attempt in range(3):
        try:
            response = client.responses.create(
                model="gpt-5.5",
                input=[
                    {
                        "role": "system",
                        "content": [{"type": "input_text", "text": AI_SYSTEM_PROMPT}],
                    },
                    {
                        "role": "system",
                        "content": [{"type": "input_text", "text": AI_RESPONSE_SCHEMA}],
                    },
                    {
                        "role": "user",
                        "content": [{"type": "input_text", "text": context}],
                    },
                ],
            )
            break
        except Exception as exc:
            last_error = exc
            status_code = getattr(exc, "status_code", None)
            class_name = exc.__class__.__name__.lower()
            retryable = (
                (isinstance(status_code, int) and status_code >= 500)
                or "timeout" in class_name
                or "connection" in class_name
                or "internalserver" in class_name
            )

            if not retryable or attempt == 2:
                raise

            time.sleep(0.75 * (2 ** attempt))

    if response is None:
        raise RuntimeError(f"AI request failed: {last_error}")

    text = response.output_text.strip()
    summary = json.loads(text)

    usage_obj = getattr(response, "usage", None)
    usage = None
    if usage_obj is not None:
        input_tokens = getattr(usage_obj, "input_tokens", None)
        output_tokens = getattr(usage_obj, "output_tokens", None)
        total_tokens = getattr(usage_obj, "total_tokens", None)
        usage = {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": total_tokens,
        }

    return {
        "success": True,
        "source": "OpenAI",
        "model": getattr(response, "model", None) or "gpt-5.5",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "usage": usage,
        "summary": summary,
    }



def build_initial_triage_context(incident: dict) -> str:
    """Build the small evidence-only context used during incident intake."""
    return f"""
INCIDENT REPORT

Title:
{incident.get('title', '')}

Description:
{incident.get('description', '')}

Reporter:
{incident.get('reporter_name', '')}

Reporter role:
{incident.get('reporter_role', '')}

Reporter department:
{incident.get('reporter_department', '')}

Reporter contact:
{incident.get('reporter_contact', '')}

Source:
{incident.get('report_source', '')}

Source reference:
{incident.get('source_reference', '')}

Original report or message:
{incident.get('original_report', '')}

Business area:
{incident.get('business_area', '')}

Reporter-assessed urgency:
{incident.get('reporter_attention', '')}
"""


def generate_initial_triage(incident: dict) -> dict:
    """Generate a concise, structured intake assessment separate from the full AI assessment."""
    from datetime import datetime, timezone

    response = client.responses.create(
        model="gpt-5.5",
        input=[
            {"role": "system", "content": [{"type": "input_text", "text": INITIAL_TRIAGE_SYSTEM_PROMPT}]},
            {"role": "system", "content": [{"type": "input_text", "text": INITIAL_TRIAGE_RESPONSE_SCHEMA}]},
            {"role": "user", "content": [{"type": "input_text", "text": build_initial_triage_context(incident)}]},
        ],
    )

    summary = json.loads(response.output_text.strip())
    suggested = str(summary.get("suggested_priority", "P2")).upper()
    if suggested not in {"P0", "P1", "P2", "P3"}:
        suggested = "P2"
    summary["suggested_priority"] = suggested
    missing = summary.get("missing_information")
    summary["missing_information"] = missing[:3] if isinstance(missing, list) else []

    usage_obj = getattr(response, "usage", None)
    usage = None
    if usage_obj is not None:
        usage = {
            "input_tokens": getattr(usage_obj, "input_tokens", None),
            "output_tokens": getattr(usage_obj, "output_tokens", None),
            "total_tokens": getattr(usage_obj, "total_tokens", None),
        }

    return {
        "success": True,
        "source": "OpenAI",
        "model": getattr(response, "model", None) or "gpt-5.5",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "usage": usage,
        "summary": summary,
    }



def generate_resolution_message(incident: dict, recipients: list) -> dict:
    """Draft one concise resolution communication. Human review remains mandatory."""
    from datetime import datetime, timezone

    context = f"""
INCIDENT TITLE:
{incident.get('title', '')}

INCIDENT DESCRIPTION:
{incident.get('description', '')}

RESOLUTION SOURCE:
{incident.get('resolution_source', '')}

ORIGINAL RESOLUTION NOTE / EVIDENCE:
{incident.get('original_resolution_note', '')}

OPERATIONS RESOLUTION SUMMARY:
{incident.get('resolution_notes', '')}

RECIPIENTS:
{', '.join(recipients)}
"""
    system_prompt = """You are the Ops Triage Hub resolution communication assistant.
Draft one short, clear operational resolution message for the listed reporter and stakeholders.
Use only the supplied incident and resolution facts. Do not invent technical details, causes, impact,
customer counts, actions, or assurances. Write in plain professional language suitable for Slack or email.
State that the incident is resolved only because Operations is preparing the final closure communication.
Return only the message text, with no heading, commentary, markdown label, or quotation marks.
Human Operations approval and editing are required before the message is communicated."""

    response = client.responses.create(
        model="gpt-5.5",
        input=[
            {"role": "system", "content": [{"type": "input_text", "text": system_prompt}]},
            {"role": "user", "content": [{"type": "input_text", "text": context}]},
        ],
    )
    usage_obj = getattr(response, "usage", None)
    usage = None
    if usage_obj is not None:
        usage = {
            "input_tokens": getattr(usage_obj, "input_tokens", None),
            "output_tokens": getattr(usage_obj, "output_tokens", None),
            "total_tokens": getattr(usage_obj, "total_tokens", None),
        }
    return {
        "success": True,
        "message": response.output_text.strip(),
        "source": "OpenAI",
        "model": getattr(response, "model", None) or "gpt-5.5",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "usage": usage,
    }
