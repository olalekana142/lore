"""File-upload adapter — turns uploaded company documents into `Document` records.

Supported (no extra deps, works offline):
  - .csv / .json : ONE ROW = ONE DOCUMENT (bulk import of FAQs / policy tables)
  - .txt / .md   : the WHOLE FILE = ONE DOCUMENT (a single policy / SOP / wiki page)

Supported with the `files` extra (`pip install -e '.[files]'`):
  - .pdf  : parsed with `pypdf`        -> WHOLE FILE = ONE DOCUMENT
  - .docx : parsed with `python-docx`  -> WHOLE FILE = ONE DOCUMENT

CSV/JSON columns are tolerant of common variants:
    id        | doc_id | slug          -> stable document id (else derived from title)
    title     | name   | subject       -> document title
    text      | body   | content | answer -> the document body
    url       | link                   -> link back to the source
    updated_at| modified | date        -> last-edited timestamp
    topic     | department | category  -> optional single topic hint
"""

from __future__ import annotations

import csv
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Iterable

from lore.models import Document, Source


class DocumentAdapter:
    source_name = "upload"

    def fetch(self, company_id: str, source: str) -> Iterable[Document]:
        path = Path(source)
        suffix = path.suffix.lower()
        if suffix == ".json":
            yield from self._from_rows(company_id, json.loads(path.read_text(encoding="utf-8")))
        elif suffix == ".csv":
            with path.open(encoding="utf-8-sig", newline="") as f:
                yield from self._from_rows(company_id, list(csv.DictReader(f)))
        elif suffix in (".txt", ".md", ".markdown"):
            yield self._from_text_file(company_id, path)
        elif suffix == ".pdf":
            yield self._from_binary(company_id, path, _read_pdf(path))
        elif suffix == ".docx":
            yield self._from_binary(company_id, path, _read_docx(path))
        else:
            raise ValueError(
                f"Unsupported document source '{source}'. "
                f"Use .csv, .json, .txt, .md, .pdf, or .docx."
            )

    # ------------------------------------------------------------------ helpers
    def _from_rows(self, company_id: str, rows: list[dict]) -> Iterable[Document]:
        for row in rows:
            title = _first(row, "title", "name", "subject", "question") or "Untitled"
            text = _first(row, "text", "body", "content", "answer", "article") or ""
            if not text.strip():
                continue
            raw_id = _first(row, "id", "doc_id", "slug") or _slug(title)
            yield Document(
                id=raw_id if str(raw_id).startswith("upload:") else f"upload:{raw_id}",
                company_id=company_id,
                title=title,
                source=Source.UPLOAD,
                url=_first(row, "url", "link"),
                text=text,
                updated_at=_parse_date(_first(row, "updated_at", "modified", "date")),
            )

    def _from_text_file(self, company_id: str, path: Path) -> Document:
        text = path.read_text(encoding="utf-8")
        # Use a leading "# Heading" as the title if present, else the file name.
        m = re.match(r"\s*#\s+(.+)", text)
        title = m.group(1).strip() if m else _name_title(path)
        return self._build(company_id, path, title, text)

    def _from_binary(self, company_id: str, path: Path, text: str) -> Document:
        """Build a Document from text already extracted out of a .pdf/.docx."""
        if not text.strip():
            raise ValueError(
                f"No extractable text in '{path.name}'. Scanned/image PDFs need OCR (not supported yet)."
            )
        # First non-empty line is usually the document title.
        first = next((ln.strip() for ln in text.splitlines() if ln.strip()), "")
        title = first[:120] if 0 < len(first) <= 120 else _name_title(path)
        return self._build(company_id, path, title, text)

    def _build(self, company_id: str, path: Path, title: str, text: str) -> Document:
        return Document(
            id=f"upload:{_slug(path.stem)}",
            company_id=company_id,
            title=title,
            source=Source.UPLOAD,
            text=text,
            updated_at=_mtime(path),
        )


def _read_pdf(path: Path) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover
        raise ValueError(
            "Reading .pdf needs the files extra. Run: pip install -e '.[files]'"
        ) from exc
    reader = PdfReader(str(path))
    return "\n\n".join((page.extract_text() or "") for page in reader.pages)


def _read_docx(path: Path) -> str:
    try:
        import docx  # python-docx
    except ImportError as exc:  # pragma: no cover
        raise ValueError(
            "Reading .docx needs the files extra. Run: pip install -e '.[files]'"
        ) from exc
    doc = docx.Document(str(path))
    return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())


def _name_title(path: Path) -> str:
    return path.stem.replace("_", " ").replace("-", " ").title()


def _first(row: dict, *keys: str) -> str | None:
    for k in keys:
        v = row.get(k)
        if v not in (None, ""):
            return str(v)
    return None


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60] or "doc"


def _mtime(path: Path) -> datetime | None:
    try:
        return datetime.fromtimestamp(path.stat().st_mtime)
    except OSError:
        return None


def _parse_date(v) -> datetime | None:
    if not v:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(str(v), fmt)
        except ValueError:
            continue
    return None
