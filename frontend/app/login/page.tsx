"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { login, register } from "@/lib/api";
import { useCompany } from "@/lib/useCompany";
import { enterGuest } from "@/lib/useAuth";
import { IconCheck, IconArrow } from "../components/icons";

const DEMO = [
  { u: "boss", p: "boss", label: "Dana · Admin", note: "full access + user management" },
  { u: "hr_admin", p: "hr", label: "HR Admin · Editor", note: "sees restricted HR docs, curates" },
  { u: "alice", p: "alice", label: "Alice · Member", note: "engineering employee" },
  { u: "sam", p: "sam", label: "Sam · Member", note: "new hire, public docs only" },
];

const BULLETS = [
  "Cited answers from your own documents",
  "Permission-aware — scoped to your role",
  "Always reflects the latest version",
];

type Mode = "signin" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const [companyId, setCompanyId] = useCompany();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(u = username, p = password) {
    if (!u.trim() || !p) return;
    setBusy(true);
    setError(null);
    try {
      const res = mode === "signup"
        ? await register(companyId, u.trim(), p, name.trim())
        : await login(companyId, u.trim(), p);
      setCompanyId(res.company_id);
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen md:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden p-10 md:flex md:flex-col md:justify-between" style={{ background: "linear-gradient(150deg, color-mix(in srgb, var(--accent) 20%, var(--surface)), var(--surface))" }}>
        <div className="hero-glow" />
        <Link href="/welcome" className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-accent-fg">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></svg>
          </span>
          <span className="text-lg font-bold tracking-tight">Lore</span>
        </Link>

        <div>
          <h1 className="text-3xl font-bold leading-tight tracking-tight">
            Your company&apos;s knowledge,<br /><span className="gradient-text">answered.</span>
          </h1>
          <ul className="mt-6 space-y-3">
            {BULLETS.map((b) => (
              <li key={b} className="flex items-center gap-2.5 text-sm">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-accent-fg" style={{ background: "var(--accent)" }}><IconCheck size={13} /></span>
                {b}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-muted-dim">A sample company is preloaded — sign in with a demo account to explore.</p>
      </div>

      {/* Form panel */}
      <div className="flex flex-col items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm">
          <Link href="/welcome" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground md:hidden">
            <span className="inline-block rotate-180"><IconArrow size={15} /></span> Home
          </Link>

          <h2 className="text-2xl font-bold tracking-tight">{mode === "signin" ? "Welcome back" : "Create your account"}</h2>
          <p className="mt-1 text-sm text-muted">{mode === "signin" ? "Sign in to your workspace." : "New accounts join as a member."}</p>

          <div className="mt-6 inline-flex w-full rounded-lg border border-border bg-surface-2 p-1">
            {(["signin", "signup"] as Mode[]).map((m) => (
              <button key={m} onClick={() => { setMode(m); setError(null); }} className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${mode === m ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}>
                {m === "signin" ? "Sign in" : "Sign up"}
              </button>
            ))}
          </div>

          <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="mt-4 space-y-3">
            <Field label="Company">
              <input value={companyId} onChange={(e) => setCompanyId(e.target.value.trim() || "acme")} className="input w-full px-3 py-2.5 text-sm" />
            </Field>
            {mode === "signup" && (
              <Field label="Full name">
                <input value={name} onChange={(e) => setName(e.target.value)} className="input w-full px-3 py-2.5 text-sm" placeholder="Jane Doe" />
              </Field>
            )}
            <Field label="Username">
              <input value={username} onChange={(e) => setUsername(e.target.value)} className="input w-full px-3 py-2.5 text-sm" autoFocus />
            </Field>
            <Field label="Password">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input w-full px-3 py-2.5 text-sm" />
            </Field>
            {error && <p className="rounded-lg px-3 py-2 text-sm" style={{ background: "var(--red-weak)", color: "var(--red)" }}>{error}</p>}
            <button type="submit" disabled={busy} className="btn-primary w-full py-2.5 text-sm">
              {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          {mode === "signin" && (
            <div className="mt-5 border-t border-border-soft pt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-dim">Demo accounts</p>
              <div className="space-y-1.5">
                {DEMO.map((d) => (
                  <button key={d.u} onClick={() => { setUsername(d.u); setPassword(d.p); submit(d.u, d.p); }} className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:border-accent">
                    <span><b>{d.label}</b> <span className="text-xs text-muted-dim">· {d.note}</span></span>
                    <span className="text-xs text-accent">use →</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <p className="mt-5 text-center text-xs text-muted-dim">
            Or <button onClick={() => { enterGuest(); router.push("/"); }} className="text-accent hover:underline">continue as guest</button> — public documents only.
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-wide text-muted-dim">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
