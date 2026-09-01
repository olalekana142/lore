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


def test_embed_is_deterministic_and_normalized():
    a, b = embed_text("how many PTO days do I get"), embed_text("how many PTO days do I get")
    assert cosine(a, b) > 0.999  # identical text -> identical vector


def test_dedupe_matches_identical_fact():
    seen: dict[str, list[float]] = {}
    vec = embed_text("Employees accrue 20 PTO days per year")
    seen["fact:1"] = vec
    assert dedupe_key(vec, seen) == "fact:1"
    assert dedupe_key(embed_text("The office is closed on federal holidays"), seen) is None
