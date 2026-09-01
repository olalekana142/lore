"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login, register } from "@/lib/api";
import { useCompany } from "@/lib/useCompany";

const DEMO = [
  { u: "boss", p: "boss", label: "Dana · Admin", note: "full access + user management" },
  { u: "hr_admin", p: "hr", label: "HR Admin · Editor", note: "sees restricted HR docs, curates" },
  { u: "alice", p: "alice", label: "Alice · Member", note: "engineering employee" },
  { u: "sam", p: "sam", label: "Sam · Member", note: "new hire, public docs only" },
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
    <div className="mx-auto max-w-sm pt-14">
      <div className="animate-fade-up card p-7">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-accent-fg">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
            </svg>
          </span>
          <div>
            <div className="text-lg font-bold leading-none">Welcome to Lore</div>
            <p className="mt-1 text-xs text-muted-dim">Answers scoped to what you&apos;re allowed to see.</p>
          </div>
        </div>

        <div className="mb-4 inline-flex w-full rounded-lg border border-border bg-surface-2 p-1">
          {(["signin", "signup"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(null); }}
              className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${mode === m ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}
            >
              {m === "signin" ? "Sign in" : "Sign up"}
            </button>
          ))}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-3">
          <Field label="Company">
            <input value={companyId} onChange={(e) => setCompanyId(e.target.value.trim() || "acme")} className="input w-full px-3 py-2 text-sm" />
          </Field>
          {mode === "signup" && (
            <Field label="Full name">
              <input value={name} onChange={(e) => setName(e.target.value)} className="input w-full px-3 py-2 text-sm" placeholder="Jane Doe" />
            </Field>
          )}
          <Field label="Username">
            <input value={username} onChange={(e) => setUsername(e.target.value)} className="input w-full px-3 py-2 text-sm" autoFocus />
          </Field>
          <Field label="Password">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input w-full px-3 py-2 text-sm" />
          </Field>
          {error && <p className="rounded-lg px-3 py-2 text-sm" style={{ background: "var(--red-weak)", color: "var(--red)" }}>{error}</p>}
          <button type="submit" disabled={busy} className="btn-primary w-full py-2.5 text-sm">
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
          {mode === "signup" && <p className="text-center text-[11px] text-muted-dim">New accounts join as a <b>member</b>; an admin can grant more access.</p>}
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
      </div>
      <p className="mt-3 text-center text-xs text-muted-dim">
        Or <button onClick={() => router.push("/")} className="text-accent hover:underline">continue as guest</button> (public documents only).
      </p>
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
