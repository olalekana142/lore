"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/api";
import { useCompany } from "@/lib/useCompany";

const DEMO = [
  { u: "hr_admin", p: "hr", label: "HR Admin", note: "sees restricted HR docs" },
  { u: "alice", p: "alice", label: "Alice · Engineering", note: "standard employee" },
  { u: "sam", p: "sam", label: "Sam · New hire", note: "public docs only" },
];

export default function LoginPage() {
  const router = useRouter();
  const [companyId, setCompanyId] = useCompany();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(u = username, p = password) {
    if (!u.trim() || !p) return;
    setBusy(true);
    setError(null);
    try {
      const res = await login(companyId, u.trim(), p);
      setCompanyId(res.company_id);
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm pt-16">
      <div className="animate-fade-up card p-7">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-accent-fg">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
            </svg>
          </span>
          <div>
            <div className="text-lg font-bold leading-none">Sign in to Lore</div>
            <p className="mt-1 text-xs text-muted-dim">Answers are scoped to what you&apos;re allowed to see.</p>
          </div>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-3">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-dim">Company</label>
            <input value={companyId} onChange={(e) => setCompanyId(e.target.value.trim() || "acme")} className="input mt-1 w-full px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-dim">Username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} className="input mt-1 w-full px-3 py-2 text-sm" autoFocus />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-dim">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input mt-1 w-full px-3 py-2 text-sm" />
          </div>
          {error && <p className="rounded-lg px-3 py-2 text-sm" style={{ background: "var(--red-weak)", color: "var(--red)" }}>{error}</p>}
          <button type="submit" disabled={busy} className="btn-primary w-full py-2.5 text-sm">
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="mt-5 border-t border-border-soft pt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-dim">Demo accounts</p>
          <div className="space-y-1.5">
            {DEMO.map((d) => (
              <button key={d.u} onClick={() => submit(d.u, d.p)} className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:border-accent">
                <span><b>{d.label}</b> <span className="text-xs text-muted-dim">· {d.note}</span></span>
                <span className="text-xs text-accent">use →</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
