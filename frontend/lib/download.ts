// Shared export helpers: turn a Markdown artifact into a downloadable Word (.doc) or .md file.

export function slugify(title: string, fallback = "document"): string {
  return title.replace(/[^a-z0-9]+/gi, "-").slice(0, 60).replace(/^-|-$/g, "") || fallback;
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadMarkdown(title: string, md: string) {
  save(new Blob([md], { type: "text/markdown" }), `${slugify(title)}.md`);
}

export function downloadWord(title: string, md: string) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:'Segoe UI',Arial,sans-serif;line-height:1.5;color:#222}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:6px 9px;text-align:left}h1,h2,h3{margin:.6em 0 .3em}</style></head><body>${mdToHtml(md)}</body></html>`;
  save(new Blob([html], { type: "application/msword" }), `${slugify(title)}.doc`);
}

// Minimal Markdown -> HTML (headings, bold, lists, tables, [n] citations).
export function mdToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) => esc(s).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/\[(\d+)\]/g, "<sup>[$1]</sup>");
  const lines = md.replace(/<br\s*\/?>/gi, "\n").split("\n");
  let html = "", list: string | null = null, table = false;
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  const closeTable = () => { if (table) { html += "</table>"; table = false; } };
  for (const raw of lines) {
    const t = raw.trim();
    const h = t.match(/^(#{1,6})\s+(.*)/);
    const b = t.match(/^[-*•]\s+(.*)/);
    const n = t.match(/^\d+[.)]\s+(.*)/);
    const row = t.startsWith("|") && t.endsWith("|") && t.length > 1;
    if (row) {
      closeList();
      const cells = t.slice(1, -1).split("|").map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) continue;
      if (!table) { html += '<table border="1" cellpadding="6">'; table = true; }
      html += "<tr>" + cells.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>";
      continue;
    }
    closeTable();
    if (h) { closeList(); html += `<h${h[1].length}>${inline(h[2].replace(/\*\*/g, ""))}</h${h[1].length}>`; }
    else if (b) { if (list !== "ul") { closeList(); html += "<ul>"; list = "ul"; } html += `<li>${inline(b[1])}</li>`; }
    else if (n) { if (list !== "ol") { closeList(); html += "<ol>"; list = "ol"; } html += `<li>${inline(n[1])}</li>`; }
    else if (!t) { closeList(); }
    else { closeList(); html += `<p>${inline(t)}</p>`; }
  }
  closeList(); closeTable();
  return html;
}
