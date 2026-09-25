"""Universal search — one box across everything Lore knows.

Ordinary company search returns a list of files. Because Lore has a graph, one query can
return the actual knowledge, the documents, the projects, the decisions and open questions,
the glossary — and the people to ask (derived from who owns the matching documents).

    query ──► knowledge (semantic facts) · documents · projects · decisions · questions
          └─► people to ask (owners of the matching documents) · glossary
"""

from __future__ import annotations

import kuzu

_CAP = 6


def universal_search(conn: kuzu.Connection, company_id: str, query: str,
                     groups: list[str] | None = None) -> dict:
    from lore.auth import can_see
    from lore.retrieval.answer import retrieve

    ql = query.lower().strip()
    tokens = [t for t in ql.split() if len(t) > 1]

    def hit(text: str | None) -> bool:
        t = (text or "").lower()
        return bool(ql) and (ql in t or any(tok in t for tok in tokens))

    # Knowledge — semantic fact search (ACL applied inside retrieve).
    r = retrieve(conn, company_id, query, groups=groups) if ql else {"facts": []}
    knowledge = [{"statement": f["statement"], "doc_id": f["doc_id"], "title": f["title"]}
                 for f in r["facts"][:5]]
    fact_docs = {f["doc_id"] for f in r["facts"]}

    # Documents — lexical match (title/body) or surfaced by the semantic hits; ACL filtered.
    docs: list[dict] = []
    owners: dict[str, str] = {}
    res = conn.execute(
        "MATCH (c:Company {id:$cid})-[:OWNS]->(d:Document) RETURN d.id, d.title, d.owner, d.audience, d.text",
        {"cid": company_id},
    )
    while res.has_next():
        did, title, owner, aud, text = res.get_next()
        if not can_see(aud, groups):
            continue
        if hit(title) or did in fact_docs or hit(text):
            if len(docs) < _CAP:
                docs.append({"doc_id": did, "title": title, "owner": owner or None})
            if owner:
                owners.setdefault(owner, title)

    # People to ask — owners of the matching documents (graph turns "topic" into "who").
    people = [{"name": name, "about": doc} for name, doc in list(owners.items())[:_CAP]]

    # Projects + their entries (decisions / open questions / action items).
    proj_names: dict[str, str] = {}
    projects: list[dict] = []
    pres = conn.execute(
        "MATCH (c:Company {id:$cid})-[:HAS_PROJECT]->(p:Project) RETURN p.id, p.name, p.description",
        {"cid": company_id},
    )
    while pres.has_next():
        pid, name, desc = pres.get_next()
        proj_names[pid] = name
        if (hit(name) or hit(desc)) and len(projects) < _CAP:
            projects.append({"id": pid, "name": name, "description": desc or ""})

    decisions, questions, actions = [], [], []
    eres = conn.execute(
        "MATCH (p:Project)-[:HAS_ENTRY]->(e:ProjectEntry) RETURN e.kind, e.title, e.project_id", {},
    )
    while eres.has_next():
        kind, title, pid = eres.get_next()
        if pid not in proj_names or not hit(title):
            continue
        item = {"title": title, "project_id": pid, "project": proj_names.get(pid)}
        bucket = decisions if kind == "decision" else questions if kind == "question" else actions if kind == "action" else None
        if bucket is not None and len(bucket) < _CAP:
            bucket.append(item)

    # Glossary / acronyms.
    glossary: list[dict] = []
    gres = conn.execute(
        "MATCH (c:Company {id:$cid})-[:DEFINES]->(g:GlossaryTerm) RETURN g.term, g.definition",
        {"cid": company_id},
    )
    while gres.has_next():
        term, defn = gres.get_next()
        if (hit(term) or hit(defn)) and len(glossary) < _CAP:
            glossary.append({"term": term, "definition": defn})

    groups_out = {
        "knowledge": knowledge, "documents": docs, "projects": projects,
        "decisions": decisions, "questions": questions, "actions": actions,
        "people": people, "glossary": glossary,
    }
    total = sum(len(v) for v in groups_out.values())
    return {"query": query, "total": total, **groups_out}
