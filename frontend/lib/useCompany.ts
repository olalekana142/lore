"use client";

import { useEffect, useState } from "react";

// The active company/workspace whose knowledge base we're querying. Persisted locally so
// it survives reloads. In a real product this comes from auth/SSO; for now it's a simple id.
const KEY = "lore.company_id";
const DEFAULT = "acme";

export function useCompany(): [string, (id: string) => void, boolean] {
  const [companyId, setId] = useState(DEFAULT);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    if (stored) setId(stored);
    setReady(true);
  }, []);

  const set = (id: string) => {
    setId(id);
    if (typeof window !== "undefined") window.localStorage.setItem(KEY, id);
  };

  return [companyId, set, ready];
}
