"""Knowledge-graph features: impact analysis, version history/diff, self-expanding eval.

These lean on the graph to do things flat RAG can't:
  - impact:   "if this document changes, what else is affected?" (facts, related docs,
              questions on its topics) — for editors before they edit/retire a doc.
  - history:  a document's version timeline + an LLM "what changed" between versions.
  - generate: from a document's evidence, propose questions it can answer, keep only the
              ones whose answer is grounded + cites this doc — the seed of a self-growing
              evaluation set (knowledge helps test the knowledge system).
"""

from __future__ import annotations

import json

import kuzu

from lore.analytics import get_document
from lore.config import settings
from lore.llm import complete


# --------------------------------------------------------------- #1 impact
def document_impact(conn: kuzu.Connection, company_id: str, doc_id: str,
                    groups: list[str] | None = None) -> dict | None:
    doc = get_document(conn, company_id, doc_id, groups)
    if doc is None:
        return None
    topics = doc["topics"]

    related = _names(conn,
        """MATCH (d:Document {id:$id})-[:ABOUT]->(t:Topic)<-[:ABOUT]-(o:Document)
           WHERE o.id <> $id RETURN DISTINCT o.title""", {"id": doc_id})

    affected_qs, aq_sample = 0, []
    if topics:
        res = conn.execute(
            """MATCH (c:Company {id:$cid})-[:ASKED]->(q:EmployeeQuestion)
               WHERE q.topic IN $topics
               RETURN q.text, q.asked_count ORDER BY q.asked_count DESC""",
            {"cid": company_id, "topics": topics},
        )
        while res.has_next():
            text, cnt = res.get_next()
            affected_qs += 1
            if len(aq_sample) < 5:
                aq_sample.append({"question": text, "asked": int(cnt or 1)})

    versions = _scalar(conn, "MATCH (:Document {id:$id})-[:HAS_VERSION]->(v) RETURN count(v)", doc_id)
    facts = len(doc["facts"])
    return {
        "doc_id": doc_id, "title": doc["title"],
        "facts": facts, "topics": topics,
        "related_docs": related, "affected_questions": affected_qs,
        "affected_sample": aq_sample, "cited_count": doc.get("cited_count", 0),
        "prior_versions": versions,
        # a rough "pieces of knowledge touched" tally, all drillable
        "total_impact": facts + len(related) + affected_qs,
    }


# --------------------------------------------------------------- #4 history / diff
def document_history(conn: kuzu.Connection, company_id: str, doc_id: str,
                     groups: list[str] | None = None) -> dict | None:
    doc = get_document(conn, company_id, doc_id, groups)
    if doc is None:
        return None
    res = conn.execute(
        "MATCH (:Document {id:$id})-[:HAS_VERSION]->(v:DocumentVersion) "
        "RETURN v.version, v.updated_at, v.effective_from, v.effective_to, v.text "
        "ORDER BY v.version DESC", {"id": doc_id},
    )
    archived = []
    while res.has_next():
        ver, upd, ef, et, text = res.get_next()
        archived.append({
            "version": ver, "is_current": False,
            "effective_from": ef.isoformat() if ef else None,
            "effective_to": et.isoformat() if et else None,
            "updated_at": upd.isoformat() if upd else None,
            "preview": (text or "")[:180],
        })
    current = {
        "version": doc["version"], "is_current": True,
        "effective_from": None, "effective_to": None,
        "updated_at": doc["updated_at"], "preview": doc["text"][:180],
    }
    return {"doc_id": doc_id, "title": doc["title"], "versions": [current] + archived}


_DIFF_PROMPT = """Summarise what changed between two versions of a company document. Output
2-5 short bullet points of concrete changes (numbers, rules, dates, eligibility). If a value
changed, show "old → new". No preamble.

OLD (v{fv}):
\"\"\"{old}\"\"\"

NEW (current):
\"\"\"{new}\"\"\"
"""


def version_diff(conn: kuzu.Connection, company_id: str, doc_id: str, from_version: int,
                 groups: list[str] | None = None) -> dict | None:
    doc = get_document(conn, company_id, doc_id, groups)
    if doc is None:
        return None
    res = conn.execute(
        "MATCH (:Document {id:$id})-[:HAS_VERSION]->(v:DocumentVersion {version:$v}) RETURN v.text",
        {"id": doc_id, "v": from_version},
    )
    if not res.has_next():
        return None
    old = res.get_next()[0]
    summary = complete(
        _DIFF_PROMPT.format(fv=from_version, old=old[:3000], new=doc["text"][:3000]),
        model=settings.generation_model, max_tokens=400, temperature=0.1,
    )
    return {"doc_id": doc_id, "from_version": from_version, "to_version": doc["version"],
            "summary": summary.strip()}


# --------------------------------------------------------------- #5 self-expanding eval
_GEN_PROMPT = """From the FACTS of one company document, write {k} distinct questions a
worker would realistically ask that THIS document answers.

Return ONLY JSON: {{"questions": ["question 1", "question 2", ...]}}

DOCUMENT: {title}
FACTS:
{facts}
"""


def generate_questions(conn: kuzu.Connection, company_id: str, doc_id: str,
                       groups: list[str] | None = None, k: int = 5) -> dict | None:
    """Generate candidate questions, then keep only those whose answer is grounded and
    cites THIS document — evidence-verified, ready to seed the golden eval set."""
    from lore.retrieval.answer import retrieve, synthesize

    doc = get_document(conn, company_id, doc_id, groups)
    if doc is None:
        return None
    facts = "\n".join(f"- {s}" for s in doc["facts"]) or "(none)"
    raw = complete(
        _GEN_PROMPT.format(k=k, title=doc["title"], facts=facts),
        model=settings.generation_model, max_tokens=400, temperature=0.4, json_mode=True,
    )
    try:
        data = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
        questions = data.get("questions", []) if isinstance(data, dict) else []
    except (json.JSONDecodeError, ValueError):
        questions = []

    verified, rejected = [], []
    for q in questions[:k]:
        if not isinstance(q, str) or not q.strip():
            continue
        r = retrieve(conn, company_id, q, groups=groups)
        res = synthesize(q, r)
        cited = {s["doc_id"] for s in res["sources"]}
        if res["confidence"] != "none" and doc_id in cited:
            verified.append({"question": q, "answer": res["answer"]})
        else:
            rejected.append({"question": q, "why": "not grounded in this document"})
    return {"doc_id": doc_id, "title": doc["title"], "verified": verified, "rejected": rejected}


# --------------------------------------------------------------- #7 policy ambiguity detection
_AMBIG_PROMPT = """You are a meticulous policy reviewer. Read the policy and write {k} sharp
questions the policy does NOT clearly answer — the edge cases, undefined terms, unstated
exceptions, boundary/scope conditions, or internal conflicts a reader would be unsure about.
Do NOT ask questions the policy already answers plainly.

Return ONLY JSON: {{"questions": [{{"q": "<question>", "type": "undefined-term|exception|missing-condition|scope|conflict"}}]}}

POLICY: {title}
\"\"\"{text}\"\"\"
"""

_AMBIG_TYPES = {"undefined-term", "exception", "missing-condition", "scope", "conflict"}


def detect_ambiguities(conn: kuzu.Connection, company_id: str, doc_id: str,
                       groups: list[str] | None = None, k: int = 5) -> dict | None:
    """Probe a policy for questions it doesn't clearly answer — real ambiguities/gaps.

    Generates edge-case questions from the policy, then tests each against the knowledge base:
    - unanswered anywhere        -> an unresolved ambiguity (the policy leaves it open)
    - answered only by ANOTHER doc -> the policy is silent but another source covers it
    Questions this document answers itself are dropped (not ambiguous).
    """
    from lore.retrieval.answer import retrieve, synthesize

    doc = get_document(conn, company_id, doc_id, groups)
    if doc is None:
        return None
    raw = complete(
        _AMBIG_PROMPT.format(k=k, title=doc["title"], text=doc["text"][:3500]),
        model=settings.generation_model, max_tokens=500, temperature=0.5, json_mode=True,
    )
    try:
        data = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
        items = data.get("questions", []) if isinstance(data, dict) else []
    except (json.JSONDecodeError, ValueError):
        items = []

    ambiguities, covered = [], 0
    for it in items[:k]:
        q = (it.get("q") if isinstance(it, dict) else it) or ""
        if not isinstance(q, str) or not q.strip():
            continue
        atype = (it.get("type") if isinstance(it, dict) else "") or "missing-condition"
        if atype not in _AMBIG_TYPES:
            atype = "missing-condition"
        res = synthesize(q, retrieve(conn, company_id, q, groups=groups))
        cited = {s["doc_id"] for s in res["sources"]}
        if res["confidence"] == "none":
            ambiguities.append({"question": q, "type": atype, "status": "unresolved", "answered_by": None})
        elif doc_id in cited:
            covered += 1
        else:
            titles = [s["title"] for s in res["sources"]]
            ambiguities.append({"question": q, "type": atype, "status": "answered_elsewhere",
                                "answered_by": titles[:2]})
    return {"doc_id": doc_id, "title": doc["title"], "ambiguities": ambiguities,
            "covered_count": covered, "probed": len([i for i in items[:k]])}


# --------------------------------------------------------------- gap -> draft -> publish -> verify
def publish_from_gap(conn: kuzu.Connection, company_id: str, question: str, title: str,
                     text: str, groups: list[str] | None = None) -> dict:
    """Publish a drafted document for a knowledge gap, then VERIFY the loop closed:

    ingest the draft → re-ask the original gap question → confirm it now gets a grounded
    answer citing the new doc → seed evidence-verified eval questions from it → report the
    remaining gap count. This is the create-knowledge half of the loop (not just maintain).
    """
    from lore.analytics import knowledge_gaps
    from lore.ingestion.pipeline import ingest_text
    from lore.retrieval.answer import retrieve, synthesize

    summary = ingest_text(company_id, title, text)
    doc_ids = summary.get("doc_ids", [])
    new_id = doc_ids[0] if doc_ids else None

    # Did publishing actually answer the original question?
    ans = synthesize(question, retrieve(conn, company_id, question, groups=groups))
    cited = {s["doc_id"] for s in ans["sources"]}
    closed = ans["confidence"] != "none" and (new_id in cited if new_id else bool(cited))

    gen = generate_questions(conn, company_id, new_id, groups=groups, k=3) if new_id else None
    return {
        "doc_id": new_id, "title": title, "closed": closed,
        "answer": ans["answer"], "sources": ans["sources"], "confidence": ans["confidence"],
        "verified_questions": [q["question"] for q in (gen["verified"] if gen else [])],
        "facts_extracted": summary.get("facts_extracted", 0),
        "remaining_gaps": len(knowledge_gaps(conn, company_id, limit=1000)),
    }


# --------------------------------------------------------------- Knowledge Change Management
def knowledge_check(conn: kuzu.Connection, company_id: str, doc_id: str,
                    groups: list[str] | None = None) -> dict | None:
    """Publish-time knowledge check: impact + conflicts + AFFECTED eval cases -> verdict.

    Runs the golden eval cases that concern this document; a case that should pass but now
    fails is a knowledge regression. This is the eval harness acting as a publishing gate.
    """
    from lore import eval as evalmod
    from lore import health
    from lore.retrieval.answer import retrieve, synthesize

    from lore import provenance

    impact = document_impact(conn, company_id, doc_id, groups)
    if impact is None:
        return None
    conflicts = health.conflicts_for_docs(conn, company_id, [doc_id])
    stale = provenance.stale_answers(conn, company_id, doc_id)

    affected = [g for g in evalmod.GOLDEN
                if not g.get("abstain") and not g.get("known_limitation") and doc_id in g.get("docs", [])]
    results, regressions = [], 0
    for g in affected:
        r = retrieve(conn, company_id, g["q"], groups=g["groups"])
        res = synthesize(g["q"], r)
        text = res["answer"].lower()
        cited = {s["doc_id"] for s in res["sources"]}
        has_ok = all(h.lower() in text for h in g.get("has", []))
        # a refute case is correct only if the answer qualifies/denies the over-claim
        refute_ok = (not g.get("refute")) or any(cue in text for cue in evalmod._REFUTE_CUES)
        ok = (res["confidence"] != "none" and has_ok and refute_ok
              and bool(set(g["docs"]) & cited))
        expected = ", ".join(g.get("has", [])) or ("a qualified answer" if g.get("refute") else "a grounded, cited answer")
        entry = {"question": g["q"], "pass": ok, "answer": res["answer"][:140], "expected": expected}
        if not ok:
            entry["cause"] = _regression_cause(g, res, cited, conflicts)
            regressions += 1
        results.append(entry)

    # three-state verdict: a failing governed case is worse than a mere conflict
    verdict = "regressions" if regressions else ("conflicts" if conflicts else "clean")
    return {
        "doc_id": doc_id, "title": impact["title"], "verdict": verdict,
        "impact": impact["total_impact"], "impact_detail": {
            "facts": impact["facts"], "related_docs": len(impact["related_docs"]),
            "affected_questions": impact["affected_questions"], "prior_versions": impact["prior_versions"],
        },
        "conflicts": conflicts, "conflict_count": len(conflicts),
        "eval": results, "regressions": regressions, "eval_total": len(results),
        "stale_answers": [
            {"id": s["id"], "question": s["question"], "created_at": s["created_at"]}
            for s in stale
        ],
        "stale_answer_count": len(stale),
    }


def _regression_cause(g: dict, res: dict, cited: set[str], conflicts: list[dict]) -> str:
    """Explain WHY a governed eval case now fails — the 'cause' line editors see."""
    if res["confidence"] == "none":
        return "answer is no longer grounded — the evidence wasn't retrieved"
    if not (set(g["docs"]) & cited):
        other = cited - set(g["docs"])
        return f"answer now cites {', '.join(sorted(other)) or 'a different source'} instead of this document"
    if conflicts:
        c = conflicts[0]
        return f'conflicting statement in "{c["b"]["title"]}": “{c["b"]["statement"][:90]}”'
    return "the expected value is missing from the answer"


# --------------------------------------------------------------- helpers
def _names(conn, cypher, params) -> list[str]:
    res = conn.execute(cypher, params)
    out = []
    while res.has_next():
        out.append(res.get_next()[0])
    return out


def _scalar(conn, cypher, doc_id) -> int:
    res = conn.execute(cypher, {"id": doc_id})
    return int(res.get_next()[0]) if res.has_next() else 0
