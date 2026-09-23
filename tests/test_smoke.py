"""Smoke tests that run WITHOUT external services (no Groq key, no network).

They cover the pure logic: the document adapter, text chunking, and the local
embedding/dedupe. Graph + Groq paths (ingestion, answer synthesis) are exercised in the
manual end-to-end run (see README -> Quickstart), not here.
"""

from pathlib import Path

import pytest

from lore.ingestion.adapters.documents import DocumentAdapter
from lore.ingestion.chunk import chunk_text
from lore.ingestion.embed import cosine, dedupe_key, embed_text

DATA = Path(__file__).resolve().parents[1] / "sample_data"
SAMPLE = DATA / "acme_handbook.csv"


def test_document_adapter_parses_csv():
    docs = list(DocumentAdapter().fetch("acme", str(SAMPLE)))
    assert len(docs) == 10
    pto = next(d for d in docs if d.id == "upload:pto-policy")
    assert pto.company_id == "acme"
    assert pto.title == "Paid Time Off Policy"
    assert "20 days of paid time off" in pto.text
    assert pto.url == "https://intra.acme.com/hr/pto"
    assert pto.updated_at is not None


def test_document_adapter_parses_pdf():
    pytest.importorskip("pypdf", reason="install the 'files' extra for PDF support")
    docs = list(DocumentAdapter().fetch("acme", str(DATA / "acme_parental_leave.pdf")))
    assert len(docs) == 1
    assert docs[0].id == "upload:acme-parental-leave"
    assert docs[0].title == "Parental Leave Policy"
    assert "16 weeks" in docs[0].text


def test_document_adapter_parses_docx():
    pytest.importorskip("docx", reason="install the 'files' extra for DOCX support")
    docs = list(DocumentAdapter().fetch("acme", str(DATA / "acme_byod.docx")))
    assert len(docs) == 1
    assert docs[0].id == "upload:acme-byod"
    assert "BYOD" in docs[0].title
    assert "MDM" in docs[0].text


def test_chunker_splits_and_bounds():
    text = "\n\n".join(f"Paragraph number {i} with some content." for i in range(50))
    chunks = chunk_text(text, max_chars=200)
    assert len(chunks) > 1
    assert all(len(c) <= 300 for c in chunks)  # small overrun tolerance for joins
    # nothing is dropped
    assert "Paragraph number 0" in chunks[0]
    assert "Paragraph number 49" in chunks[-1]


def test_drive_parse_folder_id():
    from lore.ingestion.adapters.gdrive import parse_folder_id

    assert parse_folder_id("https://drive.google.com/drive/folders/ABC123_-x") == "ABC123_-x"
    assert parse_folder_id("https://drive.google.com/open?id=XYZ789") == "XYZ789"
    assert parse_folder_id("BareFolderId42") == "BareFolderId42"


def test_drive_adapter_maps_files(monkeypatch):
    """DriveAdapter dispatches by MIME type and builds Documents, skipping unsupported."""
    from lore.ingestion.adapters.gdrive import DriveAdapter, _GOOGLE_DOC
    from lore.models import Source

    files = [
        {"id": "d1", "name": "Handbook", "mimeType": _GOOGLE_DOC,
         "modifiedTime": "2026-01-02T03:04:05.000Z", "webViewLink": "https://docs.google.com/d1"},
        {"id": "t1", "name": "notes.txt", "mimeType": "text/plain",
         "modifiedTime": "2025-06-01T00:00:00Z", "webViewLink": "https://drive.google.com/t1"},
        {"id": "s1", "name": "Budget", "mimeType": "application/vnd.google-apps.spreadsheet",
         "modifiedTime": "2025-06-01T00:00:00Z", "webViewLink": "x"},  # unsupported -> skipped
    ]
    blobs = {"d1": "PTO is 25 days per year.", "t1": "The office is open 9 to 5."}

    class FakeDrive(DriveAdapter):
        def _list_files(self, service, folder_id):
            return list(files)

        def _export_text(self, service, file_id):
            return blobs[file_id]

        def _download_bytes(self, service, file_id):
            return blobs[file_id].encode()

    docs = list(FakeDrive(service=object()).fetch("acme", "https://drive.google.com/drive/folders/F1"))
    assert len(docs) == 2  # spreadsheet skipped
    doc = next(d for d in docs if d.id == "drive:d1")
    assert doc.title == "Handbook"
    assert doc.source == Source.DRIVE
    assert doc.url == "https://docs.google.com/d1"
    assert "PTO is 25 days" in doc.text
    assert doc.updated_at is not None and doc.updated_at.year == 2026


def test_password_hashing_roundtrip():
    from lore.auth import hash_password, verify_password

    salt, h = hash_password("s3cret!")
    assert verify_password("s3cret!", salt, h)
    assert not verify_password("wrong", salt, h)
    salt2, h2 = hash_password("s3cret!")
    assert salt != salt2 and h != h2  # salted: never the same digest twice


def test_session_token_roundtrip_and_tamper():
    from lore.auth import mint_token, parse_token

    tok = mint_token("acme", "hr_admin", ["hr"], "editor")
    parsed = parse_token("Bearer " + tok)
    assert parsed == {"company_id": "acme", "username": "hr_admin", "groups": ["hr"], "role": "editor"}
    assert parse_token(tok[:-2] + "zz") is None  # tampered signature rejected
    assert parse_token("garbage") is None
    assert parse_token(None) is None


def test_permission_can_see():
    from lore.auth import ALL, can_see

    assert can_see(["everyone"], [])           # public doc, anonymous
    assert can_see(None, [])                    # default audience is public
    assert can_see(["hr"], ["hr", "eng"])       # group member
    assert can_see(["everyone", "hr"], ["eng"])  # public wins
    assert not can_see(["hr"], ["eng"])         # wrong group -> hidden
    assert not can_see(["hr"], [])              # anonymous -> hidden
    assert can_see(["hr"], [ALL])               # admin all-access sees everything


def test_role_hierarchy():
    from lore.auth import role_at_least

    assert role_at_least("admin", "editor")
    assert role_at_least("editor", "editor")
    assert not role_at_least("member", "editor")
    assert not role_at_least("anonymous", "member")
    assert role_at_least("admin", "member")


def test_bm25_ranks_exact_terms_first():
    from lore.retrieval.hybrid import bm25_scores, rank_indices, tokenize

    docs = [
        "Full-time employees accrue 25 paid time off days per year.",
        "The office is open from 9 to 5 on weekdays.",
        "Contact the IT Service Desk at extension 4357 when locked out.",
    ]
    toks = [tokenize(d) for d in docs]
    # exact rare term should dominate
    scores = bm25_scores("extension 4357", toks)
    assert rank_indices(scores)[0] == 2
    scores2 = bm25_scores("how many PTO days", toks)
    assert rank_indices(scores2)[0] == 0


def test_rrf_rewards_agreement_and_weights():
    from lore.retrieval.hybrid import rrf

    # item 2 ranks high in both -> should win
    fused = rrf([[2, 0, 1], [2, 1, 0]])
    assert max(fused, key=fused.get) == 2
    # weighting: down-weighting the second ranker lets the first decide top item
    fused_w = rrf([[0, 1, 2], [2, 1, 0]], weights=[1.0, 0.1])
    assert max(fused_w, key=fused_w.get) == 0


def test_temporal_parse_and_effective_window():
    from datetime import datetime
    from lore.retrieval.temporal import parse_as_of, effective_at, is_superseded

    assert parse_as_of("What is the current PTO policy?") is None            # current
    assert parse_as_of("What was PTO in 2025?").year == 2025                  # explicit year
    assert parse_as_of("before the 2026 change").year == 2025                 # before -> year-1
    now = datetime(2026, 9, 1)
    ef, et = datetime(2024, 1, 1), datetime(2025, 12, 31)
    assert effective_at(ef, et, datetime(2025, 6, 1))                         # in window
    assert not effective_at(ef, et, now)                                     # after window
    assert is_superseded(et, now)                                            # ended before now
    assert not is_superseded(None, now)                                      # open-ended = current


def test_embed_is_deterministic_and_normalized():
    a, b = embed_text("how many PTO days do I get"), embed_text("how many PTO days do I get")
    assert cosine(a, b) > 0.999  # identical text -> identical vector


def test_dedupe_matches_identical_fact():
    seen: dict[str, list[float]] = {}
    vec = embed_text("Employees accrue 20 PTO days per year")
    seen["fact:1"] = vec
    assert dedupe_key(vec, seen) == "fact:1"
    assert dedupe_key(embed_text("The office is closed on federal holidays"), seen) is None


def test_provenance_pins_and_invalidates_answers(tmp_path):
    """An answer is pinned to the doc version it cited; a later version makes it stale."""
    import kuzu

    from lore import provenance
    from lore.graph.schema import NODE_TABLES, REL_TABLES

    conn = kuzu.Connection(kuzu.Database(str(tmp_path / "prov.kuzu")))
    for ddl in NODE_TABLES + REL_TABLES:
        conn.execute(ddl)
    conn.execute("MERGE (c:Company {id:'acme'}) SET c.name='acme'")
    conn.execute("MERGE (d:Document {id:'upload:pto-policy'}) SET d.version=1, d.title='PTO'")
    conn.execute("MATCH (c:Company {id:'acme'}),(d:Document {id:'upload:pto-policy'}) MERGE (c)-[:OWNS]->(d)")

    aid = provenance.record_answer(conn, "acme", {
        "question": "How many PTO days?", "answer": "20 days [1]", "confidence": "high",
        "sources": [{"doc_id": "upload:pto-policy", "version": 1}],
    })
    assert aid and provenance.stale_answers(conn, "acme") == []       # nothing changed yet

    conn.execute("MATCH (d:Document {id:'upload:pto-policy'}) SET d.version=2")  # a new version lands
    stale = provenance.stale_answers(conn, "acme")
    assert len(stale) == 1
    src = stale[0]["stale_sources"][0]
    assert (src["answered_at_version"], src["current_version"]) == (1, 2)
    assert provenance.stale_count(conn, "acme", "upload:pto-policy") == 1

    # ungrounded answers carry no provenance and are never recorded
    assert provenance.record_answer(conn, "acme", {
        "question": "x", "answer": "not documented", "confidence": "none", "sources": [],
    }) is None
