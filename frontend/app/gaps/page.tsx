"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getGaps, type Gap } from "@/lib/api";
import { useCompany } from "@/lib/useCompany";
import { relativeDate } from "@/lib/format";
import { PageHeader, EmptyState, ErrorNote } from "../components/ui";
import { IconGap, IconArrow } from "../components/icons";

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
        subtitle="Questions people asked that your documents don't answer well. Fix these by adding or updating a doc."
      />

      {error && <ErrorNote message={error} />}

      {!gaps && !error && (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 shimmer" />)}</div>
      )}

      {gaps && gaps.length === 0 && (
        <EmptyState
          icon={<IconGap size={28} />}
          title="No gaps — nice."
          hint="Every question asked so far was answerable from your documents. As people ask things you haven't documented, they'll show up here ranked by demand."
        />
      )}

      {gaps && gaps.length > 0 && (
        <div className="space-y-2.5">
          {gaps.map((g, i) => (
            <div key={i} style={{ animationDelay: `${i * 40}ms` }} className="animate-fade-up card card-hover p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium">{g.question}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-dim">
                    <span>asked {g.asked_count}×</span>
                    <span>·</span>
                    <span style={{ color: "var(--red)" }}>{g.unanswered_count} unanswered</span>
                    <span>·</span>
                    <span>last {relativeDate(g.last_asked)}</span>
                  </div>
                </div>
                <Link
                  href="/connect"
                  className="btn-ghost flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs"
                  title="Add a document that answers this"
                >
                  Document it <IconArrow size={14} />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
