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


def _tickets_path():
    settings.ensure_db_dir()
    return settings.db_path.parent / "tickets.jsonl"


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


def _count() -> int:
    path = _tickets_path()
    if not path.exists():
        return 0
    return sum(1 for _ in path.read_text(encoding="utf-8").splitlines())


def execute_action(company_id: str, action_type: str, summary: str, requested_by: str = "") -> dict:
    """Simulate filing the request; log it and return a realistic confirmation."""
    dest, channel, eta = _ROUTES.get(action_type, _ROUTES["other"])
    ticket_id = f"{company_id.upper()}-{1000 + _count() + 1}"
    row = {
        "ticket_id": ticket_id,
        "company_id": company_id,
        "type": action_type,
        "summary": summary,
        "requested_by": requested_by,
        "destination": dest,
        "channel": channel,
        "status": "filed",
        "created_at": datetime.now().isoformat(),
    }
    with _tickets_path().open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
    return {
        "ticket_id": ticket_id,
        "destination": dest,
        "channel": channel,
        "eta": eta,
        "summary": summary,
        "simulated": True,
    }
