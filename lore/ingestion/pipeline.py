"""Ingestion pipeline: Documents -> Facts -> Graph.

    fetch (adapter)  ->  chunk  ->  extract facts/topics (Groq)  ->  embed + dedupe  ->
    write Company/Document/Fact/Topic nodes + edges into Kuzu

Re-ingesting a document (same id) BUMPS its version, refreshes its text/updated_at, and
replaces its facts - so once a policy is updated, answers reflect the new version
immediately. That is the "when it's updated, you can just ask again" behaviour.

Run standalone:
    python -m lore.ingestion.pipeline --company acme --source sample_data/acme_handbook.csv
"""

from __future__ import annotations

import argparse
from datetime import datetime

import kuzu

from lore.graph.schema import get_connection, init_schema

# Prefect provides orchestration/observability but isn't required to run locally.
# Degrade gracefully to plain functions when it isn't installed.
try:
    from prefect import flow, task
except ImportError:  # pragma: no cover
    def task(fn=None, **_kw):
        return fn if fn else (lambda f: f)

    def flow(fn=None, **_kw):
        return fn if fn else (lambda f: f)

from lore.ingestion.adapters.documents import DocumentAdapter
from lore.ingestion.adapters.gdrive import DriveAdapter
from lore.ingestion.chunk import chunk_text
from lore.ingestion.embed import dedupe_key, embed_text
from lore.ingestion.extract import extract
from lore.models import Document


@task
def fetch_documents(company_id: str, source: str) -> list[Document]:
    return list(DocumentAdapter().fetch(company_id, source))


@task
def upsert_company(conn: kuzu.Connection, company_id: str) -> None:
    conn.execute(
        "MERGE (c:Company {id: $id}) ON CREATE SET c.name = $id",
        {"id": company_id},
    )


def _next_version(conn: kuzu.Connection, doc_id: str) -> int:
    res = conn.execute("MATCH (d:Document {id:$id}) RETURN d.version", {"id": doc_id})
    if res.has_next():
        return int((res.get_next()[0] or 1)) + 1
    return 1


@task
def store_document(conn: kuzu.Connection, doc: Document, seen_facts: dict[str, list[float]]) -> int:
    """Upsert one Document and (re)build its Facts + Topics. Returns count of new facts.

    On re-ingest the old STATES edges are cleared first so stale facts stop surfacing;
    the version is bumped and text/updated_at refreshed.
    """
    version = _next_version(conn, doc.id)
    conn.execute(
        """MERGE (d:Document {id: $id})
           SET d.title=$title, d.source=$source, d.url=$url,
               d.text=$text, d.version=$version, d.updated_at=$updated""",
        {
            "id": doc.id, "title": doc.title, "source": doc.source.value,
            "url": doc.url or "", "text": doc.text, "version": version,
            "updated": doc.updated_at or datetime.now(),
        },
    )
    conn.execute(
        "MATCH (c:Company {id:$cid}), (d:Document {id:$id}) MERGE (c)-[:OWNS]->(d)",
        {"cid": doc.company_id, "id": doc.id},
    )
    # Clear previous facts/topics links for this doc (freshness on re-ingest).
    conn.execute("MATCH (d:Document {id:$id})-[r:STATES]->() DELETE r", {"id": doc.id})
    conn.execute("MATCH (d:Document {id:$id})-[r:ABOUT]->() DELETE r", {"id": doc.id})

    new_facts = 0
    for ci, chunk in enumerate(chunk_text(doc.text)):
        result = extract(doc.title, chunk, id_prefix=f"{doc.id}#{ci}")
        for fact in result.facts:
            vec = embed_text(fact.statement)
            dupe = dedupe_key(vec, seen_facts)
            fact_id = dupe or fact.id
            if dupe is None:
                seen_facts[fact_id] = vec
                conn.execute(
                    "MERGE (f:Fact {id:$id}) SET f.statement=$s, f.embedding=$emb",
                    {"id": fact_id, "s": fact.statement, "emb": vec},
                )
                new_facts += 1
            conn.execute(
                "MATCH (d:Document {id:$did}), (f:Fact {id:$fid}) MERGE (d)-[:STATES]->(f)",
                {"did": doc.id, "fid": fact_id},
            )
        for topic in result.topics:
            conn.execute(
                "MERGE (t:Topic {id:$id}) SET t.name=$name",
                {"id": topic.id, "name": topic.name},
            )
            conn.execute(
                "MATCH (d:Document {id:$did}), (t:Topic {id:$tid}) MERGE (d)-[:ABOUT]->(t)",
                {"did": doc.id, "tid": topic.id},
            )
    return new_facts


def _store_all(company_id: str, docs: list[Document], label: str) -> dict:
    """Shared store loop used by both the file and Drive ingestion flows."""
    conn = init_schema(get_connection())
    upsert_company(conn, company_id)

    seen_facts: dict[str, list[float]] = {}
    total_new_facts = 0
    for doc in docs:
        total_new_facts += store_document(conn, doc, seen_facts)

    summary = {
        "company_id": company_id,
        "documents_ingested": len(docs),
        "facts_extracted": total_new_facts,
    }
    print(f"[lore] {label} {summary}")
    return summary


@flow(name="lore-ingest")
def ingest(company_id: str, source: str) -> dict:
    """End-to-end ingestion for one company + source file."""
    return _store_all(company_id, fetch_documents(company_id, source), "ingested")


@flow(name="lore-ingest-drive")
def ingest_drive(company_id: str, folder: str) -> dict:
    """Ingest every supported document in a shared Google Drive folder."""
    docs = list(DriveAdapter().fetch(company_id, folder))
    return _store_all(company_id, docs, "ingested (drive)")


def main() -> None:
    ap = argparse.ArgumentParser(description="Lore ingestion")
    ap.add_argument("--company", required=True)
    ap.add_argument("--source", help="path to a .csv/.json/.txt/.md/.pdf/.docx file")
    ap.add_argument("--drive", help="Google Drive folder id or share URL to ingest")
    args = ap.parse_args()
    if args.drive:
        ingest_drive(args.company, args.drive)
    elif args.source:
        ingest(args.company, args.source)
    else:
        ap.error("provide --source <file> or --drive <folder>")


if __name__ == "__main__":
    main()
