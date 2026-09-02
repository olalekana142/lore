"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getOverview, listUsers, type Overview, type ManagedUser } from "@/lib/api";
import { relativeDate } from "@/lib/format";
import { StatTile, ErrorNote } from "./ui";
import { IconChat, IconUpload, IconGap, IconClock, IconArrow, IconUsers } from "./icons";

export default function OpsDashboard({ companyId, role }: { companyId: string; role: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await getOverview(companyId));
      if (role === "admin") setUsers(await listUsers(companyId).catch(() => null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [companyId, role]);

  useEffect(() => { load(); }, [load]);

  const roleCounts = users
    ? users.reduce((a, u) => ((a[u.role] = (a[u.role] ?? 0) + 1), a), {} as Record<string, number>)
    : null;

  return (
    <div className="mx-auto max-w-5xl">
      <header className="animate-fade-up mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="capitalize">{companyId}</span> knowledge base
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            {role === "admin" ? "Admin overview — org, content health and usage." : "Knowledge operations — gaps, freshness and usage."}
          </p>
        </div>
        <Link href="/ask" className="btn-primary flex items-center gap-2 px-4 py-2.5 text-sm">
          <IconChat size={17} /> Ask Lore
        </Link>
      </header>

      {error && <ErrorNote message={error} />}

      {/* Admin-only org strip */}
      {role === "admin" && roleCounts && users && (
        <div className="animate-fade-up mb-3 flex flex-wrap items-center gap-4 rounded-xl border border-border bg-surface-2 px-4 py-3">
          <span className="inline-flex items-center gap-2 text-sm font-semibold"><IconUsers size={16} /> {users.length} users</span>
          <span className="text-sm text-muted">{roleCounts.admin ?? 0} admin · {roleCounts.editor ?? 0} editor · {roleCounts.member ?? 0} member</span>
          <Link href="/admin" className="ml-auto text-xs font-medium text-accent hover:underline">Manage users →</Link>
        </div>
      )}

      {!data && !error && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 shimmer" />)}
        </div>
      )}

      {data && (
        <>
          <div className="animate-fade-up grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Documents" value={data.documents} />
            <StatTile label="Facts indexed" value={data.facts} />
            <StatTile label="Questions asked" value={data.questions_asked} />
            <StatTile label="Knowledge gaps" value={data.gaps_count} accent={data.gaps_count > 0} />
          </div>

          <div className="animate-fade-up mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <RoiTile label="Deflection rate" value={`${Math.round(data.roi.deflection_rate * 100)}%`} hint="questions self-served" />
            <RoiTile label="Time saved" value={fmtMinutes(data.roi.minutes_saved)} hint="vs asking a colleague" />
            <RoiTile label="Answered" value={`${data.roi.answered}/${data.roi.asked}`} hint="of questions asked" />
            <RoiTile label="Never cited" value={data.never_cited_count} hint="docs unused so far" />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Panel title="Top knowledge gaps" icon={<IconGap size={16} />} href="/gaps" cta="All gaps" empty={data.top_gaps.length === 0} emptyText="No unanswered questions yet. 🎉">
              {data.top_gaps.map((g, i) => (
                <div key={i} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="text-sm">{g.question}</span>
                  <span className="chip shrink-0" style={{ color: "var(--red)", borderColor: "var(--red)", background: "var(--red-weak)" }}>{g.unanswered_count}× unanswered</span>
                </div>
              ))}
            </Panel>

            <Panel title="Most-asked questions" icon={<IconChat size={16} />} empty={data.top_questions.length === 0} emptyText="No questions asked yet — try the Ask page.">
              {data.top_questions.map((q, i) => (
                <div key={i} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="text-sm">{q.question}</span>
                  <span className="chip shrink-0">{q.asked_count}×</span>
                </div>
              ))}
            </Panel>

            <Panel title="What people ask about" icon={<IconChat size={16} />} empty={data.questions_by_topic.length === 0} emptyText="No questions asked yet.">
              {data.questions_by_topic.map((t, i) => (
                <div key={i} className="py-1.5">
                  <div className="mb-1 flex items-center justify-between text-sm"><span>{t.topic}</span><span className="text-xs font-semibold text-accent">{t.pct}%</span></div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-accent" style={{ width: `${t.pct}%` }} /></div>
                </div>
              ))}
            </Panel>

            <Panel title="Most-used documents" icon={<IconArrow size={16} />} empty={data.most_cited.length === 0} emptyText="No answers cite a doc yet.">
              {data.most_cited.map((d, i) => (
                <Link key={i} href={`/library/${d.doc_id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-accent">
                  <span className="text-sm">{d.title}</span><span className="chip shrink-0">cited {d.cited_count}×</span>
                </Link>
              ))}
            </Panel>

            <Panel title="Needs review" icon={<IconClock size={16} />} href="/health" cta="Health" empty={data.stale_docs.length === 0} emptyText="Everything's fresh. 🎉">
              {data.stale_docs.map((d, i) => (
                <Link key={i} href={`/library/${d.doc_id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-accent">
                  <span className="text-sm">{d.title}</span>
                  <span className="chip shrink-0" style={{ color: "var(--amber)", borderColor: "var(--amber)", background: "var(--amber-weak)" }}>{relativeDate(d.updated_at)}</span>
                </Link>
              ))}
            </Panel>
          </div>

          <div className="animate-fade-up mt-4 flex flex-wrap gap-3">
            <Link href="/connect" className="btn-ghost flex items-center gap-2 px-4 py-2.5 text-sm"><IconUpload size={16} /> Add documents</Link>
            <Link href="/gaps" className="btn-ghost flex items-center gap-2 px-4 py-2.5 text-sm">Review gaps <IconArrow size={16} /></Link>
          </div>
        </>
      )}
    </div>
  );
}

function fmtMinutes(m: number): string {
  if (m >= 60) { const h = m / 60; return `${h % 1 === 0 ? h : h.toFixed(1)} hr`; }
  return `${m} min`;
}

function RoiTile({ label, value, hint }: { label: string; value: React.ReactNode; hint: string }) {
  return (
    <div className="card p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-dim">{label}</div>
      <div className="mt-1 text-xl font-bold text-accent">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-dim">{hint}</div>
    </div>
  );
}

function Panel({ title, icon, href, cta, empty, emptyText, children }: {
  title: string; icon: React.ReactNode; href?: string; cta?: string; empty?: boolean; emptyText?: string; children: React.ReactNode;
}) {
  return (
    <section className="animate-fade-up card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><span className="text-accent">{icon}</span>{title}</h2>
        {href && cta && <Link href={href} className="text-xs font-medium text-accent hover:underline">{cta} →</Link>}
      </div>
      {empty ? <p className="py-6 text-center text-sm text-muted">{emptyText}</p> : <div className="divide-y divide-border-soft">{children}</div>}
    </section>
  );
}
