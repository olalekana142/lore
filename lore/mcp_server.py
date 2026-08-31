"""Lore MCP server — exposes every capability as an MCP tool (FastMCP).

Any agent/harness (Claude Code, a Slack bot, an internal app backend) can drive Lore
through these tools. This is the single public interface described in the README.

Run:
    python -m lore.mcp_server        # or: lore-mcp
"""

from __future__ import annotations

from fastmcp import FastMCP

from lore.graph import queries
from lore.graph.schema import get_connection, init_schema
from lore.ingestion.pipeline import ingest, ingest_drive
from lore.retrieval.answer import answer
from lore.retrieval.deep_search import deep_search_facts

mcp = FastMCP("lore")

# One shared, schema-initialized connection for read tools.
_conn = init_schema(get_connection())


# ---------------------------------------------------------------- Ingestion tools
@mcp.tool()
def ingest_documents(company_id: str, source: str) -> dict:
    """Ingest a company document file (.csv/.json/.txt/.md) into the knowledge graph.

    company_id: stable id for the company/workspace.
    source:     path to the document file. Re-ingesting the same doc updates it.
    """
    return ingest(company_id, source)


@mcp.tool()
def ingest_google_drive(company_id: str, folder: str) -> dict:
    """Ingest every supported document in a shared Google Drive folder.

    folder: the folder id or its share URL. Requires service-account credentials
    (GOOGLE_APPLICATION_CREDENTIALS) and the folder shared with that account.
    """
    return ingest_drive(company_id, folder)


# ------------------------------------------------------------------- Answer tools
@mcp.tool()
def ask_company(company_id: str, question: str) -> dict:
    """FLAGSHIP: answer a worker's question from the company's documents, with citations."""
    return answer(_conn, company_id, question)


@mcp.tool()
def search_knowledge(company_id: str, query: str, top_k: int = 8) -> list[dict]:
    """Semantic search over the company's facts (returns matching facts + source docs)."""
    return deep_search_facts(_conn, company_id, query, top_k)


# ---------------------------------------------------------------- Maintenance tools
@mcp.tool()
def stale_documents(company_id: str, stale_after_days: int = 180) -> list[dict]:
    """List documents not updated recently - the review backlog."""
    return queries.find_stale_docs(_conn, company_id, stale_after_days)


@mcp.tool()
def find_conflicts(company_id: str) -> dict:
    """Find facts that conflict or duplicate across the company's documents."""
    from lore import health

    return health.content_health(_conn, company_id)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
