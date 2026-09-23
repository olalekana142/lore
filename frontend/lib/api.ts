// Typed client for the Lore FastAPI backend.
// Pages are Client Components, so calls run in the browser against the API directly.

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

// --- session token (permission-aware requests) ---
export function getToken(): string | null {
  try {
    return localStorage.getItem("lore.token");
  } catch {
    return null;
  }
}
function authHeader(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export type Confidence = "high" | "medium" | "low" | "none";

export interface Source {
  n: number;
  doc_id: string;
  title: string;
  url: string | null;
  updated_at: string | null;
  version: number;
  owner: string | null;
  verified: boolean;
  current: boolean;
  authority: number;
  canonical?: boolean;
  effective_from: string | null;
  effective_to: string | null;
  facts: string[];
}

export interface ConflictPair {
  a: { statement: string; doc_id: string; title: string };
  b: { statement: string; doc_id: string; title: string };
  similarity: number;
  reason: string;
}

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

export interface IngestSummary {
  company_id: string;
  documents_ingested: number;
  facts_extracted: number;
  doc_ids?: string[];
  conflicts?: ConflictPair[];
}

export interface DocSummary {
  doc_id: string;
  title: string;
  source: string;
  url: string | null;
  version: number;
  updated_at: string | null;
  owner: string | null;
  verified: boolean;
  verified_at: string | null;
  audience: string[];
  facts: number;
  topics: string[];
}

export interface DocDetail extends Omit<DocSummary, "facts"> {
  text: string;
  facts: string[];
  canonical?: boolean;
  authority?: number;
}

export async function setCanonical(companyId: string, docId: string, canonical: boolean): Promise<void> {
  await fetch(`${BASE}/documents/canonical`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ company_id: companyId, doc_id: docId, canonical }),
  });
}

export interface Escalation {
  id: string;
  company_id: string;
  question: string;
  asked_by: string;
  status: string;
  answer: string;
  created_at: string;
  resolved_at: string | null;
}

export interface TopicShare {
  topic: string;
  count: number;
  pct: number;
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

export interface Roi {
  asked: number;
  answered: number;
  unanswered: number;
  deflection_rate: number;
  minutes_saved: number;
}

export interface CitedDoc {
  doc_id: string;
  title: string;
  cited_count: number;
}

export interface Overview {
  documents: number;
  facts: number;
  topics: number;
  questions_asked: number;
  stale_count: number;
  gaps_count: number;
  never_cited_count: number;
  roi: Roi;
  top_topics: TopicCoverage[];
  top_questions: Gap[];
  top_gaps: Gap[];
  stale_docs: StaleDoc[];
  most_cited: CitedDoc[];
  questions_by_topic: TopicShare[];
  feedback: { up: number; down: number };
}

export interface FactRef {
  statement: string;
  doc_id: string;
  title: string;
  updated_at?: string | null;
  authority?: number;
  verified?: boolean;
  superseded?: boolean;
}
export interface Recommend {
  winner_doc: string;
  loser_doc: string;
  reason: string;
}
export interface HealthPair {
  a: FactRef;
  b: FactRef;
  similarity: number;
  reason: string;
  recommend?: Recommend;
}
export interface ContentHealth {
  conflicts: HealthPair[];
  duplicates: HealthPair[];
  never_cited: { doc_id: string; title: string; updated_at: string | null }[];
  stale: StaleDoc[];
}
export interface GlossaryTerm {
  term: string;
  definition: string;
}
export interface Draft {
  title: string;
  text: string;
  question: string;
}

export interface ChecklistItem {
  day: number;
  task: string;
  why: string;
  topic: string;
}
export interface Playbook {
  role: string;
  name: string;
  checklist: ChecklistItem[];
  quiz: { question: string }[];
}
export interface Grade {
  verdict: "correct" | "partial" | "incorrect";
  score: number;
  feedback: string;
  model_answer: string;
}

export interface ActionSuggestion {
  actionable: boolean;
  type?: string;
  label?: string;
  summary?: string;
}
export interface Ticket {
  ticket_id: string;
  destination: string;
  channel: string;
  eta: string;
  summary: string;
  simulated: boolean;
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

export interface HomeData {
  document_count: number;
  recent_docs: DocSummary[];
  popular_questions: string[];
  topics: TopicCoverage[];
}

export async function getHome(companyId: string): Promise<HomeData> {
  return j(await fetch(`${BASE}/home?${qs({ company_id: companyId })}`, { headers: authHeader() }));
}

export async function getOverview(companyId: string): Promise<Overview> {
  return j(await fetch(`${BASE}/overview?${qs({ company_id: companyId })}`, { headers: authHeader() }));
}

export async function getGaps(companyId: string): Promise<Gap[]> {
  return j(await fetch(`${BASE}/gaps?${qs({ company_id: companyId })}`));
}

export async function getContentHealth(companyId: string): Promise<ContentHealth> {
  return j(await fetch(`${BASE}/content-health?${qs({ company_id: companyId })}`, { headers: authHeader() }));
}

export interface Audit {
  documents: number;
  verified: number;
  unverified: number;
  missing_owner: number;
  restricted: number;
  superseded: number;
  stale: number;
  never_cited: number;
  gaps: number;
  scores: { freshness: number; verification: number; ownership: number; citation_coverage: number };
}

export async function getAudit(companyId: string): Promise<Audit> {
  return j(await fetch(`${BASE}/audit?${qs({ company_id: companyId })}`, { headers: authHeader() }));
}

export interface Impact {
  doc_id: string; title: string; facts: number; topics: string[];
  related_docs: string[]; affected_questions: number;
  affected_sample: { question: string; asked: number }[]; total_impact: number; prior_versions: number;
}
export interface DocVersion {
  version: number; is_current: boolean;
  effective_from: string | null; effective_to: string | null; updated_at: string | null; preview: string;
}
export interface History { doc_id: string; title: string; versions: DocVersion[]; }
export interface Diff { doc_id: string; from_version: number; to_version: number; summary: string; }
export interface GeneratedQuestions {
  doc_id: string; title: string;
  verified: { question: string; answer: string }[];
  rejected: { question: string; why: string }[];
}

export interface KnowledgeCheck {
  doc_id: string; title: string;
  verdict: "clean" | "conflicts" | "regressions";
  impact: number;
  impact_detail: { facts: number; related_docs: number; affected_questions: number; prior_versions: number };
  conflicts: ConflictPair[]; conflict_count: number;
  eval: { question: string; pass: boolean; answer: string; expected: string; cause?: string }[];
  regressions: number; eval_total: number;
  stale_answers: { id: string; question: string; created_at: string | null }[];
  stale_answer_count: number;
}
export async function knowledgeCheck(companyId: string, docId: string): Promise<KnowledgeCheck> {
  return j(await fetch(`${BASE}/knowledge/check`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ company_id: companyId, doc_id: docId }),
  }));
}

export interface Reanswer {
  id: string; question: string; old_answer: string; new_answer: string; changed: boolean;
}
export async function reanswer(companyId: string, answerId: string): Promise<Reanswer> {
  return j(await fetch(`${BASE}/answers/reanswer`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ company_id: companyId, answer_id: answerId }),
  }));
}

export async function getImpact(companyId: string, docId: string): Promise<Impact> {
  return j(await fetch(`${BASE}/impact?${qs({ company_id: companyId, doc_id: docId })}`, { headers: authHeader() }));
}
export async function getHistory(companyId: string, docId: string): Promise<History> {
  return j(await fetch(`${BASE}/history?${qs({ company_id: companyId, doc_id: docId })}`, { headers: authHeader() }));
}
export async function getDiff(companyId: string, docId: string, fromVersion: number): Promise<Diff> {
  return j(await fetch(`${BASE}/diff?${qs({ company_id: companyId, doc_id: docId, from_version: fromVersion })}`, { headers: authHeader() }));
}
export async function generateQuestions(companyId: string, docId: string): Promise<GeneratedQuestions> {
  return j(await fetch(`${BASE}/eval/generate`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ company_id: companyId, doc_id: docId }),
  }));
}

export async function supersedeDocument(companyId: string, docId: string): Promise<void> {
  await fetch(`${BASE}/documents/supersede`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ company_id: companyId, doc_id: docId }),
  });
}

// --- auth ---
export interface AuthUser {
  username: string;
  name: string;
  role: string;
  groups: string[];
}

type AuthResult = { token: string; company_id: string; user: AuthUser };

function persist(res: AuthResult) {
  try {
    localStorage.setItem("lore.token", res.token);
    localStorage.setItem("lore.user", JSON.stringify({ ...res.user, company_id: res.company_id }));
  } catch {
    /* ignore */
  }
}

export async function login(companyId: string, username: string, password: string): Promise<AuthResult> {
  const res = await j<AuthResult>(
    await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: companyId, username, password }),
    }),
  );
  persist(res);
  return res;
}

export async function register(companyId: string, username: string, password: string, name: string): Promise<AuthResult> {
  const res = await j<AuthResult>(
    await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: companyId, username, password, name }),
    }),
  );
  persist(res);
  return res;
}

export function logout(): void {
  try {
    localStorage.removeItem("lore.token");
    localStorage.removeItem("lore.user");
  } catch {
    /* ignore */
  }
}

// --- admin: user management ---
export interface ManagedUser {
  username: string;
  name: string;
  role: string;
  groups: string[];
}

export async function listUsers(companyId: string): Promise<ManagedUser[]> {
  return j(await fetch(`${BASE}/admin/users?${qs({ company_id: companyId })}`, { headers: authHeader() }));
}

export async function updateUser(companyId: string, username: string, role: string, groups: string[]): Promise<void> {
  await fetch(`${BASE}/admin/users/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ username, role, groups }),
  });
}

export async function draftGapAnswer(companyId: string, question: string): Promise<Draft> {
  return j(
    await fetch(`${BASE}/gaps/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: companyId, question }),
    }),
  );
}

export async function ingestText(companyId: string, title: string, text: string): Promise<IngestSummary> {
  return j(
    await fetch(`${BASE}/ingest-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: companyId, title, text }),
    }),
  );
}

export async function verifyDocument(companyId: string, docId: string, owner: string): Promise<void> {
  await fetch(`${BASE}/documents/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company_id: companyId, doc_id: docId, owner }),
  });
}

export async function escalate(companyId: string, question: string, askedBy = ""): Promise<Escalation> {
  return j(
    await fetch(`${BASE}/escalate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: companyId, question, asked_by: askedBy }),
    }),
  );
}

export async function getEscalations(companyId: string): Promise<Escalation[]> {
  return j(await fetch(`${BASE}/escalations?${qs({ company_id: companyId })}`));
}

export async function resolveEscalation(companyId: string, escalationId: string, answer: string): Promise<void> {
  await fetch(`${BASE}/escalations/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company_id: companyId, escalation_id: escalationId, answer }),
  });
}

export async function suggestAction(companyId: string, question: string, answer: string): Promise<ActionSuggestion> {
  return j(
    await fetch(`${BASE}/actions/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: companyId, question, answer }),
    }),
  );
}

export async function executeAction(companyId: string, type: string, summary: string): Promise<Ticket> {
  return j(
    await fetch(`${BASE}/actions/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: companyId, type, summary }),
    }),
  );
}

export async function generatePlaybook(companyId: string, role: string, name: string): Promise<Playbook> {
  return j(
    await fetch(`${BASE}/onboarding/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: companyId, role, name }),
    }),
  );
}

export async function gradeAnswer(companyId: string, question: string, answer: string): Promise<Grade> {
  return j(
    await fetch(`${BASE}/onboarding/grade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: companyId, question, answer }),
    }),
  );
}

export async function getGlossary(companyId: string): Promise<GlossaryTerm[]> {
  return j(await fetch(`${BASE}/glossary?${qs({ company_id: companyId })}`));
}

export async function addGlossaryTerm(companyId: string, term: string, definition: string): Promise<void> {
  await fetch(`${BASE}/glossary`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company_id: companyId, term, definition }),
  });
}

export async function getDocuments(companyId: string): Promise<DocSummary[]> {
  return j(await fetch(`${BASE}/documents?${qs({ company_id: companyId })}`, { headers: authHeader() }));
}

export async function getDocument(companyId: string, docId: string): Promise<DocDetail> {
  return j(await fetch(`${BASE}/documents/${docId}?${qs({ company_id: companyId })}`, { headers: authHeader() }));
}

export async function setAudience(companyId: string, docId: string, audience: string[]): Promise<void> {
  await fetch(`${BASE}/documents/audience`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ company_id: companyId, doc_id: docId, audience }),
  });
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
      headers: { "Content-Type": "application/json", ...authHeader() },
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
