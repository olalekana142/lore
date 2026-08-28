"""Typed domain models shared across ingestion, graph, and retrieval.

These mirror the node types in the company knowledge graph (see README -> Schema) and
are what source adapters normalize raw files/APIs into.

    Company --OWNS-->     Document
    Document --STATES-->  Fact
    Document --ABOUT-->   Topic
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class Source(str, Enum):
    """Where a document came from. Each maps to an ingestion adapter."""

    UPLOAD = "upload"       # a file uploaded through the app (csv/json/txt/md/pdf/docx)
    DRIVE = "drive"         # Google Drive connector (later)
    DATABASE = "database"   # internal database connector (later)
    MANUAL = "manual"       # pasted directly


class Document(BaseModel):
    """One normalized company document — the output of every source adapter.

    A Document is a whole policy/SOP/wiki page/FAQ article. Its `text` may be long;
    the ingestion pipeline chunks it and extracts atomic `Fact`s for retrieval.
    """

    id: str  # stable, source-prefixed, e.g. "upload:handbook-pto"
    company_id: str
    title: str = ""
    source: Source = Source.UPLOAD
    url: str | None = None            # link back to the doc (Drive/intranet/etc.)
    text: str = ""                    # full document text
    version: int = 1                  # bumped each time the doc is re-ingested
    updated_at: datetime | None = None  # when this version was published/edited


class Fact(BaseModel):
    """An atomic, answerable statement extracted from a document (by the LLM).

    Facts are the retrieval unit: each carries an embedding, and answers are grounded
    on the top-matching facts. Every fact links back to the Document it came from so
    answers can cite their source.
    """

    id: str
    statement: str
    embedding: list[float] | None = None


class Topic(BaseModel):
    """A broad theme / department a document belongs to (HR, IT, Security, ...)."""

    id: str
    name: str
    embedding: list[float] | None = None


class Question(BaseModel):
    """A raw question a worker asked (from a query log or a submitted-questions export)."""

    id: str
    company_id: str
    text: str = ""


class EmployeeQuestion(BaseModel):
    """A worker question distilled into structured signal for the knowledge-gap graph."""

    id: str
    text: str
    embedding: list[float] | None = None
    asked_count: int = 1


class ExtractionResult(BaseModel):
    """What the extractor returns for a single Document before it hits the graph."""

    facts: list[Fact] = Field(default_factory=list)
    topics: list[Topic] = Field(default_factory=list)
