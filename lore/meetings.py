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
                    groups: list[str] | None = None, created_by: str = "", persist: bool = True) -> dict:
    """Extract work products from a transcript, then check decisions against company policy.

    The recap is also saved as a Deliverable(kind='meeting') so it shows up in 'Your recent
    work' instead of vanishing when the pop-up closes (persist=False for the eval harness)."""
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

    result = {
        "summary": summary, "decisions": decisions, "action_items": actions,
        "open_questions": questions, "follow_up_email": email,
        "policy_conflicts": policy_conflicts, "checked_against": checked_sources,
    }
    if persist and (summary or decisions or actions):
        result["deliverable_id"] = _persist_recap(conn, company_id, result, created_by)
    return result


def _recap_markdown(r: dict) -> str:
    out = ["# Meeting recap", ""]
    if r["summary"]:
        out += ["## Summary", r["summary"], ""]
    if r["policy_conflicts"]:
        out += ["## Policy conflicts"] + [
            f"- **{c.get('decision', '')}** — {c.get('issue', '')}" + (f" (per {c['source']})" if c.get("source") else "")
            for c in r["policy_conflicts"]] + [""]
    if r["decisions"]:
        out += ["## Decisions"] + [f"- {d}" for d in r["decisions"]] + [""]
    if r["action_items"]:
        out += ["## Action items"] + [
            f"- [ ] {a['task']}" + (f" — {a['owner']}" if a["owner"] else "") + (f" (due {a['due']})" if a["due"] else "")
            for a in r["action_items"]] + [""]
    if r["open_questions"]:
        out += ["## Open questions"] + [f"- {q}" for q in r["open_questions"]] + [""]
    if r["follow_up_email"]:
        out += ["## Follow-up email", r["follow_up_email"]]
    return "\n".join(out).strip()


def _persist_recap(conn: kuzu.Connection, company_id: str, r: dict, created_by: str) -> str:
    import uuid
    from datetime import datetime

    did = f"deliv:{uuid.uuid4().hex[:10]}"
    first = (r["decisions"][0] if r["decisions"] else (r["summary"] or "Meeting"))[:60]
    title = f"Meeting recap — {first}"
    titles = list(r["checked_against"])
    conn.execute(
        """MERGE (d:Deliverable {id:$id})
           SET d.company_id=$cid, d.kind='meeting', d.title=$title, d.goal='meeting recap',
               d.content=$content, d.source_titles=$titles, d.source_count=$sc, d.project_id='',
               d.created_by=$by, d.status=$status, d.created_at=$ts""",
        {"id": did, "cid": company_id, "title": title, "content": _recap_markdown(r), "titles": titles,
         "sc": len(titles), "by": created_by or "guest",
         "status": "review" if r["policy_conflicts"] else "done", "ts": datetime.now()},
    )
    conn.execute(
        "MATCH (c:Company {id:$cid}), (d:Deliverable {id:$id}) MERGE (c)-[:HAS_DELIVERABLE]->(d)",
        {"cid": company_id, "id": did},
    )
    return did


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
