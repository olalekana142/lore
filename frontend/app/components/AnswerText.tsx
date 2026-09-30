"use client";

import { Fragment, ReactNode } from "react";

/** Render a lightweight-markdown answer: **bold**, bullet lists, and [n] citation chips. */
export default function AnswerText({
  text,
  onCite,
  streaming = false,
}: {
  text: string;
  onCite?: (n: number) => void;
  streaming?: boolean;
}) {
  const blocks = parseBlocks(text);
  return (
    <div className={`prose-answer ${streaming ? "caret" : ""}`}>
      {blocks.map((b, i) =>
        b.type === "ul" ? (
          <ul key={i}>
            {b.items.map((it, j) => (
              <li key={j}>{renderInline(it, onCite)}</li>
            ))}
          </ul>
        ) : b.type === "h" ? (
          <div key={i} className="answer-h">{renderInline(b.text, onCite)}</div>
        ) : (
          <p key={i}>{renderInline(b.text, onCite)}</p>
        ),
      )}
    </div>
  );
}

type Block = { type: "p"; text: string } | { type: "ul"; items: string[] } | { type: "h"; text: string };

function parseBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: string[] = [];

  const flushPara = () => {
    if (para.length) blocks.push({ type: "p", text: para.join(" ") });
    para = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ type: "ul", items: list });
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.match(/^\s*#{1,6}\s+(.*)/);
    const bullet = line.match(/^\s*[-*•]\s+(.*)/) || line.match(/^\s*\d+[.)]\s+(.*)/);
    if (heading) {
      flushPara();
      flushList();
      blocks.push({ type: "h", text: heading[1].replace(/\*\*/g, "") });
    } else if (bullet) {
      flushPara();
      // render "- [ ] task" / "- [x] task" as a checkbox item
      const cb = bullet[1].match(/^\[([ xX])\]\s*(.*)/);
      list.push(cb ? `${cb[1].trim() ? "☑" : "☐"} ${cb[2]}` : bullet[1]);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return blocks;
}

function renderInline(text: string, onCite?: (n: number) => void): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\[\d+\])/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(<Fragment key={key++}>{text.slice(last, m.index)}</Fragment>);
    const tok = m[0];
    if (tok.startsWith("**")) {
      out.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    } else {
      const n = parseInt(tok.slice(1, -1), 10);
      out.push(
        <sup
          key={key++}
          className="cite"
          role={onCite ? "button" : undefined}
          onClick={onCite ? () => onCite(n) : undefined}
          title={onCite ? "Show source" : undefined}
        >
          {n}
        </sup>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  return out;
}
