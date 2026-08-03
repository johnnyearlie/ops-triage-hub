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

from dotenv import load_dotenv
from openai import OpenAI

from app.prompts import AI_SYSTEM_PROMPT, AI_RESPONSE_SCHEMA

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

    Returns a dictionary matching AI_RESPONSE_SCHEMA.
    """

    context = build_ai_context(incident, timeline)

    try:

        response = client.responses.create(

            model="gpt-5.5",

            input=[

                {
                    "role": "system",
                    "content": [
                        {
                            "type": "input_text",
                            "text": AI_SYSTEM_PROMPT,
                        }
                    ],
                },

                {
                    "role": "system",
                    "content": [
                        {
                            "type": "input_text",
                            "text": AI_RESPONSE_SCHEMA,
                        }
                    ],
                },

                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": context,
                        }
                    ],
                },
            ],
        )

        text = response.output_text.strip()

        return json.loads(text)

    except Exception as exc:

        return {
            "executive_summary": "Unable to generate AI summary.",

            "business_impact": str(exc),

            "recommended_actions": [],

            "operational_risks": [
                "AI Assistant unavailable."
            ],

            "missing_information": [],

            "assumptions": [],

            "long_term_considerations": [],

            "stakeholders": [],

            "confidence": "Low",

            "confidence_reason":
                "OpenAI request failed."
        }