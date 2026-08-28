// Small formatting helpers shared across the UI.

export function compactScore(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

export function relativeDate(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  const y = Math.floor(days / 365);
  return `${y}y ago`;
}

// Split a generated draft into segments. Threads are numbered ("1/", "2/8", "1."),
// so we break on those; otherwise we split on blank lines (paragraphs).
export function splitDraft(draft: string, isThread: boolean): string[] {
  const text = draft.trim();
  if (isThread) {
    // Break right before a leading "N/" or "N/M" marker.
    const parts = text
      .split(/\n+(?=\s*\d+\s*\/)/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 1) return parts;
  }
  return text
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
}
