"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";

// Marketing / auth pages render full-bleed (no app sidebar); everything else is the app.
const BARE = ["/welcome", "/login"];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bare = BARE.some((b) => pathname === b || pathname.startsWith(b + "/"));

  if (bare) return <>{children}</>;

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 min-w-0 px-5 py-8 md:px-10 md:py-10">{children}</main>
    </div>
  );
}
