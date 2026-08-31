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

from lore import actions, analytics, escalations, feedback, glossary, health, onboarding
from lore.config import settings
from lore.graph import queries
from lore.graph.schema import get_connection, init_schema
from lore.ingestion.pipeline import ingest, ingest_drive, ingest_text
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


class TextRequest(BaseModel):
    company_id: str
    title: str
    text: str


class QuestionRequest(BaseModel):
    company_id: str
    question: str


class GlossaryRequest(BaseModel):
    company_id: str
    term: str
    definition: str


class VerifyRequest(BaseModel):
    company_id: str
    doc_id: str
    owner: str


class EscalateRequest(BaseModel):
    company_id: str
    question: str
    asked_by: str = ""


class ResolveRequest(BaseModel):
    company_id: str
    escalation_id: str
    answer: str


class PlaybookRequest(BaseModel):
    company_id: str
    role: str
    name: str = ""


class GradeRequest(BaseModel):
    company_id: str
    question: str
    answer: str


class SuggestActionRequest(BaseModel):
    company_id: str
    question: str
    answer: str


class ExecuteActionRequest(BaseModel):
    company_id: str
    type: str
    summary: str
    requested_by: str = ""


def _with_conflicts(summary: dict) -> dict:
    """Attach any upload-time conflicts between the new doc(s) and existing policies."""
    summary["conflicts"] = health.conflicts_for_docs(
        _conn, summary["company_id"], summary.get("doc_ids", [])
    )
    return summary


# ------------------------------------------------------------------------ routes
@app.get("/health")
def healthcheck() -> dict:
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
        return _with_conflicts(ingest(company_id, str(dest)))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/ingest-drive")
def ingest_drive_folder(req: DriveRequest) -> dict:
    """Ingest a shared Google Drive folder (needs the drive extra + service-account creds)."""
    try:
        return _with_conflicts(ingest_drive(req.company_id, req.folder))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/ask")
def ask(req: AskRequest) -> dict:
    """One-shot cited answer (used by tools/tests); also logs the question."""
    history = [t.model_dump() for t in req.history]
    r = retrieve(_conn, req.company_id, req.question)
    result = synthesize(req.question, r, history)
    topic = analytics.primary_topic(_conn, result["sources"][0]["doc_id"]) if result["sources"] else "General"
    analytics.log_question(
        _conn, req.company_id, req.question, r["query_vec"],
        coverage=r["top_similarity"], answered=bool(result["sources"]), topic=topic,
    )
    analytics.record_citations(_conn, [s["doc_id"] for s in result["sources"]])
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
                          "confidence": r["confidence"], "glossary": r.get("glossary", [])}) + "\n"
        messages = build_messages(question, r["facts"], history, r.get("glossary"))
        pieces: list[str] = []
        for delta in stream_chat(messages, model=settings.generation_model,
                                 max_tokens=700, temperature=0.2):
            pieces.append(delta)
            yield json.dumps({"type": "token", "t": delta}) + "\n"
        full = "".join(pieces)
        cited = cited_sources(full, r["sources"])
        # Log after synthesis: "answered" = the reply actually cited a source.
        topic = analytics.primary_topic(_conn, cited[0]["doc_id"]) if cited else "General"
        analytics.log_question(
            _conn, company_id, question, r["query_vec"],
            coverage=r["top_similarity"], answered=bool(cited), topic=topic,
        )
        analytics.record_citations(_conn, [s["doc_id"] for s in cited])
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


@app.post("/gaps/draft")
def gap_draft(req: QuestionRequest) -> dict:
    """LLM-draft a document answering an unanswered question (for review + save)."""
    return analytics.draft_answer(req.company_id, req.question)


@app.post("/ingest-text")
def ingest_text_doc(req: TextRequest) -> dict:
    """Ingest a pasted or drafted document (title + body)."""
    try:
        return _with_conflicts(ingest_text(req.company_id, req.title, req.text))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/content-health")
def content_health(company_id: str) -> dict:
    """Conflicts + duplicates across docs, plus never-cited and stale docs."""
    result = health.content_health(_conn, company_id)
    result["never_cited"] = analytics.never_cited_docs(_conn, company_id)
    result["stale"] = queries.find_stale_docs(_conn, company_id)
    return result


@app.post("/documents/verify")
def verify_document(req: VerifyRequest) -> dict:
    """Mark a document reviewed/verified now, with an owner (Trust: ownership)."""
    analytics.verify_document(_conn, req.doc_id, req.owner)
    return {"ok": True}


@app.post("/escalate")
def escalate(req: EscalateRequest) -> dict:
    """Forward an unanswered question to the human inbox."""
    return escalations.create(req.company_id, req.question, req.asked_by)


@app.get("/escalations")
def get_escalations(company_id: str) -> list[dict]:
    return escalations.list_open(company_id)


@app.post("/escalations/resolve")
def resolve_escalation(req: ResolveRequest) -> dict:
    """HR answers -> saved into the knowledge base + escalation closed."""
    try:
        return escalations.resolve(req.company_id, req.escalation_id, req.answer)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/actions/suggest")
def actions_suggest(req: SuggestActionRequest) -> dict:
    """After an answer, decide if it can be turned into an executable request."""
    return actions.suggest_action(req.company_id, req.question, req.answer)


@app.post("/actions/execute")
def actions_execute(req: ExecuteActionRequest) -> dict:
    """Execute the request (currently simulated — logs + returns a ticket confirmation)."""
    return actions.execute_action(req.company_id, req.type, req.summary, req.requested_by)


@app.post("/onboarding/generate")
def onboarding_generate(req: PlaybookRequest) -> dict:
    """Build a role-specific onboarding playbook (checklist + quiz) from the KB."""
    return onboarding.generate_playbook(_conn, req.company_id, req.role, req.name)


@app.post("/onboarding/grade")
def onboarding_grade(req: GradeRequest) -> dict:
    """Grade a new hire's answer to a quiz question against the knowledge base."""
    return onboarding.grade_answer(_conn, req.company_id, req.question, req.answer)


@app.get("/glossary")
def get_glossary(company_id: str) -> list[dict]:
    return glossary.list_terms(_conn, company_id)


@app.post("/glossary")
def add_glossary(req: GlossaryRequest) -> dict:
    glossary.add_term(_conn, req.company_id, req.term, req.definition)
    return {"ok": True}


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
