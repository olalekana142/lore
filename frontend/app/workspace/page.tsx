"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { analyzeMeeting, listProjects, createProject, addProjectEntries, type MeetingAnalysis, type ProjectSummary } from "@/lib/api";
import { useCompany } from "@/lib/useCompany";
import DocIntelligence from "../components/DocIntelligence";
import DeliverableStudio from "../components/DeliverableStudio";
import WorkspaceDashboard from "../components/WorkspaceDashboard";
import AnswerText from "../components/AnswerText";
import { ErrorNote } from "../components/ui";
import { IconSparkle, IconCheck, IconGap, IconHealth, IconCopy, IconChat, IconSearch } from "../components/icons";

const SAMPLE = `Priya: Thanks everyone. First, PTO — HR confirmed full-timers now get 25 days, effective this year.
Dan: Good. For the Acme migration, we've decided to standardize on PostgreSQL. Owner is Sam, target end of Q1.
Priya: Also, new hires can start booking time off immediately now — no more 90-day wait.
Dan: One open item: can contractors expense meals above the $60 daily limit? Nobody's sure.
Priya: Let's also let the sales team approve their own travel up to $2,000 without manager sign-off.
Dan: Action: Maria to draft the updated travel guidance by Friday.`;

export default function WorkspacePage() {
  const [companyId] = useCompany();
  const router = useRouter();
  const [ask, setAsk] = useState("");
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<MeetingAnalysis | null>(null);
  const [copied, setCopied] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projSel, setProjSel] = useState("");
  const [newProj, setNewProj] = useState("");
  const [saved, setSaved] = useState(0);
  const [savingProj, setSavingProj] = useState(false);
  const [deliverableKey, setDeliverableKey] = useState(0);

  useEffect(() => { listProjects(companyId).then(setProjects).catch(() => {}); }, [companyId]);

  async function saveToProject() {
    if (!res) return;
    setSavingProj(true);
    try {
      let pid = projSel;
      if (!pid && newProj.trim()) {
        const p = await createProject(companyId, newProj.trim());
        pid = p.id;
      }
      if (!pid) return;
      const entries = [
        ...res.decisions.map((d) => ({ kind: "decision", title: d })),
        ...res.action_items.map((a) => ({ kind: "action", title: a.task, owner: a.owner, due: a.due })),
        ...res.open_questions.map((q) => ({ kind: "question", title: q })),
      ];
      const { added } = await addProjectEntries(companyId, pid, entries);
      setSaved(added);
      setProjSel(pid);
      setNewProj("");
      await listProjects(companyId).then(setProjects).catch(() => {});
    } finally {
      setSavingProj(false);
    }
  }

  async function analyze() {
    if (!transcript.trim()) return;
    setBusy(true);
    setError(null);
    setRes(null);
    setSaved(0);
    try {
      setRes(await analyzeMeeting(companyId, transcript));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to analyze");
    } finally {
      setBusy(false);
    }
  }

  function copyEmail() {
    if (!res?.follow_up_email) return;
    navigator.clipboard?.writeText(res.follow_up_email).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }

  return (
    <div className="mx-auto max-w-6xl">
      {/* Top bar */}
      <header className="animate-fade-up mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Your workspace</h1>
          <p className="mt-1 text-sm text-muted">Turn company knowledge into completed work.</p>
        </div>
        <div className="flex items-center gap-2">
          <form onSubmit={(e) => { e.preventDefault(); if (ask.trim()) router.push(`/ask?q=${encodeURIComponent(ask.trim())}`); }} className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-dim"><IconSearch size={16} /></span>
            <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Ask anything about how we work…" className="input w-72 max-w-full py-2.5 pl-9 pr-3 text-sm" />
          </form>
          <button onClick={() => document.getElementById("create")?.scrollIntoView({ behavior: "smooth" })} className="btn-primary flex shrink-0 items-center gap-1.5 px-4 py-2.5 text-sm">
            <IconSparkle size={16} /> New task
          </button>
        </div>
      </header>

      <WorkspaceDashboard companyId={companyId} refreshKey={deliverableKey} />

      <div className="mb-3 mt-9 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-dim">
        <span className="h-px flex-1 bg-border" /> Tools <span className="h-px flex-1 bg-border" />
      </div>

      <div className="mx-auto max-w-3xl space-y-4">
      <div id="create">
        <DeliverableStudio companyId={companyId} onCreated={() => setDeliverableKey((k) => k + 1)} />
      </div>

      <section id="meeting" className="animate-fade-up card p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className="text-accent"><IconSparkle size={16} /></span> Meeting intelligence
        </h2>
        <p className="mt-1 text-xs text-muted">
          Paste a meeting transcript. Lore pulls out the decisions, action items and open questions,
          drafts a recap email — and checks whether any decision conflicts with company policy.
        </p>
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          rows={8}
          placeholder="Paste your meeting transcript here…"
          className="input mt-3 w-full px-3 py-2 text-sm leading-relaxed"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button onClick={analyze} disabled={busy || !transcript.trim()} className="btn-primary px-4 py-2 text-sm">
            {busy ? "Analyzing…" : "Analyze meeting"}
          </button>
          <button onClick={() => setTranscript(SAMPLE)} className="btn-ghost px-3 py-2 text-xs">Try a sample</button>
        </div>
      </section>

      {error && <div className="mt-4"><ErrorNote message={error} /></div>}

      {res && (
        <div className="mt-4 space-y-4">
          <section className="animate-fade-up card flex flex-wrap items-center gap-2 p-4">
            <span className="text-sm font-medium">Save to a project</span>
            <select value={projSel} onChange={(e) => setProjSel(e.target.value)} className="input px-3 py-1.5 text-sm">
              <option value="">{projects.length ? "Choose a project…" : "No projects yet"}</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <span className="text-xs text-muted-dim">or</span>
            <input value={newProj} onChange={(e) => setNewProj(e.target.value)} placeholder="new project name" className="input px-3 py-1.5 text-sm" />
            <button onClick={saveToProject} disabled={savingProj || (!projSel && !newProj.trim())} className="btn-primary px-3 py-1.5 text-sm">
              {savingProj ? "Saving…" : "Save decisions & actions"}
            </button>
            {saved > 0 && <span className="text-sm font-medium" style={{ color: "var(--green)" }}>✓ Saved {saved} item{saved === 1 ? "" : "s"} to project memory</span>}
          </section>

          {res.policy_conflicts.length > 0 && (
            <section className="animate-fade-up card border-l-4 p-5" style={{ borderLeftColor: "var(--amber)" }}>
              <h3 className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--amber)" }}>
                <IconHealth size={16} /> {res.policy_conflicts.length} decision{res.policy_conflicts.length > 1 ? "s" : ""} may conflict with company policy
              </h3>
              <ul className="mt-2 space-y-2">
                {res.policy_conflicts.map((c, i) => (
                  <li key={i} className="rounded-lg bg-surface-2 p-3 text-sm">
                    <div className="font-medium">“{c.decision}”</div>
                    <div className="mt-1 text-xs text-muted-dim">{c.issue}{c.source && <> · per <b>{c.source}</b></>}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {res.summary && (
            <section className="animate-fade-up card p-5">
              <h3 className="text-sm font-semibold">Summary</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{res.summary}</p>
            </section>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <section className="animate-fade-up card p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><IconCheck size={16} /> Decisions</h3>
              {res.decisions.length ? (
                <ul className="mt-2 space-y-1.5 text-sm">
                  {res.decisions.map((d, i) => <li key={i} className="flex gap-2"><span className="text-accent">•</span>{d}</li>)}
                </ul>
              ) : <p className="mt-2 text-sm text-muted-dim">None captured.</p>}
            </section>

            <section className="animate-fade-up card p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><IconGap size={16} /> Open questions</h3>
              {res.open_questions.length ? (
                <ul className="mt-2 space-y-1.5 text-sm">
                  {res.open_questions.map((q, i) => (
                    <li key={i} className="flex items-center justify-between gap-2">
                      <span className="flex gap-2"><span className="text-accent">?</span>{q}</span>
                      <a href={`/ask?q=${encodeURIComponent(q)}`} className="shrink-0 text-xs text-accent hover:underline">Ask Lore</a>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-sm text-muted-dim">None raised.</p>}
            </section>
          </div>

          <section className="animate-fade-up card p-5">
            <h3 className="text-sm font-semibold">Action items</h3>
            {res.action_items.length ? (
              <div className="mt-2 overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2 text-xs text-muted-dim">
                    <tr><th className="px-3 py-2 text-left font-medium">Task</th><th className="px-3 py-2 text-left font-medium">Owner</th><th className="px-3 py-2 text-left font-medium">Due</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border-soft">
                    {res.action_items.map((a, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2">{a.task}</td>
                        <td className="px-3 py-2 text-muted">{a.owner || "—"}</td>
                        <td className="px-3 py-2 text-muted">{a.due || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="mt-2 text-sm text-muted-dim">None assigned.</p>}
          </section>

          {res.follow_up_email && (
            <section className="animate-fade-up card p-5">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold"><IconChat size={16} /> Follow-up email</h3>
                <button onClick={copyEmail} className="btn-ghost inline-flex items-center gap-1.5 px-3 py-1.5 text-xs">
                  <IconCopy size={13} /> {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="mt-2 rounded-lg bg-surface-2 p-3 text-sm"><AnswerText text={res.follow_up_email} /></div>
            </section>
          )}

          {res.checked_against.length > 0 && (
            <p className="text-center text-xs text-muted-dim">
              Decisions checked against {res.checked_against.length} company source{res.checked_against.length > 1 ? "s" : ""}: {res.checked_against.join(", ")}
            </p>
          )}
        </div>
      )}

      <div id="document">
        <DocIntelligence companyId={companyId} />
      </div>
      </div>
    </div>
  );
}
