"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getBriefing, type Briefing } from "@/lib/api";
import { relativeDate } from "@/lib/format";
import { IconClock, IconGap, IconBook, IconArrow } from "./icons";

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function DailyBriefing({ companyId }: { companyId: string }) {
  const [b, setB] = useState<Briefing | null>(null);

  useEffect(() => { getBriefing(companyId).then(setB).catch(() => {}); }, [companyId]);
  if (!b) return null;

  const nothing = b.recent_changes.length === 0 && b.open_questions.length === 0 && b.projects.length === 0;

  return (
    <section className="animate-fade-up mb-6">
      <h1 className="text-2xl font-bold tracking-tight">{greeting()}, {b.name}.</h1>
      <p className="mt-1 text-sm text-muted">Here&apos;s what&apos;s worth your attention today.</p>

      {nothing ? (
        <div className="mt-4 card p-5 text-sm text-muted">Nothing new right now — ask Lore anything, or start a project.</div>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {/* Latest knowledge changes */}
          <div className="card p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><span className="text-accent"><IconClock size={15} /></span> Latest updates</div>
            {b.recent_changes.length ? (
              <ul className="space-y-2">
                {b.recent_changes.slice(0, 4).map((c) => (
                  <li key={c.doc_id} className="text-sm">
                    <Link href={`/library/${encodeURIComponent(c.doc_id)}`} className="hover:text-accent">{c.title}</Link>
                    <div className="text-[11px] text-muted-dim">
                      v{c.version}{c.changed ? " · updated" : ""} · {relativeDate(c.updated_at)}
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-dim">No recent changes.</p>}
          </div>

          {/* Open questions */}
          <div className="card p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><span className="text-accent"><IconGap size={15} /></span> Open questions</div>
            {b.open_questions.length ? (
              <ul className="space-y-2">
                {b.open_questions.slice(0, 4).map((q, i) => (
                  <li key={i} className="text-sm">
                    <Link href={`/projects/${encodeURIComponent(q.project_id)}`} className="hover:text-accent">{q.title}</Link>
                    <div className="text-[11px] text-muted-dim">{q.project}</div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-dim">Nothing unresolved. 🎉</p>}
          </div>

          {/* Projects + ops */}
          <div className="card p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><span className="text-accent"><IconBook size={15} /></span> Your projects</div>
            {b.projects.length ? (
              <ul className="space-y-2">
                {b.projects.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                    <Link href={`/projects/${encodeURIComponent(p.id)}`} className="hover:text-accent">{p.name}</Link>
                    {p.open_questions > 0 && <span className="chip shrink-0" style={{ color: "var(--amber)" }}>{p.open_questions} open</span>}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-dim">No projects yet. <Link href="/projects" className="text-accent hover:underline">Start one →</Link></p>}
            {b.ops && (
              <div className="mt-3 flex gap-3 border-t border-border-soft pt-3 text-xs">
                <Link href="/gaps" className="text-muted hover:text-accent">{b.ops.gaps} knowledge gap{b.ops.gaps === 1 ? "" : "s"}</Link>
                <Link href="/health" className="text-muted hover:text-accent">{b.ops.stale} to review</Link>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
