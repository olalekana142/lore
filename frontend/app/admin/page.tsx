"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { listUsers, updateUser, type ManagedUser } from "@/lib/api";
import { useCompany } from "@/lib/useCompany";
import { useAuth, atLeast } from "@/lib/useAuth";
import { PageHeader, ErrorNote } from "../components/ui";

const ROLES = ["member", "editor", "admin"];

export default function AdminPage() {
  const router = useRouter();
  const [companyId] = useCompany();
  const { user, ready } = useAuth();
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setUsers(await listUsers(companyId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [companyId]);

  useEffect(() => {
    if (!ready) return;
    if (!atLeast(user?.role, "admin")) {
      router.replace("/");
      return;
    }
    load();
  }, [ready, user, load, router]);

  if (ready && !atLeast(user?.role, "admin")) return null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Users & roles" subtitle="Grant access. Members ask & read; editors curate; admins manage everything." />
      {error && <ErrorNote message={error} />}
      {!users && !error && <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 shimmer" />)}</div>}
      {users && (
        <div className="space-y-2">
          {users.map((u) => (
            <UserRow key={u.username} companyId={companyId} u={u} isSelf={u.username === user?.username} onSaved={load} />
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-muted-dim">
        <b>Roles:</b> member (ask + read permitted docs) · editor (curate: add/verify docs, resolve escalations, set access) · admin (+ manage users).
        <br /><b>Groups</b> control which restricted documents a person can see (e.g. <code>hr</code>, <code>finance</code>).
      </p>
    </div>
  );
}

function UserRow({ companyId, u, isSelf, onSaved }: { companyId: string; u: ManagedUser; isSelf: boolean; onSaved: () => void }) {
  const [role, setRole] = useState(u.role);
  const [groups, setGroups] = useState(u.groups.join(", "));
  const [busy, setBusy] = useState(false);
  const dirty = role !== u.role || groups !== u.groups.join(", ");

  async function save() {
    setBusy(true);
    try {
      await updateUser(companyId, u.username, role, groups.split(",").map((g) => g.trim()).filter(Boolean));
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex flex-wrap items-center gap-3 p-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{u.name} {isSelf && <span className="text-xs text-muted-dim">(you)</span>}</div>
        <div className="text-xs text-muted-dim">@{u.username}</div>
      </div>
      <select value={role} onChange={(e) => setRole(e.target.value)} disabled={isSelf} className="input px-2.5 py-1.5 text-sm" title={isSelf ? "You can't change your own role" : ""}>
        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      <input value={groups} onChange={(e) => setGroups(e.target.value)} placeholder="groups (hr, finance)" className="input w-44 px-2.5 py-1.5 text-sm" />
      <button onClick={save} disabled={busy || !dirty} className="btn-primary px-3 py-1.5 text-sm">{busy ? "…" : "Save"}</button>
    </div>
  );
}
