"""Deliverables — turn company knowledge into finished, grounded work products.

The flagship "bring Lore a task and it helps you complete it" experience: a person states a
goal, picks a type (brief, FAQ, SOP, report, customer reply, memo, agenda), optionally scopes
it to a project, and Lore drafts it — grounded in the company's own documents (with [n]
citations) and, when given, the project's decisions/notes. The draft is saved as the person's
"recent work" with a review status, because a deliverable that will go to a customer or the
team should be checked by a human first.
"""

from __future__ import annotations

import uuid
from datetime import datetime

import kuzu

from lore.config import settings
from lore.llm import complete

KINDS: dict[str, str] = {
    "brief": "a concise account/project brief with the key context, status and next steps",
    "faq": "a short customer-facing FAQ (question headings + crisp answers)",
    "sop": "a step-by-step standard operating procedure (purpose, steps, exceptions, owner)",
    "report": "a short structured report with clear sections",
    "memo": "a decision memo (context, decision, rationale, next steps)",
    "reply": "a professional, customer-ready reply",
    "agenda": "a focused meeting agenda with timed items",
}


def generate(conn: kuzu.Connection, company_id: str, kind: str, goal: str,
             project_id: str | None = None, created_by: str = "",
             groups: list[str] | None = None, persist: bool = True) -> dict:
    """Draft a deliverable grounded in company knowledge (+ a project's memory if given).

    persist=False (used by the eval harness) drafts without saving a Deliverable node."""
    from lore.retrieval.answer import cited_sources, retrieve

    descr = KINDS.get(kind, KINDS["brief"])
    r = retrieve(conn, company_id, goal, groups=groups)
    facts = r["facts"]
    fact_lines = "\n".join(f"[{f['n']}] ({f['title']}) {f['statement']}" for f in facts) or "(no company facts matched)"

    project_ctx = ""
    if project_id:
        from lore import projects
        proj = projects.get_project(conn, company_id, project_id)
        if proj:
            project_ctx = "\nPROJECT MEMORY (" + proj["name"] + "):\n" + (
                "\n".join(f"- ({e['kind']}) {e['title']}" + (f": {e['body']}" if e['body'] else "")
                          for e in proj["entries"]) or "(none)")

    prompt = (
        f"You produce {descr} for a company employee. Use ONLY the company facts and project "
        "memory below — do not invent facts, numbers, names or policies. Cite company facts "
        "inline as [n]. If something needed isn't supported, write [TODO: …] so a human fills "
        "it in.\n"
        "FORMAT as clean Markdown: a short '# Title', '## Section' headings, concise paragraphs, "
        "'-' bullets and '1.' numbered steps, and **bold** for labels. Do NOT use HTML tags such "
        "as <br>. Output only the deliverable, no preamble.\n\n"
        f"TASK: {goal}\n\nCOMPANY FACTS:\n{fact_lines}\n{project_ctx}"
    )
    content = complete(prompt, model=settings.generation_model, max_tokens=1100, temperature=0.3).strip()
    cited = cited_sources(content, r["sources"])

    did = f"deliv:{uuid.uuid4().hex[:10]}"
    title = goal.strip()[:80] or KINDS.get(kind, "Deliverable")
    titles = [s["title"] for s in cited]
    if persist:
        conn.execute(
            """MERGE (d:Deliverable {id:$id})
               SET d.company_id=$cid, d.kind=$kind, d.title=$title, d.goal=$goal, d.content=$content,
                   d.source_titles=$titles, d.source_count=$sc, d.project_id=$pid, d.created_by=$by,
                   d.status=$status, d.created_at=$ts""",
            {"id": did, "cid": company_id, "kind": kind, "title": title, "goal": goal.strip(),
             "content": content, "titles": titles, "sc": len(titles), "pid": project_id or "",
             "by": created_by, "status": "draft", "ts": datetime.now()},
        )
        conn.execute(
            "MATCH (c:Company {id:$cid}), (d:Deliverable {id:$id}) MERGE (c)-[:HAS_DELIVERABLE]->(d)",
            {"cid": company_id, "id": did},
        )
    return {"id": did, "kind": kind, "title": title, "content": content, "sources": cited,
            "grounded": bool(cited), "needs_review": True, "project_id": project_id or None,
            # how many numbered sources the model was allowed to cite (eval: detects dangling [n])
            "retrieved_sources": len(r["sources"]),
            "retrieved_facts": [f["statement"] for f in facts]}


def list_deliverables(conn: kuzu.Connection, company_id: str, limit: int = 12) -> list[dict]:
    res = conn.execute(
        """MATCH (c:Company {id:$cid})-[:HAS_DELIVERABLE]->(d:Deliverable)
           RETURN d.id, d.kind, d.title, d.source_count, d.status, d.created_by, d.created_at, d.project_id
           ORDER BY d.created_at DESC LIMIT $limit""",
        {"cid": company_id, "limit": limit},
    )
    out = []
    while res.has_next():
        did, kind, title, sc, status, by, created, pid = res.get_next()
        out.append({"id": did, "kind": kind, "title": title, "source_count": int(sc or 0),
                    "status": status, "created_by": by or "", "project_id": pid or None,
                    "created_at": created.isoformat() if created else None})
    return out


def get_deliverable(conn: kuzu.Connection, company_id: str, deliverable_id: str) -> dict | None:
    res = conn.execute(
        """MATCH (c:Company {id:$cid})-[:HAS_DELIVERABLE]->(d:Deliverable {id:$id})
           RETURN d.kind, d.title, d.goal, d.content, d.source_titles, d.status, d.created_at""",
        {"cid": company_id, "id": deliverable_id},
    )
    if not res.has_next():
        return None
    kind, title, goal, content, titles, status, created = res.get_next()
    return {"id": deliverable_id, "kind": kind, "title": title, "goal": goal, "content": content,
            "source_titles": list(titles or []), "status": status,
            "created_at": created.isoformat() if created else None}
