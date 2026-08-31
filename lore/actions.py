"""Actionable workflows — turn an answer into a completed request.

Knowing the policy is half the job. If someone asks "how do I request a new laptop?",
Lore can offer to actually FILE the request. Two steps:

  - suggest_action: after answering, classify whether the question is an executable
    request (file a ticket) vs purely informational.
  - execute_action: run it. Today this SIMULATES filing a ticket (logged to a JSONL) and
    returns a realistic confirmation; wiring a real Jira/Zendesk/Slack connector is a
    drop-in replacement for `_dispatch` once credentials are configured.
"""

from __future__ import annotations

import json
from datetime import datetime

import kuzu

from lore.config import settings
from lore.llm import complete

_SUGGEST_PROMPT = """Decide whether the employee's message is an ACTION the company could
execute on their behalf (file a ticket / submit a request) rather than a purely
informational question.

Actionable: "request a new laptop", "I need access to the analytics dashboard",
            "reset my VPN token", "order a monitor".
NOT actionable: "how many PTO days do I get?", "what is the security policy?" (info only).

Message: {question}
Answer already given: {answer}

Return ONLY JSON:
{{"actionable": true/false,
  "type": "it_hardware|it_access|it_support|hr_request|facilities|other",
  "label": "<short button text, e.g. 'File IT request for a new laptop'>",
  "summary": "<one sentence describing the request to file>"}}
"""

# Where each action type routes (simulated destinations).
_ROUTES = {
    "it_hardware": ("IT Service Desk", "#it-help", "1 business day"),
    "it_access": ("IT Security", "#access-requests", "4 business hours"),
    "it_support": ("IT Service Desk", "#it-help", "1 business day"),
    "hr_request": ("People Ops", "#people-ops", "2 business days"),
    "facilities": ("Facilities", "#facilities", "2 business days"),
    "other": ("Operations", "#ops", "2 business days"),
}


def _safe_json(raw: str) -> dict:
    raw = raw.strip()
    try:
        return json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
    except (json.JSONDecodeError, ValueError):
        return {}


def suggest_action(company_id: str, question: str, answer: str) -> dict:
    """Classify whether an answer can be turned into an executable request."""
    raw = complete(
        _SUGGEST_PROMPT.format(question=question, answer=answer[:600]),
        model=settings.extraction_model,
        max_tokens=250,
        temperature=0.1,
        json_mode=True,
        reasoning_effort="low",
    )
    d = _safe_json(raw)
    if not d.get("actionable"):
        return {"actionable": False}
    action_type = d.get("type", "other")
    if action_type not in _ROUTES:
        action_type = "other"
    return {
        "actionable": True,
        "type": action_type,
        "label": d.get("label", "Submit this request"),
        "summary": d.get("summary", question),
    }


def _count(conn: kuzu.Connection, company_id: str) -> int:
    res = conn.execute("MATCH (t:Ticket {company_id:$c}) RETURN count(t)", {"c": company_id})
    return int(res.get_next()[0]) if res.has_next() else 0


def execute_action(conn: kuzu.Connection, company_id: str, action_type: str,
                   summary: str, requested_by: str = "") -> dict:
    """Simulate filing the request; store the ticket and return a realistic confirmation."""
    dest, channel, eta = _ROUTES.get(action_type, _ROUTES["other"])
    ticket_id = f"{company_id.upper()}-{1000 + _count(conn, company_id) + 1}"
    conn.execute(
        """CREATE (t:Ticket {id:$id, company_id:$c, type:$ty, summary:$s, requested_by:$by,
                             destination:$d, channel:$ch, status:'filed', created_at:$t})""",
        {"id": ticket_id, "c": company_id, "ty": action_type, "s": summary,
         "by": requested_by, "d": dest, "ch": channel, "t": datetime.now()},
    )
    return {
        "ticket_id": ticket_id, "destination": dest, "channel": channel,
        "eta": eta, "summary": summary, "simulated": True,
    }
