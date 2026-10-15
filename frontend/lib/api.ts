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
export interface Simulation {
  doc_id: string; title: string;
  verdict: "clean" | "conflicts" | "regressions";
  diff: string; proposed_facts: number;
  impact: number;
  impact_detail: { facts: number; related_docs: number; affected_questions: number };
  eval: { question: string; pass: boolean; answer: string; expected: string; cause?: string }[];
  regressions: number; eval_total: number;
  conflicts: ConflictPair[]; conflict_count: number;
}
export async function simulateChange(companyId: string, docId: string, proposedText: string): Promise<Simulation> {
  return j(await fetch(`${BASE}/documents/simulate`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ company_id: companyId, doc_id: docId, proposed_text: proposedText }),
  }));
}
export async function applyChange(companyId: string, docId: string, proposedText: string): Promise<{ doc_id: string; facts_extracted: number }> {
  return j(await fetch(`${BASE}/documents/apply`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ company_id: companyId, doc_id: docId, proposed_text: proposedText }),
  }));
}

export async function knowledgeCheck(companyId: string, docId: string): Promise<KnowledgeCheck> {
  return j(await fetch(`${BASE}/knowledge/check`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ company_id: companyId, doc_id: docId }),
  }));
}

export interface AutopilotItem {
  severity: AlertSeverity; kind: string; title: string; detail: string; href: string;
  action?: { type: string; doc_id: string; title: string };
}
export interface Autopilot {
  headline: string; count: number; items: AutopilotItem[]; counts: Record<AlertSeverity, number>;
}
export async function getAutopilot(companyId: string): Promise<Autopilot> {
  return j(await fetch(`${BASE}/autopilot?${qs({ company_id: companyId })}`, { headers: authHeader() }));
}

export interface Deliverable {
  id: string; kind: string; title: string; content: string;
  sources: Source[]; grounded: boolean; needs_review: boolean; project_id: string | null;
}
export interface DeliverableSummary {
  id: string; kind: string; title: string; source_count: number; status: string;
  created_by: string; project_id: string | null; created_at: string | null;
}
export interface DeliverableDetail {
  id: string; kind: string; title: string; goal: string; content: string;
  source_titles: string[]; status: string; created_at: string | null;
}
export async function generateDeliverable(companyId: string, kind: string, goal: string, projectId?: string | null): Promise<Deliverable> {
  return j(await fetch(`${BASE}/deliverables/generate`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ company_id: companyId, kind, goal, project_id: projectId ?? null }),
  }));
}
export async function listDeliverables(companyId: string): Promise<DeliverableSummary[]> {
  return j(await fetch(`${BASE}/deliverables?${qs({ company_id: companyId })}`, { headers: authHeader() }));
}
export async function getDeliverable(companyId: string, id: string): Promise<DeliverableDetail> {
  return j(await fetch(`${BASE}/deliverables/${encodeURIComponent(id)}?${qs({ company_id: companyId })}`, { headers: authHeader() }));
}

export interface Briefing {
  name: string; role: string;
  recent_changes: { doc_id: string; title: string; version: number; updated_at: string | null; changed: boolean }[];
  open_questions: { title: string; project_id: string; project: string }[];
  projects: { id: string; name: string; open_questions: number; created_at: string | null }[];
  ops?: { gaps: number; stale: number };
}
export async function getBriefing(companyId: string): Promise<Briefing> {
  return j(await fetch(`${BASE}/me/briefing?${qs({ company_id: companyId })}`, { headers: authHeader() }));
}

export interface UniversalSearch {
  query: string; total: number;
  knowledge: { statement: string; doc_id: string; title: string }[];
  documents: { doc_id: string; title: string; owner: string | null }[];
  projects: { id: string; name: string; description: string }[];
  decisions: { title: string; project_id: string; project: string }[];
  questions: { title: string; project_id: string; project: string }[];
  actions: { title: string; project_id: string; project: string }[];
  people: { name: string; about: string }[];
  glossary: { term: string; definition: string }[];
}
export async function searchAll(companyId: string, query: string): Promise<UniversalSearch> {
  return j(await fetch(`${BASE}/search/all?${qs({ company_id: companyId, query })}`, { headers: authHeader() }));
}

export interface ProjectSummary { id: string; name: string; description: string; created_at: string | null; entries: number }
export interface ProjectEntry { id: string; kind: string; title: string; body: string; owner: string; due: string; created_at: string | null }
export interface Project {
  id: string; name: string; description: string; created_at: string | null;
  entries: ProjectEntry[]; counts: Record<string, number>;
}
export interface ProjectAnswer { project_id: string; question: string; answer: string; sources: Source[] }

export async function listProjects(companyId: string): Promise<ProjectSummary[]> {
  return j(await fetch(`${BASE}/projects?${qs({ company_id: companyId })}`, { headers: authHeader() }));
}
export async function createProject(companyId: string, name: string, description = ""): Promise<{ id: string; name: string }> {
  return j(await fetch(`${BASE}/projects`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ company_id: companyId, name, description }),
  }));
}
export async function getProject(companyId: string, projectId: string): Promise<Project> {
  return j(await fetch(`${BASE}/projects/${encodeURIComponent(projectId)}?${qs({ company_id: companyId })}`, { headers: authHeader() }));
}
export async function addProjectEntries(companyId: string, projectId: string, entries: Partial<ProjectEntry>[]): Promise<{ added: number }> {
  return j(await fetch(`${BASE}/projects/${encodeURIComponent(projectId)}/entries`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ company_id: companyId, entries }),
  }));
}
export async function askProject(companyId: string, projectId: string, question: string): Promise<ProjectAnswer> {
  return j(await fetch(`${BASE}/projects/${encodeURIComponent(projectId)}/ask`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ company_id: companyId, question }),
  }));
}

export interface DocIntel { mode: string; label: string; content: string }
export async function analyzeDocument(companyId: string, text: string, mode: string): Promise<DocIntel> {
  return j(await fetch(`${BASE}/docint/analyze`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ company_id: companyId, text, mode }),
  }));
}
export interface DocPolicyCheck {
  conflicts: { term: string; issue: string; source: string }[];
  checked_against: string[]; terms_checked: number;
}
export async function checkDocPolicies(companyId: string, text: string): Promise<DocPolicyCheck> {
  return j(await fetch(`${BASE}/docint/policy`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ company_id: companyId, text }),
  }));
}

export interface DocCompare {
  added: string[]; removed: string[]; changed: { was: string; now: string }[];
  contradictions: string[]; review: string[];
}
export async function compareDocuments(companyId: string, textA: string, textB: string): Promise<DocCompare> {
  return j(await fetch(`${BASE}/docint/compare`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ company_id: companyId, text_a: textA, text_b: textB }),
  }));
}

export interface Composed { format: string; label: string; content: string }
export async function composeAnswer(companyId: string, question: string, answer: string, format: string): Promise<Composed> {
  return j(await fetch(`${BASE}/compose`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ company_id: companyId, question, answer, format }),
  }));
}

export interface MeetingAnalysis {
  summary: string;
  decisions: string[];
  action_items: { task: string; owner: string; due: string }[];
  open_questions: string[];
  follow_up_email: string;
  policy_conflicts: { decision: string; issue: string; source: string }[];
  checked_against: string[];
}
export async function analyzeMeeting(companyId: string, transcript: string): Promise<MeetingAnalysis> {
  return j(await fetch(`${BASE}/meetings/analyze`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ company_id: companyId, transcript }),
  }));
}

export type AlertSeverity = "critical" | "review" | "gap" | "info";
export interface KnowledgeAlert {
  severity: AlertSeverity; kind: string; title: string; detail: string; href: string;
}
export interface Alerts {
  alerts: KnowledgeAlert[];
  counts: Record<AlertSeverity, number>;
  total: number;
}
export async function getAlerts(companyId: string): Promise<Alerts> {
  return j(await fetch(`${BASE}/alerts?${qs({ company_id: companyId })}`, { headers: authHeader() }));
}

export interface Challenge {
  question: string; answer: string;
  verdict: "survives" | "contested" | "unchallenged" | "no_answer";
  defender: { doc_id: string; title: string; authority?: number; canonical: boolean; verified: boolean } | null;
  challenges: {
    statement: string; title: string; doc_id: string; why: string;
    resolution: string; beaten: boolean; superseded: boolean; authority: number; verified: boolean;
  }[];
}
export async function challengeAnswer(companyId: string, question: string): Promise<Challenge> {
  return j(await fetch(`${BASE}/answers/challenge`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ company_id: companyId, question }),
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

export interface Ambiguities {
  doc_id: string; title: string; probed: number; covered_count: number;
  ambiguities: {
    question: string; type: string;
    status: "unresolved" | "answered_elsewhere"; answered_by: string[] | null;
  }[];
}
export async function detectAmbiguities(companyId: string, docId: string): Promise<Ambiguities> {
  return j(await fetch(`${BASE}/documents/ambiguities`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ company_id: companyId, doc_id: docId }),
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
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ company_id: companyId, question }),
    }),
  );
}

export interface GapPublish {
  doc_id: string | null; title: string; closed: boolean;
  answer: string; sources: Source[]; confidence: Confidence;
  verified_questions: string[]; facts_extracted: number; remaining_gaps: number;
}
export async function publishFromGap(companyId: string, question: string, title: string, text: string): Promise<GapPublish> {
  return j(await fetch(`${BASE}/gaps/publish`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ company_id: companyId, question, title, text }),
  }));
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
