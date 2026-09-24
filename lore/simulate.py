"""Policy simulation — CI/CD for organizational knowledge.

Preview a proposed change to a document BEFORE publishing it: what it would change, what it
would affect, whether it introduces conflicts, and whether it would regress the evaluation
cases the document governs — all without touching production.

    proposed text ──► diff (what changed)
                  ├─► impact (facts · related docs · questions it touches)
                  ├─► conflict preview (proposed facts vs the rest of the KB)
                  └─► run governed evals against the SIMULATED knowledge ──► verdict
                                                                              │
                              approve ─────────────────────────► apply_change (re-ingest)
"""

from __future__ import annotations

from datetime import datetime

import kuzu

from lore.config import settings
from lore.ingestion.embed import cosine, embed_text
from lore.llm import complete

_DIFF_PROMPT = """Summarise what a PROPOSED edit changes versus the current company document.
2-5 short bullets of concrete changes (numbers, rules, dates, eligibility); show "old → new"
where a value changes. If nothing material changes, say so. No preamble.

CURRENT:
\"\"\"{old}\"\"\"

PROPOSED:
\"\"\"{new}\"\"\"
"""


def _extract_proposed_facts(title: str, text: str, doc_id: str) -> list[dict]:
    """Extract + embed the facts the proposed text would produce (not persisted)."""
    from lore.ingestion.chunk import chunk_text
    from lore.ingestion.extract import extract

    out: list[dict] = []
    for ci, chunk in enumerate(chunk_text(text)):
        for f in extract(title, chunk, id_prefix=f"{doc_id}#sim{ci}").facts:
            out.append({"statement": f.statement, "emb": embed_text(f.statement)})
    return out


def _sim_retrieve(pool: list[dict], question: str, top_k: int) -> dict:
    """Rank an in-memory fact pool for a question (mirrors answer.retrieve, no graph)."""
    qv = embed_text(question)
    ranked = sorted(pool, key=lambda f: cosine(qv, f["emb"]), reverse=True)
    facts: list[dict] = []
    sources: list[dict] = []
    doc_num: dict[str, int] = {}
    for f in ranked:
        sim = cosine(qv, f["emb"])
        if sim < settings.min_relevance:
            continue
        if f["doc_id"] not in doc_num:
            doc_num[f["doc_id"]] = len(sources) + 1
            sources.append({"n": len(sources) + 1, "doc_id": f["doc_id"], "title": f["title"],
                            "url": None, "updated_at": None, "version": None, "owner": None,
                            "verified": f.get("verified", False), "current": True,
                            "authority": f.get("authority", 60), "canonical": f.get("canonical", False),
                            "effective_from": None, "effective_to": None, "facts": []})
        n = doc_num[f["doc_id"]]
        facts.append({"n": n, "title": f["title"], "statement": f["statement"],
                      "doc_id": f["doc_id"], "similarity": round(sim, 4)})
        sources[n - 1]["facts"].append(f["statement"])
        if len(facts) >= top_k:
            break
    top_sim = max((f["similarity"] for f in facts), default=0.0)
    conf = "none" if not facts else "high" if top_sim >= 0.6 else "medium" if top_sim >= 0.4 else "low"
    return {"facts": facts, "sources": sources, "confidence": conf, "top_similarity": top_sim, "glossary": []}


def simulate_change(conn: kuzu.Connection, company_id: str, doc_id: str, proposed_text: str,
                    groups: list[str] | None = None) -> dict | None:
    """Dry-run a proposed edit: diff + impact + conflict preview + governed-eval regression."""
    from lore import eval as evalmod
    from lore import health
    from lore.analytics import get_document
    from lore.knowledge import _regression_cause, document_impact
    from lore.retrieval.answer import synthesize

    doc = get_document(conn, company_id, doc_id, groups)
    if doc is None:
        return None

    diff = complete(_DIFF_PROMPT.format(old=doc["text"][:3000], new=proposed_text[:3000]),
                    model=settings.generation_model, max_tokens=400, temperature=0.1).strip()

    impact = document_impact(conn, company_id, doc_id, groups)

    # Build the SIMULATED knowledge: every current fact except this doc's, plus the facts the
    # proposed text would produce (labelled as this doc, treated as the current version).
    proposed = _extract_proposed_facts(doc["title"], proposed_text, doc_id)
    for p in proposed:
        p.update({"doc_id": doc_id, "title": doc["title"], "authority": doc.get("authority", 60),
                  "verified": doc.get("verified", False), "canonical": doc.get("canonical", False),
                  "superseded": False, "updated_at": datetime.now()})
    others = [f for f in health._active_facts(conn, company_id, groups) if f["doc_id"] != doc_id]
    pool = others + proposed

    # Governed evals — run the doc's golden cases against the simulated pool.
    governed = [g for g in evalmod.GOLDEN
                if not g.get("abstain") and not g.get("known_limitation") and doc_id in g.get("docs", [])]
    results, regressions = [], 0
    for g in governed:
        r = _sim_retrieve(pool, g["q"], settings.answer_top_k)
        res = synthesize(g["q"], r)
        text = res["answer"].lower()
        cited = {s["doc_id"] for s in res["sources"]}
        has_ok = all(h.lower() in text for h in g.get("has", []))
        refute_ok = (not g.get("refute")) or any(cue in text for cue in evalmod._REFUTE_CUES)
        ok = res["confidence"] != "none" and has_ok and refute_ok and bool(set(g["docs"]) & cited)
        expected = ", ".join(g.get("has", [])) or ("a qualified answer" if g.get("refute") else "a grounded, cited answer")
        entry = {"question": g["q"], "pass": ok, "answer": res["answer"][:140], "expected": expected}
        if not ok:
            entry["cause"] = _regression_cause(g, res, cited, [])
            regressions += 1
        results.append(entry)

    # Conflict preview — proposed facts vs the rest of the knowledge base.
    conflicts = _preview_conflicts(proposed, others)

    verdict = "regressions" if regressions else ("conflicts" if conflicts else "clean")
    return {
        "doc_id": doc_id, "title": doc["title"], "verdict": verdict,
        "diff": diff, "proposed_facts": len(proposed),
        "impact": impact["total_impact"] if impact else 0,
        "impact_detail": {
            "facts": impact["facts"] if impact else 0,
            "related_docs": len(impact["related_docs"]) if impact else 0,
            "affected_questions": impact["affected_questions"] if impact else 0,
        },
        "eval": results, "regressions": regressions, "eval_total": len(results),
        "conflicts": conflicts, "conflict_count": len(conflicts),
    }


def _preview_conflicts(proposed: list[dict], others: list[dict]) -> list[dict]:
    from lore import health

    scored: list[tuple[dict, dict, float]] = []
    for a in proposed:
        for b in others:
            s = cosine(a["emb"], b["emb"])
            if s >= health._CANDIDATE_SIM:
                scored.append((a, b, round(s, 3)))
    scored.sort(key=lambda p: p[2], reverse=True)
    scored = scored[:health._MAX_PAIRS]
    verdicts = health._classify(scored)
    conflicts = []
    for idx, (a, b, sim) in enumerate(scored, start=1):
        if (verdicts.get(idx, {}).get("relationship") or "").lower() == "conflict":
            conflicts.append({"a": health._side(a), "b": health._side(b), "similarity": sim,
                              "reason": verdicts.get(idx, {}).get("reason", ""),
                              "recommend": health._recommend(a, b)})
    return conflicts


def apply_change(conn: kuzu.Connection, company_id: str, doc_id: str, proposed_text: str,
                 groups: list[str] | None = None) -> dict | None:
    """Publish the proposed change: re-ingest the SAME document id with the new text.

    Bumps the version, snapshots the prior version, and replaces its facts — so history,
    diff, impact and historical-answer-invalidation all kick in naturally.
    """
    from lore.analytics import get_document
    from lore.ingestion.pipeline import _store_all
    from lore.models import Document, Source

    doc = get_document(conn, company_id, doc_id, groups)
    if doc is None:
        return None
    try:
        source = Source(doc.get("source") or "manual")
    except ValueError:
        source = Source.MANUAL
    new_doc = Document(id=doc_id, company_id=company_id, title=doc["title"], source=source,
                       url=doc.get("url"), text=proposed_text, updated_at=datetime.now())
    summary = _store_all(company_id, [new_doc], "applied change")
    return {"doc_id": doc_id, "facts_extracted": summary.get("facts_extracted", 0)}
