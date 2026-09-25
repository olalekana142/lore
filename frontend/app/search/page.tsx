"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { searchAll, type UniversalSearch } from "@/lib/api";
import { useCompany } from "@/lib/useCompany";
import { PageHeader } from "../components/ui";
import { IconSearch, IconLibrary, IconBook, IconCheck, IconGap, IconUsers, IconChat, IconArrow } from "../components/icons";

type Group = { key: keyof UniversalSearch; label: string };
const GROUPS: Group[] = [
  { key: "knowledge", label: "Answers" },
  { key: "documents", label: "Documents" },
  { key: "people", label: "People" },
  { key: "projects", label: "Projects" },
  { key: "decisions", label: "Decisions" },
  { key: "questions", label: "Questions" },
  { key: "actions", label: "Action items" },
  { key: "glossary", label: "Glossary" },
];

export default function SearchPage() {
  const [companyId, , ready] = useCompany();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<UniversalSearch | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    try { setQ(new URLSearchParams(window.location.search).get("q") ?? ""); } catch { /* ignore */ }
  }, []);

  const run = useCallback(async (query: string) => {
    if (!query.trim()) return;
    setBusy(true);
    try { setRes(await searchAll(companyId, query.trim())); } finally { setBusy(false); }
  }, [companyId]);

  useEffect(() => { if (ready && q.trim()) run(q); /* eslint-disable-next-line */ }, [ready]);

  const count = (k: Group["key"]) => (Array.isArray(res?.[k]) ? (res![k] as unknown[]).length : 0);
  const show = (k: Group["key"]) => filter === "all" || filter === k;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Search" subtitle="One place to find answers, documents, projects, decisions and the people to ask." />

      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-dim"><IconSearch size={16} /></span>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run(q)}
            placeholder="Search everything… e.g. PTO, refund, PostgreSQL" className="input w-full pl-9 pr-3 py-2.5 text-sm" />
        </div>
        <button onClick={() => run(q)} disabled={busy || !q.trim()} className="btn-primary px-5 py-2.5 text-sm">{busy ? "…" : "Search"}</button>
      </div>

      {res && (
        <>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {["all", ...GROUPS.map((g) => g.key)].map((k) => {
              const c = k === "all" ? res.total : count(k as Group["key"]);
              if (k !== "all" && c === 0) return null;
              const label = k === "all" ? "All" : GROUPS.find((g) => g.key === k)!.label;
              return (
                <button key={k} onClick={() => setFilter(k)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${filter === k ? "border-accent text-accent" : "border-border text-muted hover:text-foreground"}`}>
                  {label} <span className="text-muted-dim">{c}</span>
                </button>
              );
            })}
            <Link href={`/ask?q=${encodeURIComponent(res.query)}`} className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline">
              <IconChat size={13} /> Ask Lore this
            </Link>
          </div>

          {res.total === 0 && <p className="py-10 text-center text-sm text-muted">Nothing found. Try different words, or <Link href={`/ask?q=${encodeURIComponent(res.query)}`} className="text-accent hover:underline">ask Lore</Link>.</p>}

          <div className="mt-4 space-y-5">
            {show("knowledge") && res.knowledge.length > 0 && (
              <Section icon={<IconChat size={15} />} title="Answers">
                {res.knowledge.map((k, i) => (
                  <Link key={i} href={`/library/${encodeURIComponent(k.doc_id)}?q=${encodeURIComponent(k.statement)}`} className="row">
                    <span>{k.statement}</span>
                    <span className="src">{k.title}</span>
                  </Link>
                ))}
              </Section>
            )}
            {show("documents") && res.documents.length > 0 && (
              <Section icon={<IconLibrary size={15} />} title="Documents">
                {res.documents.map((d) => (
                  <Link key={d.doc_id} href={`/library/${encodeURIComponent(d.doc_id)}`} className="row">
                    <span>{d.title}</span>
                    {d.owner && <span className="src">owner: {d.owner}</span>}
                  </Link>
                ))}
              </Section>
            )}
            {show("people") && res.people.length > 0 && (
              <Section icon={<IconUsers size={15} />} title="People to ask">
                {res.people.map((p, i) => (
                  <div key={i} className="row"><span className="font-medium">{p.name}</span><span className="src">owns “{p.about}”</span></div>
                ))}
              </Section>
            )}
            {show("projects") && res.projects.length > 0 && (
              <Section icon={<IconBook size={15} />} title="Projects">
                {res.projects.map((p) => (
                  <Link key={p.id} href={`/projects/${encodeURIComponent(p.id)}`} className="row"><span>{p.name}</span>{p.description && <span className="src">{p.description}</span>}</Link>
                ))}
              </Section>
            )}
            {show("decisions") && res.decisions.length > 0 && (
              <Section icon={<IconCheck size={15} />} title="Decisions">
                {res.decisions.map((d, i) => (
                  <Link key={i} href={`/projects/${encodeURIComponent(d.project_id)}`} className="row"><span>{d.title}</span><span className="src">{d.project}</span></Link>
                ))}
              </Section>
            )}
            {show("questions") && res.questions.length > 0 && (
              <Section icon={<IconGap size={15} />} title="Open questions">
                {res.questions.map((d, i) => (
                  <Link key={i} href={`/projects/${encodeURIComponent(d.project_id)}`} className="row"><span>{d.title}</span><span className="src">{d.project}</span></Link>
                ))}
              </Section>
            )}
            {show("actions") && res.actions.length > 0 && (
              <Section icon={<IconCheck size={15} />} title="Action items">
                {res.actions.map((d, i) => (
                  <Link key={i} href={`/projects/${encodeURIComponent(d.project_id)}`} className="row"><span>{d.title}</span><span className="src">{d.project}</span></Link>
                ))}
              </Section>
            )}
            {show("glossary") && res.glossary.length > 0 && (
              <Section icon={<IconSearch size={15} />} title="Glossary">
                {res.glossary.map((g, i) => (
                  <div key={i} className="row"><span className="font-medium">{g.term}</span><span className="src">{g.definition}</span></div>
                ))}
              </Section>
            )}
          </div>
        </>
      )}
      <style jsx>{`
        .row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 0; border-top:1px solid var(--border-soft); font-size:14px; }
        .row:first-child { border-top:0; }
        .src { color: var(--muted-dim); font-size:11px; white-space:nowrap; flex-shrink:0; }
      `}</style>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="animate-fade-up card p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold"><span className="text-accent">{icon}</span> {title}</h2>
      <div>{children}</div>
    </section>
  );
}
