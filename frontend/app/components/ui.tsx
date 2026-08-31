"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { Confidence, Source } from "@/lib/api";
import { relativeDate } from "@/lib/format";
import { IconExternal } from "./icons";

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="animate-fade-up mb-7 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

const CONF: Record<Confidence, { label: string; cls: string }> = {
  high: { label: "High confidence", cls: "text-green" },
  medium: { label: "Medium confidence", cls: "text-amber" },
  low: { label: "Low confidence", cls: "text-amber" },
  none: { label: "Not documented", cls: "text-muted" },
};

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const c = CONF[confidence] ?? CONF.low;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${c.cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {c.label}
    </span>
  );
}

export function SourceCard({ source, highlight }: { source: Source; highlight?: boolean }) {
  return (
    <div
      className={`card p-3.5 transition-colors ${highlight ? "!border-accent" : ""}`}
      id={`source-${source.n}`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-accent-weak text-xs font-bold text-accent">
          {source.n}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Link href={`/library/${source.doc_id}`} className="truncate text-sm font-semibold hover:text-accent">
              {source.title}
            </Link>
            {source.url && (
              <a href={source.url} target="_blank" rel="noreferrer" className="text-muted-dim hover:text-accent">
                <IconExternal size={13} />
              </a>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-dim">
            <span>v{source.version} · updated {relativeDate(source.updated_at)}</span>
            {source.verified ? (
              <span className="inline-flex items-center gap-0.5 font-medium" style={{ color: "var(--green)" }}>
                ✓ Verified{source.owner ? ` · ${source.owner}` : ""}
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 font-medium" style={{ color: "var(--amber)" }}>
                ⚠ Unverified
              </span>
            )}
          </div>
          {source.facts?.length > 0 && (
            <ul className="mt-2 space-y-1">
              {source.facts.slice(0, 3).map((f, i) => (
                <li key={i}>
                  <Link
                    href={`/library/${source.doc_id}?q=${encodeURIComponent(f)}`}
                    className="group block border-l-2 border-border pl-2.5 text-xs leading-relaxed text-muted transition-colors hover:border-accent hover:text-foreground"
                    title="See this in the source document"
                  >
                    {f}
                    <span className="ml-1 text-accent opacity-0 transition-opacity group-hover:opacity-100">↗</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export function StatTile({ label, value, accent }: { label: string; value: ReactNode; accent?: boolean }) {
  return (
    <div className="card p-4">
      <div className={`text-2xl font-bold ${accent ? "text-accent" : ""}`}>{value}</div>
      <div className="mt-0.5 text-xs text-muted">{label}</div>
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 p-10 text-center">
      {icon && <div className="text-muted-dim">{icon}</div>}
      <p className="font-medium">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted">{hint}</p>}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: "var(--red)", background: "var(--red-weak)", color: "var(--red)" }}>
      {message} — is the API running on :8000?
    </div>
  );
}
