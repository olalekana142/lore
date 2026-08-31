"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getDocument, verifyDocument, setAudience, type DocDetail } from "@/lib/api";
import { useCompany } from "@/lib/useCompany";
import { relativeDate } from "@/lib/format";
import { ErrorNote } from "../../components/ui";
import { IconArrow, IconExternal, IconDoc } from "../../components/icons";

/** Find the sentence in `text` that best matches `q` (token overlap); split around it. */
function splitForHighlight(text: string, q: string | null): [string, string, string] | null {
  if (!q) return null;
  const qWords = new Set((q.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2));
  if (qWords.size === 0) return null;
  const sentences = text.match(/[^.!?\n]+[.!?]?/g) ?? [];
  let best: string | null = null;
  let bestScore = 0;
  for (const s of sentences) {
    const sw = (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2);
    if (sw.length === 0) continue;
    const overlap = sw.filter((w) => qWords.has(w)).length / sw.length;
    if (overlap > bestScore) {
      bestScore = overlap;
      best = s;
    }
  }
  if (!best || bestScore < 0.34) return null;
  const idx = text.indexOf(best);
  if (idx < 0) return null;
  return [text.slice(0, idx), best.trim(), text.slice(idx + best.length)];
}

function AudienceBar({ doc, companyId, onDone }: { doc: DocDetail; companyId: string; onDone: () => void }) {
  const isPublic = !doc.audience || doc.audience.includes("everyone");
  const [value, setValue] = useState((doc.audience ?? ["everyone"]).join(", "));
  const [busy, setBusy] = useState(false);

  async function save(next: string) {
    setBusy(true);
    try {
      const groups = next.split(",").map((g) => g.trim()).filter(Boolean);
      await setAudience(companyId, doc.doc_id, groups.length ? groups : ["everyone"]);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-1 mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-2 p-3">
      <span className="inline-flex items-center gap-1.5 text-sm font-medium">
        {isPublic ? "🌐 Visible to everyone" : `🔒 Restricted to: ${doc.audience?.join(", ")}`}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="everyone, or hr, finance…"
          className="input w-52 px-3 py-1.5 text-sm"
        />
        <button onClick={() => save(value)} disabled={busy} className="btn-ghost px-3 py-1.5 text-sm">Set access</button>
        {!isPublic && (
          <button onClick={() => { setValue("everyone"); save("everyone"); }} disabled={busy} className="btn-ghost px-3 py-1.5 text-sm">Make public</button>
        )}
      </div>
    </div>
  );
}

function VerifyBar({ doc, companyId, onDone }: { doc: DocDetail; companyId: string; onDone: () => void }) {
  const [owner, setOwner] = useState(doc.owner ?? "");
  const [busy, setBusy] = useState(false);

  async function verify() {
    if (!owner.trim()) return;
    setBusy(true);
    try {
      await verifyDocument(companyId, doc.doc_id, owner.trim());
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-1 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-2 p-3">
      {doc.verified ? (
        <span className="inline-flex items-center gap-1.5 text-sm font-medium" style={{ color: "var(--green)" }}>
          ✓ Verified{doc.owner ? ` by ${doc.owner}` : ""} · {relativeDate(doc.verified_at)}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-sm font-medium" style={{ color: "var(--amber)" }}>
          ⚠ Unverified — employees see this warning on answers from this doc
        </span>
      )}
      <div className="ml-auto flex items-center gap-2">
        <input
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          placeholder="Owner (e.g. HR Team)"
          className="input w-40 px-3 py-1.5 text-sm"
        />
        <button onClick={verify} disabled={busy || !owner.trim()} className="btn-primary px-3 py-1.5 text-sm">
          {doc.verified ? "Re-verify" : "Mark verified"}
        </button>
      </div>
    </div>
  );
}

export default function DocumentPage() {
  const params = useParams();
  const docId = decodeURIComponent(Array.isArray(params.id) ? params.id[0] : params.id ?? "");
  const [companyId, , ready] = useCompany();
  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const markRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    try {
      setHighlight(new URLSearchParams(window.location.search).get("q"));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (doc && highlight && markRef.current) {
      markRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [doc, highlight]);

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

          <VerifyBar doc={doc} companyId={companyId} onDone={load} />
          <AudienceBar doc={doc} companyId={companyId} onDone={load} />

          <section className="mb-5 mt-5">
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
            {highlight && (
              <div className="mb-2 text-xs text-muted-dim">
                Showing where the cited fact came from — highlighted below.
              </div>
            )}
            <div className="card whitespace-pre-wrap p-5 text-sm leading-relaxed text-muted">
              {(() => {
                const parts = splitForHighlight(doc.text, highlight);
                if (!parts) return doc.text;
                return (
                  <>
                    {parts[0]}
                    <mark
                      ref={markRef}
                      style={{ background: "var(--accent-weak)", color: "var(--foreground)", borderRadius: 4, padding: "1px 3px", boxShadow: "0 0 0 2px var(--accent-weak)" }}
                    >
                      {parts[1]}
                    </mark>
                    {parts[2]}
                  </>
                );
              })()}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
