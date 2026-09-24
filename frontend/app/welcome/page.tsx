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
  { Icon: IconChat, tag: "Ask", title: "Answers in seconds", body: "Anyone can ask a question in plain English and get a clear answer — no training, no digging through shared drives." },
  { Icon: IconShieldCheck, tag: "Trust", title: "Answers you can trust", body: "Every answer shows the exact document it came from, so your team can act with confidence instead of second-guessing." },
  { Icon: IconUsers, tag: "Trust", title: "The right people, the right answers", body: "Sensitive policies stay private. People only ever get answers from the documents their role is allowed to see." },
  { Icon: IconHealth, tag: "Trust", title: "One source of truth", body: "When two documents disagree, Lore catches it and points everyone to the official, up-to-date version." },
  { Icon: IconAlert, tag: "Trust", title: "Nothing slips through the cracks", body: "Lore quietly watches for outdated, unowned or missing information and flags it before it causes confusion." },
  { Icon: IconSearch, tag: "Trust", title: "Finds the gaps you missed", body: "It asks the tricky follow-up questions your team will — and shows you where your policies don't have an answer yet." },
  { Icon: IconClock, tag: "Stay current", title: "Always up to date", body: "Update a policy once and every answer reflects it instantly — with a plain-English summary of what changed." },
  { Icon: IconCheck, tag: "Stay current", title: "Change with confidence", body: "Before an update goes live, Lore checks it won't quietly break the answers your team already relies on." },
  { Icon: IconSparkle, tag: "Improve", title: "Gets better on its own", body: "The questions people keep asking become new, verified answers — your knowledge base fills its own gaps over time." },
];

const LOOP = [
  { Icon: IconChat, title: "Answer", body: "clear, sourced answers in seconds" },
  { Icon: IconHealth, title: "Check", body: "spots gaps, conflicts & stale info" },
  { Icon: IconClock, title: "Keep current", body: "one update, reflected everywhere" },
  { Icon: IconSparkle, title: "Improve", body: "turns questions into answers" },
  { Icon: IconShieldCheck, title: "Stay honest", body: "revisits old answers when things change" },
];

const STEPS = [
  { n: "01", title: "Add your documents", body: "Upload your handbooks, policies and how-tos — or connect a Google Drive folder. PDFs, Word, anything." },
  { n: "02", title: "Lore learns them", body: "It reads and organizes everything, so it understands how your policies connect — no setup or tagging needed." },
  { n: "03", title: "Your team just asks", body: "Everyone gets clear, sourced answers that always reflect your latest documents — from day one." },
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
              <span className="h-1.5 w-1.5 rounded-full bg-green" /> One place for every company answer
            </div>
            <h1 className="animate-fade-up text-4xl font-bold leading-[1.05] tracking-tight md:text-6xl" style={{ animationDelay: "60ms" }}>
              Every company answer,
              <br className="hidden md:block" /> <span className="gradient-text">that your team can trust.</span>
            </h1>
            <p className="animate-fade-up mx-auto mt-5 max-w-xl text-lg text-muted" style={{ animationDelay: "120ms" }}>
              Lore turns your handbooks, policies and how-tos into one place your whole team can just ask — and get a clear,
              trustworthy answer in seconds. No more digging through drives or pinging colleagues. Works for teams of 5 or 5,000.
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
                    <div className="mt-1 pl-7 text-[11px] text-muted-dim">Updated 2 weeks ago · the official HR policy</div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium" style={{ background: "color-mix(in srgb, var(--green) 14%, transparent)", color: "var(--green)" }}>
                      <IconShieldCheck size={11} /> Double-checked
                    </span>
                    <span className="text-muted-dim">an older doc still said 20 — Lore used the current one</span>
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
          {[["Answers in seconds", "not hours of searching"], ["Always current", "never an outdated answer"], ["Private by design", "the right people only"], ["Trusted", "every answer is sourced"]].map(([a, b]) => (
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
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Not just a chatbot. <span className="gradient-text">A knowledge base that looks after itself.</span></h2>
          <p className="mt-4 text-muted">Most tools answer and stop there. Lore keeps your knowledge healthy — spotting what&apos;s out of date, keeping every change in sync, and filling the gaps your team keeps running into.</p>
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
        <p className="mt-6 text-center text-xs text-muted-dim">…and repeat — so the answers your team relies on stay right, without anyone babysitting them.</p>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-5 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Everything your team needs to <span className="gradient-text">stop guessing.</span></h2>
          <p className="mt-4 text-muted">From the first question to keeping every policy current — Lore handles the busywork so your team gets answers they can rely on.</p>
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
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Knowledge that <span className="gradient-text">stays right on its own.</span></h2>
            <p className="mt-4 text-muted">The hidden cost of a wiki isn&apos;t writing it — it&apos;s keeping it trustworthy. Lore does that part for you:</p>
            <ul className="mt-5 space-y-3">
              {[
                "No more answers pulled from an outdated document",
                "Everyone sees the same official version — no conflicting advice",
                "New hires get up to speed from day one",
                "Sensitive information stays with the right people",
                "The questions people keep asking turn into real answers",
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
              <IconHealth size={16} /> Two documents don&apos;t agree
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
              <IconCheck size={13} /> Sorted → everyone&apos;s pointed to the official Paid Time Off Policy
            </div>
            <p className="mt-2 text-xs text-muted-dim">Lore catches the mismatch and points everyone to the right one — before someone acts on the wrong number.</p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-5 pb-20">
        <div className="relative overflow-hidden rounded-3xl border border-border px-6 py-14 text-center" style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--accent) 14%, var(--surface)), var(--surface))" }}>
          <div className="hero-glow" />
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Give your team one place to ask.</h2>
          <p className="mx-auto mt-3 max-w-md text-muted">Clear answers, always current, private by default. Try it now — a sample company is ready to explore, no signup needed.</p>
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
