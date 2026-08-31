"use client";

import { useState } from "react";
import { generatePlaybook, gradeAnswer, type Playbook, type Grade } from "@/lib/api";
import { useCompany } from "@/lib/useCompany";
import { PageHeader, ErrorNote } from "../components/ui";
import { IconRocket, IconCheck, IconSparkle } from "../components/icons";

const ROLES = ["Software Engineer", "Sales Rep", "People / HR", "Finance", "Customer Support"];

export default function OnboardingPage() {
  const [companyId] = useCompany();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pb, setPb] = useState<Playbook | null>(null);
  const [done, setDone] = useState<Set<number>>(new Set());

  async function generate() {
    if (!role.trim()) return;
    setBusy(true);
    setError(null);
    setPb(null);
    setDone(new Set());
    try {
      const p = await generatePlaybook(companyId, role.trim(), name.trim());
      setPb(p);
      // restore progress
      try {
        const saved = localStorage.getItem(`lore.onboard.${companyId}.${role}`);
        if (saved) setDone(new Set(JSON.parse(saved)));
      } catch {
        /* ignore */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate");
    } finally {
      setBusy(false);
    }
  }

  function toggle(i: number) {
    const next = new Set(done);
    next.has(i) ? next.delete(i) : next.add(i);
    setDone(next);
    try {
      localStorage.setItem(`lore.onboard.${companyId}.${role}`, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  }

  const pct = pb && pb.checklist.length ? Math.round((done.size / pb.checklist.length) * 100) : 0;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Onboarding playbooks"
        subtitle="Generate a role-specific ramp plan from your knowledge base, with quizzes graded against your real policies."
      />

      <div className="animate-fade-up card mb-6 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-dim">New hire name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam" className="input mt-1 w-full px-3 py-2 text-sm" />
          </div>
          <div className="flex-[2]">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-dim">Role</label>
            <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Senior Backend Engineer" className="input mt-1 w-full px-3 py-2 text-sm" />
          </div>
          <button onClick={generate} disabled={busy || !role.trim()} className="btn-primary flex items-center gap-2 px-4 py-2 text-sm">
            {busy ? <span className="spinner" /> : <IconRocket size={16} />} Generate
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {ROLES.map((r) => (
            <button key={r} onClick={() => setRole(r)} className="chip hover:border-accent">{r}</button>
          ))}
        </div>
      </div>

      {error && <ErrorNote message={error} />}

      {busy && !pb && (
        <div className="card p-8 text-center text-sm text-muted">
          <span className="spinner mx-auto mb-3" style={{ borderColor: "var(--border)", borderTopColor: "var(--accent)" }} />
          Building a plan from your documents…
        </div>
      )}

      {pb && (
        <div className="animate-fade-up space-y-6">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold">14-day checklist for {pb.role}</h2>
              <span className="text-sm font-semibold text-accent">{pct}% complete</span>
            </div>
            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="space-y-2">
              {pb.checklist.map((c, i) => (
                <button
                  key={i}
                  onClick={() => toggle(i)}
                  className={`card flex w-full items-start gap-3 p-3.5 text-left transition-colors ${done.has(i) ? "opacity-60" : "card-hover"}`}
                >
                  <span
                    className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border"
                    style={{
                      borderColor: done.has(i) ? "var(--green)" : "var(--border)",
                      background: done.has(i) ? "var(--green)" : "transparent",
                      color: "white",
                    }}
                  >
                    {done.has(i) && <IconCheck size={13} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="chip shrink-0">Day {c.day}</span>
                      <span className={`text-sm font-medium ${done.has(i) ? "line-through" : ""}`}>{c.task}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted">{c.why}</div>
                  </div>
                  {c.topic && <span className="chip shrink-0">{c.topic}</span>}
                </button>
              ))}
            </div>
          </section>

          {pb.quiz.length > 0 && (
            <section>
              <h2 className="mb-1 flex items-center gap-2 text-base font-bold"><IconSparkle size={16} /> Knowledge check</h2>
              <p className="mb-3 text-sm text-muted">Answer in your own words — Lore grades against the real policy.</p>
              <div className="space-y-2.5">
                {pb.quiz.map((q, i) => (
                  <QuizCard key={i} companyId={companyId} question={q.question} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function QuizCard({ companyId, question }: { companyId: string; question: string }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [grade, setGrade] = useState<Grade | null>(null);

  async function check() {
    if (!answer.trim()) return;
    setBusy(true);
    try {
      setGrade(await gradeAnswer(companyId, question, answer.trim()));
    } finally {
      setBusy(false);
    }
  }

  const color = grade
    ? grade.verdict === "correct"
      ? "var(--green)"
      : grade.verdict === "partial"
        ? "var(--amber)"
        : "var(--red)"
    : "var(--muted)";

  return (
    <div className="card p-4">
      <p className="text-sm font-medium">{question}</p>
      <div className="mt-2 flex gap-2">
        <input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your answer…" className="input flex-1 px-3 py-2 text-sm" />
        <button onClick={check} disabled={busy || !answer.trim()} className="btn-primary px-4 py-2 text-sm">
          {busy ? "Grading…" : "Check"}
        </button>
      </div>
      {grade && (
        <div className="animate-scale-in mt-3 rounded-lg border p-3" style={{ borderColor: color, background: `color-mix(in srgb, ${color} 10%, transparent)` }}>
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color }}>
            <span className="capitalize">{grade.verdict}</span>
            <span className="text-xs">· {grade.score}/100</span>
          </div>
          <p className="mt-1 text-sm">{grade.feedback}</p>
          {grade.verdict !== "correct" && grade.model_answer && (
            <p className="mt-1.5 text-xs text-muted"><b>Correct answer:</b> {grade.model_answer}</p>
          )}
        </div>
      )}
    </div>
  );
}
