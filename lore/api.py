"""HTTP API for the Lore frontend (FastAPI).

Endpoints:
  POST /ask            one-shot cited answer (JSON)
  POST /ask/stream     conversational, streaming answer (NDJSON) + follow-up memory
  POST /feedback       thumbs up/down on an answer
  GET  /overview       home-dashboard stats
  GET  /gaps           knowledge gaps (asked but undocumented)
  GET  /questions      most-asked questions
  GET  /documents      document library (list)
  GET  /documents/{id} one document (text + facts)
  GET  /search /stale /topics   search + maintenance
  POST /ingest         upload a document

Run:  uvicorn lore.api:app --reload --port 8000
"""

from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from lore import analytics, feedback
from lore.config import settings
from lore.graph import queries
from lore.graph.schema import get_connection, init_schema
from lore.ingestion.pipeline import ingest, ingest_drive
from lore.llm import stream_chat
from lore.retrieval.answer import build_messages, cited_sources, retrieve, synthesize
from lore.retrieval.deep_search import deep_search_facts

app = FastAPI(title="Lore API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)

_conn = init_schema(get_connection())


# ----------------------------------------------------------------- request models
class Turn(BaseModel):
    role: str
    content: str


class AskRequest(BaseModel):
    company_id: str
    question: str
    history: list[Turn] = []


class FeedbackRequest(BaseModel):
    company_id: str
    question: str
    answer: str
    rating: str
    note: str = ""


class DriveRequest(BaseModel):
    company_id: str
    folder: str


# ------------------------------------------------------------------------ routes
@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/ingest")
async def ingest_upload(company_id: str = Form(...), file: UploadFile = File(...)) -> dict:
    """Accept a document upload (.csv/.json/.txt/.md/.pdf/.docx) and run ingestion."""
    suffix = Path(file.filename or "upload.csv").suffix or ".csv"
    tmp_dir = Path(tempfile.gettempdir()) / "lore_uploads"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    dest = tmp_dir / f"{company_id}_{Path(file.filename or 'doc').stem}{suffix}"
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)
    try:
        return ingest(company_id, str(dest))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/ingest-drive")
def ingest_drive_folder(req: DriveRequest) -> dict:
    """Ingest a shared Google Drive folder (needs the drive extra + service-account creds)."""
    try:
        return ingest_drive(req.company_id, req.folder)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/ask")
def ask(req: AskRequest) -> dict:
    """One-shot cited answer (used by tools/tests); also logs the question."""
    history = [t.model_dump() for t in req.history]
    r = retrieve(_conn, req.company_id, req.question)
    result = synthesize(req.question, r, history)
    analytics.log_question(
        _conn, req.company_id, req.question, r["query_vec"],
        coverage=r["top_similarity"], answered=bool(result["sources"]),
    )
    return result


@app.post("/ask/stream")
def ask_stream(req: AskRequest) -> StreamingResponse:
    """Conversational streaming answer as NDJSON lines:

        {"type":"sources","sources":[...],"confidence":"..."}
        {"type":"token","t":"..."}   (repeated)
        {"type":"done","sources":[...]}   (only the citations actually used)
    """
    company_id, question = req.company_id, req.question
    history = [t.model_dump() for t in req.history]
    r = retrieve(_conn, company_id, question)

    def gen():
        yield json.dumps({"type": "sources", "sources": r["sources"],
                          "confidence": r["confidence"]}) + "\n"
        messages = build_messages(question, r["facts"], history)
        pieces: list[str] = []
        for delta in stream_chat(messages, model=settings.generation_model,
                                 max_tokens=700, temperature=0.2):
            pieces.append(delta)
            yield json.dumps({"type": "token", "t": delta}) + "\n"
        full = "".join(pieces)
        cited = cited_sources(full, r["sources"])
        # Log after synthesis: "answered" = the reply actually cited a source.
        analytics.log_question(
            _conn, company_id, question, r["query_vec"],
            coverage=r["top_similarity"], answered=bool(cited),
        )
        yield json.dumps({"type": "done", "sources": cited}) + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson")


@app.post("/feedback")
def post_feedback(req: FeedbackRequest) -> dict:
    feedback.record(req.company_id, req.question, req.answer, req.rating, req.note)
    return {"ok": True}


@app.get("/overview")
def overview(company_id: str) -> dict:
    data = analytics.overview(_conn, company_id)
    data["feedback"] = feedback.summary(company_id)
    return data


@app.get("/gaps")
def gaps(company_id: str) -> list[dict]:
    return analytics.knowledge_gaps(_conn, company_id)


@app.get("/questions")
def questions(company_id: str) -> list[dict]:
    return analytics.top_questions(_conn, company_id)


@app.get("/documents")
def documents(company_id: str) -> list[dict]:
    return analytics.list_documents(_conn, company_id)


@app.get("/documents/{doc_id:path}")
def document(doc_id: str, company_id: str) -> dict:
    doc = analytics.get_document(_conn, company_id, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="document not found")
    return doc


@app.get("/search")
def search(company_id: str, query: str, top_k: int = 8) -> list[dict]:
    return deep_search_facts(_conn, company_id, query, top_k)


@app.get("/stale")
def stale(company_id: str, stale_after_days: int = 180) -> list[dict]:
    return queries.find_stale_docs(_conn, company_id, stale_after_days)


@app.get("/topics")
def topics(company_id: str) -> list[dict]:
    return queries.topic_coverage(_conn, company_id)
