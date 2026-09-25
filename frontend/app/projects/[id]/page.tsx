"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getProject, addProjectEntries, askProject, type Project, type ProjectAnswer } from "@/lib/api";
import { useCompany } from "@/lib/useCompany";
import { ErrorNote } from "../../components/ui";
import { IconArrow, IconCheck, IconGap, IconChat, IconSparkle } from "../../components/icons";

const KIND_META: Record<string, { label: string; color: string }> = {
  decision: { label: "Decisions", color: "var(--green)" },
  action: { label: "Action items", color: "var(--accent)" },
  question: { label: "Open questions", color: "var(--amber)" },
  note: { label: "Notes", color: "var(--muted)" },
};
const ORDER = ["decision", "action", "question", "note"];

export default function ProjectPage() {
  const params = useParams();
  const projectId = decodeURIComponent(Array.isArray(params.id) ? params.id[0] : params.id ?? "");
  const [companyId, , ready] = useCompany();
  const [proj, setProj] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState("decision");
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);

  const [q, setQ] = useState("");
  const [asking, setAsking] = useState(false);
  const [ans, setAns] = useState<ProjectAnswer | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setProj(await getProject(companyId, projectId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [companyId, projectId]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  async function add() {
    if (!title.trim()) return;
    setAdding(true);
    try {
      await addProjectEntries(companyId, projectId, [{ kind, title: title.trim() }]);
      setTitle("");
      await load();
    } finally {
      setAdding(false);
    }
  }

  async function ask() {
    if (!q.trim()) return;
    setAsking(true);
    setAns(null);
    try {
      setAns(await askProject(companyId, projectId, q.trim()));
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/projects" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground">
        <span className="inline-block rotate-180"><IconArrow size={15} /></span> All projects
      </Link>

      {error && <ErrorNote message={error} />}
      {!proj && !error && <div className="h-40 shimmer" />}

      {proj && (
        <div className="animate-fade-up">
          <h1 className="text-2xl font-bold tracking-tight">{proj.name}</h1>
          {proj.description && <p className="mt-1.5 text-sm text-muted">{proj.description}</p>}

          {/* Ask the project */}
          <section className="mt-5 card p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><span className="text-accent"><IconSparkle size={16} /></span> Ask this project</h2>
            <p className="mt-1 text-xs text-muted">e.g. “Why did we choose PostgreSQL?” or “What’s still unresolved?” — answered from this project’s memory + company knowledge.</p>
            <div className="mt-2 flex gap-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()}
                placeholder="Ask about this project…" className="input flex-1 px-3 py-2 text-sm" />
              <button onClick={ask} disabled={asking || !q.trim()} className="btn-primary px-4 py-2 text-sm">{asking ? "…" : "Ask"}</button>
            </div>
            {ans && (
              <div className="animate-scale-in mt-3 rounded-xl border border-border bg-surface-2 p-3 text-sm leading-relaxed">
                {ans.answer}
              </div>
            )}
          </section>

          {/* Add entry */}
          <section className="mt-4 card p-5">
            <h2 className="text-sm font-semibold">Add to project memory</h2>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <select value={kind} onChange={(e) => setKind(e.target.value)} className="input px-3 py-2 text-sm sm:w-40">
                {ORDER.map((k) => <option key={k} value={k}>{KIND_META[k].label.replace(/s$/, "")}</option>)}
              </select>
              <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()}
                placeholder="What happened / was decided…" className="input flex-1 px-3 py-2 text-sm" />
              <button onClick={add} disabled={adding || !title.trim()} className="btn-ghost px-4 py-2 text-sm">{adding ? "Adding…" : "Add"}</button>
            </div>
          </section>

          {/* Memory grouped by kind */}
          <div className="mt-4 space-y-4">
            {ORDER.filter((k) => proj.entries.some((e) => e.kind === k)).map((k) => (
              <section key={k} className="card p-5">
                <h3 className="flex items-center gap-2 text-sm font-semibold" style={{ color: KIND_META[k].color }}>
                  {k === "decision" ? <IconCheck size={15} /> : k === "question" ? <IconGap size={15} /> : <IconChat size={15} />}
                  {KIND_META[k].label}
                </h3>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {proj.entries.filter((e) => e.kind === k).map((e) => (
                    <li key={e.id} className="flex items-start gap-2">
                      <span style={{ color: KIND_META[k].color }}>•</span>
                      <span>{e.title}
                        {(e.owner || e.due) && <span className="ml-1 text-xs text-muted-dim">({[e.owner, e.due].filter(Boolean).join(" · ")})</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {proj.entries.length === 0 && <p className="py-8 text-center text-sm text-muted">No memory yet. Add an entry above, or save a meeting from the Workspace.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
