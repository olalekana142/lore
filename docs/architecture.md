# Lore — System Architecture

> Renders automatically on GitHub. An editable **draw.io** version is in
> [`lore-architecture.drawio`](./lore-architecture.drawio) — open it at
> [app.diagrams.net](https://app.diagrams.net) or with the VS Code "Draw.io Integration" extension.

```mermaid
flowchart TB
    %% ===== Actors =====
    subgraph USERS["👥 Users & Agents"]
        direction LR
        EMP["Employee<br/>(member)"]
        ED["HR / Curator<br/>(editor)"]
        ADM["Admin"]
        GST["Guest"]
        AG["Agent / Bot<br/>(Claude Code…)"]
    end

    %% ===== Frontend =====
    subgraph FE["🖥️ Frontend — Next.js 16 (role-based UI, dark/light)"]
        direction LR
        FE1["Landing & Login"]
        FE2["Dashboard<br/>(Member / Ops / Admin)"]
        FE3["Ask — chat + streaming"]
        FE4["Documents / Library"]
        FE5["Gaps · Health · Onboarding"]
        FE6["Add Docs · Admin"]
    end

    %% ===== API =====
    subgraph API["⚙️ HTTP API — FastAPI (Bearer JWT · RBAC guard · per-thread Kùzu conns)"]
        direction LR
        AP1["/auth · /admin/users"]
        AP2["/ask · /ask/stream"]
        AP3["/ingest* · /documents · /home · /overview"]
        AP4["/gaps · /escalations · /actions · /onboarding · /glossary · /content-health"]
    end
    MCP["🔌 MCP Server (FastMCP)<br/>ask · ingest · search · find_conflicts"]

    %% ===== Core =====
    subgraph CORE["🧠 Core services — lore/"]
        direction LR
        CO1["auth.py<br/>PBKDF2 · tokens · roles · can_see()"]
        CO2["retrieval/answer<br/>permission filter · glossary · cite"]
        CO3["ingestion/pipeline<br/>chunk→extract→embed→dedupe→link"]
        CO4["health<br/>conflict & duplicate"]
        CO5["analytics<br/>ROI · gaps · home · citations"]
        CO6["onboarding · actions · escalations · feedback · glossary"]
    end

    %% ===== Data / AI / Sources =====
    subgraph KUZU["🗄️ Knowledge Graph — Kùzu (embedded)"]
        direction LR
        K1["Company"]
        K2["Document<br/>{audience, version, verified}"]
        K3["Fact {embedding}"]
        K4["Topic"]
        K5["User {role, groups}"]
        K6["EmployeeQuestion · GlossaryTerm<br/>Feedback · Escalation · Ticket"]
    end
    subgraph AI["🤖 LLM & Embeddings"]
        direction LR
        AI1["Groq API<br/>gpt-oss-20b extract · gpt-oss-120b answers/stream"]
        AI2["fastembed (local)<br/>bge-small-en-v1.5"]
    end
    subgraph SRC["📥 Ingestion sources"]
        direction LR
        S1["File upload<br/>CSV·JSON·TXT·MD·PDF·DOCX"]
        S2["Google Drive<br/>(service account)"]
        S3["Paste text · gap drafts · escalation answers"]
    end

    %% ===== Flows =====
    USERS -->|browser| FE
    AG -.->|MCP tools| MCP
    FE -->|"HTTPS + Bearer JWT"| API
    API --> CORE
    MCP -.-> CORE
    CORE -->|Cypher read/write| KUZU
    CORE -->|extract · answer · embed| AI
    CO3 -->|fetch + normalize| SRC

    classDef u fill:#dae8fc,stroke:#6c8ebf;
    classDef f fill:#d5e8d4,stroke:#82b366;
    classDef a fill:#ffe6cc,stroke:#d79b00;
    classDef c fill:#fff2cc,stroke:#d6b656;
    classDef k fill:#f8cecc,stroke:#b85450;
    classDef ai fill:#e1d5e7,stroke:#9673a6;
    class EMP,ED,ADM,GST,AG u;
    class FE1,FE2,FE3,FE4,FE5,FE6 f;
    class AP1,AP2,AP3,AP4,MCP a;
    class CO1,CO2,CO3,CO4,CO5,CO6 c;
    class K1,K2,K3,K4,K5,K6 k;
    class AI1,AI2 ai;
    class S1,S2,S3 f;
```

## Deployment

Docker Compose → **api** (uvicorn, embedding model baked into the image) + **web** (Next.js standalone), a persistent named volume for the Kùzu graph, and `GROQ_API_KEY` injected at runtime from `.env`.

## Request flow (an answer)

1. Browser sends the question with a **Bearer token** → API resolves **identity (company, groups, role)**.
2. `retrieve()` embeds the (glossary-expanded) query, scores every **Fact** by cosine, and **drops facts the caller's groups can't see**.
3. Top facts + their source **Documents** go to Groq (`gpt-oss-120b`) which **synthesizes an answer and cites `[n]`**.
4. The response streams back; the question is **logged** (topic, answered?), and cited docs get a **citation bump**.
