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
from lore.ingestion.pipeline import ingest, ingest_text

COMPANY = os.environ.get("LORE_SEED_COMPANY", "acme")
_SAMPLES = [
    "acme_handbook.csv",
    "acme_pto_update.csv",
    "acme_parental_leave.pdf",
    "acme_byod.docx",
    "acme_faq.csv",  # legacy FAQ — intentionally conflicts (20 vs 25 PTO days) for the demo
]
_GLOSSARY = [
    ("PTO", "Paid Time Off"),
    ("MFA", "Multi-Factor Authentication"),
    ("MDM", "Mobile Device Management"),
    ("BYOD", "Bring Your Own Device"),
    ("SOP", "Standard Operating Procedure"),
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

    from lore import glossary, analytics
    for term, definition in _GLOSSARY:
        glossary.add_term(conn, COMPANY, term, definition)
    print(f"[seed] glossary: {len(_GLOSSARY)} terms")

    # Verify a couple of docs (with owners) so the app shows a mix of verified/unverified.
    for doc_id, owner in [("upload:pto-policy", "HR Team"),
                          ("upload:security-incident", "IT Security")]:
        analytics.verify_document(conn, doc_id, owner)
    print("[seed] verified 2 docs")

    # Permissions demo: an HR-only document + a few users in different groups.
    from lore import auth
    comp = ingest_text(
        COMPANY, "Compensation Bands 2026",
        "Level 3 engineers earn between 120,000 and 150,000 dollars per year. Level 5 "
        "engineers earn 180,000 to 220,000. Annual merit increases are capped at 8 percent. "
        "Equity refresh grants vest over 4 years.",
    )
    for did in comp.get("doc_ids", []):
        analytics.set_audience(conn, did, ["hr"])  # restricted: only the 'hr' group can see it
    auth.create_user(conn, COMPANY, "boss", "boss", "Dana (Admin)", ["hr", "engineering"], role="admin")
    auth.create_user(conn, COMPANY, "hr_admin", "hr", "HR Admin", ["hr"], role="editor")
    auth.create_user(conn, COMPANY, "alice", "alice", "Alice (Engineering)", ["engineering"], role="member")
    auth.create_user(conn, COMPANY, "sam", "sam", "Sam (New Hire)", [], role="member")
    print("[seed] users: boss/boss (admin), hr_admin/hr (editor), alice/alice (member), sam/sam (member)")
    print("[seed] done.")


if __name__ == "__main__":
    main()
