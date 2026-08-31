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
| `Document` | one policy/SOP/wiki/FAQ | `id`, `title`, `source`, `url`, `text`, `version`, `updated_at` |
| `Fact` | atomic answerable statement | `id`, `statement`, `embedding` |
| `Topic` | department / theme | `id`, `name` |
| `EmployeeQuestion` | worker questions (gap-finding, later) | `id`, `text`, `asked_count`, `embedding` |

### Edges

```
Company  --OWNS-->        Document
Document --STATES-->      Fact
Document --ABOUT-->       Topic
Company  --ASKED-->       EmployeeQuestion
Topic    --CONNECTED_TO-> Topic
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

The HTTP API mirrors these: `POST /ingest`, `POST /ask`, `GET /search`, `GET /stale`,
`GET /topics`.

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

**Pages:** `/ask` (flagship — ask a question, get a cited answer) · `/connect` (add
documents) · `/stale` (review docs overdue for update).

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
- [ ] **Phase 7 — Ops**: SSO/auth, per-team permissions, Slack bot, expert/people graph, real Jira/Slack action connectors, scheduled re-sync

---

## Project layout

```
lore/
├── mcp_server.py           # FastMCP entrypoint — registers all tools
├── api.py                  # FastAPI HTTP layer for the web app
├── config.py               # models, paths, retrieval knobs
├── models.py               # Company / Document / Fact / Topic
├── llm.py                  # single Groq call site
├── graph/
│   ├── schema.py           # Kùzu node/edge DDL
│   └── queries.py          # stale docs, topic coverage
├── ingestion/
│   ├── pipeline.py         # fetch → chunk → extract → embed → link
│   ├── chunk.py            # paragraph-aware chunker
│   ├── extract.py          # Groq fact/topic extraction (JSON mode)
│   ├── embed.py            # fastembed embeddings + dedupe
│   └── adapters/
│       └── documents.py    # csv/json/txt/md upload adapter
└── retrieval/
    ├── answer.py           # retrieve-then-synthesize, with citations
    ├── deep_search.py      # semantic fact search
    └── nl_query.py         # NL entry point
```
```
frontend/  — Next.js app (app/ask, app/connect, app/stale)
sample_data/acme_handbook.csv     — 10 sample policy docs
sample_data/acme_pto_update.csv   — an updated PTO policy (demo the freshness loop)
```
```
tests/test_smoke.py — pure-logic tests (adapter, chunker, embedding), no network
```
