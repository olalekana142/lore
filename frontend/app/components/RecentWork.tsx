"use client";

import { useCallback, useEffect, useState } from "react";
import { listDeliverables, getDeliverable, type DeliverableSummary, type DeliverableDetail } from "@/lib/api";
import { relativeDate } from "@/lib/format";
import AnswerText from "./AnswerText";
import { IconClock, IconDoc } from "./icons";

const KIND_LABEL: Record<string, string> = {
  brief: "Brief", faq: "FAQ", sop: "SOP", report: "Report", memo: "Memo", reply: "Reply", agenda: "Agenda",
};

export default function RecentWork({ companyId, refreshKey }: { companyId: string; refreshKey: number }) {
  const [items, setItems] = useState<DeliverableSummary[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<DeliverableDetail | null>(null);

  const load = useCallback(() => { listDeliverables(companyId).then(setItems).catch(() => {}); }, [companyId]);
  useEffect(() => { load(); }, [load, refreshKey]);

  async function toggle(id: string) {
    if (open === id) { setOpen(null); return; }
    setOpen(id); setDetail(null);
    try { setDetail(await getDeliverable(companyId, id)); } catch { /* ignore */ }
  }

  if (!items || items.length === 0) return null;

  return (
    <section className="animate-fade-up card p-5">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><span className="text-accent"><IconClock size={16} /></span> Your recent work</h2>
      <div className="divide-y divide-border-soft">
        {items.map((it) => (
          <div key={it.id}>
            <button onClick={() => toggle(it.id)} className="flex w-full items-center justify-between gap-3 py-2.5 text-left">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-weak text-accent"><IconDoc size={14} /></span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{it.title}</div>
                  <div className="text-[11px] text-muted-dim">{KIND_LABEL[it.kind] ?? it.kind} · {it.created_by || "you"} · {relativeDate(it.created_at)}</div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-[11px]">
                {it.source_count > 0 && <span style={{ color: "var(--green)" }}>Grounded · {it.source_count}</span>}
                <span className="chip" style={{ color: "var(--amber)" }}>{it.status === "draft" ? "Draft" : it.status}</span>
              </div>
            </button>
            {open === it.id && (
              <div className="animate-scale-in mb-3 rounded-lg bg-surface-2 p-3">
                {detail ? (
                  <>
                    <div className="text-sm"><AnswerText text={detail.content} /></div>
                    {detail.source_titles.length > 0 && (
                      <div className="mt-2 border-t border-border-soft pt-2 text-xs text-muted-dim">Sources: {detail.source_titles.join(" · ")}</div>
                    )}
                  </>
                ) : <div className="h-10 shimmer" />}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
