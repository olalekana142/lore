"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getDocument, type DocDetail } from "@/lib/api";
import { useCompany } from "@/lib/useCompany";
import { relativeDate } from "@/lib/format";
import { ErrorNote } from "../../components/ui";
import { IconArrow, IconExternal, IconDoc } from "../../components/icons";

export default function DocumentPage() {
  const params = useParams();
  const docId = decodeURIComponent(Array.isArray(params.id) ? params.id[0] : params.id ?? "");
  const [companyId, , ready] = useCompany();
  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDoc(await getDocument(companyId, docId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [companyId, docId]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/library" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground">
        <span className="inline-block rotate-180"><IconArrow size={15} /></span> Back to documents
      </Link>

      {error && <ErrorNote message={error} />}
      {!doc && !error && (
        <div className="space-y-3">
          <div className="h-8 w-2/3 shimmer" />
          <div className="h-40 shimmer" />
        </div>
      )}

      {doc && (
        <div className="animate-fade-up">
          <header className="mb-5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{doc.title}</h1>
              <span className="chip">v{doc.version}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-dim">
              <span>updated {relativeDate(doc.updated_at)}</span>
              <span>·</span>
              <span>{doc.source}</span>
              {doc.topics.map((t) => (
                <span key={t} className="chip">{t}</span>
              ))}
              {doc.url && (
                <a href={doc.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                  source <IconExternal size={12} />
                </a>
              )}
            </div>
          </header>

          <section className="mb-5">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <span className="text-accent"><IconDoc size={16} /></span>
              Extracted facts <span className="chip">{doc.facts.length}</span>
            </h2>
            <div className="card divide-y divide-border-soft">
              {doc.facts.map((f, i) => (
                <div key={i} className="flex gap-3 p-3.5 text-sm">
                  <span className="text-muted-dim">{i + 1}.</span>
                  <span>{f}</span>
                </div>
              ))}
              {doc.facts.length === 0 && <p className="p-4 text-sm text-muted">No facts extracted.</p>}
            </div>
            <p className="mt-2 text-xs text-muted-dim">
              These are what Lore retrieves and cites. Re-upload this document on the{" "}
              <Link href="/connect" className="text-accent hover:underline">Add documents</Link> page to refresh them.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold">Full text</h2>
            <div className="card whitespace-pre-wrap p-5 text-sm leading-relaxed text-muted">{doc.text}</div>
          </section>
        </div>
      )}
    </div>
  );
}
