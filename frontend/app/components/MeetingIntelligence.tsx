"use client";

import { useEffect, useState } from "react";
import { analyzeMeeting, listProjects, createProject, addProjectEntries, type MeetingAnalysis, type ProjectSummary } from "@/lib/api";
import AnswerText from "./AnswerText";
import { ErrorNote } from "./ui";
import { IconCheck, IconGap, IconHealth, IconCopy, IconChat } from "./icons";

const SAMPLE = `Priya: Thanks everyone. First, PTO — HR confirmed full-timers now get 25 days, effective this year.
Dan: Good. For the Acme migration, we've decided to standardize on PostgreSQL. Owner is Sam, target end of Q1.
Priya: Also, new hires can start booking time off immediately now — no more 90-day wait.
Dan: One open item: can contractors expense meals above the $60 daily limit? Nobody's sure.
Priya: Let's also let the sales team approve their own travel up to $2,000 without manager sign-off.
Dan: Action: Maria to draft the updated travel guidance by Friday.`;

export default function MeetingIntelligence({ companyId, onSaved }: { companyId: string; onSaved?: () => void }) {
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

  useEffect(() => { listProjects(companyId).then(setProjects).catch(() => {}); }, [companyId]);

  async function analyze() {
    if (!transcript.trim()) return;
    setBusy(true); setError(null); setRes(null); setSaved(0);
    try { setRes(await analyzeMeeting(companyId, transcript)); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to analyze"); }
    finally { setBusy(false); }
  }
  async function saveToProject() {
    if (!res) return;
    setSavingProj(true);
    try {
      let pid = projSel;
      if (!pid && newProj.trim()) pid = (await createProject(companyId, newProj.trim())).id;
      if (!pid) return;
      const entries = [
        ...res.decisions.map((d) => ({ kind: "decision", title: d })),
        ...res.action_items.map((a) => ({ kind: "action", title: a.task, owner: a.owner, due: a.due })),
        ...res.open_questions.map((q) => ({ kind: "question", title: q })),
      ];
      const { added } = await addProjectEntries(companyId, pid, entries);
      setSaved(added); setProjSel(pid); setNewProj("");
      await listProjects(companyId).then(setProjects).catch(() => {});
      onSaved?.();
    } finally { setSavingProj(false); }
  }
  function copyEmail() {
    if (!res?.follow_up_email) return;
    navigator.clipboard?.writeText(res.follow_up_email).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  }

  return (
    <div>
      <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={7}
        placeholder="Paste your meeting transcript here…" className="input w-full px-3 py-2 text-sm leading-relaxed" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button onClick={analyze} disabled={busy || !transcript.trim()} className="btn-primary px-4 py-2 text-sm">{busy ? "Analyzing…" : "Analyze meeting"}</button>
        <button onClick={() => setTranscript(SAMPLE)} className="btn-ghost px-3 py-2 text-xs">Try a sample</button>
      </div>

      {error && <div className="mt-4"><ErrorNote message={error} /></div>}

      {res && (
        <div className="mt-4 space-y-4">
          <section className="card flex flex-wrap items-center gap-2 p-4">
            <span className="text-sm font-medium">Save to a project</span>
            <select value={projSel} onChange={(e) => setProjSel(e.target.value)} className="input px-3 py-1.5 text-sm">
              <option value="">{projects.length ? "Choose a project…" : "No projects yet"}</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <span className="text-xs text-muted-dim">or</span>
            <input value={newProj} onChange={(e) => setNewProj(e.target.value)} placeholder="new project name" className="input px-3 py-1.5 text-sm" />
            <button onClick={saveToProject} disabled={savingProj || (!projSel && !newProj.trim())} className="btn-primary px-3 py-1.5 text-sm">{savingProj ? "Saving…" : "Save decisions & actions"}</button>
            {saved > 0 && <span className="text-sm font-medium" style={{ color: "var(--green)" }}>✓ Saved {saved} item{saved === 1 ? "" : "s"} to project memory</span>}
          </section>

          {res.policy_conflicts.length > 0 && (
            <section className="card border-l-4 p-5" style={{ borderLeftColor: "var(--amber)" }}>
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
            <section className="card p-5"><h3 className="text-sm font-semibold">Summary</h3><p className="mt-1.5 text-sm leading-relaxed text-muted">{res.summary}</p></section>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <section className="card p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><IconCheck size={16} /> Decisions</h3>
              {res.decisions.length ? <ul className="mt-2 space-y-1.5 text-sm">{res.decisions.map((d, i) => <li key={i} className="flex gap-2"><span className="text-accent">•</span>{d}</li>)}</ul> : <p className="mt-2 text-sm text-muted-dim">None captured.</p>}
            </section>
            <section className="card p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><IconGap size={16} /> Open questions</h3>
              {res.open_questions.length ? (
                <ul className="mt-2 space-y-1.5 text-sm">
                  {res.open_questions.map((q, i) => (
                    <li key={i} className="flex items-center justify-between gap-2"><span className="flex gap-2"><span className="text-accent">?</span>{q}</span><a href={`/ask?q=${encodeURIComponent(q)}`} className="shrink-0 text-xs text-accent hover:underline">Ask Lore</a></li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-sm text-muted-dim">None raised.</p>}
            </section>
          </div>

          <section className="card p-5">
            <h3 className="text-sm font-semibold">Action items</h3>
            {res.action_items.length ? (
              <div className="mt-2 overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2 text-xs text-muted-dim"><tr><th className="px-3 py-2 text-left font-medium">Task</th><th className="px-3 py-2 text-left font-medium">Owner</th><th className="px-3 py-2 text-left font-medium">Due</th></tr></thead>
                  <tbody className="divide-y divide-border-soft">
                    {res.action_items.map((a, i) => (<tr key={i}><td className="px-3 py-2">{a.task}</td><td className="px-3 py-2 text-muted">{a.owner || "—"}</td><td className="px-3 py-2 text-muted">{a.due || "—"}</td></tr>))}
                  </tbody>
                </table>
              </div>
            ) : <p className="mt-2 text-sm text-muted-dim">None assigned.</p>}
          </section>

          {res.follow_up_email && (
            <section className="card p-5">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold"><IconChat size={16} /> Follow-up email</h3>
                <button onClick={copyEmail} className="btn-ghost inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"><IconCopy size={13} /> {copied ? "Copied" : "Copy"}</button>
              </div>
              <div className="mt-2 rounded-lg bg-surface-2 p-3 text-sm"><AnswerText text={res.follow_up_email} /></div>
            </section>
          )}

          {res.checked_against.length > 0 && (
            <p className="text-center text-xs text-muted-dim">Decisions checked against {res.checked_against.length} company source{res.checked_against.length > 1 ? "s" : ""}: {res.checked_against.join(", ")}</p>
          )}
        </div>
      )}
    </div>
  );
}
