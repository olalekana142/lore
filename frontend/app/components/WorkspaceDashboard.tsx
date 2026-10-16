"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getWorkspaceHome, getDeliverable, updateWorkItem, type WorkspaceHome, type DeliverableDetail } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { relativeDate } from "@/lib/format";
import AnswerText from "./AnswerText";
import { downloadMarkdown, downloadWord } from "@/lib/download";
import { IconDoc, IconUsers, IconCheck, IconGap, IconArrow, IconClock, IconBook, IconSparkle } from "./icons";

const STATUS: Record<string, { label: string; color: string }> = {
  progress: { label: "In progress", color: "var(--amber)" },
  review: { label: "Ready for review", color: "var(--green)" },
  owner: { label: "Needs owner", color: "var(--red)" },
  active: { label: "Active", color: "var(--green)" },
  done: { label: "Complete", color: "var(--green)" },
};

const GOALS = [
  { icon: IconClock, title: "Prepare a meeting brief", body: "Get up to speed with key context, decisions and people.", target: "create" },
  { icon: IconCheck, title: "Turn notes into action items", body: "Extract tasks, owners and deadlines from a transcript.", target: "meeting" },
  { icon: IconDoc, title: "Analyze a document", body: "Get a summary, key points, and a policy check.", target: "document" },
  { icon: IconBook, title: "Build a project plan", body: "Draft a plan using your policies and team context.", target: "create" },
];

export default function WorkspaceDashboard({ companyId, refreshKey, onLaunch }: { companyId: string; refreshKey: number; onLaunch: (target: string) => void }) {
  const [data, setData] = useState<WorkspaceHome | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DeliverableDetail | null>(null);
  const { user } = useAuth();
  const me = user?.username ?? user?.name ?? "me";
  const [acting, setActing] = useState<string | null>(null);

  async function act(id: string, patch: { status?: string; owner?: string }) {
    setActing(id);
    try { await updateWorkItem(companyId, id, patch); load(); } finally { setActing(null); }
  }

  const load = useCallback(() => { getWorkspaceHome(companyId).then(setData).catch(() => {}); }, [companyId]);
  useEffect(() => { load(); }, [load, refreshKey]);

  async function openRow(r: WorkspaceHome["recent_work"][number]) {
    if (r.type_key !== "generated") return;
    if (openId === r.id) { setOpenId(null); return; }
    setOpenId(r.id); setDetail(null);
    try { setDetail(await getDeliverable(companyId, r.id)); } catch { /* ignore */ }
  }

  const SignalIcon = ({ k }: { k: string }) => k === "people" ? <IconUsers size={15} /> : k === "decision" ? <IconCheck size={15} /> : <IconDoc size={15} />;

  return (
    <div className="space-y-5">
      {/* Pick up where you left off + Company signals */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="animate-fade-up card p-5 lg:col-span-2">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-accent"><IconSparkle size={16} /></span>
            <h2 className="text-sm font-bold">Pick up where you left off</h2>
          </div>
          <p className="mb-2 text-xs text-muted-dim">Your active work and what needs attention.</p>
          {data && data.active_work.length === 0 && (
            <p className="py-6 text-center text-sm text-muted">Nothing in flight. Start something below. ✨</p>
          )}
          <div className="divide-y divide-border-soft">
            {data?.active_work.map((w) => {
              const st = STATUS[w.status] ?? STATUS.active;
              return (
                <div key={w.id} className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-surface-2">
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-weak text-accent">
                    {w.kind === "project" ? <IconBook size={15} /> : w.kind === "gap" ? <IconGap size={15} /> : <IconDoc size={15} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link href={w.href} className="text-sm font-medium hover:text-accent">{w.title}</Link>
                    <div className="mt-0.5 text-xs text-muted">{w.desc}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-dim">
                      <span>{w.context}</span>
                      <span className="chip">{w.tag}</span>
                      {w.owner && <span className="chip">@{w.owner}</span>}
                      {!w.owner && (
                        <button onClick={() => act(w.id, { owner: me })} disabled={acting === w.id} className="text-accent hover:underline">Assign to me</button>
                      )}
                      <button onClick={() => act(w.id, { status: "done" })} disabled={acting === w.id} className="text-muted hover:text-foreground">
                        {acting === w.id ? "…" : "Mark done"}
                      </button>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium" style={{ color: st.color }}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.color }} />{w.status_label}
                    </span>
                    <div className="mt-1 text-[11px] text-muted-dim">{relativeDate(w.updated)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="animate-fade-up card p-5">
          <div className="mb-2 flex items-center gap-2"><span className="text-accent"><IconGap size={16} /></span><h2 className="text-sm font-bold">Company signals</h2></div>
          {data && data.company_signals.length === 0 && <p className="py-4 text-sm text-muted-dim">All quiet.</p>}
          <div className="space-y-3">
            {data?.company_signals.map((s, i) => (
              <Link key={i} href={s.href} className="-mx-2 flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-2">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted"><SignalIcon k={s.icon} /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium leading-snug">{s.title}</div>
                  <div className="text-[11px] text-muted-dim">{s.detail}</div>
                </div>
                <span className="shrink-0 text-[11px] text-muted-dim">{relativeDate(s.when)}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      {/* Start with a goal */}
      <section className="animate-fade-up">
        <div className="mb-2 flex items-center gap-2"><span className="text-accent"><IconArrow size={16} /></span><h2 className="text-sm font-bold">Start with a goal</h2></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {GOALS.map((g) => (
            <button key={g.title} onClick={() => onLaunch(g.target)} className="marketing-card group p-4 text-left">
              <div className="flex items-center justify-between">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-weak text-accent"><g.icon size={18} /></span>
                <IconArrow size={15} />
              </div>
              <div className="mt-3 text-sm font-semibold">{g.title}</div>
              <div className="mt-1 text-xs text-muted">{g.body}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Your recent work */}
      <section id="recent" className="animate-fade-up card p-5">
        <div className="mb-2 flex items-center gap-2"><span className="text-accent"><IconClock size={16} /></span><h2 className="text-sm font-bold">Your recent work</h2></div>
        {data && data.recent_work.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No work yet — generate a deliverable or start a project.</p>
        ) : (
          <div className="overflow-hidden">
            <div className="hidden grid-cols-[1fr_120px_200px_180px_90px] gap-3 border-b border-border px-2 pb-2 text-[11px] font-medium uppercase tracking-wide text-muted-dim md:grid">
              <span>Title</span><span>Type</span><span>Context</span><span>Status</span><span className="text-right">Updated</span>
            </div>
            <div className="divide-y divide-border-soft">
              {data?.recent_work.map((r) => (
                <div key={r.id}>
                  {r.type_key === "generated" ? (
                    <button onClick={() => openRow(r)} className="grid w-full grid-cols-1 gap-1 px-2 py-3 text-left transition-colors hover:bg-surface-2 md:grid-cols-[1fr_120px_200px_180px_90px] md:items-center md:gap-3">
                      <RowCells r={r} />
                    </button>
                  ) : (
                    <Link href={r.href} className="grid w-full grid-cols-1 gap-1 px-2 py-3 transition-colors hover:bg-surface-2 md:grid-cols-[1fr_120px_200px_180px_90px] md:items-center md:gap-3">
                      <RowCells r={r} />
                    </Link>
                  )}
                  {openId === r.id && (
                    <div className="animate-scale-in mb-3 rounded-lg bg-surface-2 p-3">
                      {detail ? (
                        <>
                          <div className="mb-2 flex justify-end gap-3 text-xs">
                            <button onClick={() => downloadWord(detail.title, detail.content)} className="text-muted hover:text-foreground">Word</button>
                            <button onClick={() => downloadMarkdown(detail.title, detail.content)} className="text-muted hover:text-foreground">.md</button>
                          </div>
                          <div className="text-sm"><AnswerText text={detail.content} /></div>
                          {detail.source_titles.length > 0 && <div className="mt-2 border-t border-border-soft pt-2 text-xs text-muted-dim">Sources: {detail.source_titles.join(" · ")}</div>}
                        </>
                      ) : <div className="h-10 shimmer" />}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function RowCells({ r }: { r: WorkspaceHome["recent_work"][number] }) {
  const TYPE_COLOR: Record<string, string> = { generated: "var(--accent)", project: "#8b5cf6", meeting: "#3b82f6" };
  return (
    <>
      <span className="truncate text-sm font-medium">{r.title}</span>
      <span className="text-xs"><span className="chip" style={{ color: TYPE_COLOR[r.type_key] ?? "var(--muted)" }}>{r.type}</span></span>
      <span className="truncate text-xs text-muted">{r.context}</span>
      <span className="text-xs">
        <span style={{ color: r.status === "review" ? "var(--amber)" : "var(--green)" }}>
          {r.status === "review" ? "⚠ " : "✓ "}{r.status_label}
        </span>
        {r.grounded && <span className="ml-1 text-[11px]" style={{ color: "var(--green)" }}>· grounded</span>}
      </span>
      <span className="text-right text-[11px] text-muted-dim">{relativeDate(r.updated)}</span>
    </>
  );
}
