"""Source adapters — each normalizes raw data into `Document` records.

The core pipeline is source-agnostic; adapters are the only source-specific code.
Add a new source (Google Drive, an internal database, ...) = add one adapter that
yields `Document`s, no pipeline changes.
"""

from __future__ import annotations

from typing import Iterable, Protocol

from lore.models import Document


class DocumentAdapter(Protocol):
    """Contract every source adapter fulfills."""

    source_name: str

    def fetch(self, company_id: str, source: str) -> Iterable[Document]:
        """Yield normalized Documents. `source` is a file path, folder, or connection."""
        ...
