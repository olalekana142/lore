"""AI Onboarding Playbooks — turn the knowledge base into a role-specific ramp plan.

Two capabilities:
  - generate_playbook: given a new hire's role, build a day-by-day onboarding checklist
    grounded in the company's actual topics/documents, plus micro-sim quiz questions.
  - grade_answer: grade the hire's answer to a quiz question against the KB (retrieve the
    relevant facts, then have the model score the answer and give the correct version).
"""

from __future__ import annotations

import json

import kuzu

from lore.analytics import list_documents
from lore.config import settings
from lore.graph.queries import topic_coverage
from lore.llm import complete
from lore.retrieval.answer import retrieve

_PLAYBOOK_PROMPT = """You design onboarding for a new hire using ONLY the company's real
knowledge base below. Create a practical ramp plan grounded in these topics/documents.

New hire: {name} — role: {role}

Company topics: {topics}
Company documents: {docs}

Produce:
- 8-12 checklist items spread across days 1-14, each tied to a real topic/doc above,
  prioritising what THIS role must know first (security, tools, policies they'll hit early).
- 4 quiz questions that test critical, high-stakes policies (incident response, security,
  time-off rules, etc.) — things a wrong answer would actually cause a problem.

Return ONLY JSON:
{{
  "checklist": [{{"day": 1, "task": "<imperative task>", "why": "<why it matters>", "topic": "<topic>"}}],
  "quiz": [{{"question": "<a question with a definite, policy-based answer>"}}]
}}
"""

_GRADE_PROMPT = """Grade a new hire's answer to an onboarding question, using ONLY these
company facts as the source of truth.

FACTS:
{facts}

QUESTION: {question}
HIRE'S ANSWER: {answer}

Return ONLY JSON:
{{"verdict": "correct|partial|incorrect", "score": <0-100>,
  "feedback": "<one specific sentence>", "model_answer": "<the correct answer from the facts>"}}
"""


def _safe_json(raw: str, default):
    raw = raw.strip()
    a, b = (raw.find("["), raw.rfind("]")) if isinstance(default, list) else (raw.find("{"), raw.rfind("}"))
    try:
        return json.loads(raw[a:b + 1])
    except (json.JSONDecodeError, ValueError):
        return default


def generate_playbook(conn: kuzu.Connection, company_id: str, role: str, name: str) -> dict:
    topics = [t["topic"] for t in topic_coverage(conn, company_id, limit=20)]
    docs = [d["title"] for d in list_documents(conn, company_id)][:25]
    raw = complete(
        _PLAYBOOK_PROMPT.format(
            name=name or "the new hire", role=role or "employee",
            topics=", ".join(topics) or "(none)",
            docs="; ".join(docs) or "(none)",
        ),
        model=settings.generation_model,
        max_tokens=1400,
        temperature=0.4,
        json_mode=True,
    )
    data = _safe_json(raw, {})
    checklist = [c for c in data.get("checklist", []) if c.get("task")]
    checklist.sort(key=lambda c: c.get("day", 0))
    quiz = [q for q in data.get("quiz", []) if q.get("question")]
    return {"role": role, "name": name, "checklist": checklist, "quiz": quiz}


def grade_answer(conn: kuzu.Connection, company_id: str, question: str, answer: str) -> dict:
    r = retrieve(conn, company_id, question)
    facts = "\n".join(f"- {f['statement']}" for f in r["facts"]) or "(no relevant facts found)"
    raw = complete(
        _GRADE_PROMPT.format(facts=facts, question=question, answer=answer),
        model=settings.generation_model,
        max_tokens=400,
        temperature=0.1,
        json_mode=True,
    )
    data = _safe_json(raw, {})
    try:
        score = max(0, min(100, int(data.get("score", 0))))
    except (TypeError, ValueError):
        score = 0
    return {
        "verdict": data.get("verdict", "incorrect"),
        "score": score,
        "feedback": data.get("feedback", ""),
        "model_answer": data.get("model_answer", ""),
    }
