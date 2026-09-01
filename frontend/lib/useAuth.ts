"use client";

import { useEffect, useState } from "react";

export interface SessionUser {
  username: string;
  name: string;
  role: string;
  groups: string[];
  company_id: string;
}

/** Role rank helper for gating UI (admin > editor > member > anonymous). */
export function atLeast(role: string | undefined, min: "member" | "editor" | "admin"): boolean {
  const rank: Record<string, number> = { anonymous: 0, member: 1, editor: 2, admin: 3 };
  return (rank[role ?? "anonymous"] ?? 0) >= rank[min];
}

/** Reads the logged-in user from localStorage (set by lib/api.login). */
export function useAuth(): { user: SessionUser | null; ready: boolean; refresh: () => void } {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = () => {
    try {
      const raw = localStorage.getItem("lore.user");
      setUser(raw ? (JSON.parse(raw) as SessionUser) : null);
    } catch {
      setUser(null);
    }
  };

  useEffect(() => {
    refresh();
    setReady(true);
    // keep tabs in sync
    const onStorage = () => refresh();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return { user, ready, refresh };
}
