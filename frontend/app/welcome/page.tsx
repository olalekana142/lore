"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "@/lib/useTheme";
import { enterGuest } from "@/lib/useAuth";
import {
  IconChat, IconHealth, IconShieldCheck,
  IconClock, IconSparkle, IconAlert, IconSearch, IconCheck,
  IconUsers, IconSun, IconMoon, IconArrow,
} from "../components/icons";

const FEATURES = [
  { Icon: IconChat, tag: "Answer", title: "Cited answers, streamed", body: "Ask in plain English; get a synthesized answer that streams in and cites the exact documents it used." },
  { Icon: IconShieldCheck, tag: "Answer", title: "Why this answer — & Challenge it", body: "Every answer shows its evidence. Hit Challenge and Lore adversarially hunts for contradicting facts, then tells you whether the answer survives." },
  { Icon: IconUsers, tag: "Answer", title: "Permission-aware", body: "Roles and per-doc audiences mean people only ever see — and get cited — what they're allowed to." },
  { Icon: IconHealth, tag: "Audit", title: "Conflicts → canonical source", body: "Flags contradictory policies and resolves them: designate one authoritative source of truth and it wins in retrieval and conflicts." },
  { Icon: IconAlert, tag: "Audit", title: "Proactive alerts", body: "One prioritized feed — conflicts, stale docs, missing owners, outdated answers, unmet demand. Problems find you." },
  { Icon: IconSearch, tag: "Audit", title: "Ambiguity detection", body: "Probes a policy with the edge-case questions a careful reader would ask — and flags the ones it doesn't clearly answer." },
  { Icon: IconClock, tag: "Change", title: "Versioned & impact-aware", body: "Every change is versioned with a plain-English “what changed”, and Lore shows exactly what a change will affect before you publish." },
  { Icon: IconCheck, tag: "Change", title: "A publishing gate", body: "Publishing re-runs impact, conflict detection and the evaluation cases a document governs — a knowledge regression blocks the change." },
  { Icon: IconSparkle, tag: "Improve", title: "Self-healing knowledge", body: "Turn an unanswered question into a verified, cited doc — and re-answer the past answers a change quietly made stale." },
];

const LOOP = [
  { Icon: IconChat, title: "Answer", body: "grounded · cited · challengeable" },
  { Icon: IconHealth, title: "Audit", body: "gaps · conflicts · staleness · alerts" },
  { Icon: IconClock, title: "Change", body: "versions · impact · regressions" },
  { Icon: IconSparkle, title: "Improve", body: "gap → draft → publish" },
  { Icon: IconShieldCheck, title: "Re-evaluate", body: "stale answers → re-answer" },
];

const STEPS = [
  { n: "01", title: "Connect your docs", body: "Upload policies, SOPs, wikis and FAQs — or sync a Google Drive folder. PDF, DOCX, Markdown, CSV." },
  { n: "02", title: "Lore builds a graph", body: "It extracts atomic facts, links them to topics, versions and sources, and embeds everything for retrieval." },
  { n: "03", title: "Your team just asks", body: "Every answer is grounded, cited, permission-scoped, and always reflects the latest verified version." },
];

export default function Welcome() {
  const [theme, toggleTheme, ready] = useTheme();
  const router = useRouter();
  const demo = () => { enterGuest(); router.push("/"); };

  return (
    <div className="min-h-screen">
      {/* Nav */}
      <header className="glass-nav sticky top-0 z-30">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <Link href="/welcome" className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-accent-fg">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
              </svg>
            </span>
            <span className="text-lg font-bold tracking-tight">Lore</span>
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-muted md:flex">
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#how" className="hover:text-foreground">How it works</a>
            <a href="#why" className="hover:text-foreground">Why Lore</a>
          </nav>
          <div className="flex items-center gap-2">
            <button onClick={toggleTheme} className="grid h-9 w-9 place-items-center rounded-lg border border-border text-muted hover:text-foreground" aria-label="Toggle theme">
              {ready && theme === "dark" ? <IconSun size={17} /> : <IconMoon size={17} />}
            </button>
            <Link href="/login" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-muted hover:text-foreground sm:block">Sign in</Link>
            <Link href="/login" className="btn-primary px-4 py-2 text-sm">Get started</Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="hero-glow" />
        <div className="absolute inset-0 -z-10 grid-bg" />
        <div className="mx-auto max-w-6xl px-5 pb-16 pt-16 md:pt-24">
          <div className="mx-auto max-w-3xl text-center">
            <div className="animate-fade-up mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-surface/70 px-3 py-1 text-xs text-muted backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-green" /> GraphRAG knowledge base for your company
            </div>
            <h1 className="animate-fade-up text-4xl font-bold leading-[1.05] tracking-tight md:text-6xl" style={{ animationDelay: "60ms" }}>
              Your company&apos;s knowledge,
              <br className="hidden md:block" /> <span className="gradient-text">continuously verified.</span>
            </h1>
            <p className="animate-fade-up mx-auto mt-5 max-w-xl text-lg text-muted" style={{ animationDelay: "120ms" }}>
              Lore turns your policies, wikis and SOPs into a knowledge base anyone can just ask — with cited answers it can
              defend, a graph that catches what&apos;s stale, conflicting or missing, and a publishing gate that keeps every
              change honest.
            </p>
            <div className="animate-fade-up mt-8 flex flex-wrap justify-center gap-3" style={{ animationDelay: "180ms" }}>
              <Link href="/login" className="btn-primary flex items-center gap-2 px-6 py-3 text-sm">
                Get started free <IconArrow size={16} />
              </Link>
              <button onClick={demo} className="btn-ghost px-6 py-3 text-sm">Explore the live demo</button>
            </div>
            <p className="animate-fade-up mt-3 text-xs text-muted-dim" style={{ animationDelay: "220ms" }}>No setup — a sample company is preloaded.</p>
          </div>

          {/* Product mockup */}
          <div className="animate-fade-up floaty mx-auto mt-14 max-w-2xl" style={{ animationDelay: "300ms" }}>
            <div className="card overflow-hidden p-0 shadow-[var(--shadow)]">
              <div className="flex items-center gap-1.5 border-b border-border bg-surface-2 px-4 py-3">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--red)" }} />
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--amber)" }} />
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--green)" }} />
                <span className="ml-3 text-xs text-muted-dim">Ask Lore</span>
              </div>
              <div className="space-y-4 p-5 text-left">
                <div className="flex justify-end">
                  <div className="rounded-2xl rounded-br-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg">How many PTO days do I get?</div>
                </div>
                <div>
                  <div className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold text-green"><span className="h-1.5 w-1.5 rounded-full bg-current" /> High confidence</div>
                  <p className="text-[15px] leading-relaxed">
                    Full-time employees accrue <b>25 days</b> of paid time off per year, usable immediately on joining
                    <sup className="cite">1</sup>.
                  </p>
                  <div className="mt-3 rounded-xl border border-border bg-surface-2 p-3">
                    <div className="flex items-center gap-2">
                      <span className="grid h-5 w-5 place-items-center rounded bg-accent-weak text-[11px] font-bold text-accent">1</span>
                      <span className="text-sm font-semibold">Paid Time Off Policy</span>
                      <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-green"><IconCheck size={12} /> Verified · HR Team</span>
                    </div>
                    <div className="mt-1 pl-7 text-[11px] text-muted-dim">v2 · updated 2 weeks ago · ★ authoritative source</div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium" style={{ background: "color-mix(in srgb, var(--green) 14%, transparent)", color: "var(--green)" }}>
                      <IconShieldCheck size={11} /> Survives challenge
                    </span>
                    <span className="text-muted-dim">legacy “20 days” claim found &amp; beaten as superseded</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y border-border bg-surface/40">
        <div className="mx-auto grid max-w-4xl grid-cols-2 gap-6 px-5 py-10 text-center md:grid-cols-4">
          {[["Cited & defensible", "every answer"], ["Self-auditing", "conflicts · gaps · staleness"], ["Change-managed", "versions · impact · regressions"], ["Self-healing", "gap → draft → verify"]].map(([a, b]) => (
            <div key={a}>
              <div className="text-lg font-bold gradient-text">{a}</div>
              <div className="mt-1 text-xs text-muted">{b}</div>
            </div>
          ))}
        </div>
      </section>

      {/* The loop */}
      <section className="mx-auto max-w-6xl px-5 pt-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Not a chatbot. <span className="gradient-text">A knowledge loop.</span></h2>
          <p className="mt-4 text-muted">Lore doesn&apos;t just answer — it audits its own knowledge, manages every change, fills its own gaps, and re-checks past answers when the source moves.</p>
        </div>
        <div className="mt-12 flex flex-wrap items-stretch justify-center gap-3">
          {LOOP.map((s, i) => (
            <div key={s.title} className="flex items-center gap-3">
              <div className="marketing-card animate-fade-up flex w-[188px] flex-col items-center px-4 py-5 text-center" style={{ animationDelay: `${i * 70}ms` }}>
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-weak text-accent"><s.Icon size={20} /></span>
                <div className="mt-3 font-semibold">{s.title}</div>
                <div className="mt-1 text-xs text-muted-dim">{s.body}</div>
              </div>
              {i < LOOP.length - 1 && <span className="hidden text-muted-dim lg:block"><IconArrow size={18} /></span>}
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-muted-dim">…then repeat. Every generated artifact stays traceable to the exact knowledge state it came from.</p>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-5 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">More than search. <span className="gradient-text">Understanding.</span></h2>
          <p className="mt-4 text-muted">Most tools do flat lookup over your files. Lore reasons across them — because your knowledge is a graph, not a pile of documents.</p>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <div key={f.title} className="marketing-card animate-fade-up p-6" style={{ animationDelay: `${i * 50}ms` }}>
              <div className="flex items-center justify-between">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent-weak text-accent"><f.Icon size={22} /></span>
                <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-dim">{f.tag}</span>
              </div>
              <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-y border-border bg-surface/40">
        <div className="mx-auto max-w-5xl px-5 py-20">
          <h2 className="text-center text-3xl font-bold tracking-tight md:text-4xl">Live in minutes</h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="relative">
                <div className="font-mono text-sm font-semibold text-accent">{s.n}</div>
                <h3 className="mt-2 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why / differentiator */}
      <section id="why" className="mx-auto max-w-6xl px-5 py-20">
        <div className="grid items-center gap-10 md:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Knowledge that <span className="gradient-text">keeps itself honest.</span></h2>
            <p className="mt-4 text-muted">Because Lore links every fact to its source, version and topic, it can do things flat vector search can&apos;t:</p>
            <ul className="mt-5 space-y-3">
              {[
                "Flag two documents that contradict — and resolve them via the canonical source",
                "Adversarially challenge an answer and prove whether it survives",
                "Block a change that would regress questions the document governs",
                "Re-check past answers when the source they cited changes version",
                "Fill its own gaps: unanswered question → drafted, verified doc",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-sm">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md text-accent-fg" style={{ background: "var(--accent)" }}><IconCheck size={13} /></span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="marketing-card p-6">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--red)" }}>
              <IconHealth size={16} /> Conflict detected across 2 documents
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-surface-2 p-3">
                <div className="text-[11px] font-semibold uppercase text-muted-dim">Paid Time Off Policy</div>
                <div className="mt-1 text-sm">Employees accrue <b>25 days</b> PTO per year.</div>
              </div>
              <div className="rounded-lg border border-border bg-surface-2 p-3">
                <div className="text-[11px] font-semibold uppercase text-muted-dim">Employee FAQ (legacy)</div>
                <div className="mt-1 text-sm">Staff receive <b>20 days</b> vacation per year.</div>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium" style={{ background: "color-mix(in srgb, var(--green) 12%, transparent)", color: "var(--green)" }}>
              <IconCheck size={13} /> Resolved → “Paid Time Off Policy” wins (canonical · current · verified)
            </div>
            <p className="mt-2 text-xs text-muted-dim">Lore doesn&apos;t just catch the mismatch — it recommends the authoritative side and can retire the loser.</p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-5 pb-20">
        <div className="relative overflow-hidden rounded-3xl border border-border px-6 py-14 text-center" style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--accent) 14%, var(--surface)), var(--surface))" }}>
          <div className="hero-glow" />
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Give your team one place to ask.</h2>
          <p className="mx-auto mt-3 max-w-md text-muted">Cited, current, and scoped to who&apos;s asking. Try the live demo — no signup needed.</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/login" className="btn-primary flex items-center gap-2 px-6 py-3 text-sm">Get started <IconArrow size={16} /></Link>
            <button onClick={demo} className="btn-ghost px-6 py-3 text-sm">Explore the demo</button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-sm text-muted-dim">
          <div className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-accent text-accent-fg">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></svg>
            </span>
            <span className="font-semibold text-foreground">Lore</span> — company knowledge, answered.
          </div>
          <div className="flex gap-5">
            <a href="#features" className="hover:text-foreground">Features</a>
            <Link href="/login" className="hover:text-foreground">Sign in</Link>
            <button onClick={demo} className="hover:text-foreground">Demo</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
