"use client";

import { useEffect, useState } from "react";

export interface SessionUser {
  username: string;
  name: string;
  groups: string[];
  company_id: string;
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
