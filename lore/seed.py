"""Optional first-boot seeding of the sample company, for the Docker demo.

Idempotent: if the company already has documents, does nothing. Runs as its own
process (in the container entrypoint) BEFORE uvicorn opens the DB, so there's no Kùzu
writer-lock conflict. Extraction calls Groq, so a valid GROQ_API_KEY must be present;
on any failure it just leaves the graph empty and the app still starts.

Enable by setting LORE_SEED_SAMPLE=1 (the docker-compose sets it by default).
"""

from __future__ import annotations

import os
from pathlib import Path

from lore.graph.schema import get_connection, init_schema
from lore.ingestion.pipeline import ingest

COMPANY = os.environ.get("LORE_SEED_COMPANY", "acme")
_SAMPLES = [
    "acme_handbook.csv",
    "acme_pto_update.csv",
    "acme_parental_leave.pdf",
    "acme_byod.docx",
]


def _already_seeded(conn) -> bool:
    res = conn.execute(
        "MATCH (c:Company {id:$id})-[:OWNS]->(d:Document) RETURN d.id LIMIT 1",
        {"id": COMPANY},
    )
    return res.has_next()


def main() -> None:
    if os.environ.get("LORE_SEED_SAMPLE", "").lower() not in ("1", "true", "yes"):
        print("[seed] LORE_SEED_SAMPLE not set - skipping sample seed.")
        return

    conn = init_schema(get_connection())
    if _already_seeded(conn):
        print(f"[seed] '{COMPANY}' already has documents - skipping.")
        return

    data_dir = Path(os.environ.get("LORE_SAMPLE_DIR", "sample_data"))
    for name in _SAMPLES:
        path = data_dir / name
        if path.exists():
            print(f"[seed] ingesting {path} ...")
            ingest(COMPANY, str(path))
    print("[seed] done.")


if __name__ == "__main__":
    main()
