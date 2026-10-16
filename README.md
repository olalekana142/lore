# Lore — Company Knowledge Base (GraphRAG) 📚

> Turn your company's scattered policies, SOPs and wikis into a knowledge base any worker
> can just **ask** — and every answer cites the document it came from.

Lore ingests a company's internal documents into a **GraphRAG knowledge graph** of
*documents*, *facts*, and *topics*. A worker asks a question in plain English; Lore
retrieves the most relevant facts, synthesizes a direct answer, and shows the **source
documents** it used. Re-ingest an updated policy and answers reflect the new version
immediately.

**The one-line pitch:** *"How many PTO days do I get?" → a straight answer, cited to the
current PTO policy — no digging through the intranet.*

---

## Why this exists

Company knowledge is spread across Confluence, Google Drive, PDFs and people's heads.
Workers waste time hunting for answers or pinging colleagues, and half of what they find
is out of date. Lore gives everyone one place to ask, grounds every answer in real
documents, and keeps answers current as those documents change.

**The core loop:**

```
INGEST company docs  →  BUILD a graph of documents + facts + topics
      →  ASK a question  →  ANSWER it, grounded + cited  →  RE-INGEST when docs change
```

---

## What Lore does — your company's knowledge, continuously verified

Lore isn't "ChatGPT over PDFs." It doesn't just retrieve knowledge — it can tell you **where
its knowledge came from, whether it's trustworthy, what changed, what conflicts, what a change
will affect, and whether its own past answers are still grounded.** That full loop is the moat:

```
                         COMPANY KNOWLEDGE
                                │
                        ┌───────▼────────┐
                        │      LORE      │
                        └───────┬────────┘
         ┌──────────────────────┼──────────────────────┐
         ▼                      ▼                      ▼
       ANSWER                 AUDIT                  CHANGE
   evidence · cite       gaps · conflicts      versions · impact
   why · challenge       staleness · alerts    regressions · canonical
         └──────────────────────┼──────────────────────┘
                                ▼
                    IMPROVE  (gap → draft → publish)
                                │
                    RE-EVALUATE (stale answers → re-answer)
                                └──────────────► repeat
```

**Answer — grounded, and defensible**
- **Cited answers** — every claim links to the source document; click a citation to see the exact sentence.
- **Why this answer** — a trust panel: current vs retired sources, verified, owner, authority, freshness.
- **Challenge this answer** — adversarially searches for evidence *against* the answer and reports whether it **survives** (e.g. a legacy "20 PTO days" claim, found and beaten as superseded).
- **Permission-aware** — answers, search and the library are filtered by each user's groups; you only ever get cited what you're allowed to see.

**Audit — the knowledge, continuously checked**
- **Knowledge audit** — one scorecard: freshness, verification, ownership, citation coverage.
- **Conflict & duplicate detection** — reasons *across* documents to flag contradictory facts, with a resolution recommendation (`canonical > current > authority > recency > verified`).
- **Proactive alerts** — one prioritised feed (conflicts · past review date · missing owners · stale answers · high-demand gaps · unused docs) so problems surface without anyone looking.
- **Policy ambiguity detection** — probes a policy with the edge-case questions a careful reader would ask, and flags the ones it *doesn't* clearly answer (undefined terms, exceptions, scope).

**Change — managed, not silent**
- **Version history + "what changed"** — every re-ingest snapshots the prior version; an LLM diff shows the change (e.g. *PTO 20 → 25, 90-day wait removed*).
- **Knowledge impact analysis** — before you edit/retire a doc: what facts, related docs and questions it touches.
- **Knowledge Check (the publishing gate)** — one action runs impact + conflict detection + the **governed evaluation cases** a doc is responsible for, and returns a verdict: `clean → conflicts → regressions`. A governed case that should pass but now fails is a **knowledge regression**, shown with expected-vs-now and a cause. The eval harness becomes part of the publishing workflow.
- **Canonical source / authority** — admins designate the authoritative source of truth for a topic; it wins in retrieval and conflict resolution, cutting through years of duplicated docs.

**Improve & re-evaluate — the self-healing half**
- **Gap → draft → publish → verify** — an unanswered question becomes a drafted doc; publishing re-asks the original question, confirms it's now answered + cited, and seeds evidence-verified eval questions. *Gap closure, measured.*
- **Historical answer invalidation** — every grounded answer is pinned to the knowledge state (docs @ versions) it used; when a source changes, Lore flags the past answers it made stale and can **re-answer** them, showing old vs new.

Backing all of it: a **RAG evaluation harness** run as a regression gate (recall · MRR · citation
precision · abstention 2×2 · ACL-leak = 0 · latency). Nothing ships unless it beats or preserves
the baseline — *evidence before complexity*. Hybrid retrieval and a claim verifier were built,
measured, and left **off** because the harness proved they didn't help on this corpus.

---

## Why GraphRAG (and not a pile of document chunks)

Answers are grounded on **facts** extracted from documents, and facts, documents and
topics are **linked**. That structure buys things flat chunk-search can't:

| Capability | How the graph makes it work |
|---|---|
| Cited answers | every `Fact` links back to its source `Document`, so answers show sources |
| Freshness | re-ingesting a `Document` bumps its version and replaces its `Fact`s |
| Stale-doc review | traverse `Company → Document`, filter by `updated_at` |
| Topic coverage | `Document → ABOUT → Topic` counts show thinly-documented areas |
| De-duplication | the same fact stated in many docs collapses to one node |

---

## Architecture

```
                         ┌─────────────────────────────────────────┐
                         │           MCP SERVER (FastMCP)           │
   Harness / Agent  ───► │  ingest_documents · ask_company · ...    │
   (Claude Code, app)    └───────────────┬─────────────────────────┘
                                         │
              ┌──────────────────────────┼──────────────────────────┐
              ▼                          ▼                          ▼
     ┌─────────────────┐      ┌────────────────────┐      ┌──────────────────┐
     │ INGESTION       │      │  KNOWLEDGE GRAPH   │      │  RETRIEVAL       │
     │ adapters·chunk  │─────►│  (Kùzu, embedded)  │◄─────│  embed question  │
     │ extract facts·  │      │  Company·Document· │      │  rank facts·     │
     │ embed·dedupe·   │      │  Fact·Topic        │      │  synthesize +    │
     │ link            │      │                    │      │  cite sources    │
     └─────────────────┘      └────────────────────┘      └──────────────────┘
```

### Stack

| Layer | Choice | Notes |
|---|---|---|
| MCP server | **FastMCP** (Python) | exposes tools to any agent/harness/bot |
| Graph DB | **Kùzu** (embedded) | zero-ops, in-process, great for local dev; Cypher-like |
| HTTP API | **FastAPI** | thin layer the web app talks to |
| Frontend | **Next.js + Tailwind** | Ask / Add-documents / Review pages |
| Fact extraction | **Groq · `openai/gpt-oss-20b`** | fast, JSON-mode, low reasoning effort |
| Answer synthesis | **Groq · `openai/gpt-oss-120b`** | grounded, cited answers |
| Embeddings | **fastembed** (BAAI/bge-small-en-v1.5) | local, no API key, no torch |

> All LLM calls go through the single `lore/llm.py` module (Groq, OpenAI-compatible).
> Swapping models/providers touches only `llm.py` + `config.py`. Check what models your
> key can use with `client.models.list()`.

---

## Knowledge Graph Schema

### Nodes

| Node | Purpose | Key properties |
|---|---|---|
| `Company` | tenant / workspace | `id`, `name` |
| `Document` | one policy/SOP/wiki/FAQ | `id`, `title`, `source`, `url`, `text`, `version`, `updated_at`, `owner`, `verified_at`, `audience`, `effective_from/to`, `authority`, `canonical`, `cited_count` |
| `DocumentVersion` | archived prior version (history/diff) | `id`, `doc_id`, `version`, `text`, `effective_from/to` |
| `Fact` | atomic answerable statement | `id`, `statement`, `embedding` |
| `Topic` | department / theme | `id`, `name` |
| `User` | account + access | `username`, `role` (admin/editor/member), `groups`, salted `pw_hash` |
| `Answer` | a generated answer pinned to its knowledge state | `question`, `answer`, `cited_docs`, `cited_versions`, `created_at` |
| `EmployeeQuestion` | worker questions (gap-finding) | `id`, `text`, `asked_count`, `unanswered_count`, `coverage`, `topic`, `embedding` |
| `GlossaryTerm` · `Feedback` · `Escalation` · `Ticket` | jargon, thumbs, HR inbox, dispatched actions | — |

### Edges

```
Company  --OWNS-->        Document          Document --HAS_VERSION--> DocumentVersion
Document --STATES-->      Fact              Company  --GENERATED-->   Answer
Document --ABOUT-->       Topic             Company  --DEFINES-->     GlossaryTerm
Company  --ASKED-->       EmployeeQuestion  Topic    --CONNECTED_TO-> Topic
```

---

## MCP Tools (the interface)

| Tool | Signature | Description |
|---|---|---|
| `ingest_documents` | `(company_id, source)` | ingest a `.csv/.json/.txt/.md/.pdf/.docx` file; re-ingest to update |
| `ingest_google_drive` | `(company_id, folder)` | ingest a shared Drive folder (service-account auth) |
| `ask_company` | `(company_id, question)` | **flagship**: cited answer from the company's docs |
| `search_knowledge` | `(company_id, query, top_k)` | semantic search over facts |
| `stale_documents` | `(company_id, stale_after_days)` | docs overdue for review |
| `find_conflicts` | `(company_id)` | **graph-native**: facts that conflict or duplicate across docs |
| `search_all` | `(company_id, query)` | universal search — knowledge · documents · projects · decisions · people-to-ask · glossary |
| `generate_deliverable` | `(company_id, kind, goal, project_id?)` | grounded, cited draft: brief · faq · sop · report · memo · reply · agenda |
| `analyze_meeting` | `(company_id, transcript)` | decisions · action items · open questions · recap email · **policy check** |
| `check_document_policy` | `(company_id, text)` | flag a pasted document's terms that conflict with company policy |
| `list_projects` · `ask_project` | `(company_id[, project_id, question])` | project memory — list, and answer from a project's decisions/notes |
| `attention_digest` | `(company_id)` | Autopilot — ranked findings that need attention |

> MCP callers carry no user identity, so they see **public** documents only (same ACL as an anonymous web user).

### Intelligence features (the graph moat)

- **Conversational Ask** — streaming answers, follow-up memory, clickable `[n]` citations, thumbs feedback.
- **Conflict & duplicate detection** — reasons *across* documents to flag contradictory facts (e.g. "20 PTO days" in one doc vs "25" in another) and redundant content. Flat vector RAG can't do this.
- **Knowledge gaps → auto-draft** — logs questions the docs can't answer, then the LLM drafts the missing doc for review; publish it and the gap closes.
- **ROI analytics** — deflection rate, estimated time saved, most-cited and never-cited ("dead weight") documents.
- **Glossary** — company acronyms/jargon expanded into every query before retrieval.
- **Trust engine** — conflict alerts *at upload time*, document ownership + verification with an "Unverified" badge on answers, and "% of questions by topic" for leadership.
- **Escalate → learn** — when Lore can't answer, forward to an HR inbox; their reply is ingested so the next person gets it automatically.
- **Onboarding playbooks** — a role generates a KB-grounded 14-day checklist plus quizzes graded against your real policies.
- **Actionable workflows** — answers become actions ("file the IT request?") that dispatch a ticket (simulated; drop-in real Jira/Zendesk/Slack).
- **Provenance** — click a cited fact to open the source document with the exact sentence highlighted.
- **Auth + permission-aware answers** — users belong to groups; every `Document` has an `audience`. Answers, search, and the library are filtered so people only ever see (and get cited) what their groups permit; anonymous callers see public docs only. Passwords are salted PBKDF2; sessions are stateless HMAC tokens. *Demo users (seeded): `hr_admin`/`hr` (sees restricted HR docs), `alice`/`alice` (engineering), `sam`/`sam` (public only) — sign in and ask "What do Level 5 engineers earn?" to see access scoping in action.*

The HTTP API (`lore/api.py`) mirrors these and more — `/ask` · `/search/all` ·
`/deliverables/*` · `/meetings/analyze` · `/docint/*` · `/projects/*` · `/knowledge/check` ·
`/documents/simulate` · `/autopilot` · `/alerts` · `/me/briefing` · `/workspace/home` (docs at `/docs`).

---

## Document ingestion

The core pipeline is **source-agnostic**; each source is a thin **adapter** that yields
normalized `Document` records. Add a source = add one adapter, no pipeline changes.

| Source | Format | Status |
|---|---|---|
| **File upload** | `.csv` / `.json` (row-per-doc), `.txt` / `.md` (whole file) | **working** |
| **File upload** | `.pdf` / `.docx` (whole file) | **working** — needs `pip install -e '.[files]'` |
| **Google Drive** | a shared folder (Docs, PDF, DOCX, text) | **working** — needs `.[drive]` + a service account |
| Internal database | support tickets, catalog, HR system | later |

#### Google Drive setup

Uses a **service account** (server-to-server, no interactive OAuth):

1. In Google Cloud, create a service account, **enable the Drive API**, and download its JSON key.
2. Tell Lore where the key is (either one):
   - `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json`, or
   - `GOOGLE_SERVICE_ACCOUNT_JSON='{...}'` (the whole key inline — handy for Docker/.env).
3. **Share the Drive folder** with the service account's email (`...@...iam.gserviceaccount.com`), Viewer is enough.
4. Ingest it:
   ```bash
   python -m lore.ingestion.pipeline --company acme --drive "https://drive.google.com/drive/folders/<id>"
   # or in the web app: Add documents → Google Drive → paste the folder link
   ```
   Google Docs export as text; PDFs/DOCX/text files are downloaded and parsed. Re-run to re-sync.

**CSV/JSON columns** (tolerant of variants): `id`, `title`, `text`, `url`, `updated_at`,
plus `topic` hints. Each row becomes one `Document`.

**Pipeline:** fetch (adapter) → chunk long docs → extract `Fact`s + `Topic`s (Groq) →
embed + dedupe → write `Company/Document/Fact/Topic` nodes and edges into Kùzu.
Re-ingesting the same `Document` id bumps its `version`, refreshes `text`/`updated_at`,
and **replaces its facts** — so updates land immediately.

---

## Quickstart

```bash
# 1. install (uv or pip both work)
pip install -e .

# 2. add your Groq key
#    edit .env  →  GROQ_API_KEY=...   (and pick models your key can use)

# 3. run the pure-logic tests (no API key / network needed)
pytest -q

# 4. ingest the sample company handbook (10 docs) into the graph
python -m lore.ingestion.pipeline --company acme --source sample_data/acme_handbook.csv

# 5. try the flagship from the MCP server, or hit the API (below)
python -m lore.mcp_server        # or: lore-mcp
```

### Run with Docker (whole stack)

Both services are containerized. The embedding model is baked into the API image (no
runtime download), the graph persists in a named volume, and the sample company seeds on
first boot.

```bash
# 1. put your Groq key in .env at the repo root:
#    GROQ_API_KEY=gsk_...

# 2. build + run both containers
docker compose up --build

# 3. open the app
#    web  → http://localhost:3000
#    API  → http://localhost:8000  (docs at /docs)
```

- **Secrets**: `.env` is git- and docker-ignored; `docker-compose.yml` passes
  `GROQ_API_KEY` into the API container at runtime (never baked into an image).
- **Persistence**: the Kùzu graph lives in the `lore-data` volume — survives restarts.
  Reset it with `docker compose down -v`.
- **Seeding**: first boot ingests the `acme` sample company. Turn it off with
  `LORE_SEED_SAMPLE=0` in `.env`.
- **API URL**: the browser calls the API at `http://localhost:8000` (baked at web-build
  time via `NEXT_PUBLIC_API_URL`); override that build arg if you deploy elsewhere.

### Running the web app locally (frontend + API)

```bash
# Terminal 1 — backend API
uvicorn lore.api:app --reload --port 8000

# Terminal 2 — Next.js frontend
cd frontend
npm install         # first time only
npm run dev         # http://localhost:3000
```

**Pages:** `/` (start-my-day briefing) · `/workspace` (outcome dashboard — deliverables,
meeting & document intelligence, recent work) · `/ask` · `/search` · `/projects` · `/library`
(documents) · `/onboarding` · editors: `/gaps` · `/health` · `/autopilot` · `/connect` · admin: `/admin`.

### See the freshness loop

```bash
# ask before: "20 days, after 90 days"
# then re-ingest the updated policy:
python -m lore.ingestion.pipeline --company acme --source sample_data/acme_pto_update.csv
# ask again: "25 days" — and the cited source is now version 2.
```

---

## Roadmap

- [x] **Phase 1 — Core**: Company/Document/Fact/Topic graph, document ingestion, cited answers
- [x] **Phase 2 — Freshness**: version-on-reingest, stale-doc review
- [x] **Phase 3 — Web app**: Next.js Ask / Add-documents / Review pages over FastAPI
- [x] **Phase 4 — More sources**: PDF/DOCX parsing ✅ · Google Drive connector ✅ · database connector
- [x] **Phase 5 — Intelligence**: knowledge gaps + auto-draft ✅ · conflict/duplicate detection ✅ · ROI analytics ✅ · glossary ✅
- [x] **Phase 6 — Trust & workflow**: conflict-at-upload ✅ · ownership/verification ✅ · escalate→learn ✅ · onboarding playbooks ✅ · actionable workflows ✅ · provenance highlighting ✅
- [x] **Phase 7 — Ops**: auth + group permissions ✅ · RBAC (admin/editor/member) ✅ · role-based dashboards ✅ · per-thread DB connections ✅
- [x] **Phase 8 — Knowledge Change Management (Lore 2.0)**: RAG eval harness + regression gate ✅ · version history + diff ✅ · knowledge impact analysis ✅ · Knowledge Check (impact + conflict + governed eval → verdict) ✅ · historical answer invalidation + re-answer ✅ · canonical source / authority ✅ · challenge-this-answer ✅ · gap → draft → publish → verify ✅ · proactive alerts ✅ · policy ambiguity detection ✅
- [x] **Phase 9 — Employee workspace (layer 1)**: start-my-day briefing ✅ · universal search incl. people-to-ask ✅ · meeting intelligence + policy check ✅ · one-click work products ✅ · project memory ✅ · document intelligence + policy check ✅ · Autopilot ✅ · Deliverables (grounded, cited finished work; Word/.md export) ✅ · outcome-dashboard Workspace with pop-up tools ✅
- [ ] **Next**: eval gate for the AI work features · stateful work items (assign / approve / complete) · richer projects (people, linked docs) · one integration (Jira / Linear / Slack)
- [ ] **Later**: SSO · Slack bot · expert/people graph · scheduled re-sync · database connector

---

## Project layout

```
lore/
├── mcp_server.py           # FastMCP entrypoint — registers all tools (incl. workspace)
├── api.py                  # FastAPI HTTP layer for the web app
├── config.py · models.py · llm.py (single Groq call site) · auth.py (PBKDF2, HMAC tokens, ACL)
├── eval.py                 # RAG eval harness + regression gate (evidence before complexity)
├── seed.py                 # first-boot sample company (Docker demo)
├── graph/
│   ├── schema.py           # Kùzu node/edge DDL (Document, Fact, Topic, Project, Deliverable, Answer…)
│   └── queries.py          # stale docs, topic coverage
├── ingestion/              # pipeline.py (chunk → extract → embed → link → version snapshot),
│                           # chunk.py, extract.py, embed.py, adapters/ (files, Google Drive)
├── retrieval/              # answer.py (ACL · temporal · authority/canonical re-rank · cite),
│                           # deep_search.py, hybrid.py · temporal.py · verify.py (built, measured, OFF)
│
│   # knowledge layer (trust)
├── health.py               # conflict/duplicate detection + resolution recommendation
├── knowledge.py            # impact · history/diff · Knowledge Check · ambiguity · gap→publish
├── provenance.py           # answers pinned to a knowledge state; stale-answer invalidation
├── challenge.py            # adversarial "challenge this answer"
├── simulate.py             # policy simulation (dry-run a change) + apply
│   # ops layer
├── analytics.py · alerts.py · autopilot.py · glossary.py · escalations.py · feedback.py · actions.py
│   # employee workspace layer
├── workspace.py            # outcome dashboard (active work · signals · recent work)
├── deliverables.py         # grounded, cited finished work products
├── meetings.py             # meeting intelligence + policy check
├── docintel.py             # document analyze / compare / policy check
├── projects.py             # project memory + ask-this-project
├── briefing.py · search.py · compose.py · onboarding.py
```
```
frontend/  — Next.js 16 app: app/workspace (dashboard + pop-up tools), app/ask, app/search,
             app/projects, app/library, app/gaps, app/health, app/autopilot, app/connect,
             app/admin, app/onboarding, app/welcome, app/login; shared components/ (AnswerText,
             WorkspaceDashboard, DeliverableStudio, MeetingIntelligence, DocIntelligence, Modal…)
sample_data/ — acme_handbook.csv (10 policy docs) · acme_pto_update.csv (PTO 20→25) ·
               acme_faq.csv (legacy, conflicts on purpose) · parental leave PDF · BYOD DOCX
```
```
tests/test_smoke.py      — pure-logic tests (adapter, chunker, embedding, auth, temporal, provenance)
tests/test_workspace.py  — DB-level tests on a temp graph (projects, deliverables, workspace home,
                           briefing, search) — no Groq
```
