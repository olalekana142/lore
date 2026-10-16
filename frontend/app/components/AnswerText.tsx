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
        ) : b.type === "table" ? (
          <table key={i} className="answer-table"><tbody>
            {b.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => ri === 0
                  ? <th key={ci}>{renderInline(cell, onCite)}</th>
                  : <td key={ci}>{renderInline(cell, onCite)}</td>)}
              </tr>
            ))}
          </tbody></table>
        ) : (
          <p key={i}>{renderInline(b.text, onCite)}</p>
        ),
      )}
    </div>
  );
}

type Block = { type: "p"; text: string } | { type: "ul"; items: string[] } | { type: "h"; text: string } | { type: "table"; rows: string[][] };

function parseBlocks(text: string): Block[] {
  // normalize HTML line breaks the model sometimes emits
  const lines = text.replace(/<br\s*\/?>/gi, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: string[] = [];
  let table: string[][] = [];

  const flushPara = () => {
    if (para.length) blocks.push({ type: "p", text: para.join(" ") });
    para = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ type: "ul", items: list });
    list = [];
  };
  const flushTable = () => {
    if (table.length) blocks.push({ type: "table", rows: table });
    table = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    const heading = line.match(/^\s*#{1,6}\s+(.*)/);
    const bullet = line.match(/^\s*[-*•]\s+(.*)/) || line.match(/^\s*\d+[.)]\s+(.*)/);
    const isRow = trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.length > 1;
    if (isRow) {
      flushPara();
      flushList();
      const cells = trimmed.slice(1, -1).split("|").map((c) => c.trim());
      const sep = cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "");
      if (!sep) table.push(cells);
      continue;
    }
    if (heading) {
      flushPara();
      flushList();
      flushTable();
      blocks.push({ type: "h", text: heading[1].replace(/\*\*/g, "") });
    } else if (bullet) {
      flushPara();
      flushTable();
      // render "- [ ] task" / "- [x] task" as a checkbox item
      const cb = bullet[1].match(/^\[([ xX])\]\s*(.*)/);
      list.push(cb ? `${cb[1].trim() ? "☑" : "☐"} ${cb[2]}` : bullet[1]);
    } else if (!trimmed) {
      flushPara();
      flushList();
      flushTable();
    } else {
      flushList();
      flushTable();
      para.push(trimmed);
    }
  }
  flushPara();
  flushList();
  flushTable();
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
