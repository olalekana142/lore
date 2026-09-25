"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { listProjects, createProject, type ProjectSummary } from "@/lib/api";
import { useCompany } from "@/lib/useCompany";
import { PageHeader, ErrorNote } from "../components/ui";
import { IconGap, IconArrow } from "../components/icons";

export default function ProjectsPage() {
  const [companyId, , ready] = useCompany();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setProjects(await listProjects(companyId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [companyId]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  async function create() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await createProject(companyId, name.trim(), desc.trim());
      setName(""); setDesc("");
      await load();
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Projects" subtitle="Durable memory for a piece of work — decisions, action items and open questions you can ask later." />

      <section className="animate-fade-up card mb-5 p-5">
        <h2 className="text-sm font-semibold">New project</h2>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name (e.g. Enterprise Migration)" className="input flex-1 px-3 py-2 text-sm" />
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Short description (optional)" className="input flex-1 px-3 py-2 text-sm" />
          <button onClick={create} disabled={creating || !name.trim()} className="btn-primary px-4 py-2 text-sm">{creating ? "Creating…" : "Create"}</button>
        </div>
      </section>

      {error && <ErrorNote message={error} />}

      {projects && projects.length === 0 && (
        <p className="py-10 text-center text-sm text-muted">No projects yet. Create one above, or save a meeting from the Workspace.</p>
      )}

      <div className="space-y-3">
        {projects?.map((p, i) => (
          <Link key={p.id} href={`/projects/${encodeURIComponent(p.id)}`}
            style={{ animationDelay: `${i * 50}ms` }}
            className="animate-fade-up card flex items-center justify-between gap-4 p-4 transition-colors hover:border-accent">
            <div className="min-w-0">
              <div className="font-medium">{p.name}</div>
              {p.description && <div className="mt-0.5 truncate text-xs text-muted">{p.description}</div>}
            </div>
            <div className="flex shrink-0 items-center gap-3 text-xs text-muted-dim">
              <span className="inline-flex items-center gap-1"><IconGap size={13} /> {p.entries} item{p.entries === 1 ? "" : "s"}</span>
              <IconArrow size={15} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
