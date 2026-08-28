"""Kuzu graph schema - node & relationship tables.

Kuzu is embedded (runs in-process, no server), which keeps local Windows dev zero-ops.
Its DDL is Cypher-like. `init_schema` is idempotent: safe to call on every startup.

Graph shape (see README -> Schema):

    Company  --OWNS-->      Document
    Document --STATES-->    Fact
    Document --ABOUT-->     Topic
    Company  --ASKED-->     EmployeeQuestion   (knowledge-gap signal)
    Topic    --CONNECTED_TO-> Topic
"""

from __future__ import annotations

import kuzu

from lore.config import settings

# --- Node tables ---
NODE_TABLES = [
    """CREATE NODE TABLE IF NOT EXISTS Company(
        id STRING, name STRING, PRIMARY KEY(id)
    )""",
    """CREATE NODE TABLE IF NOT EXISTS Document(
        id STRING, title STRING, source STRING, url STRING,
        text STRING, version INT64, updated_at TIMESTAMP, PRIMARY KEY(id)
    )""",
    """CREATE NODE TABLE IF NOT EXISTS Fact(
        id STRING, statement STRING, embedding DOUBLE[], PRIMARY KEY(id)
    )""",
    """CREATE NODE TABLE IF NOT EXISTS Topic(
        id STRING, name STRING, embedding DOUBLE[], PRIMARY KEY(id)
    )""",
    """CREATE NODE TABLE IF NOT EXISTS EmployeeQuestion(
        id STRING, text STRING, asked_count INT64, unanswered_count INT64,
        coverage DOUBLE, last_asked TIMESTAMP, embedding DOUBLE[], PRIMARY KEY(id)
    )""",
]

# --- Relationship tables ---
REL_TABLES = [
    "CREATE REL TABLE IF NOT EXISTS OWNS(FROM Company TO Document)",
    "CREATE REL TABLE IF NOT EXISTS STATES(FROM Document TO Fact)",
    "CREATE REL TABLE IF NOT EXISTS ABOUT(FROM Document TO Topic)",
    "CREATE REL TABLE IF NOT EXISTS ASKED(FROM Company TO EmployeeQuestion)",
    "CREATE REL TABLE IF NOT EXISTS CONNECTED_TO(FROM Topic TO Topic, weight DOUBLE)",
]


# Kuzu allows only ONE Database handle per file (it takes a write lock). Opening a
# second handle in the same process - e.g. the API's read connection plus an ingest
# pipeline connection - raises "Could not set lock on file". So we keep a single,
# process-wide Database and hand out lightweight Connections from it (many are allowed).
_db: kuzu.Database | None = None


def get_database() -> kuzu.Database:
    global _db
    if _db is None:
        settings.ensure_db_dir()
        _db = kuzu.Database(str(settings.db_path))
    return _db


def get_connection() -> kuzu.Connection:
    """Return a new Connection on the shared, process-wide Database."""
    return kuzu.Connection(get_database())


def init_schema(conn: kuzu.Connection | None = None) -> kuzu.Connection:
    """Create all node/rel tables if they don't exist. Idempotent."""
    conn = conn or get_connection()
    for ddl in NODE_TABLES + REL_TABLES:
        conn.execute(ddl)
    return conn


if __name__ == "__main__":
    init_schema()
    print(f"Schema initialized at {settings.db_path}")
