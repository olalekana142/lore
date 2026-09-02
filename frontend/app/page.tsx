"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCompany } from "@/lib/useCompany";
import { useAuth, atLeast, isGuest } from "@/lib/useAuth";
import MemberHome from "./components/MemberHome";
import OpsDashboard from "./components/OpsDashboard";

export default function Home() {
  const [companyId, , companyReady] = useCompany();
  const { user, ready: authReady } = useAuth();
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);

  // Front door: first-time / logged-out visitors see the landing page; logged-in users
  // and explicit guests get their home.
  useEffect(() => {
    if (!authReady) return;
    if (user || isGuest()) setAllowed(true);
    else router.replace("/welcome");
  }, [authReady, user, router]);

  if (!allowed || !companyReady) return null;

  // Editors & admins get the knowledge-ops dashboard; everyone else gets the employee home.
  return atLeast(user?.role, "editor") ? (
    <OpsDashboard companyId={companyId} role={user?.role ?? "editor"} />
  ) : (
    <MemberHome companyId={companyId} name={user?.name ?? ""} />
  );
}
