"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

// Resolve the currently applied theme, honoring an explicit choice, else the OS setting.
function current(): Theme {
  if (typeof document === "undefined") return "light";
  if (document.documentElement.classList.contains("dark")) return "dark";
  if (document.documentElement.classList.contains("light")) return "light";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useTheme(): [Theme, () => void, boolean] {
  const [theme, setTheme] = useState<Theme>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setTheme(current());
    setReady(true);
  }, []);

  const toggle = () => {
    const next: Theme = current() === "dark" ? "light" : "dark";
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(next);
    try {
      localStorage.setItem("lore.theme", next);
    } catch {
      /* ignore */
    }
    setTheme(next);
  };

  return [theme, toggle, ready];
}
