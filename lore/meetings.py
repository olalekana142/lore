"""Meeting intelligence — turn a raw transcript into work products, checked against company knowledge.

This is an employee-workspace feature (why people open Lore daily) that only works well
*because* of the governed knowledge layer: it extracts the decisions, action items and open
questions from a meeting, drafts a follow-up email — and then checks whether any decision
contradicts company policy, grounded in the real documents.

    transcript ──► structured extract (summary · decisions · actions · questions · email)
               └─► retrieve related company facts ──► flag decisions that conflict with policy
"""

from __future__ import annotations

import json

import kuzu

from lore.config import settings
from lore.llm import complete

_ANALYZE_PROMPT = """You are an assistant that turns a meeting transcript into clean, useful
work products. Read the transcript and return ONLY JSON with this shape:

{{
  "summary": "2-3 sentence plain-English summary",
  "decisions": ["a concrete decision that was made", "..."],
  "action_items": [{{"task": "what to do", "owner": "person or team or ''", "due": "date/'' if none"}}],
  "open_questions": ["an unresolved question raised", "..."],
  "follow_up_email": "a short, ready-to-send recap email to attendees"
}}

Only include things actually supported by the transcript. Use "" when a field is unknown.

TRANSCRIPT:
\"\"\"{transcript}\"\"\"
"""

_POLICY_PROMPT = """You check meeting decisions against official company policy.

COMPANY POLICY FACTS (each tagged with its source document):
{facts}

DECISIONS FROM THE MEETING:
{decisions}

For any decision that appears to CONTRADICT or violate the policy facts, return it. Ignore
decisions that are consistent or simply unrelated. Return ONLY JSON:
{{"conflicts": [{{"decision": "<the decision>", "issue": "<=20 words on the conflict", "source": "<source document title>"}}]}}
"""


def analyze_meeting(conn: kuzu.Connection, company_id: str, transcript: str,
                    groups: list[str] | None = None) -> dict:
    """Extract work products from a transcript, then check decisions against company policy."""
    raw = complete(_ANALYZE_PROMPT.format(transcript=transcript[:8000]),
                   model=settings.generation_model, max_tokens=1100, temperature=0.2, json_mode=True)
    try:
        data = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
    except (json.JSONDecodeError, ValueError):
        data = {}

    summary = (data.get("summary") or "").strip()
    decisions = [d for d in (data.get("decisions") or []) if isinstance(d, str) and d.strip()]
    actions = [
        {"task": (a.get("task") or "").strip(), "owner": (a.get("owner") or "").strip(),
         "due": (a.get("due") or "").strip()}
        for a in (data.get("action_items") or []) if isinstance(a, dict) and (a.get("task") or "").strip()
    ]
    questions = [q for q in (data.get("open_questions") or []) if isinstance(q, str) and q.strip()]
    email = (data.get("follow_up_email") or "").strip()

    policy_conflicts, checked_sources = _policy_check(conn, company_id, decisions, groups)

    return {
        "summary": summary, "decisions": decisions, "action_items": actions,
        "open_questions": questions, "follow_up_email": email,
        "policy_conflicts": policy_conflicts, "checked_against": checked_sources,
    }


def _policy_check(conn: kuzu.Connection, company_id: str, decisions: list[str],
                  groups: list[str] | None) -> tuple[list[dict], list[str]]:
    """Ground the decisions against retrieved company policy and flag contradictions."""
    from lore.retrieval.answer import retrieve

    if not decisions:
        return [], []
    # Retrieve per decision (not one blended query) so each decision's relevant policy is
    # actually surfaced — then union the facts for a single grounded check.
    seen: set[str] = set()
    pooled: list[dict] = []
    titles: list[str] = []
    for d in decisions[:6]:
        r = retrieve(conn, company_id, d, top_k=4, groups=groups)
        for f in r["facts"]:
            key = f["statement"]
            if key not in seen:
                seen.add(key)
                pooled.append(f)
        for s in r["sources"]:
            if s["title"] not in titles:
                titles.append(s["title"])
    if not pooled:
        return [], []
    facts = "\n".join(f'- "{f["statement"]}" (source: {f["title"]})' for f in pooled)
    dl = "\n".join(f"{i + 1}. {d}" for i, d in enumerate(decisions))
    raw = complete(_POLICY_PROMPT.format(facts=facts, decisions=dl),
                   model=settings.generation_model, max_tokens=500, temperature=0.0,
                   json_mode=True, reasoning_effort="low")
    try:
        data = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
        conflicts = [c for c in data.get("conflicts", []) if isinstance(c, dict) and c.get("decision")]
    except (json.JSONDecodeError, ValueError):
        conflicts = []
    return conflicts, titles
