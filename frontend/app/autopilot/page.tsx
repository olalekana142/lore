"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getAutopilot, supersedeDocument, type Autopilot, type AlertSeverity } from "@/lib/api";
import { useCompany } from "@/lib/useCompany";
import { PageHeader, ErrorNote } from "../components/ui";
import { IconArrow } from "../components/icons";

const DOT: Record<AlertSeverity, string> = {
  critical: "var(--red)", review: "var(--amber)", gap: "#d4a017", info: "var(--muted)",
};

export default function AutopilotPage() {
  const [companyId, , ready] = useCompany();
  const [data, setData] = useState<Autopilot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retiring, setRetiring] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setData(await getAutopilot(companyId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setBusy(false);
    }
  }, [companyId]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  async function retire(docId: string) {
    setRetiring(docId);
    try {
      await supersedeDocument(companyId, docId);
      await load();
    } finally {
      setRetiring(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Autopilot"
        subtitle="Lore proactively watches your knowledge and surfaces what needs attention — before anyone hits a wrong answer."
        action={<button onClick={load} disabled={busy} className="btn-ghost px-3 py-2 text-sm">{busy ? "Scanning…" : "Re-scan"}</button>}
      />

      {error && <ErrorNote message={error} />}
      {!data && !error && <div className="space-y-3"><div className="h-16 shimmer" /><div className="h-16 shimmer" /></div>}

      {data && (
        <>
          <div className="animate-fade-up mb-4 flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold">{data.headline}</h2>
            <div className="flex items-center gap-2 text-xs">
              {(Object.keys(DOT) as AlertSeverity[]).filter((s) => data.counts[s] > 0).map((s) => (
                <span key={s} className="inline-flex items-center gap-1 text-muted-dim">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: DOT[s] }} />{data.counts[s]}
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-2.5">
            {data.items.map((it, i) => (
              <div key={i} style={{ animationDelay: `${i * 40}ms` }} className="animate-fade-up card flex items-start gap-3 p-4">
                <span className="mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: DOT[it.severity] }} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{it.title}</div>
                  <div className="mt-0.5 text-xs text-muted-dim">{it.detail}</div>
                  <div className="mt-2 flex items-center gap-3">
                    {it.action?.type === "supersede" && (
                      <button onClick={() => retire(it.action!.doc_id)} disabled={retiring === it.action!.doc_id}
                        className="btn-ghost px-2.5 py-1 text-xs">
                        {retiring === it.action!.doc_id ? "Retiring…" : `Retire “${it.action!.title}”`}
                      </button>
                    )}
                    <Link href={it.href} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                      Review <IconArrow size={12} />
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
