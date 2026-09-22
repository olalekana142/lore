"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  getContentHealth,
  getGlossary,
  addGlossaryTerm,
  getAudit,
  supersedeDocument,
  type ContentHealth,
  type HealthPair,
  type GlossaryTerm,
  type Audit,
} from "@/lib/api";
import { useCompany } from "@/lib/useCompany";
import { useAuth, atLeast } from "@/lib/useAuth";
import { relativeDate } from "@/lib/format";
import { PageHeader, ErrorNote } from "../components/ui";
import { IconAlert, IconCopy, IconClock, IconBook } from "../components/icons";

export default function HealthPage() {
  const [companyId, , ready] = useCompany();
  const { user } = useAuth();
  const canEdit = atLeast(user?.role, "editor");
  const [data, setData] = useState<ContentHealth | null>(null);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setData(null);
    setAudit(null);
    try {
      setAudit(await getAudit(companyId)); // fast scorecard first
      setData(await getContentHealth(companyId)); // slower conflict scan
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
        title="Content health"
        subtitle="Where Lore reasons across documents — spotting conflicts, duplicates, dead weight, and jargon."
      />

      {error && <ErrorNote message={error} />}

      {audit && <AuditScorecard audit={audit} conflicts={data?.conflicts.length} />}

      {!data && !error && (
        <div className="card p-8 text-center text-sm text-muted">
          <span className="spinner mx-auto mb-3" style={{ borderColor: "var(--border)", borderTopColor: "var(--accent)" }} />
          <p>Scanning documents for conflicts &amp; duplicates…</p>
        </div>
      )}

      {data && (
        <div className="space-y-8">
          <Section
            title="Conflicts"
            desc="Two documents that would give an employee contradictory answers."
            count={data.conflicts.length}
            tone="red"
            empty="No conflicts found — your docs agree with each other."
          >
            {data.conflicts.map((c, i) => <PairCard key={i} pair={c} kind="conflict" companyId={companyId} canEdit={canEdit} onResolved={load} />)}
          </Section>

          <Section
            title="Duplicates"
            desc="The same fact stated in more than one document — candidates to consolidate."
            count={data.duplicates.length}
            tone="amber"
            empty="No duplicate content detected."
          >
            {data.duplicates.map((d, i) => <PairCard key={i} pair={d} kind="duplicate" companyId={companyId} canEdit={canEdit} onResolved={load} />)}
          </Section>

          <Section
            title="Never cited"
            desc="Documents no answer has ever used — potential dead weight to review or retire."
            count={data.never_cited.length}
            tone="muted"
            empty="Every document has been used in an answer."
          >
            <div className="card divide-y divide-border-soft">
              {data.never_cited.slice(0, 12).map((d) => (
                <Link key={d.doc_id} href={`/library/${d.doc_id}`} className="flex items-center justify-between gap-3 p-3 text-sm hover:text-accent">
                  <span>{d.title}</span>
                  <span className="text-xs text-muted-dim">updated {relativeDate(d.updated_at)}</span>
                </Link>
              ))}
            </div>
          </Section>

          <Section
            title="Stale"
            desc="Not updated in over 6 months — re-ingest the current version to refresh."
            count={data.stale.length}
            tone="amber"
            empty="Everything is fresh."
          >
            <div className="card divide-y divide-border-soft">
              {data.stale.slice(0, 12).map((d) => (
                <Link key={d.doc_id} href={`/library/${d.doc_id}`} className="flex items-center justify-between gap-3 p-3 text-sm hover:text-accent">
                  <span className="inline-flex items-center gap-2"><IconClock size={14} /> {d.title}</span>
                  <span className="text-xs text-muted-dim">{relativeDate(d.updated_at)}</span>
                </Link>
              ))}
            </div>
          </Section>

          <GlossaryManager companyId={companyId} />
        </div>
      )}
    </div>
  );
}

function AuditScorecard({ audit, conflicts }: { audit: Audit; conflicts?: number }) {
  const bars: [string, number][] = [
    ["Freshness", audit.scores.freshness],
    ["Verification", audit.scores.verification],
    ["Ownership", audit.scores.ownership],
    ["Citation coverage", audit.scores.citation_coverage],
  ];
  const barColor = (v: number) => (v >= 75 ? "var(--green)" : v >= 40 ? "var(--amber)" : "var(--red)");
  const actions = ([
    [conflicts ?? 0, "unresolved conflicts", "var(--red)"],
    [audit.unverified, "unverified documents", "var(--amber)"],
    [audit.missing_owner, "documents without an owner", "var(--amber)"],
    [audit.stale, "stale documents", "var(--amber)"],
    [audit.superseded, "superseded documents", "var(--muted)"],
    [audit.never_cited, "never cited (possible dead weight)", "var(--muted)"],
    [audit.gaps, "unanswered popular questions", "var(--amber)"],
  ] as [number, string, string][]).filter(([n]) => n > 0);

  return (
    <div className="animate-fade-up mb-8 card p-5">
      <h2 className="mb-1 text-base font-bold">Knowledge audit</h2>
      <p className="mb-4 text-xs text-muted">
        {audit.documents} documents scanned · every metric is a real, drillable count — no arbitrary AI score.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {bars.map(([label, v]) => (
          <div key={label}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span>{label}</span>
              <span className="font-bold" style={{ color: barColor(v) }}>{v}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full transition-all" style={{ width: `${v}%`, background: barColor(v) }} />
            </div>
          </div>
        ))}
      </div>
      {actions.length > 0 && (
        <div className="mt-4 border-t border-border-soft pt-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-dim">Action required</div>
          <div className="flex flex-wrap gap-2">
            {actions.map(([n, label, color]) => (
              <span key={label} className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs"
                style={{ borderColor: color, color, background: `color-mix(in srgb, ${color} 10%, transparent)` }}>
                <b>{n}</b> {label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  title, desc, count, tone, empty, children,
}: {
  title: string; desc: string; count: number; tone: "red" | "amber" | "muted";
  empty: string; children: React.ReactNode;
}) {
  const color = tone === "red" ? "var(--red)" : tone === "amber" ? "var(--amber)" : "var(--muted)";
  return (
    <section className="animate-fade-up">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-base font-bold">{title}</h2>
        <span
          className="rounded-full px-2 py-0.5 text-xs font-bold"
          style={{ color, background: count ? `color-mix(in srgb, ${color} 14%, transparent)` : "var(--surface-2)" }}
        >
          {count}
        </span>
      </div>
      <p className="mb-3 text-sm text-muted">{desc}</p>
      {count === 0 ? (
        <div className="card p-5 text-center text-sm text-muted">{empty}</div>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </section>
  );
}

function tierName(a?: number): string {
  const v = a ?? 60;
  return v >= 90 ? "Official" : v >= 80 ? "Approved" : v >= 60 ? "Standard" : "Low authority";
}

function PairCard({ pair, kind, companyId, canEdit, onResolved }: {
  pair: HealthPair; kind: "conflict" | "duplicate"; companyId: string; canEdit: boolean; onResolved: () => void;
}) {
  const color = kind === "conflict" ? "var(--red)" : "var(--amber)";
  const Icon = kind === "conflict" ? IconAlert : IconCopy;
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const loser = pair.recommend ? [pair.a, pair.b].find((f) => f.doc_id === pair.recommend!.loser_doc) : undefined;

  async function resolve() {
    if (!loser) return;
    setBusy(true);
    try {
      await supersedeDocument(companyId, loser.doc_id);
      setDone(true);
      setTimeout(onResolved, 800);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold" style={{ color }}>
        <Icon size={15} /> {pair.reason || (kind === "conflict" ? "Conflicting statements" : "Duplicate content")}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {[pair.a, pair.b].map((f, i) => {
          const wins = pair.recommend && f.doc_id === pair.recommend.winner_doc;
          return (
            <Link key={i} href={`/library/${f.doc_id}`}
              className="rounded-lg border bg-surface-2 p-3 transition-colors hover:border-accent"
              style={{ borderColor: wins ? "var(--green)" : "var(--border)" }}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-dim">{f.title}</span>
                {wins && <span className="text-[10px] font-bold" style={{ color: "var(--green)" }}>AUTHORITATIVE</span>}
              </div>
              <div className="text-sm leading-relaxed">{f.statement}</div>
              <div className="mt-1.5 flex flex-wrap gap-x-2 text-[10px] text-muted-dim">
                <span>{tierName(f.authority)}</span>
                {f.verified && <span style={{ color: "var(--green)" }}>· verified</span>}
                {f.superseded && <span style={{ color: "var(--amber)" }}>· superseded</span>}
                {f.updated_at && <span>· {relativeDate(f.updated_at)}</span>}
              </div>
            </Link>
          );
        })}
      </div>
      {kind === "conflict" && pair.recommend && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-2.5">
          <span className="text-xs text-muted">🧭 {pair.recommend.reason}</span>
          {canEdit && loser && !loser.superseded && !done && (
            <button onClick={resolve} disabled={busy} className="btn-ghost ml-auto px-3 py-1.5 text-xs">
              {busy ? "Resolving…" : `Retire “${loser.title}”`}
            </button>
          )}
          {done && <span className="ml-auto text-xs" style={{ color: "var(--green)" }}>✓ Resolved</span>}
        </div>
      )}
    </div>
  );
}

function GlossaryManager({ companyId }: { companyId: string }) {
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [term, setTerm] = useState("");
  const [def, setDef] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setTerms(await getGlossary(companyId));
    } catch {
      /* ignore */
    }
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!term.trim() || !def.trim()) return;
    setBusy(true);
    try {
      await addGlossaryTerm(companyId, term.trim(), def.trim());
      setTerm("");
      setDef("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="animate-fade-up">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold"><IconBook size={16} /> Glossary</h2>
        <span className="chip">{terms.length}</span>
      </div>
      <p className="mb-3 text-sm text-muted">
        Company acronyms &amp; jargon. Lore expands these in questions before searching, so
        &quot;What&apos;s our BYOD policy?&quot; finds the right docs.
      </p>
      <div className="card p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          {terms.map((t) => (
            <span key={t.term} className="chip" title={t.definition}>
              <b className="text-foreground">{t.term}</b> = {t.definition}
            </span>
          ))}
          {terms.length === 0 && <span className="text-sm text-muted">No terms yet.</span>}
        </div>
        <form onSubmit={add} className="flex flex-wrap gap-2">
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Term (e.g. OKR)" className="input w-32 px-3 py-2 text-sm" />
          <input value={def} onChange={(e) => setDef(e.target.value)} placeholder="Definition" className="input flex-1 px-3 py-2 text-sm" />
          <button type="submit" disabled={busy || !term.trim() || !def.trim()} className="btn-primary px-4 py-2 text-sm">Add</button>
        </form>
      </div>
    </section>
  );
}
