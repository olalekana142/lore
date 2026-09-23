"use client";

import { useEffect, useRef, useState } from "react";
import {
  askStream, sendFeedback, escalate, suggestAction, executeAction, challengeAnswer,
  type Confidence, type Source, type Turn, type ActionSuggestion, type Ticket, type Challenge,
} from "@/lib/api";
import { useCompany } from "@/lib/useCompany";
import AnswerText from "../components/AnswerText";
import { ConfidenceBadge, SourceCard } from "../components/ui";
import { IconSend, IconThumbUp, IconThumbDown, IconChat, IconGap, IconZap, IconInfo, IconShieldCheck } from "../components/icons";
import { relativeDate } from "@/lib/format";

interface Msg {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  confidence?: Confidence;
  streaming?: boolean;
}

const SUGGESTIONS = [
  "How many PTO days do I get?",
  "I lost my laptop — what now?",
  "What's the meal limit when traveling?",
  "How much parental leave do I get?",
];

export default function AskPage() {
  const [companyId] = useCompany();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Launch straight into a question passed via ?q= (from the home page / popular questions).
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("q");
      if (q) run(q);
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(question: string) {
    if (!question.trim() || busy) return;
    setInput("");
    setBusy(true);

    const history: Turn[] = messages
      .filter((m) => !m.streaming)
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [
      ...prev,
      { role: "user", content: question },
      { role: "assistant", content: "", streaming: true },
    ]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const setLast = (patch: Partial<Msg>) =>
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { ...next[next.length - 1], ...patch };
        return next;
      });

    await askStream(
      companyId,
      question,
      history,
      {
        onSources: (sources, confidence) => setLast({ sources, confidence }),
        onToken: (t) => setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, content: last.content + t };
          return next;
        }),
        onDone: (cited) => setLast({ sources: cited, streaming: false }),
        onError: (msg) =>
          setLast({ content: `⚠️ ${msg} — is the API running on :8000?`, streaming: false }),
      },
      ctrl.signal,
    );
    setBusy(false);
    abortRef.current = null;
  }

  function stop() {
    abortRef.current?.abort();
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.streaming) next[next.length - 1] = { ...last, streaming: false };
      return next;
    });
    setBusy(false);
  }

  const empty = messages.length === 0;

  return (
    <div className="mx-auto flex h-[calc(100vh-5rem)] max-w-3xl flex-col">
      {empty ? (
        <div className="animate-fade-up flex flex-1 flex-col items-center justify-center text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent-weak text-accent">
            <IconChat size={26} />
          </span>
          <h1 className="mt-5 text-2xl font-bold tracking-tight">Ask Lore anything</h1>
          <p className="mt-2 max-w-md text-sm text-muted">
            Ask about policies, benefits, IT, travel — anything in your company&apos;s docs.
            Every answer cites the source it came from.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => run(s)} className="btn-ghost px-3 py-2 text-xs">
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 space-y-6 overflow-y-auto pb-4 pr-1">
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg">
                  {m.content}
                </div>
              </div>
            ) : (
              <AssistantBubble key={i} msg={m} companyId={companyId} question={messages[i - 1]?.content ?? ""} />
            ),
          )}
          <div ref={endRef} />
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(input);
        }}
        className="mt-2 flex items-center gap-2 border-t border-border pt-4"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={empty ? "Ask a question…" : "Ask a follow-up…"}
          className="input flex-1 px-4 py-3 text-sm"
          autoFocus
        />
        {busy ? (
          <button type="button" onClick={stop} className="btn-ghost px-4 py-3 text-sm">
            Stop
          </button>
        ) : (
          <button type="submit" disabled={!input.trim()} className="btn-primary grid h-11 w-11 place-items-center">
            <IconSend size={18} />
          </button>
        )}
      </form>
    </div>
  );
}

function authorityTier(a: number): string {
  if (a >= 90) return "Official policy";
  if (a >= 80) return "Approved source";
  if (a >= 60) return "Standard document";
  return "Low authority";
}

function WhyPanel({ sources }: { sources: Source[] }) {
  const allCurrent = sources.every((s) => s.current);
  const verified = sources.filter((s) => s.verified).length;
  const owners = Array.from(new Set(sources.map((s) => s.owner).filter(Boolean)));
  const maxAuth = Math.max(...sources.map((s) => s.authority ?? 60));
  const canonical = sources.some((s) => s.canonical);
  const freshest = sources.map((s) => s.updated_at).filter(Boolean).sort().reverse()[0] as string | undefined;

  const Row = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
    <li className="flex items-center gap-2 text-sm">
      <span style={{ color: ok ? "var(--green)" : "var(--amber)" }}>{ok ? "✓" : "⚠"}</span>
      {children}
    </li>
  );

  return (
    <div className="animate-scale-in mt-3 rounded-xl border border-border bg-surface-2 p-4">
      <div className="mb-2.5 flex items-center gap-2 text-sm font-semibold">
        <span className="text-accent"><IconShieldCheck size={16} /></span> Why this answer
      </div>
      <ul className="space-y-1.5">
        <Row ok={allCurrent}>{allCurrent ? "Current version — no retired sources used" : "Includes a source that isn't current"}</Row>
        <Row ok={verified === sources.length}>
          {verified === sources.length ? "Verified" : `${verified} of ${sources.length} sources verified`}
          {owners.length > 0 && <span className="text-muted"> · owned by {owners.join(", ")}</span>}
        </Row>
        <Row ok={sources.length >= 1}>{sources.length === 1 ? "1 source" : `${sources.length} independent sources`} cited</Row>
        <Row ok={maxAuth >= 60}>Highest authority: <b className="font-semibold">{authorityTier(maxAuth)}</b></Row>
        {canonical && <Row ok={true}>Backed by the <b className="font-semibold">authoritative source</b> for this topic</Row>}
        {freshest && <Row ok={true}>Freshest source updated {relativeDate(freshest)}</Row>}
      </ul>
      <p className="mt-2.5 border-t border-border-soft pt-2.5 text-xs text-muted-dim">
        Every claim is grounded in the documents below — click a fact to see the exact sentence in its source.
      </p>
    </div>
  );
}

function ChallengePanel({ chal }: { chal: Challenge }) {
  const tone = chal.verdict === "survives" ? "var(--green)"
    : chal.verdict === "contested" ? "var(--amber)" : "var(--muted)";
  const headline = chal.verdict === "survives" ? "✓ Answer survives the challenge"
    : chal.verdict === "contested" ? "⚠ Answer is contested"
    : chal.verdict === "unchallenged" ? "✓ No contradicting evidence found"
    : "No grounded answer to challenge";
  return (
    <div className="animate-scale-in mt-3 rounded-xl border border-border bg-surface-2 p-4">
      <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold" style={{ color: tone }}>
        <IconShieldCheck size={16} /> {headline}
      </div>
      <p className="mb-2.5 text-xs text-muted-dim">
        Lore searched for evidence against this answer{chal.defender ? <> and defended it with <b>{chal.defender.title}</b>{chal.defender.canonical ? " (canonical)" : ""}</> : ""}.
        {chal.challenges.length > 0 && ` Found ${chal.challenges.length} contradicting statement${chal.challenges.length > 1 ? "s" : ""}:`}
      </p>
      <ul className="space-y-2">
        {chal.challenges.map((c, i) => (
          <li key={i} className="rounded-lg bg-surface p-2.5 text-xs">
            <div className="flex items-start gap-2">
              <span style={{ color: c.beaten ? "var(--green)" : "var(--amber)" }}>{c.beaten ? "✓" : "⚠"}</span>
              <div>
                <div>“{c.statement}” <span className="text-muted-dim">({c.title})</span></div>
                <div className="mt-0.5 text-muted-dim">
                  {c.beaten ? "beaten: " : "unresolved: "}{c.resolution}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AssistantBubble({ msg, companyId, question }: { msg: Msg; companyId: string; question: string }) {
  const [cite, setCite] = useState<number | null>(null);
  const [rated, setRated] = useState<"up" | "down" | null>(null);
  const [escalated, setEscalated] = useState(false);
  const [why, setWhy] = useState(false);
  const [action, setAction] = useState<ActionSuggestion | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [filing, setFiling] = useState(false);
  const [chal, setChal] = useState<Challenge | null>(null);
  const [challenging, setChallenging] = useState(false);
  const askedRef = useRef(false);

  const runChallenge = async () => {
    setChallenging(true);
    try {
      setChal(await challengeAnswer(companyId, question));
    } finally {
      setChallenging(false);
    }
  };

  // Once the answer is complete, ask whether it can be turned into an action.
  useEffect(() => {
    if (msg.streaming || !msg.content || msg.confidence === "none" || askedRef.current) return;
    askedRef.current = true;
    suggestAction(companyId, question, msg.content).then(setAction).catch(() => {});
  }, [msg.streaming, msg.content, msg.confidence, companyId, question]);

  const fileIt = () => {
    if (!action?.type) return;
    setFiling(true);
    executeAction(companyId, action.type, action.summary ?? question)
      .then(setTicket)
      .finally(() => setFiling(false));
  };

  const rate = (r: "up" | "down") => {
    setRated(r);
    sendFeedback(companyId, question, msg.content, r).catch(() => {});
  };

  const doEscalate = () => {
    setEscalated(true);
    escalate(companyId, question).catch(() => {});
  };

  return (
    <div className="animate-fade-up">
      <div className="card p-5">
        {msg.confidence && (
          <div className="mb-2.5">
            <ConfidenceBadge confidence={msg.confidence} />
          </div>
        )}
        {msg.content ? (
          <AnswerText text={msg.content} streaming={msg.streaming} onCite={(n) => setCite(n)} />
        ) : (
          <div className="flex items-center gap-1 py-1">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </div>
        )}

        {!msg.streaming && msg.content && (
          <div className="mt-4 flex items-center gap-1 border-t border-border-soft pt-3">
            <span className="mr-1 text-xs text-muted-dim">Helpful?</span>
            <button
              onClick={() => rate("up")}
              className={`rounded-md p-1.5 transition-colors hover:bg-surface-2 ${rated === "up" ? "text-green" : "text-muted-dim"}`}
              title="Helpful"
            >
              <IconThumbUp size={15} />
            </button>
            <button
              onClick={() => rate("down")}
              className={`rounded-md p-1.5 transition-colors hover:bg-surface-2 ${rated === "down" ? "text-red" : "text-muted-dim"}`}
              title="Not helpful"
            >
              <IconThumbDown size={15} />
            </button>
            {rated && <span className="ml-1 text-xs text-muted-dim">Thanks for the feedback</span>}
            {msg.sources && msg.sources.length > 0 && (
              <div className="ml-auto flex items-center gap-1">
                <button
                  onClick={runChallenge}
                  disabled={challenging}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-dim transition-colors hover:text-foreground"
                  title="Adversarially search for evidence against this answer"
                >
                  <IconShieldCheck size={14} /> {challenging ? "Challenging…" : "Challenge"}
                </button>
                <button
                  onClick={() => setWhy((w) => !w)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors ${why ? "text-accent" : "text-muted-dim hover:text-foreground"}`}
                >
                  <IconInfo size={14} /> Why this answer?
                </button>
              </div>
            )}
          </div>
        )}

        {why && msg.sources && msg.sources.length > 0 && <WhyPanel sources={msg.sources} />}
        {chal && <ChallengePanel chal={chal} />}

        {action?.actionable && (
          <div className="mt-3 rounded-lg border p-3" style={{ borderColor: "var(--accent)", background: "var(--accent-weak)" }}>
            {ticket ? (
              <div className="text-sm">
                <span style={{ color: "var(--green)" }} className="font-medium">✓ Filed {ticket.ticket_id}</span>{" "}
                to {ticket.destination} ({ticket.channel}) · ETA {ticket.eta}.
                <span className="ml-1 text-xs text-muted-dim">(simulated — connect Jira/Slack to go live)</span>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm">{action.summary}</span>
                <button onClick={fileIt} disabled={filing} className="btn-primary flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs">
                  {filing ? <span className="spinner" /> : <IconZap size={14} />} {action.label}
                </button>
              </div>
            )}
          </div>
        )}

        {!msg.streaming && msg.confidence === "none" && (
          <div className="mt-3 rounded-lg border border-border bg-surface-2 p-3">
            {escalated ? (
              <p className="text-sm" style={{ color: "var(--green)" }}>
                ✓ Sent to HR. When they answer, it&apos;s saved so the next person gets it automatically.
              </p>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted">Not documented? Ask a human.</span>
                <button onClick={doEscalate} className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs">
                  <IconGap size={14} /> Escalate to HR
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {msg.sources && msg.sources.length > 0 && (
        <div className="mt-2.5 space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-dim">Sources</div>
          {msg.sources.map((s) => (
            <SourceCard key={s.doc_id} source={s} highlight={cite === s.n} />
          ))}
        </div>
      )}
    </div>
  );
}
