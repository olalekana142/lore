"use client";

import { useEffect, useState } from "react";
import { generateDeliverable, listProjects, type Deliverable, type ProjectSummary } from "@/lib/api";
import AnswerText from "./AnswerText";
import { IconSparkle, IconCopy, IconCheck } from "./icons";

const KINDS: [string, string][] = [
  ["brief", "Brief"], ["faq", "FAQ"], ["sop", "SOP"], ["report", "Report"],
  ["memo", "Decision memo"], ["reply", "Customer reply"], ["agenda", "Meeting agenda"],
];

const PRESETS: { kind: string; label: string; goal: string }[] = [
  { kind: "faq", label: "Customer FAQ", goal: "Customer-facing FAQ about our PTO, expense and travel policies" },
  { kind: "sop", label: "Write an SOP", goal: "SOP for reporting and responding to a security incident" },
  { kind: "brief", label: "Account brief", goal: "Brief summarizing our key policies a new manager should know" },
  { kind: "reply", label: "Customer reply", goal: "Reply to a customer asking how our expense reimbursement works" },
];

export default function DeliverableStudio({ companyId, onCreated }: { companyId: string; onCreated?: () => void }) {
  const [kind, setKind] = useState("faq");
  const [goal, setGoal] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Deliverable | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { listProjects(companyId).then(setProjects).catch(() => {}); }, [companyId]);

  async function run() {
    if (!goal.trim()) return;
    setBusy(true); setRes(null);
    try {
      setRes(await generateDeliverable(companyId, kind, goal, projectId || null));
      onCreated?.();
    } finally {
      setBusy(false);
    }
  }
  function copy() {
    if (!res) return;
    navigator.clipboard?.writeText(res.content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  }

  return (
    <section className="animate-fade-up card p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><span className="text-accent"><IconSparkle size={16} /></span> Create a deliverable</h2>
      <p className="mt-1 text-xs text-muted">Describe what you need. Lore drafts it from your company knowledge — cited, and flagged for review before it goes out.</p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button key={p.label} onClick={() => { setKind(p.kind); setGoal(p.goal); }}
            className="rounded-full border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:text-foreground">{p.label}</button>
        ))}
      </div>

      <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={2}
        placeholder="e.g. Draft a customer FAQ about our PTO and expense policies" className="input mt-2 w-full px-3 py-2 text-sm" />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="input px-3 py-1.5 text-sm">
          {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="input px-3 py-1.5 text-sm">
          <option value="">No project context</option>
          {projects.map((p) => <option key={p.id} value={p.id}>Use: {p.name}</option>)}
        </select>
        <button onClick={run} disabled={busy || !goal.trim()} className="btn-primary px-4 py-1.5 text-sm">{busy ? "Drafting…" : "Generate draft"}</button>
      </div>

      {res && (
        <div className="animate-scale-in mt-4 rounded-xl border border-border bg-surface-2 p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: "color-mix(in srgb, var(--amber) 14%, transparent)", color: "var(--amber)" }}>
              ⚠ Draft — review before sharing
            </span>
            <div className="flex items-center gap-3 text-xs">
              {res.grounded ? (
                <span className="inline-flex items-center gap-1" style={{ color: "var(--green)" }}><IconCheck size={12} /> Grounded in {res.sources.length} source{res.sources.length === 1 ? "" : "s"}</span>
              ) : <span className="text-muted-dim">Not grounded in company docs</span>}
              <button onClick={copy} className="inline-flex items-center gap-1 text-muted hover:text-foreground"><IconCopy size={13} /> {copied ? "Copied" : "Copy"}</button>
            </div>
          </div>
          <div className="text-sm"><AnswerText text={res.content} /></div>
          {res.sources.length > 0 && (
            <div className="mt-3 border-t border-border-soft pt-2 text-xs text-muted-dim">
              Sources: {res.sources.map((s) => s.title).join(" · ")}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
