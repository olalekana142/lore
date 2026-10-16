"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCompany } from "@/lib/useCompany";
import WorkspaceDashboard from "../components/WorkspaceDashboard";
import DeliverableStudio from "../components/DeliverableStudio";
import MeetingIntelligence from "../components/MeetingIntelligence";
import DocIntelligence from "../components/DocIntelligence";
import Modal from "../components/Modal";
import { IconSparkle, IconSearch } from "../components/icons";

type Tool = null | "create" | "meeting" | "document";

const MODAL_META: Record<Exclude<Tool, null>, { title: string; subtitle: string }> = {
  create: { title: "Create a deliverable", subtitle: "Describe what you need — Lore drafts it from company knowledge, cited and flagged for review." },
  meeting: { title: "Meeting intelligence", subtitle: "Paste a transcript — get decisions, action items, a recap email, and a policy check." },
  document: { title: "Document intelligence", subtitle: "Paste a contract or document — summarize, extract obligations, or check it against your policies." },
};

export default function WorkspacePage() {
  const [companyId] = useCompany();
  const router = useRouter();
  const [ask, setAsk] = useState("");
  const [tool, setTool] = useState<Tool>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const bump = () => setRefreshKey((k) => k + 1);

  return (
    <div className="mx-auto max-w-6xl">
      {/* Top bar */}
      <header className="animate-fade-up mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Your workspace</h1>
          <p className="mt-1 text-sm text-muted">Turn company knowledge into completed work.</p>
        </div>
        <div className="flex items-center gap-2">
          <form onSubmit={(e) => { e.preventDefault(); if (ask.trim()) router.push(`/ask?q=${encodeURIComponent(ask.trim())}`); }} className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-dim"><IconSearch size={16} /></span>
            <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Ask anything about how we work…" className="input w-72 max-w-full py-2.5 pl-9 pr-3 text-sm" />
          </form>
          <button onClick={() => setTool("create")} className="btn-primary flex shrink-0 items-center gap-1.5 px-4 py-2.5 text-sm">
            <IconSparkle size={16} /> New task
          </button>
        </div>
      </header>

      <WorkspaceDashboard companyId={companyId} refreshKey={refreshKey} onLaunch={(t) => setTool(t as Tool)} />

      {/* Tool pop-ups */}
      <Modal open={tool !== null} onClose={() => setTool(null)} title={tool ? MODAL_META[tool].title : ""} subtitle={tool ? MODAL_META[tool].subtitle : ""}>
        {tool === "create" && <DeliverableStudio companyId={companyId} onCreated={bump} embedded />}
        {tool === "meeting" && <MeetingIntelligence companyId={companyId} onSaved={bump} />}
        {tool === "document" && <DocIntelligence companyId={companyId} embedded />}
      </Modal>
    </div>
  );
}
