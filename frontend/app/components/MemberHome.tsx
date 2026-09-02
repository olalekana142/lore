"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getHome, type HomeData } from "@/lib/api";
import { relativeDate } from "@/lib/format";
import { ErrorNote } from "./ui";
import { IconChat, IconRocket, IconLibrary, IconArrow, IconClock } from "./icons";

export default function MemberHome({ companyId, name }: { companyId: string; name: string }) {
  const router = useRouter();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [started, setStarted] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await getHome(companyId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [companyId]);

  useEffect(() => {
    load();
    // "started onboarding" = any saved playbook progress for this company
    try {
      const prefix = `lore.onboard.${companyId}.`;
      let found = false;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) { found = true; break; }
      }
      setStarted(found);
    } catch {
      setStarted(false);
    }
  }, [load, companyId]);

  const ask = (question: string) => {
    if (!question.trim()) return;
    router.push(`/ask?q=${encodeURIComponent(question.trim())}`);
  };

  return (
    <div className="mx-auto max-w-4xl">
      <header className="animate-fade-up mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          {name ? `Welcome, ${name.split(" ")[0]}` : "Welcome"} 👋
        </h1>
        <p className="mt-1.5 text-sm text-muted">Ask anything about {companyId} — answers come from the company&apos;s own documents.</p>
      </header>

      {/* Ask bar */}
      <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="animate-fade-up mb-4 flex gap-2" style={{ animationDelay: "60ms" }}>
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-dim"><IconChat size={17} /></span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a question…" className="input w-full py-3 pl-10 pr-4 text-sm" />
        </div>
        <button type="submit" className="btn-primary px-5 text-sm">Ask</button>
      </form>

      {error && <ErrorNote message={error} />}

      {/* Onboarding card — front and center for new hires */}
      {started !== null && (
        <div className="animate-fade-up mb-4 overflow-hidden rounded-2xl border border-border" style={{ background: "linear-gradient(120deg, color-mix(in srgb, var(--accent) 12%, var(--surface)), var(--surface))", animationDelay: "100ms" }}>
          <div className="flex flex-wrap items-center gap-4 p-5">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-accent text-accent-fg"><IconRocket size={24} /></span>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">{started ? "Continue your onboarding" : "New here? Start your onboarding"}</h2>
              <p className="mt-0.5 text-sm text-muted">
                {started ? "Pick up your role-specific checklist and knowledge checks." : "Get a role-specific ramp plan with a checklist and quizzes graded on real policy."}
              </p>
            </div>
            <Link href="/onboarding" className="btn-primary flex shrink-0 items-center gap-2 px-4 py-2.5 text-sm">
              {started ? "Resume" : "Start"} <IconArrow size={16} />
            </Link>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Popular questions */}
        <section className="animate-fade-up card p-5" style={{ animationDelay: "140ms" }}>
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold"><span className="text-accent"><IconChat size={16} /></span> Popular questions</h2>
          <p className="mb-3 text-xs text-muted">What your teammates ask most — tap to ask.</p>
          {data?.popular_questions?.length ? (
            <div className="flex flex-wrap gap-2">
              {data.popular_questions.map((question) => (
                <button key={question} onClick={() => ask(question)} className="rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs text-muted transition-colors hover:border-accent hover:text-foreground">
                  {question}
                </button>
              ))}
            </div>
          ) : (
            <p className="py-4 text-center text-sm text-muted">No questions asked yet — be the first!</p>
          )}
        </section>

        {/* Recently updated */}
        <section className="animate-fade-up card p-5" style={{ animationDelay: "180ms" }}>
          <div className="mb-1 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><span className="text-accent"><IconClock size={16} /></span> Recently updated</h2>
            <Link href="/library" className="text-xs font-medium text-accent hover:underline">All docs →</Link>
          </div>
          <p className="mb-2 text-xs text-muted">Stay current on what changed.</p>
          <div className="divide-y divide-border-soft">
            {data?.recent_docs?.slice(0, 5).map((d) => (
              <Link key={d.doc_id} href={`/library/${d.doc_id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-accent">
                <span className="truncate">{d.title}</span>
                <span className="shrink-0 text-xs text-muted-dim">{relativeDate(d.updated_at)}</span>
              </Link>
            ))}
            {!data?.recent_docs?.length && <p className="py-4 text-center text-sm text-muted">No documents yet.</p>}
          </div>
        </section>
      </div>

      {/* Quick links */}
      <div className="animate-fade-up mt-4 grid grid-cols-3 gap-3" style={{ animationDelay: "220ms" }}>
        <QuickLink href="/ask" icon={<IconChat size={18} />} label="Ask Lore" />
        <QuickLink href="/library" icon={<IconLibrary size={18} />} label="Browse docs" />
        <QuickLink href="/onboarding" icon={<IconRocket size={18} />} label="Onboarding" />
      </div>
    </div>
  );
}

function QuickLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link href={href} className="card card-hover flex items-center gap-2.5 p-4 text-sm font-medium">
      <span className="text-accent">{icon}</span> {label}
    </Link>
  );
}
