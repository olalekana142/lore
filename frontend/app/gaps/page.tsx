"use client";

import { useCallback, useEffect, useState } from "react";
import { getGaps, draftGapAnswer, ingestText, getEscalations, resolveEscalation, type Gap, type Escalation } from "@/lib/api";
import { useCompany } from "@/lib/useCompany";
import { relativeDate } from "@/lib/format";
import { PageHeader, EmptyState, ErrorNote } from "../components/ui";
import { IconGap, IconSparkle } from "../components/icons";

export default function GapsPage() {
  const [companyId, , ready] = useCompany();
  const [gaps, setGaps] = useState<Gap[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setGaps(await getGaps(companyId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [companyId]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Knowledge gaps"
        subtitle="Questions people asked that your docs don't answer. Let Lore draft the missing doc, review it, and publish to close the gap."
      />

      {error && <ErrorNote message={error} />}

      <EscalationInbox companyId={companyId} ready={ready} onResolved={load} />

      {!gaps && !error && (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 shimmer" />)}</div>
      )}

      {gaps && gaps.length === 0 && (
        <EmptyState
          icon={<IconGap size={28} />}
          title="No gaps — nice."
          hint="Every question asked so far was answerable from your documents. New unanswered questions show up here, ranked by demand."
        />
      )}

      {gaps && gaps.length > 0 && (
        <div className="space-y-2.5">
          {gaps.map((g, i) => (
            <GapRow key={g.question} gap={g} companyId={companyId} delay={i * 40} onClosed={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function EscalationInbox({ companyId, ready, onResolved }: { companyId: string; ready: boolean; onResolved: () => void }) {
  const [items, setItems] = useState<Escalation[]>([]);

  const load = useCallback(async () => {
    try {
      setItems(await getEscalations(companyId));
    } catch {
      /* ignore */
    }
  }, [companyId]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  if (items.length === 0) return null;

  return (
    <div className="animate-fade-up mb-6 rounded-xl border p-4" style={{ borderColor: "var(--accent)", background: "var(--accent-weak)" }}>
      <h2 className="mb-1 text-sm font-bold text-accent">HR inbox · {items.length} escalated</h2>
      <p className="mb-3 text-xs text-muted">Answer these and they&apos;re saved into the knowledge base — the next person who asks gets it automatically.</p>
      <div className="space-y-2">
        {items.map((e) => (
          <EscalationRow key={e.id} esc={e} companyId={companyId} onResolved={() => { load(); onResolved(); }} />
        ))}
      </div>
    </div>
  );
}

function EscalationRow({ esc, companyId, onResolved }: { esc: Escalation; companyId: string; onResolved: () => void }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);

  async function resolve() {
    if (!answer.trim()) return;
    setBusy(true);
    try {
      await resolveEscalation(companyId, esc.id, answer.trim());
      onResolved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg bg-surface p-3">
      <p className="text-sm font-medium">{esc.question}</p>
      <div className="mt-2 flex gap-2">
        <input
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Write the answer to publish…"
          className="input flex-1 px-3 py-2 text-sm"
        />
        <button onClick={resolve} disabled={busy || !answer.trim()} className="btn-primary px-3 py-2 text-sm">
          {busy ? "Publishing…" : "Answer & publish"}
        </button>
      </div>
    </div>
  );
}

function GapRow({ gap, companyId, delay, onClosed }: { gap: Gap; companyId: string; delay: number; onClosed: () => void }) {
  const [drafting, setDrafting] = useState(false);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function draft() {
    setDrafting(true);
    setOpen(true);
    try {
      const d = await draftGapAnswer(companyId, gap.question);
      setTitle(d.title);
      setText(d.text);
    } catch {
      setText("⚠️ Draft failed — is the API running?");
    } finally {
      setDrafting(false);
    }
  }

  async function save() {
    if (!title.trim() || !text.trim()) return;
    setSaving(true);
    try {
      await ingestText(companyId, title, text);
      setSaved(true);
      setTimeout(onClosed, 900); // reload → gap should drop off once answerable
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ animationDelay: `${delay}ms` }} className="animate-fade-up card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium">{gap.question}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-dim">
            <span>asked {gap.asked_count}×</span>
            <span>·</span>
            <span style={{ color: "var(--red)" }}>{gap.unanswered_count} unanswered</span>
            <span>·</span>
            <span>last {relativeDate(gap.last_asked)}</span>
          </div>
        </div>
        {!open && (
          <button onClick={draft} className="btn-primary flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs">
            <IconSparkle size={14} /> Draft answer
          </button>
        )}
      </div>

      {open && (
        <div className="animate-scale-in mt-4 border-t border-border-soft pt-4">
          {drafting ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <span className="dot" /><span className="dot" /><span className="dot" />
              <span className="ml-1">Drafting a doc to answer this…</span>
            </div>
          ) : saved ? (
            <p className="text-sm font-medium" style={{ color: "var(--green)" }}>
              ✓ Published — this gap will close once the new doc is indexed.
            </p>
          ) : (
            <>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-dim">Draft title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="input mb-3 mt-1 w-full px-3 py-2 text-sm" />
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-dim">Draft content (review &amp; edit)</label>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={9} className="input mt-1 w-full px-3 py-2 text-sm font-mono leading-relaxed" />
              <p className="mt-1.5 text-xs text-muted-dim">AI-drafted from the question — edit and fill any [placeholders] before publishing.</p>
              <div className="mt-3 flex gap-2">
                <button onClick={save} disabled={saving} className="btn-primary px-4 py-2 text-sm">
                  {saving ? "Publishing…" : "Publish as document"}
                </button>
                <button onClick={() => setOpen(false)} className="btn-ghost px-4 py-2 text-sm">Cancel</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
