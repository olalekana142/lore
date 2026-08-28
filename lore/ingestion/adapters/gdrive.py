"""Google Drive adapter — ingest every doc in a shared Drive folder.

Auth is a **service account** (server-to-server, no interactive OAuth):
  1. Create a service account in Google Cloud, enable the Drive API, download its JSON key.
  2. Share the target Drive folder with the service account's email (Viewer is enough).
  3. Point Lore at the key + folder:
       GOOGLE_APPLICATION_CREDENTIALS=/path/key.json   (or GOOGLE_SERVICE_ACCOUNT_JSON='{...}')
       then ingest folder id (or the folder's share URL).

Each Drive file becomes one Document:
  - Google Docs           -> exported as text/plain
  - .pdf / .docx          -> downloaded + parsed (reuses the file adapter's parsers)
  - .txt / .md / .csv / .json -> downloaded as text
  - Google Sheets/Slides, images, sub-folders -> skipped (logged)

Non-recursive for now (direct children of the folder); recursion is a small follow-up.
The google libraries are imported lazily, so the base install doesn't need them
(`pip install -e '.[drive]'`).
"""

from __future__ import annotations

import io
import json
import os
import re
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Iterable

from lore.ingestion.adapters.documents import _read_docx, _read_pdf
from lore.models import Document, Source

_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
_GOOGLE_DOC = "application/vnd.google-apps.document"
_TEXT_MIMES = {"text/plain", "text/markdown", "text/csv", "application/json"}
_PDF = "application/pdf"
_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def parse_folder_id(source: str) -> str:
    """Accept a raw folder id or a Drive URL and return the folder id."""
    source = source.strip()
    m = re.search(r"/folders/([A-Za-z0-9_-]+)", source) or re.search(r"[?&]id=([A-Za-z0-9_-]+)", source)
    if m:
        return m.group(1)
    return source  # assume it's already a bare id


def _parse_time(v: str | None) -> datetime | None:
    if not v:
        return None
    try:
        return datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        return None


class DriveAdapter:
    source_name = "drive"

    def __init__(self, service=None):
        # `service` can be injected (tests); otherwise it's built from credentials.
        self._service = service

    # --------------------------------------------------------------- public API
    def fetch(self, company_id: str, source: str) -> Iterable[Document]:
        folder_id = parse_folder_id(source)
        service = self._get_service()
        for meta in self._list_files(service, folder_id):
            doc = self._to_document(company_id, service, meta)
            if doc is not None:
                yield doc

    # --------------------------------------------------------------- internals
    def _get_service(self):
        if self._service is not None:
            return self._service
        try:
            from google.oauth2 import service_account
            from googleapiclient.discovery import build
        except ImportError as exc:  # pragma: no cover
            raise ValueError(
                "Google Drive ingestion needs the drive extra. Run: pip install -e '.[drive]'"
            ) from exc

        inline = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
        key_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if inline:
            creds = service_account.Credentials.from_service_account_info(
                json.loads(inline), scopes=_SCOPES
            )
        elif key_path and Path(key_path).exists():
            creds = service_account.Credentials.from_service_account_file(key_path, scopes=_SCOPES)
        else:
            raise ValueError(
                "No Google credentials found. Set GOOGLE_APPLICATION_CREDENTIALS to a service "
                "account key file (or GOOGLE_SERVICE_ACCOUNT_JSON to its JSON), and share the "
                "Drive folder with the service account's email."
            )
        self._service = build("drive", "v3", credentials=creds, cache_discovery=False)
        return self._service

    def _list_files(self, service, folder_id: str) -> Iterable[dict]:
        page_token = None
        while True:
            resp = (
                service.files()
                .list(
                    q=f"'{folder_id}' in parents and trashed = false",
                    fields="nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink)",
                    pageSize=100,
                    supportsAllDrives=True,
                    includeItemsFromAllDrives=True,
                    pageToken=page_token,
                )
                .execute()
            )
            yield from resp.get("files", [])
            page_token = resp.get("nextPageToken")
            if not page_token:
                break

    def _to_document(self, company_id: str, service, meta: dict) -> Document | None:
        mime = meta.get("mimeType", "")
        name = meta.get("name", "Untitled")
        file_id = meta["id"]

        if mime == _GOOGLE_DOC:
            text = self._export_text(service, file_id)
        elif mime == _PDF:
            text = _read_bytes_as(self._download_bytes(service, file_id), ".pdf")
        elif mime == _DOCX:
            text = _read_bytes_as(self._download_bytes(service, file_id), ".docx")
        elif mime in _TEXT_MIMES:
            text = self._download_bytes(service, file_id).decode("utf-8", errors="replace")
        else:
            print(f"[drive] skipping '{name}' (unsupported type {mime})")
            return None

        if not text.strip():
            print(f"[drive] skipping '{name}' (no extractable text)")
            return None

        return Document(
            id=f"drive:{file_id}",
            company_id=company_id,
            title=name,
            source=Source.DRIVE,
            url=meta.get("webViewLink"),
            text=text,
            updated_at=_parse_time(meta.get("modifiedTime")),
        )

    # download helpers (overridable in tests)
    def _export_text(self, service, file_id: str) -> str:
        data = service.files().export(fileId=file_id, mimeType="text/plain").execute()
        return data.decode("utf-8", errors="replace") if isinstance(data, bytes) else str(data)

    def _download_bytes(self, service, file_id: str) -> bytes:
        from googleapiclient.http import MediaIoBaseDownload

        req = service.files().get_media(fileId=file_id, supportsAllDrives=True)
        buf = io.BytesIO()
        downloader = MediaIoBaseDownload(buf, req)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        return buf.getvalue()


def _read_bytes_as(data: bytes, suffix: str) -> str:
    """Reuse the file adapter's PDF/DOCX parsers by writing bytes to a temp file."""
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    try:
        tmp.write(data)
        tmp.close()
        return _read_pdf(Path(tmp.name)) if suffix == ".pdf" else _read_docx(Path(tmp.name))
    finally:
        os.unlink(tmp.name)
