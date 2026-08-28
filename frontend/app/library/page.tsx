"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getDocuments, type DocSummary } from "@/lib/api";
import { useCompany } from "@/lib/useCompany";
import { relativeDate } from "@/lib/format";
import { PageHeader, EmptyState, ErrorNote } from "../components/ui";
import { IconLibrary, IconSearch, IconUpload, IconDoc } from "../components/icons";

const SOURCE_ICON: Record<string, string> = {
  upload: "📄",
  drive: "🗂️",
  database: "🗄️",
  manual: "✍️",
};

export default function LibraryPage() {
  const [companyId, , ready] = useCompany();
  const [docs, setDocs] = useState<DocSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      setDocs(await getDocuments(companyId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [companyId]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  const filtered = useMemo(() => {
    if (!docs) return [];
    const term = q.trim().toLowerCase();
    if (!term) return docs;
    return docs.filter(
      (d) => d.title.toLowerCase().includes(term) || d.topics.some((t) => t.toLowerCase().includes(term)),
    );
  }, [docs, q]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Documents"
        subtitle={docs ? `${docs.length} document${docs.length === 1 ? "" : "s"} in ${companyId}'s knowledge base` : "Your company's knowledge base"}
        action={
          <Link href="/connect" className="btn-primary flex items-center gap-2 px-4 py-2.5 text-sm">
            <IconUpload size={16} /> Add
          </Link>
        }
      />

      {error && <ErrorNote message={error} />}

      {docs && docs.length > 0 && (
        <div className="animate-fade-up relative mb-4">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-dim">
            <IconSearch size={16} />
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search documents & topics…"
            className="input w-full py-2.5 pl-10 pr-4 text-sm"
          />
        </div>
      )}

      {!docs && !error && (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 shimmer" />)}</div>
      )}

      {docs && docs.length === 0 && (
        <EmptyState
          icon={<IconLibrary size={28} />}
          title="No documents yet"
          hint={<>Upload a policy, SOP, or FAQ to get started. <Link href="/connect" className="text-accent hover:underline">Add documents →</Link></>}
        />
      )}

      {docs && docs.length > 0 && (
        <div className="space-y-2">
          {filtered.map((d, i) => (
            <Link
              key={d.doc_id}
              href={`/library/${d.doc_id}`}
              style={{ animationDelay: `${i * 30}ms` }}
              className="animate-fade-up card card-hover flex items-center gap-4 p-4"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-lg">
                {SOURCE_ICON[d.source] ?? "📄"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold">{d.title}</span>
                  {d.version > 1 && <span className="chip shrink-0">v{d.version}</span>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-dim">
                  <span className="inline-flex items-center gap-1"><IconDoc size={12} /> {d.facts} facts</span>
                  {d.topics.slice(0, 3).map((t) => (
                    <span key={t} className="chip">{t}</span>
                  ))}
                </div>
              </div>
              <span className="shrink-0 text-xs text-muted-dim">{relativeDate(d.updated_at)}</span>
            </Link>
          ))}
          {filtered.length === 0 && <p className="card p-6 text-center text-sm text-muted">No documents match “{q}”.</p>}
        </div>
      )}
    </div>
  );
}
