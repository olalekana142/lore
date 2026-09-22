"""Content health — conflict & duplicate detection across documents.

This is the graph-native differentiator: because every Fact is a node linked to its
source Document, Lore can reason ACROSS documents to find:

  - CONFLICTS   two facts about the same thing that disagree (e.g. "20 PTO days" in one
                doc vs "25 PTO days" in another) — a trust risk employees would hit.
  - DUPLICATES  two docs stating the same fact — redundant content to consolidate.

Method: embed-similarity finds candidate fact pairs from DIFFERENT documents; an LLM then
classifies each candidate as conflict / duplicate / unrelated (embeddings alone can't tell
"20 days" from "25 days" apart — they look nearly identical). Cheap, and only the
high-similarity band is judged.
"""

from __future__ import annotations

import json

import kuzu
import numpy as np

from lore.config import settings
from lore.ingestion.embed import cosine
from lore.llm import complete

_CANDIDATE_SIM = 0.70   # pairs at least this similar (and cross-document) are candidates
_MAX_PAIRS = 20         # cap LLM judgements per scan

_CLASSIFY_PROMPT = """You compare pairs of statements pulled from a company's internal
documents. Be STRICT and conservative — most pairs are UNRELATED.

For each numbered pair choose exactly one relationship:
- "conflict":  a worker asking ONE question would get TWO CONTRADICTORY answers from
               these — different numbers, durations, eligibility, or rules for the SAME
               thing (e.g. "20 vacation days" vs "25 PTO days"; "wait 90 days" vs "start
               immediately"). Only when they truly contradict.
- "duplicate": the two statements convey essentially the SAME fact (redundant).
- "unrelated": DEFAULT. Different topics, or different aspects of the same area that do
               NOT contradict (e.g. "notify your manager" vs "submit in Workday").

Return ONLY a JSON array, one object per pair, echoing the pair number:
[{{"pair": 1, "relationship": "conflict|duplicate|unrelated", "reason": "<=12 words"}}]

PAIRS:
{pairs}
"""


def _active_facts(conn: kuzu.Connection, company_id: str, groups: list[str] | None = None) -> list[dict]:
    """Facts from visible docs (with each doc's provenance for conflict explanation)."""
    from datetime import datetime

    from lore.auth import can_see

    res = conn.execute(
        """MATCH (c:Company {id:$cid})-[:OWNS]->(d:Document)-[:STATES]->(f:Fact)
           RETURN f.id, f.statement, f.embedding, d.id, d.title, d.audience,
                  d.updated_at, d.authority, d.verified_at, d.effective_to""",
        {"cid": company_id},
    )
    now = datetime.now()
    out: list[dict] = []
    while res.has_next():
        fid, statement, emb, did, title, audience, updated_at, authority, verified_at, eff_to = res.get_next()
        if not emb:
            continue
        if groups is not None and not can_see(audience, groups):
            continue
        out.append({
            "fact_id": fid, "statement": statement, "emb": emb, "doc_id": did, "title": title,
            "updated_at": updated_at, "authority": authority or 60,
            "verified": verified_at is not None,
            "superseded": bool(eff_to and eff_to < now),
        })
    return out


def _side(f: dict) -> dict:
    return {
        "statement": f["statement"], "doc_id": f["doc_id"], "title": f["title"],
        "updated_at": f["updated_at"].isoformat() if f.get("updated_at") else None,
        "authority": f["authority"], "verified": f["verified"], "superseded": f["superseded"],
    }


def _recommend(a: dict, b: dict) -> dict:
    """Pick the authoritative side of a conflict: current > higher authority > newer > verified."""
    def key(x):
        return (0 if x["superseded"] else 1, x["authority"],
                x["updated_at"].timestamp() if x.get("updated_at") else 0, int(x["verified"]))
    winner, loser = (a, b) if key(a) >= key(b) else (b, a)
    bits = []
    if loser["superseded"] and not winner["superseded"]:
        bits.append("the other is superseded")
    if winner["authority"] > loser["authority"]:
        bits.append("higher authority")
    if winner.get("updated_at") and loser.get("updated_at") and winner["updated_at"] > loser["updated_at"]:
        bits.append("more recent")
    if winner["verified"] and not loser["verified"]:
        bits.append("verified")
    reason = f"“{winner['title']}” wins ({', '.join(bits) or 'preferred'}); answers use it."
    return {"winner_doc": winner["doc_id"], "loser_doc": loser["doc_id"], "reason": reason}


def _candidate_pairs(facts: list[dict]) -> list[tuple[dict, dict, float]]:
    """Cross-document fact pairs above the similarity threshold, most-similar first."""
    if len(facts) < 2:
        return []
    mat = np.array([f["emb"] for f in facts], dtype=float)
    norms = np.linalg.norm(mat, axis=1)
    norms[norms == 0] = 1.0
    sims = (mat @ mat.T) / np.outer(norms, norms)
    pairs: list[tuple[dict, dict, float]] = []
    n = len(facts)
    for i in range(n):
        for j in range(i + 1, n):
            if facts[i]["doc_id"] == facts[j]["doc_id"]:
                continue  # same doc — not a cross-source conflict/duplicate
            s = float(sims[i, j])
            if s >= _CANDIDATE_SIM:
                pairs.append((facts[i], facts[j], round(s, 3)))
    pairs.sort(key=lambda p: p[2], reverse=True)
    return pairs[:_MAX_PAIRS]


def _classify(pairs: list[tuple[dict, dict, float]]) -> list[dict]:
    if not pairs:
        return []
    numbered = "\n".join(
        f'{i + 1}. A: "{a["statement"]}" (doc: {a["title"]})\n'
        f'   B: "{b["statement"]}" (doc: {b["title"]})'
        for i, (a, b, _) in enumerate(pairs)
    )
    # Judge with the stronger model (accuracy matters more than speed for one call).
    raw = complete(
        _CLASSIFY_PROMPT.format(pairs=numbered),
        model=settings.generation_model,
        max_tokens=1500,
        temperature=0.0,
        json_mode=True,
        reasoning_effort="low",
    )
    try:
        data = json.loads(raw[raw.find("["): raw.rfind("]") + 1])
    except (json.JSONDecodeError, ValueError):
        data = []
    # Map verdicts back to pairs by the echoed 1-based "pair" number (avoids misalignment).
    by_num: dict[int, dict] = {}
    for v in data if isinstance(data, list) else []:
        try:
            by_num[int(v.get("pair"))] = v
        except (TypeError, ValueError):
            continue
    return by_num


def conflicts_for_docs(conn: kuzu.Connection, company_id: str, doc_ids: list[str]) -> list[dict]:
    """Conflicts between the just-ingested doc(s) and the rest of the knowledge base.

    Powers the upload-time alert: "this new doc contradicts an existing policy."
    """
    if not doc_ids:
        return []
    facts = _active_facts(conn, company_id)
    new = [f for f in facts if f["doc_id"] in set(doc_ids)]
    others = [f for f in facts if f["doc_id"] not in set(doc_ids)]
    if not new or not others:
        return []

    scored: list[tuple[dict, dict, float]] = []
    for a in new:
        for b in others:
            s = cosine(a["emb"], b["emb"])
            if s >= _CANDIDATE_SIM:
                scored.append((a, b, round(s, 3)))
    scored.sort(key=lambda p: p[2], reverse=True)
    scored = scored[:_MAX_PAIRS]

    verdicts = _classify(scored)
    conflicts = []
    for idx, (a, b, sim) in enumerate(scored, start=1):
        v = verdicts.get(idx, {})
        if (v.get("relationship") or "").lower() == "conflict":
            conflicts.append({"a": _side(a), "b": _side(b), "similarity": sim,
                              "reason": v.get("reason", ""), "recommend": _recommend(a, b)})
    return conflicts


def content_health(conn: kuzu.Connection, company_id: str, groups: list[str] | None = None) -> dict:
    """Return {conflicts:[...], duplicates:[...]} across documents visible to `groups`."""
    facts = _active_facts(conn, company_id, groups)
    pairs = _candidate_pairs(facts)
    verdicts = _classify(pairs)

    conflicts, duplicates = [], []
    for idx, (a, b, sim) in enumerate(pairs, start=1):
        v = verdicts.get(idx, {})
        rel = (v.get("relationship") or "").lower()
        if rel not in ("conflict", "duplicate"):
            continue
        entry = {"a": _side(a), "b": _side(b), "similarity": sim, "reason": v.get("reason", "")}
        if rel == "conflict":
            entry["recommend"] = _recommend(a, b)
            conflicts.append(entry)
        else:
            duplicates.append(entry)
    return {"conflicts": conflicts, "duplicates": duplicates}
