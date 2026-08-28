// Typed client for the Lore FastAPI backend.
// Pages are Client Components, so calls run in the browser against the API directly.

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

export type Confidence = "high" | "medium" | "low" | "none";

export interface Source {
  n: number;
  doc_id: string;
  title: string;
  url: string | null;
  updated_at: string | null;
  version: number;
  facts: string[];
}

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

export interface IngestSummary {
  company_id: string;
  documents_ingested: number;
  facts_extracted: number;
}

export interface DocSummary {
  doc_id: string;
  title: string;
  source: string;
  url: string | null;
  version: number;
  updated_at: string | null;
  facts: number;
  topics: string[];
}

export interface DocDetail extends Omit<DocSummary, "facts"> {
  text: string;
  facts: string[];
}

export interface Gap {
  question: string;
  asked_count: number;
  unanswered_count: number;
  coverage: number;
  last_asked: string | null;
}

export interface TopicCoverage {
  topic: string;
  documents: number;
}

export interface StaleDoc {
  doc_id: string;
  title: string;
  url: string | null;
  version: number;
  updated_at: string | null;
}

export interface Overview {
  documents: number;
  facts: number;
  topics: number;
  questions_asked: number;
  stale_count: number;
  gaps_count: number;
  top_topics: TopicCoverage[];
  top_questions: Gap[];
  top_gaps: Gap[];
  stale_docs: StaleDoc[];
  feedback: { up: number; down: number };
}

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

const qs = (o: Record<string, string | number>) =>
  new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString();

export async function ingest(companyId: string, file: File): Promise<IngestSummary> {
  const form = new FormData();
  form.append("company_id", companyId);
  form.append("file", file);
  return j(await fetch(`${BASE}/ingest`, { method: "POST", body: form }));
}

export async function ingestDrive(companyId: string, folder: string): Promise<IngestSummary> {
  return j(
    await fetch(`${BASE}/ingest-drive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: companyId, folder }),
    }),
  );
}

export async function getOverview(companyId: string): Promise<Overview> {
  return j(await fetch(`${BASE}/overview?${qs({ company_id: companyId })}`));
}

export async function getGaps(companyId: string): Promise<Gap[]> {
  return j(await fetch(`${BASE}/gaps?${qs({ company_id: companyId })}`));
}

export async function getDocuments(companyId: string): Promise<DocSummary[]> {
  return j(await fetch(`${BASE}/documents?${qs({ company_id: companyId })}`));
}

export async function getDocument(companyId: string, docId: string): Promise<DocDetail> {
  return j(await fetch(`${BASE}/documents/${docId}?${qs({ company_id: companyId })}`));
}

export async function sendFeedback(
  companyId: string,
  question: string,
  answer: string,
  rating: "up" | "down",
): Promise<void> {
  await fetch(`${BASE}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company_id: companyId, question, answer, rating }),
  });
}

// --- streaming Ask ---
export interface StreamHandlers {
  onSources: (sources: Source[], confidence: Confidence) => void;
  onToken: (t: string) => void;
  onDone: (citedSources: Source[]) => void;
  onError: (message: string) => void;
}

export async function askStream(
  companyId: string,
  question: string,
  history: Turn[],
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const res = await fetch(`${BASE}/ask/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: companyId, question, history }),
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const evt = JSON.parse(line);
        if (evt.type === "sources") handlers.onSources(evt.sources, evt.confidence);
        else if (evt.type === "token") handlers.onToken(evt.t);
        else if (evt.type === "done") handlers.onDone(evt.sources);
      }
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    handlers.onError(err instanceof Error ? err.message : "stream failed");
  }
}
