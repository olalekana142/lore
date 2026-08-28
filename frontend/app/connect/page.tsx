"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ingest, ingestDrive, type IngestSummary } from "@/lib/api";
import { useCompany } from "@/lib/useCompany";
import { PageHeader, StatTile } from "../components/ui";
import { IconUpload, IconArrow } from "../components/icons";

type Mode = "file" | "drive";

export default function ConnectPage() {
  const [companyId] = useCompany();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("file");
  const [file, setFile] = useState<File | null>(null);
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<IngestSummary | null>(null);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      if (mode === "file") {
        if (!file) return;
        setSummary(await ingest(companyId, file));
      } else {
        if (!folder.trim()) return;
        setSummary(await ingestDrive(companyId, folder.trim()));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ingestion failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Add documents"
        subtitle={<>Add company docs to <span className="capitalize font-medium text-foreground">{companyId}</span>&apos;s knowledge base. Lore extracts the facts; re-add an updated doc and answers refresh automatically.</>}
      />

      <div className="animate-fade-up mb-4 inline-flex rounded-lg border border-border bg-surface-2 p-1">
        {(["file", "drive"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setSummary(null); setError(null); }}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              mode === m ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"
            }`}
          >
            {m === "file" ? "Upload file" : "Google Drive"}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="animate-fade-up card space-y-5 p-6">
        {mode === "file" ? (
          <>
            <label
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-4 py-12 text-center transition-colors"
              style={{
                borderColor: dragging ? "var(--accent)" : file ? "var(--green)" : "var(--border)",
                background: dragging ? "var(--accent-weak)" : file ? "var(--green-weak)" : "var(--surface-2)",
              }}
            >
              <input
                type="file"
                accept=".csv,.json,.md,.markdown,.txt,.pdf,.docx"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="hidden"
              />
              <span className="grid h-12 w-12 place-items-center rounded-full bg-surface text-accent shadow-sm">
                <IconUpload size={22} />
              </span>
              {file ? (
                <>
                  <span className="text-sm font-semibold">{file.name}</span>
                  <span className="text-xs text-muted-dim">{(file.size / 1024).toFixed(1)} KB · click to replace</span>
                </>
              ) : (
                <>
                  <span className="text-sm font-semibold">Drag &amp; drop a document</span>
                  <span className="text-xs text-muted-dim">or click to browse</span>
                </>
              )}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {[".csv", ".json", ".md", ".txt", ".pdf", ".docx"].map((t) => (
                <span key={t} className="chip font-mono">{t}</span>
              ))}
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="text-sm font-medium">Google Drive folder</label>
              <input
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder="Paste a folder share link or its ID"
                className="input mt-1.5 w-full px-3.5 py-2.5 text-sm"
              />
            </div>
            <div className="rounded-lg border border-border bg-surface-2 p-3.5 text-xs leading-relaxed text-muted">
              <p className="mb-1.5 font-semibold text-foreground">One-time setup</p>
              1. Create a Google Cloud <b>service account</b>, enable the Drive API, download its JSON key.<br />
              2. Set <code className="rounded bg-surface px-1">GOOGLE_APPLICATION_CREDENTIALS</code> to that key on the server.<br />
              3. <b>Share the folder</b> with the service account&apos;s email (Viewer). Then paste the folder link above.
              <p className="mt-1.5 text-muted-dim">Pulls Google Docs, PDFs, DOCX, and text files from the folder.</p>
            </div>
          </>
        )}

        <button
          type="submit"
          disabled={busy || (mode === "file" ? !file : !folder.trim())}
          className="btn-primary flex w-full items-center justify-center gap-2 py-3 text-sm"
        >
          {busy ? (
            <><span className="spinner" /> Ingesting… extracting facts via Groq</>
          ) : mode === "file" ? "Ingest document" : "Sync Drive folder"}
        </button>

        {error && (
          <p className="rounded-xl px-3 py-2 text-sm" style={{ background: "var(--red-weak)", color: "var(--red)" }}>{error}</p>
        )}
      </form>

      {summary && (
        <div className="animate-scale-in mt-5 card p-6" style={{ borderColor: "var(--green)" }}>
          <h3 className="flex items-center gap-2 font-semibold">
            <span className="grid h-6 w-6 place-items-center rounded-full text-sm" style={{ background: "var(--green-weak)", color: "var(--green)" }}>✓</span>
            {mode === "file" ? "Document ingested" : "Drive folder synced"}
          </h3>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <StatTile label="Documents" value={summary.documents_ingested ?? 0} accent />
            <StatTile label="Facts extracted" value={summary.facts_extracted ?? 0} accent />
          </div>
          <div className="mt-5 flex gap-2">
            <button onClick={() => router.push("/ask")} className="btn-primary flex items-center gap-2 px-4 py-2.5 text-sm">
              Ask a question <IconArrow size={16} />
            </button>
            <button onClick={() => router.push("/library")} className="btn-ghost px-4 py-2.5 text-sm">View library</button>
          </div>
        </div>
      )}
    </div>
  );
}
