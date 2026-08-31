"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCompany } from "@/lib/useCompany";
import { useTheme } from "@/lib/useTheme";
import {
  IconHome,
  IconChat,
  IconLibrary,
  IconGap,
  IconUpload,
  IconHealth,
  IconRocket,
  IconSun,
  IconMoon,
} from "./icons";

const NAV = [
  { href: "/", label: "Dashboard", Icon: IconHome },
  { href: "/ask", label: "Ask Lore", Icon: IconChat },
  { href: "/library", label: "Documents", Icon: IconLibrary },
  { href: "/gaps", label: "Knowledge gaps", Icon: IconGap },
  { href: "/health", label: "Content health", Icon: IconHealth },
  { href: "/onboarding", label: "Onboarding", Icon: IconRocket },
  { href: "/connect", label: "Add documents", Icon: IconUpload },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [companyId, setCompanyId, ready] = useCompany();
  const [theme, toggleTheme, themeReady] = useTheme();

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col gap-6 border-r border-border bg-surface/70 px-3 py-5 backdrop-blur-xl">
      <Link href="/" className="flex items-center gap-2.5 px-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-accent-fg shadow-sm">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
          </svg>
        </span>
        <div>
          <div className="text-[17px] font-bold leading-none tracking-tight">Lore</div>
          <p className="mt-1 text-[10px] text-muted-dim">company knowledge, answered</p>
        </div>
      </Link>

      <nav className="flex flex-col gap-0.5">
        {NAV.map(({ href, label, Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-accent-weak text-accent"
                  : "text-muted hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-3">
        <button
          onClick={toggleTheme}
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          {themeReady && theme === "dark" ? <IconSun size={18} /> : <IconMoon size={18} />}
          {themeReady ? (theme === "dark" ? "Light mode" : "Dark mode") : "Theme"}
        </button>

        <div className="card p-3">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-dim">
            Workspace
          </label>
          <div className="mt-2 flex items-center gap-2">
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-accent-fg">
              {ready ? companyId.charAt(0).toUpperCase() : "…"}
            </div>
            <input
              value={ready ? companyId : ""}
              onChange={(e) => setCompanyId(e.target.value.trim() || "acme")}
              className="input w-full px-2.5 py-1.5 text-sm"
              placeholder="company id"
            />
          </div>
        </div>
      </div>
    </aside>
  );
}
