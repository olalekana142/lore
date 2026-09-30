"use client";

import { useState } from "react";
import { analyzeDocument, compareDocuments, type DocIntel, type DocCompare } from "@/lib/api";
import { IconDoc, IconCopy, IconArrow } from "./icons";

const MODES: [string, string][] = [
  ["summary", "Summarize"], ["obligations", "Obligations"], ["risks", "Unusual clauses"], ["actions", "Action items"],
];

export default function DocIntelligence({ companyId }: { companyId: string }) {
  const [tab, setTab] = useState<"analyze" | "compare">("analyze");

  // analyze
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [res, setRes] = useState<DocIntel | null>(null);
  const [copied, setCopied] = useState(false);

  // compare
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [cmpBusy, setCmpBusy] = useState(false);
  const [cmp, setCmp] = useState<DocCompare | null>(null);

  async function analyze(mode: string) {
    if (!text.trim()) return;
    setBusy(mode); setRes(null);
    try { setRes(await analyzeDocument(companyId, text, mode)); } finally { setBusy(null); }
  }
  async function compare() {
    if (!a.trim() || !b.trim()) return;
    setCmpBusy(true); setCmp(null);
    try { setCmp(await compareDocuments(companyId, a, b)); } finally { setCmpBusy(false); }
  }
  function copy() {
    if (!res) return;
    navigator.clipboard?.writeText(res.content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  }

  return (
    <section className="animate-fade-up card mt-4 p-5">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><span className="text-accent"><IconDoc size={16} /></span> Document intelligence</h2>
        <div className="flex gap-1 rounded-lg bg-surface-2 p-0.5 text-xs">
          {(["analyze", "compare"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-md px-2.5 py-1 font-medium capitalize transition-colors ${tab === t ? "bg-surface text-foreground shadow-sm" : "text-muted-dim"}`}>
              {t === "analyze" ? "Analyze" : "Compare two"}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-xs text-muted">Paste a contract, offer letter or any document — Lore works with what you give it (no upload stored).</p>

      {tab === "analyze" ? (
        <>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} placeholder="Paste a document…" className="input mt-3 w-full px-3 py-2 text-sm leading-relaxed" />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {MODES.map(([mode, label]) => (
              <button key={mode} onClick={() => analyze(mode)} disabled={!!busy || !text.trim()}
                className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:opacity-50">
                {busy === mode ? "…" : label}
              </button>
            ))}
          </div>
          {res && (
            <div className="animate-scale-in mt-3 rounded-xl border border-border bg-surface-2 p-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-dim">{res.label}</span>
                <button onClick={copy} className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"><IconCopy size={13} /> {copied ? "Copied" : "Copy"}</button>
              </div>
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{res.content}</pre>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <textarea value={a} onChange={(e) => setA(e.target.value)} rows={7} placeholder="Document A (current / old)…" className="input w-full px-3 py-2 text-sm" />
            <textarea value={b} onChange={(e) => setB(e.target.value)} rows={7} placeholder="Document B (new / proposed)…" className="input w-full px-3 py-2 text-sm" />
          </div>
          <button onClick={compare} disabled={cmpBusy || !a.trim() || !b.trim()} className="btn-primary mt-2 px-4 py-2 text-sm">{cmpBusy ? "Comparing…" : "Compare documents"}</button>
          {cmp && (
            <div className="animate-scale-in mt-3 space-y-3">
              {cmp.contradictions.length > 0 && (
                <Block title="Contradictions" color="var(--red)">{cmp.contradictions.map((t, i) => <li key={i}>{t}</li>)}</Block>
              )}
              {cmp.changed.length > 0 && (
                <div className="rounded-lg bg-surface-2 p-3">
                  <div className="mb-1 text-xs font-semibold" style={{ color: "var(--amber)" }}>Changed</div>
                  <ul className="space-y-1 text-sm">
                    {cmp.changed.map((c, i) => <li key={i}><span className="text-muted-dim line-through">{c.was}</span> <IconArrow size={11} /> <b>{c.now}</b></li>)}
                  </ul>
                </div>
              )}
              {cmp.added.length > 0 && <Block title="Added in B" color="var(--green)">{cmp.added.map((t, i) => <li key={i}>{t}</li>)}</Block>}
              {cmp.removed.length > 0 && <Block title="Removed from A" color="var(--muted)">{cmp.removed.map((t, i) => <li key={i}>{t}</li>)}</Block>}
              {cmp.review.length > 0 && <Block title="Worth a human review" color="var(--accent)">{cmp.review.map((t, i) => <li key={i}>{t}</li>)}</Block>}
              {[cmp.added, cmp.removed, cmp.changed, cmp.contradictions, cmp.review].every((x) => x.length === 0) &&
                <p className="text-sm text-muted-dim">No meaningful differences found.</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Block({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-surface-2 p-3">
      <div className="mb-1 text-xs font-semibold" style={{ color }}>{title}</div>
      <ul className="space-y-1 text-sm">{children}</ul>
    </div>
  );
}
