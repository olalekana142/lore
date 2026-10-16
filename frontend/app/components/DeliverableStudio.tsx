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

export default function DeliverableStudio({ companyId, onCreated, embedded = false }: { companyId: string; onCreated?: () => void; embedded?: boolean }) {
  const [kind, setKind] = useState("faq");
  const [goal, setGoal] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Deliverable | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { listProjects(companyId).then(setProjects).catch(() => {}); }, [companyId]);

  async function run() {
    if (!goal.trim()) return;
    setBusy(true); setRes(null); setError(null);
    try {
      setRes(await generateDeliverable(companyId, kind, goal, projectId || null));
      onCreated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't generate — please try again.");
    } finally {
      setBusy(false);
    }
  }
  function copy() {
    if (!res) return;
    navigator.clipboard?.writeText(res.content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  }
  function save(blob: Blob, ext: string) {
    const name = (res?.title || "deliverable").replace(/[^a-z0-9]+/gi, "-").slice(0, 60).replace(/^-|-$/g, "") || "deliverable";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${name}.${ext}`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadMd() { if (res) save(new Blob([res.content], { type: "text/markdown" }), "md"); }
  function downloadDoc() {
    if (!res) return;
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:'Segoe UI',Arial,sans-serif;line-height:1.5;color:#222}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:6px 9px;text-align:left}h1,h2,h3{margin:.6em 0 .3em}</style></head><body>${mdToHtml(res.content)}</body></html>`;
    save(new Blob([html], { type: "application/msword" }), "doc");
  }

  return (
    <section className={embedded ? "" : "animate-fade-up card p-5"}>
      {!embedded && (
        <>
          <h2 className="flex items-center gap-2 text-sm font-semibold"><span className="text-accent"><IconSparkle size={16} /></span> Create a deliverable</h2>
          <p className="mt-1 text-xs text-muted">Describe what you need. Lore drafts it from your company knowledge — cited, and flagged for review before it goes out.</p>
        </>
      )}

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

      {error && <div className="mt-2 rounded-lg px-3 py-2 text-sm" style={{ background: "color-mix(in srgb, var(--red) 12%, transparent)", color: "var(--red)" }}>{error}</div>}

      {res && (
        <div id="deliverable-result" className="animate-scale-in mt-4 rounded-xl border border-border bg-surface-2 p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: "color-mix(in srgb, var(--amber) 14%, transparent)", color: "var(--amber)" }}>
              ⚠ Draft — review before sharing
            </span>
            <div className="flex items-center gap-3 text-xs">
              {res.grounded ? (
                <span className="inline-flex items-center gap-1" style={{ color: "var(--green)" }}><IconCheck size={12} /> Grounded in {res.sources.length} source{res.sources.length === 1 ? "" : "s"}</span>
              ) : <span className="text-muted-dim">Not grounded in company docs</span>}
              <button onClick={copy} className="inline-flex items-center gap-1 text-muted hover:text-foreground"><IconCopy size={13} /> {copied ? "Copied" : "Copy"}</button>
              <button onClick={downloadDoc} className="text-muted hover:text-foreground">Word</button>
              <button onClick={downloadMd} className="text-muted hover:text-foreground">.md</button>
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

// Minimal Markdown -> HTML for the Word export (headings, bold, lists, tables, citations).
function mdToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) => esc(s).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/\[(\d+)\]/g, "<sup>[$1]</sup>");
  const lines = md.replace(/<br\s*\/?>/gi, "\n").split("\n");
  let html = "", list: string | null = null, table = false;
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  const closeTable = () => { if (table) { html += "</table>"; table = false; } };
  for (const raw of lines) {
    const t = raw.trim();
    const h = t.match(/^(#{1,6})\s+(.*)/);
    const b = t.match(/^[-*•]\s+(.*)/);
    const n = t.match(/^\d+[.)]\s+(.*)/);
    const row = t.startsWith("|") && t.endsWith("|") && t.length > 1;
    if (row) {
      closeList();
      const cells = t.slice(1, -1).split("|").map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) continue;
      if (!table) { html += '<table border="1" cellpadding="6">'; table = true; }
      html += "<tr>" + cells.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>";
      continue;
    }
    closeTable();
    if (h) { closeList(); html += `<h${h[1].length}>${inline(h[2].replace(/\*\*/g, ""))}</h${h[1].length}>`; }
    else if (b) { if (list !== "ul") { closeList(); html += "<ul>"; list = "ul"; } html += `<li>${inline(b[1])}</li>`; }
    else if (n) { if (list !== "ol") { closeList(); html += "<ol>"; list = "ol"; } html += `<li>${inline(n[1])}</li>`; }
    else if (!t) { closeList(); }
    else { closeList(); html += `<p>${inline(t)}</p>`; }
  }
  closeList(); closeTable();
  return html;
}
