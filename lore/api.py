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
import threading
from pathlib import Path

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from lore import actions, alerts as alerts_mod, analytics, auth, autopilot as autopilot_mod, briefing as briefing_mod, challenge, compose as compose_mod, deliverables as deliverables_mod, docintel as docintel_mod, escalations, feedback, glossary, health, knowledge, meetings, onboarding, projects as projects_mod, provenance, search as search_mod, simulate as simulate_mod, workspace as workspace_mod
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

# Kùzu Connections are NOT thread-safe, but the Database is and hands out many cheap
# Connections. FastAPI serves sync endpoints on a threadpool, so we give each thread its
# own Connection (created once, reused) instead of sharing one across threads.
init_schema(get_connection())  # ensure the schema exists once at startup
_local = threading.local()


def _db():
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = get_connection()
        _local.conn = conn
    return conn


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


class DocRequest(BaseModel):
    company_id: str
    doc_id: str


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


class RegisterRequest(BaseModel):
    company_id: str
    username: str
    password: str
    name: str = ""
    groups: list[str] = []


class LoginRequest(BaseModel):
    company_id: str
    username: str
    password: str


class AudienceRequest(BaseModel):
    company_id: str
    doc_id: str
    audience: list[str]


def _identity(company_fallback: str, authorization: str | None) -> tuple[str, list[str], str]:
    """Resolve (company_id, groups, role) from a bearer token.

    A valid token pins the company, groups AND role (client can't spoof any). Admins get
    an all-access pseudo-group. Anonymous callers see only public documents.
    """
    tok = auth.parse_token(authorization)
    if tok:
        groups = list(tok["groups"])
        if tok.get("role") == "admin":
            groups.append(auth.ALL)
        return tok["company_id"], groups, tok.get("role", "member")
    return company_fallback, [auth.PUBLIC], "anonymous"


def _require(authorization: str | None, minimum: str) -> tuple[str, list[str], str]:
    """Resolve identity and enforce a minimum role, else 403."""
    cid, groups, role = _identity("", authorization)
    if not auth.role_at_least(role, minimum):
        raise HTTPException(status_code=403, detail=f"This action requires the '{minimum}' role.")
    return cid, groups, role


def _with_conflicts(summary: dict) -> dict:
    """Attach any upload-time conflicts between the new doc(s) and existing policies."""
    summary["conflicts"] = health.conflicts_for_docs(
        _db(), summary["company_id"], summary.get("doc_ids", [])
    )
    return summary


# ------------------------------------------------------------------------ routes
@app.get("/health")
def healthcheck() -> dict:
    return {"status": "ok"}


# ---------------------------------------------------------------------- auth
@app.post("/auth/register")
def auth_register(req: RegisterRequest) -> dict:
    """Self-service sign-up. New accounts are always 'member' (roles are granted by admins)."""
    if auth.user_exists(_db(), req.company_id, req.username):
        raise HTTPException(status_code=409, detail="That username is already taken.")
    user = auth.create_user(_db(), req.company_id, req.username, req.password, req.name,
                            groups=[], role="member")
    token = auth.mint_token(req.company_id, user["username"], user["groups"], user["role"])
    return {"token": token, "company_id": req.company_id, "user": user}


@app.post("/auth/login")
def auth_login(req: LoginRequest) -> dict:
    user = auth.verify_login(_db(), req.company_id, req.username, req.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = auth.mint_token(req.company_id, user["username"], user["groups"], user["role"])
    return {"token": token, "company_id": req.company_id, "user": user}


@app.get("/auth/me")
def auth_me(authorization: str | None = Header(None)) -> dict:
    tok = auth.parse_token(authorization)
    if not tok:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {"company_id": tok["company_id"], "username": tok["username"],
            "groups": tok["groups"], "role": tok.get("role", "member")}


@app.get("/admin/users")
def admin_list_users(company_id: str, authorization: str | None = Header(None)) -> list[dict]:
    cid, _, _ = _require(authorization, "admin")
    return auth.list_users(_db(), cid)


class UpdateUserRequest(BaseModel):
    username: str
    role: str
    groups: list[str] = []


@app.post("/admin/users/update")
def admin_update_user(req: UpdateUserRequest, authorization: str | None = Header(None)) -> dict:
    cid, _, _ = _require(authorization, "admin")
    auth.update_user(_db(), cid, req.username, req.role, req.groups)
    return {"ok": True}


@app.post("/documents/audience")
def set_document_audience(req: AudienceRequest, authorization: str | None = Header(None)) -> dict:
    """Set which groups can see a document ('everyone' = public). Editor+."""
    _require(authorization, "editor")
    analytics.set_audience(_db(), req.doc_id, req.audience)
    return {"ok": True}


@app.post("/ingest")
async def ingest_upload(company_id: str = Form(...), file: UploadFile = File(...),
                        authorization: str | None = Header(None)) -> dict:
    """Accept a document upload (.csv/.json/.txt/.md/.pdf/.docx) and run ingestion. Editor+."""
    _require(authorization, "editor")
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
def ingest_drive_folder(req: DriveRequest, authorization: str | None = Header(None)) -> dict:
    """Ingest a shared Google Drive folder (needs the drive extra + service-account creds). Editor+."""
    _require(authorization, "editor")
    try:
        return _with_conflicts(ingest_drive(req.company_id, req.folder))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/ask")
def ask(req: AskRequest, authorization: str | None = Header(None)) -> dict:
    """One-shot cited answer (used by tools/tests); also logs the question."""
    company_id, groups, _ = _identity(req.company_id, authorization)
    history = [t.model_dump() for t in req.history]
    r = retrieve(_db(), company_id, req.question, groups=groups)
    result = synthesize(req.question, r, history)
    topic = analytics.primary_topic(_db(), result["sources"][0]["doc_id"]) if result["sources"] else "General"
    analytics.log_question(
        _db(), company_id, req.question, r["query_vec"],
        coverage=r["top_similarity"], answered=bool(result["sources"]), topic=topic,
    )
    analytics.record_citations(_db(), [s["doc_id"] for s in result["sources"]])
    provenance.record_answer(_db(), company_id, result)  # pin to the knowledge state it used
    return result


@app.post("/ask/stream")
def ask_stream(req: AskRequest, authorization: str | None = Header(None)) -> StreamingResponse:
    """Conversational streaming answer as NDJSON lines:

        {"type":"sources","sources":[...],"confidence":"..."}
        {"type":"token","t":"..."}   (repeated)
        {"type":"done","sources":[...]}   (only the citations actually used)
    """
    company_id, groups, _ = _identity(req.company_id, authorization)
    question = req.question
    history = [t.model_dump() for t in req.history]
    r = retrieve(_db(), company_id, question, groups=groups)

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
        topic = analytics.primary_topic(_db(), cited[0]["doc_id"]) if cited else "General"
        analytics.log_question(
            _db(), company_id, question, r["query_vec"],
            coverage=r["top_similarity"], answered=bool(cited), topic=topic,
        )
        analytics.record_citations(_db(), [s["doc_id"] for s in cited])
        provenance.record_answer(_db(), company_id,
                                 {"question": question, "answer": full,
                                  "sources": cited, "confidence": r["confidence"] if cited else "none"})
        yield json.dumps({"type": "done", "sources": cited}) + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson")


@app.post("/feedback")
def post_feedback(req: FeedbackRequest) -> dict:
    feedback.record(_db(), req.company_id, req.question, req.answer, req.rating, req.note)
    return {"ok": True}


@app.get("/home")
def home(company_id: str, authorization: str | None = Header(None)) -> dict:
    """Employee home: recent + popular, scoped to the caller's permissions."""
    cid, groups, _ = _identity(company_id, authorization)
    return analytics.home(_db(), cid, groups=groups)


@app.get("/overview")
def overview(company_id: str, authorization: str | None = Header(None)) -> dict:
    """Knowledge-ops dashboard (gaps, ROI, review queue). Editor+ only."""
    _require(authorization, "editor")
    data = analytics.overview(_db(), company_id)
    data["feedback"] = feedback.summary(_db(), company_id)
    return data


@app.get("/gaps")
def gaps(company_id: str) -> list[dict]:
    return analytics.knowledge_gaps(_db(), company_id)


@app.post("/gaps/draft")
def gap_draft(req: QuestionRequest, authorization: str | None = Header(None)) -> dict:
    """LLM-draft a document answering an unanswered question (for review + save). Editor+."""
    _require(authorization, "editor")
    return analytics.draft_answer(req.company_id, req.question)


@app.post("/ingest-text")
def ingest_text_doc(req: TextRequest, authorization: str | None = Header(None)) -> dict:
    """Ingest a pasted or drafted document (title + body). Editor+."""
    _require(authorization, "editor")
    try:
        return _with_conflicts(ingest_text(req.company_id, req.title, req.text))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class GapPublishRequest(BaseModel):
    company_id: str
    question: str
    title: str
    text: str


@app.post("/gaps/publish")
def gap_publish(req: GapPublishRequest, authorization: str | None = Header(None)) -> dict:
    """Publish a drafted doc for a gap, then verify the gap closed + seed eval questions. Editor+."""
    cid, groups, _ = _require(authorization, "editor")
    try:
        return knowledge.publish_from_gap(_db(), cid, req.question, req.title, req.text, groups=groups)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class SupersedeRequest(BaseModel):
    company_id: str
    doc_id: str


@app.post("/documents/supersede")
def supersede_document(req: SupersedeRequest, authorization: str | None = Header(None)) -> dict:
    """Retire a document (resolve a conflict in favour of the other). Editor+."""
    _require(authorization, "editor")
    analytics.supersede_document(_db(), req.doc_id)
    return {"ok": True}


class CanonicalRequest(BaseModel):
    company_id: str
    doc_id: str
    canonical: bool = True


@app.post("/documents/canonical")
def set_canonical(req: CanonicalRequest, authorization: str | None = Header(None)) -> dict:
    """Designate (or clear) a document as the authoritative source for its topics. Admin only."""
    _require(authorization, "admin")
    analytics.set_canonical(_db(), req.doc_id, req.canonical)
    return {"ok": True, "canonical": req.canonical}


@app.get("/alerts")
def get_alerts(company_id: str, authorization: str | None = Header(None)) -> dict:
    """Proactive prioritised alerts (conflicts, stale, unowned, gaps, unused). Editor+."""
    cid, groups, _ = _require(authorization, "editor")
    return alerts_mod.alerts(_db(), cid, groups=groups)


@app.get("/autopilot")
def get_autopilot(company_id: str, authorization: str | None = Header(None)) -> dict:
    """Proactive attention digest (supersede suggestions, recurring gaps, stale, unowned…). Editor+."""
    cid, groups, _ = _require(authorization, "editor")
    return autopilot_mod.autopilot(_db(), cid, groups=groups)


@app.get("/audit")
def audit(company_id: str, authorization: str | None = Header(None)) -> dict:
    """Knowledge-quality scorecard (editor+). Fast; conflict counts come from /content-health."""
    cid, groups, _ = _require(authorization, "editor")
    return analytics.audit(_db(), cid, groups=groups)


@app.get("/content-health")
def content_health(company_id: str, authorization: str | None = Header(None)) -> dict:
    """Conflicts + duplicates across docs, plus never-cited and stale docs."""
    cid, groups, _ = _identity(company_id, authorization)
    result = health.content_health(_db(), cid, groups=groups)
    result["never_cited"] = analytics.never_cited_docs(_db(), cid)
    result["stale"] = queries.find_stale_docs(_db(), cid)
    return result


@app.post("/documents/verify")
def verify_document(req: VerifyRequest, authorization: str | None = Header(None)) -> dict:
    """Mark a document reviewed/verified now, with an owner (Trust: ownership). Editor+."""
    _require(authorization, "editor")
    analytics.verify_document(_db(), req.doc_id, req.owner)
    return {"ok": True}


@app.post("/escalate")
def escalate(req: EscalateRequest) -> dict:
    """Forward an unanswered question to the human inbox."""
    return escalations.create(_db(), req.company_id, req.question, req.asked_by)


@app.get("/escalations")
def get_escalations(company_id: str) -> list[dict]:
    return escalations.list_open(_db(), company_id)


@app.post("/escalations/resolve")
def resolve_escalation(req: ResolveRequest, authorization: str | None = Header(None)) -> dict:
    """HR answers -> saved into the knowledge base + escalation closed. Editor+."""
    _require(authorization, "editor")
    try:
        return escalations.resolve(_db(), req.company_id, req.escalation_id, req.answer)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/actions/suggest")
def actions_suggest(req: SuggestActionRequest) -> dict:
    """After an answer, decide if it can be turned into an executable request."""
    return actions.suggest_action(req.company_id, req.question, req.answer)


@app.post("/actions/execute")
def actions_execute(req: ExecuteActionRequest) -> dict:
    """Execute the request (currently simulated — logs + returns a ticket confirmation)."""
    return actions.execute_action(_db(), req.company_id, req.type, req.summary, req.requested_by)


@app.post("/onboarding/generate")
def onboarding_generate(req: PlaybookRequest) -> dict:
    """Build a role-specific onboarding playbook (checklist + quiz) from the KB."""
    return onboarding.generate_playbook(_db(), req.company_id, req.role, req.name)


@app.post("/onboarding/grade")
def onboarding_grade(req: GradeRequest) -> dict:
    """Grade a new hire's answer to a quiz question against the knowledge base."""
    return onboarding.grade_answer(_db(), req.company_id, req.question, req.answer)


@app.get("/glossary")
def get_glossary(company_id: str) -> list[dict]:
    return glossary.list_terms(_db(), company_id)


@app.post("/glossary")
def add_glossary(req: GlossaryRequest, authorization: str | None = Header(None)) -> dict:
    _require(authorization, "editor")
    glossary.add_term(_db(), req.company_id, req.term, req.definition)
    return {"ok": True}


@app.get("/questions")
def questions(company_id: str) -> list[dict]:
    return analytics.top_questions(_db(), company_id)


@app.get("/documents")
def documents(company_id: str, authorization: str | None = Header(None)) -> list[dict]:
    cid, groups, _ = _identity(company_id, authorization)
    return analytics.list_documents(_db(), cid, groups=groups)


@app.get("/documents/{doc_id:path}")
def document(doc_id: str, company_id: str, authorization: str | None = Header(None)) -> dict:
    cid, groups, _ = _identity(company_id, authorization)
    doc = analytics.get_document(_db(), cid, doc_id, groups=groups)
    if doc is None:
        raise HTTPException(status_code=404, detail="document not found")
    return doc


@app.get("/impact")
def impact(company_id: str, doc_id: str, authorization: str | None = Header(None)) -> dict:
    """Knowledge impact analysis: what else a document touches (#1). Editor+."""
    cid, groups, _ = _require(authorization, "editor")
    res = knowledge.document_impact(_db(), cid, doc_id, groups=groups)
    if res is None:
        raise HTTPException(status_code=404, detail="document not found")
    return res


@app.get("/history")
def history(company_id: str, doc_id: str, authorization: str | None = Header(None)) -> dict:
    """Document version timeline (#4)."""
    cid, groups, _ = _identity(company_id, authorization)
    res = knowledge.document_history(_db(), cid, doc_id, groups=groups)
    if res is None:
        raise HTTPException(status_code=404, detail="document not found")
    return res


@app.get("/diff")
def diff(company_id: str, doc_id: str, from_version: int, authorization: str | None = Header(None)) -> dict:
    """LLM 'what changed' between an old version and the current one (#4). Editor+."""
    cid, groups, _ = _require(authorization, "editor")
    res = knowledge.version_diff(_db(), cid, doc_id, from_version, groups=groups)
    if res is None:
        raise HTTPException(status_code=404, detail="version not found")
    return res


@app.post("/eval/generate")
def eval_generate(req: DocRequest, authorization: str | None = Header(None)) -> dict:
    """Generate evidence-verified questions a document can answer (#5, self-expanding eval). Editor+."""
    cid, groups, _ = _require(authorization, "editor")
    res = knowledge.generate_questions(_db(), cid, req.doc_id, groups=groups)
    if res is None:
        raise HTTPException(status_code=404, detail="document not found")
    return res


@app.post("/documents/ambiguities")
def document_ambiguities(req: DocRequest, authorization: str | None = Header(None)) -> dict:
    """Probe a policy for questions it doesn't clearly answer (ambiguity detection). Editor+."""
    cid, groups, _ = _require(authorization, "editor")
    res = knowledge.detect_ambiguities(_db(), cid, req.doc_id, groups=groups)
    if res is None:
        raise HTTPException(status_code=404, detail="document not found")
    return res


class SimulateRequest(BaseModel):
    company_id: str
    doc_id: str
    proposed_text: str


@app.post("/documents/simulate")
def simulate_change(req: SimulateRequest, authorization: str | None = Header(None)) -> dict:
    """Dry-run a proposed edit: diff + impact + conflict preview + governed-eval regression. Editor+."""
    cid, groups, _ = _require(authorization, "editor")
    res = simulate_mod.simulate_change(_db(), cid, req.doc_id, req.proposed_text, groups=groups)
    if res is None:
        raise HTTPException(status_code=404, detail="document not found")
    return res


@app.post("/documents/apply")
def apply_change(req: SimulateRequest, authorization: str | None = Header(None)) -> dict:
    """Publish a proposed change: re-ingest the same document id with the new text. Editor+."""
    cid, groups, _ = _require(authorization, "editor")
    try:
        res = simulate_mod.apply_change(_db(), cid, req.doc_id, req.proposed_text, groups=groups)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if res is None:
        raise HTTPException(status_code=404, detail="document not found")
    return res


@app.post("/knowledge/check")
def knowledge_check(req: DocRequest, authorization: str | None = Header(None)) -> dict:
    """Publish-time knowledge check: impact + conflicts + affected eval cases -> verdict.

    The eval harness acting as a publishing gate (Lore 2.0 Knowledge Change Management). Editor+.
    """
    cid, groups, _ = _require(authorization, "editor")
    res = knowledge.knowledge_check(_db(), cid, req.doc_id, groups=groups)
    if res is None:
        raise HTTPException(status_code=404, detail="document not found")
    return res


class ChallengeRequest(BaseModel):
    company_id: str
    question: str


class DocIntelRequest(BaseModel):
    company_id: str
    text: str
    mode: str = "summary"


class DocCompareRequest(BaseModel):
    company_id: str
    text_a: str
    text_b: str


@app.post("/docint/analyze")
def docint_analyze(req: DocIntelRequest, authorization: str | None = Header(None)) -> dict:
    """Summarize / extract obligations / flag unusual clauses / pull action items from a pasted doc."""
    _identity(req.company_id, authorization)
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="no document text")
    return docintel_mod.analyze(req.text, req.mode)


@app.post("/docint/policy")
def docint_policy(req: DocIntelRequest, authorization: str | None = Header(None)) -> dict:
    """Check a pasted document's terms against the company's own policies (grounded, cited)."""
    cid, groups, _ = _identity(req.company_id, authorization)
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="no document text")
    return docintel_mod.check_policies(_db(), cid, req.text, groups=groups)


@app.post("/docint/compare")
def docint_compare(req: DocCompareRequest, authorization: str | None = Header(None)) -> dict:
    """Compare two pasted documents: added / removed / changed / contradictions / to-review."""
    _identity(req.company_id, authorization)
    if not req.text_a.strip() or not req.text_b.strip():
        raise HTTPException(status_code=400, detail="need both documents")
    return docintel_mod.compare(req.text_a, req.text_b)


class MeetingRequest(BaseModel):
    company_id: str
    transcript: str


class ComposeRequest(BaseModel):
    company_id: str
    question: str
    answer: str
    format: str


@app.post("/compose")
def compose(req: ComposeRequest, authorization: str | None = Header(None)) -> dict:
    """Reformat a grounded answer into a work product (email/checklist/faq/memo/slack)."""
    _identity(req.company_id, authorization)
    if not req.answer.strip():
        raise HTTPException(status_code=400, detail="nothing to compose")
    return compose_mod.compose(req.question, req.answer, req.format)


class CreateProjectRequest(BaseModel):
    company_id: str
    name: str
    description: str = ""


class ProjectEntriesRequest(BaseModel):
    company_id: str
    entries: list[dict]


class ProjectAskRequest(BaseModel):
    company_id: str
    question: str


class DeliverableRequest(BaseModel):
    company_id: str
    kind: str
    goal: str
    project_id: str | None = None


@app.post("/deliverables/generate")
def generate_deliverable(req: DeliverableRequest, authorization: str | None = Header(None)) -> dict:
    """Draft a finished, grounded, cited deliverable from company knowledge (+ a project). Member+."""
    cid, groups, _ = _require(authorization, "member")
    tok = auth.parse_token(authorization) or {}
    if not req.goal.strip():
        raise HTTPException(status_code=400, detail="describe what you need")
    return deliverables_mod.generate(_db(), cid, req.kind, req.goal, project_id=req.project_id,
                                     created_by=tok.get("username", ""), groups=groups)


@app.get("/workspace/home")
def workspace_home(company_id: str, authorization: str | None = Header(None)) -> dict:
    """Assembled 'work gets done' dashboard: active work, company signals, recent work. Member+."""
    cid, groups, _ = _require(authorization, "member")
    return workspace_mod.workspace_home(_db(), cid, groups=groups)


@app.get("/deliverables")
def list_deliverables(company_id: str, authorization: str | None = Header(None)) -> list[dict]:
    cid, _, _ = _require(authorization, "member")
    return deliverables_mod.list_deliverables(_db(), cid)


@app.get("/deliverables/{deliverable_id}")
def get_deliverable(deliverable_id: str, company_id: str, authorization: str | None = Header(None)) -> dict:
    cid, _, _ = _require(authorization, "member")
    res = deliverables_mod.get_deliverable(_db(), cid, deliverable_id)
    if res is None:
        raise HTTPException(status_code=404, detail="deliverable not found")
    return res


@app.get("/me/briefing")
def my_briefing(company_id: str, authorization: str | None = Header(None)) -> dict:
    """Personalized start-my-day briefing (latest changes, open questions, projects, ops)."""
    tok = auth.parse_token(authorization)
    if not tok:
        raise HTTPException(status_code=401, detail="Not authenticated")
    cid, groups, role = _identity(company_id, authorization)
    return briefing_mod.my_briefing(_db(), cid, tok["username"], role, groups=groups)


@app.get("/projects")
def list_projects(company_id: str, authorization: str | None = Header(None)) -> list[dict]:
    cid, _, _ = _require(authorization, "member")
    return projects_mod.list_projects(_db(), cid)


@app.post("/projects")
def create_project(req: CreateProjectRequest, authorization: str | None = Header(None)) -> dict:
    cid, _, _ = _require(authorization, "member")
    return projects_mod.create_project(_db(), cid, req.name, req.description)


@app.get("/projects/{project_id}")
def get_project(project_id: str, company_id: str, authorization: str | None = Header(None)) -> dict:
    cid, _, _ = _require(authorization, "member")
    res = projects_mod.get_project(_db(), cid, project_id)
    if res is None:
        raise HTTPException(status_code=404, detail="project not found")
    return res


@app.post("/projects/{project_id}/entries")
def add_project_entries(project_id: str, req: ProjectEntriesRequest, authorization: str | None = Header(None)) -> dict:
    cid, _, _ = _require(authorization, "member")
    added = projects_mod.add_entries(_db(), cid, project_id, req.entries)
    if added == 0 and req.entries:
        raise HTTPException(status_code=404, detail="project not found or no valid entries")
    return {"added": added}


@app.post("/projects/{project_id}/ask")
def ask_project(project_id: str, req: ProjectAskRequest, authorization: str | None = Header(None)) -> dict:
    cid, groups, _ = _require(authorization, "member")
    res = projects_mod.ask_project(_db(), cid, project_id, req.question, groups=groups)
    if res is None:
        raise HTTPException(status_code=404, detail="project not found")
    return res


@app.post("/meetings/analyze")
def analyze_meeting(req: MeetingRequest, authorization: str | None = Header(None)) -> dict:
    """Turn a meeting transcript into decisions/actions/questions/email + a policy check.

    Any signed-in user; the policy check uses their own ACL groups."""
    cid, groups, _ = _identity(req.company_id, authorization)
    if not req.transcript.strip():
        raise HTTPException(status_code=400, detail="transcript is empty")
    return meetings.analyze_meeting(_db(), cid, req.transcript, groups=groups)


@app.post("/answers/challenge")
def challenge_answer(req: ChallengeRequest, authorization: str | None = Header(None)) -> dict:
    """Adversarially search for evidence against the answer; report whether it survives.

    Available to any signed-in user (uses their own ACL groups)."""
    cid, groups, _ = _identity(req.company_id, authorization)
    return challenge.challenge_answer(_db(), cid, req.question, groups=groups)


@app.get("/answers/stale")
def answers_stale(company_id: str, doc_id: str | None = None,
                  authorization: str | None = Header(None)) -> list[dict]:
    """Past answers whose cited evidence has since changed version (historical
    invalidation). Optionally scoped to one document. Editor+."""
    cid, _, _ = _require(authorization, "editor")
    return provenance.stale_answers(_db(), cid, doc_id)


@app.post("/answers/reanswer")
def answers_reanswer(req: dict, authorization: str | None = Header(None)) -> dict:
    """Re-answer a stored question against current evidence; return before/after. Editor+."""
    cid, groups, _ = _require(authorization, "editor")
    res = provenance.reanswer(_db(), cid, req.get("answer_id", ""), groups=groups)
    if res is None:
        raise HTTPException(status_code=404, detail="answer not found")
    return res


@app.get("/search/all")
def search_all(company_id: str, query: str, authorization: str | None = Header(None)) -> dict:
    """Universal search across knowledge, documents, projects, decisions, people, glossary."""
    cid, groups, _ = _identity(company_id, authorization)
    return search_mod.universal_search(_db(), cid, query, groups=groups)


@app.get("/search")
def search(company_id: str, query: str, top_k: int = 8, authorization: str | None = Header(None)) -> list[dict]:
    cid, groups, _ = _identity(company_id, authorization)
    return deep_search_facts(_db(), cid, query, top_k, groups=groups)


@app.get("/stale")
def stale(company_id: str, stale_after_days: int = 180) -> list[dict]:
    return queries.find_stale_docs(_db(), company_id, stale_after_days)


@app.get("/topics")
def topics(company_id: str) -> list[dict]:
    return queries.topic_coverage(_db(), company_id)
