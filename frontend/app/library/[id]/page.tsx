"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  getDocument, verifyDocument, setAudience,
  getImpact, getHistory, getDiff, generateQuestions, knowledgeCheck, supersedeDocument, reanswer, setCanonical, detectAmbiguities,
  type DocDetail, type Impact, type History, type GeneratedQuestions, type KnowledgeCheck, type Reanswer, type Ambiguities,
} from "@/lib/api";
import { useCompany } from "@/lib/useCompany";
import { useAuth, atLeast } from "@/lib/useAuth";
import { relativeDate } from "@/lib/format";
import { ErrorNote } from "../../components/ui";
import { IconArrow, IconExternal, IconDoc, IconClock, IconGap, IconSparkle } from "../../components/icons";

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

function HistoryTimeline({ companyId, docId, canEdit }: { companyId: string; docId: string; canEdit: boolean }) {
  const [hist, setHist] = useState<History | null>(null);
  const [diffs, setDiffs] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    getHistory(companyId, docId).then(setHist).catch(() => {});
  }, [companyId, docId]);

  if (!hist || hist.versions.length < 2) return null; // only interesting with history

  async function whatChanged(fromVersion: number) {
    setBusy(fromVersion);
    try {
      const d = await getDiff(companyId, docId, fromVersion);
      setDiffs((prev) => ({ ...prev, [fromVersion]: d.summary }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mb-5">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><span className="text-accent"><IconClock size={16} /></span> Version history</h2>
      <div className="card p-4">
        <ol className="relative space-y-4 border-l border-border pl-5">
          {hist.versions.map((v) => (
            <li key={v.version} className="relative">
              <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-surface" style={{ background: v.is_current ? "var(--accent)" : "var(--muted-dim)" }} />
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <b>v{v.version}</b>
                {v.is_current ? (
                  <span className="chip" style={{ color: "var(--green)", borderColor: "var(--green)" }}>current</span>
                ) : (
                  <span className="chip">retired</span>
                )}
                <span className="text-xs text-muted-dim">{relativeDate(v.updated_at)}</span>
                {!v.is_current && canEdit && !diffs[v.version] && (
                  <button onClick={() => whatChanged(v.version)} disabled={busy === v.version} className="ml-auto text-xs font-medium text-accent hover:underline">
                    {busy === v.version ? "…" : "What changed?"}
                  </button>
                )}
              </div>
              <div className="mt-1 text-xs text-muted">{v.preview}…</div>
              {diffs[v.version] && (
                <div className="mt-2 whitespace-pre-wrap rounded-lg border border-border bg-surface-2 p-2.5 text-xs">{diffs[v.version]}</div>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function ImpactBar({ companyId, docId }: { companyId: string; docId: string }) {
  const [im, setIm] = useState<Impact | null>(null);
  useEffect(() => {
    getImpact(companyId, docId).then(setIm).catch(() => {});
  }, [companyId, docId]);
  if (!im) return null;
  return (
    <section className="mb-5">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><span className="text-accent"><IconGap size={16} /></span> Knowledge impact</h2>
      <div className="card p-4 text-sm">
        Editing or retiring this document could affect <b>{im.total_impact}</b> pieces of knowledge:{" "}
        {im.facts} facts · {im.related_docs.length} related documents · {im.affected_questions} questions on its topics
        {im.prior_versions > 0 && <> · {im.prior_versions} prior version(s)</>}.
        {im.affected_sample.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-xs text-muted">
            {im.affected_sample.map((q, i) => <li key={i}>{q.question} <span className="text-muted-dim">({q.asked}×)</span></li>)}
          </ul>
        )}
      </div>
    </section>
  );
}

function GenerateQuestions({ companyId, docId }: { companyId: string; docId: string }) {
  const [gen, setGen] = useState<GeneratedQuestions | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      setGen(await generateQuestions(companyId, docId));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><span className="text-accent"><IconSparkle size={16} /></span> What can this document answer?</h2>
        <button onClick={run} disabled={busy} className="btn-ghost px-3 py-1.5 text-xs">
          {busy ? "Generating…" : gen ? "Regenerate" : "Generate & verify"}
        </button>
      </div>
      {gen && (
        <div className="card p-4">
          <p className="mb-2 text-xs text-muted">{gen.verified.length} evidence-verified questions (grounded in this doc — ready to seed the eval set).</p>
          <ul className="space-y-1.5">
            {gen.verified.map((v, i) => (
              <li key={i} className="flex items-start gap-2 text-sm"><span style={{ color: "var(--green)" }}>✓</span>{v.question}</li>
            ))}
            {gen.rejected.map((r, i) => (
              <li key={`r${i}`} className="flex items-start gap-2 text-sm text-muted-dim"><span style={{ color: "var(--amber)" }}>✗</span>{r.question}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

const AMBIG_LABEL: Record<string, string> = {
  "undefined-term": "undefined term", exception: "unstated exception",
  "missing-condition": "missing condition", scope: "unclear scope", conflict: "internal conflict",
};

function AmbiguityFinder({ companyId, docId }: { companyId: string; docId: string }) {
  const [res, setRes] = useState<Ambiguities | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      setRes(await detectAmbiguities(companyId, docId));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className="text-accent"><IconGap size={16} /></span> Find ambiguities
        </h2>
        <button onClick={run} disabled={busy} className="btn-ghost px-3 py-1.5 text-xs">
          {busy ? "Probing…" : res ? "Re-run" : "Probe this policy"}
        </button>
      </div>
      <p className="mb-2 text-xs text-muted">
        Lore asks the edge-case questions a careful reader would — then flags the ones this
        policy doesn’t clearly answer.
      </p>
      {res && (
        <div className="card p-4">
          {res.ambiguities.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--green)" }}>
              ✓ No ambiguities found — the policy answered all {res.probed} probing questions.
            </p>
          ) : (
            <>
              <p className="mb-2 text-xs text-muted">
                {res.ambiguities.length} of {res.probed} probing questions weren’t clearly resolved by this policy
                {res.covered_count > 0 && ` (${res.covered_count} were)`}.
              </p>
              <ul className="space-y-2">
                {res.ambiguities.map((a, i) => (
                  <li key={i} className="rounded-lg bg-surface-2 p-2.5 text-sm">
                    <div className="flex items-start gap-2">
                      <span style={{ color: a.status === "unresolved" ? "var(--amber)" : "var(--muted)" }}>
                        {a.status === "unresolved" ? "⚠" : "↗"}
                      </span>
                      <div>
                        <div>{a.question}</div>
                        <div className="mt-0.5 text-xs text-muted-dim">
                          <span className="chip mr-1">{AMBIG_LABEL[a.type] ?? a.type}</span>
                          {a.status === "unresolved"
                            ? "not answered anywhere in the knowledge base"
                            : `answered elsewhere — ${(a.answered_by ?? []).join(", ")}`}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function KnowledgeCheckPanel({ companyId, docId }: { companyId: string; docId: string }) {
  const [chk, setChk] = useState<KnowledgeCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [retiring, setRetiring] = useState<string | null>(null);
  const [ra, setRa] = useState<Record<string, Reanswer>>({});
  const [raBusy, setRaBusy] = useState<string | null>(null);

  async function runReanswer(id: string) {
    setRaBusy(id);
    try {
      const res = await reanswer(companyId, id);
      setRa((m) => ({ ...m, [id]: res }));
    } finally {
      setRaBusy(null);
    }
  }

  async function run() {
    setBusy(true);
    try {
      setChk(await knowledgeCheck(companyId, docId));
    } finally {
      setBusy(false);
    }
  }
  async function retire(loser: string) {
    setRetiring(loser);
    try {
      await supersedeDocument(companyId, loser);
      await run();
    } finally {
      setRetiring(null);
    }
  }

  const tone = chk?.verdict === "clean" ? "var(--green)" : chk?.verdict === "regressions" ? "var(--red, #dc2626)" : "var(--amber)";
  const banner =
    chk?.verdict === "clean" ? "✓ Ready to publish — no conflicts, all governed evaluations pass"
    : chk?.verdict === "regressions" ? `✗ Blocked — ${chk.regressions} knowledge regression(s) would ship`
    : `⚠ Review needed — ${chk?.conflict_count} conflict(s) to resolve`;
  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className="text-accent"><IconClock size={16} /></span> Knowledge check
        </h2>
        <button onClick={run} disabled={busy} className="btn-primary px-3 py-1.5 text-xs">
          {busy ? "Checking…" : chk ? "Re-run check" : "Run knowledge check"}
        </button>
      </div>
      <p className="mb-2 text-xs text-muted">
        Before you rely on a change, Lore re-runs impact, conflict detection and the evaluation
        cases this document governs — the eval harness acting as a publishing gate.
      </p>
      {chk && (
        <div className="card p-4">
          <div
            className="mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold"
            style={{ background: `color-mix(in srgb, ${tone} 13%, transparent)`, color: tone }}
          >
            {banner}
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            {[
              ["Impact", chk.impact],
              ["Facts", chk.impact_detail.facts],
              ["Conflicts", chk.conflict_count],
              ["Eval cases", chk.eval_total],
            ].map(([k, v]) => (
              <div key={k as string} className="rounded-lg bg-surface-2 p-2 text-center">
                <div className="text-lg font-semibold text-fg">{v}</div>
                <div className="text-muted">{k}</div>
              </div>
            ))}
          </div>

          {chk.eval.length > 0 && (
            <div className="mb-3">
              <div className="mb-1 text-xs font-medium text-muted">Governed evaluation cases</div>
              <ul className="space-y-1">
                {chk.eval.map((e, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span style={{ color: e.pass ? "var(--green)" : "var(--red, #dc2626)" }}>{e.pass ? "✓" : "✗"}</span>
                    <span>
                      {e.question}
                      {!e.pass && (
                        <span className="mt-0.5 block text-xs text-muted-dim">
                          expected <b className="text-fg">{e.expected}</b> · now “{e.answer}”
                          {e.cause && <><br />cause: {e.cause}</>}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {chk.conflicts.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-medium text-muted">Conflicts introduced</div>
              <ul className="space-y-2">
                {chk.conflicts.map((c, i) => (
                  <li key={i} className="rounded-lg bg-surface-2 p-2 text-xs">
                    <div className="text-muted">{c.reason}</div>
                    <div className="mt-1">“{c.a.statement}” <span className="text-muted-dim">({c.a.title})</span></div>
                    <div>“{c.b.statement}” <span className="text-muted-dim">({c.b.title})</span></div>
                    <div className="mt-1 flex gap-2">
                      <button onClick={() => retire(c.b.doc_id)} disabled={retiring === c.b.doc_id} className="btn-ghost px-2 py-1 text-[11px]">
                        {retiring === c.b.doc_id ? "Retiring…" : `Retire ${c.b.title}`}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {chk.stale_answer_count > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-xs font-medium" style={{ color: "var(--amber)" }}>
                ⚠ {chk.stale_answer_count} past answer{chk.stale_answer_count > 1 ? "s were" : " was"} based on an older version of this document
              </div>
              <ul className="space-y-2">
                {chk.stale_answers.map((s) => (
                  <li key={s.id} className="rounded-lg bg-surface-2 p-2 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <span>“{s.question}”</span>
                      <button onClick={() => runReanswer(s.id)} disabled={raBusy === s.id} className="btn-ghost shrink-0 px-2 py-1 text-[11px]">
                        {raBusy === s.id ? "Re-answering…" : ra[s.id] ? "Re-answer" : "Re-answer"}
                      </button>
                    </div>
                    {ra[s.id] && (
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <div className="rounded bg-surface p-2">
                          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-dim">Old answer</div>
                          {ra[s.id].old_answer}
                        </div>
                        <div className="rounded p-2" style={{ background: "color-mix(in srgb, var(--green) 10%, transparent)" }}>
                          <div className="mb-1 text-[10px] uppercase tracking-wide" style={{ color: "var(--green)" }}>
                            New answer {ra[s.id].changed ? "· changed" : "· unchanged"}
                          </div>
                          {ra[s.id].new_answer}
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function CanonicalBar({ doc, companyId, onDone }: { doc: DocDetail; companyId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    try {
      await setCanonical(companyId, doc.doc_id, !doc.canonical);
      onDone();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mb-1 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-2 p-3">
      {doc.canonical ? (
        <span className="inline-flex items-center gap-1.5 text-sm font-medium" style={{ color: "var(--accent)" }}>
          ★ Authoritative source for its topics — retrieval and conflict resolution favour it
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-sm text-muted">
          Supporting source — not designated authoritative
        </span>
      )}
      <button onClick={toggle} disabled={busy} className="ml-auto btn-ghost px-3 py-1.5 text-sm">
        {busy ? "Saving…" : doc.canonical ? "Remove as canonical" : "Make canonical source"}
      </button>
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
  const { user } = useAuth();
  const canEdit = atLeast(user?.role, "editor");
  const isAdmin = atLeast(user?.role, "admin");
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
              {doc.canonical && (
                <span className="chip" style={{ background: "color-mix(in srgb, var(--accent) 16%, transparent)", color: "var(--accent)" }}>
                  ★ Authoritative source
                </span>
              )}
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

          {canEdit ? (
            <>
              <VerifyBar doc={doc} companyId={companyId} onDone={load} />
              <AudienceBar doc={doc} companyId={companyId} onDone={load} />
              {isAdmin && <CanonicalBar doc={doc} companyId={companyId} onDone={load} />}
            </>
          ) : (
            <div className="mb-1 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-2 p-3 text-sm">
              {doc.verified ? (
                <span style={{ color: "var(--green)" }}>✓ Verified{doc.owner ? ` by ${doc.owner}` : ""}</span>
              ) : (
                <span style={{ color: "var(--amber)" }}>⚠ Unverified</span>
              )}
              <span className="text-muted-dim">·</span>
              <span>{!doc.audience || doc.audience.includes("everyone") ? "🌐 Everyone" : `🔒 ${doc.audience.join(", ")}`}</span>
            </div>
          )}

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

          <HistoryTimeline companyId={companyId} docId={doc.doc_id} canEdit={canEdit} />
          {canEdit && <KnowledgeCheckPanel companyId={companyId} docId={doc.doc_id} />}
          {canEdit && <ImpactBar companyId={companyId} docId={doc.doc_id} />}
          {canEdit && <GenerateQuestions companyId={companyId} docId={doc.doc_id} />}
          {canEdit && <AmbiguityFinder companyId={companyId} docId={doc.doc_id} />}

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
