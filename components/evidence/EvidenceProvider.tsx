"use client";
// Reusable right-side evidence drawer. Any screen calls useEvidence().open(refs) — the page underneath keeps its
// scroll position, filters and selection. The drawer renders the ORIGINAL stored document (never a mock-up).
import LocalTime from "@/components/LocalTime";
import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { EvidenceRef } from "@/lib/workspace";

const PdfViewer = dynamic(() => import("./PdfViewer"), { ssr: false, loading: () => <div className="p-6 text-sm text-slate-500">Loading viewer…</div> });

interface Ctx { open: (refs: EvidenceRef | EvidenceRef[], index?: number) => void; close: () => void; current?: EvidenceRef }
const EvidenceCtx = createContext<Ctx>({ open: () => {}, close: () => {} });
export const useEvidence = () => useContext(EvidenceCtx);

export function EvidenceProvider({ children }: { children: React.ReactNode }) {
  const [refs, setRefs] = useState<EvidenceRef[]>([]);
  const [idx, setIdx] = useState(0);
  const open = useCallback((r: EvidenceRef | EvidenceRef[], index = 0) => { const list = Array.isArray(r) ? r : [r]; setRefs(list); setIdx(Math.min(index, list.length - 1)); }, []);
  const close = useCallback(() => setRefs([]), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);
  const value = useMemo(() => ({ open, close, current: refs[idx] }), [open, close, refs, idx]);
  return (
    <EvidenceCtx.Provider value={value}>
      {children}
      {refs.length > 0 && <EvidenceDrawer refs={refs} idx={idx} setIdx={setIdx} onClose={close} />}
    </EvidenceCtx.Provider>
  );
}

/** Small button used across the Action Center, reviews, register and readiness screens. */
export function EvidenceButton({ refs, index = 0, label = "View evidence", className = "" }: { refs?: EvidenceRef | EvidenceRef[]; index?: number; label?: string; className?: string }) {
  const { open } = useEvidence();
  const list = refs ? (Array.isArray(refs) ? refs : [refs]) : [];
  if (!list.length) return <span className={`text-xs text-slate-400 ${className}`}>No evidence</span>;
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); open(list, index); }} className={`inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 ${className}`}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>
      {label}
    </button>
  );
}

function EvidenceDrawer({ refs, idx, setIdx, onClose }: { refs: EvidenceRef[]; idx: number; setIdx: (n: number) => void; onClose: () => void }) {
  const r = refs[idx];
  const isPdf = !!r.fileId && (!r.mediaType || r.mediaType === "application/pdf");
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-label="Evidence viewer">
      <div className="absolute inset-0 bg-night-950/70 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="ros-rise relative flex h-full w-full max-w-[760px] flex-col border-l border-slate-200 bg-night-800 shadow-2xl sm:w-[58vw]">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Evidence · {r.projectName}</div>
            <div className="truncate text-base font-semibold">{r.docName}{r.revLabel ? ` · Rev ${r.revLabel}` : ""}</div>
            <div className="truncate text-xs text-slate-500">{r.fileName ?? "No file"}{r.revStatus ? ` · ${r.revStatus.replace("_", " ")}` : ""}</div>
          </div>
          <button onClick={onClose} className="btn-ghost !px-2 !py-1" aria-label="Close evidence">✕</button>
        </header>
        {refs.length > 1 && (
          <div className="flex gap-1 border-b border-slate-200 px-3 py-2">
            {refs.map((x, i) => (
              <button key={x.key + i} onClick={() => setIdx(i)} className={`rounded-md px-2.5 py-1 text-xs font-medium ${i === idx ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
                {x.docName.split(" ")[0]} Rev {x.revLabel ?? "—"}{x.revStatus === "approved" ? " (approved)" : x.revStatus === "in_review" ? " (in review)" : ""}
              </button>
            ))}
          </div>
        )}
        <div className="space-y-2 border-b border-slate-200 px-4 py-3">
          <span className="pill bg-slate-100 text-slate-700 ring-slate-200">{r.provenance}</span>
          {(r.quote || r.factLabel) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
              {r.factLabel && <div className="text-xs font-semibold text-amber-900">{r.factLabel}{r.factValue ? `: ${r.factValue}` : ""}{r.page ? ` · cited page ${r.page}` : ""}</div>}
              {r.quote ? <div className="mt-1 italic text-amber-950">“{r.quote}”</div> : <div className="mt-1 text-xs text-amber-800">No verbatim quotation recorded for this fact.</div>}
            </div>
          )}
          {r.note && <div className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">{r.note}</div>}
          {r.basis && (
            <div className="rounded-lg border border-slate-200 p-3 text-xs text-slate-700">
              <div className="font-semibold text-slate-800">Requirement basis</div>
              <div className="mt-1"><span className="text-slate-500">Reference:</span> {r.basis.codeRef}</div>
              <div><span className="text-slate-500">Must include:</span> {r.basis.mustInclude}</div>
              <div><span className="text-slate-500">When:</span> {r.basis.when}</div>
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1">
          {r.communication ? <CommunicationEvidence c={r.communication} quote={r.quote} />
            : isPdf ? <PdfViewer key={r.key} fileId={r.fileId!} page={r.page} quote={r.quote} />
            : r.fileId && r.mediaType?.startsWith("image/") ? <ImageEvidence fileId={r.fileId} />
            : r.fileId && r.mediaType === "text/plain" ? <TextEvidence fileId={r.fileId} quote={r.quote} />
            : <FactsOnly r={r} />}
        </div>
      </aside>
    </div>
  );
}

/** Verbatim stored communication (Project Memory) with the cited quote highlighted. Never reconstructed. */
function CommunicationEvidence({ c, quote }: { c: NonNullable<EvidenceRef["communication"]>; quote?: string }) {
  const [state, setState] = useState<{ body?: string; meta?: { importedBy: string; importedAt: string; sha: string; engine: string; synthetic?: boolean }; err?: string }>({});
  useEffect(() => {
    let live = true;
    fetch(`/api/sites/${encodeURIComponent(c.siteId)}/communications`, { credentials: "same-origin" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(r.status === 403 ? "Communications are internal EQORE records — sign in as an EQORE user to read the original." : j.error ?? `Could not load (${r.status})`);
        const m = (j.communications as { id: string; body: string; importedBy: string; importedAt: string; contentSha256: string; analysis: { engine: string }; synthetic?: boolean }[]).find((x) => x.id === c.id);
        if (!m) throw new Error("Communication not found on record");
        if (live) setState({ body: m.body, meta: { importedBy: m.importedBy, importedAt: m.importedAt, sha: m.contentSha256, engine: m.analysis.engine, synthetic: m.synthetic } });
      })
      .catch((e) => live && setState({ err: e.message }));
    return () => { live = false; };
  }, [c.siteId, c.id]);
  if (state.err) return <div className="p-4 text-sm text-red-700">{state.err}</div>;
  if (!state.body) return <div className="p-4 text-sm text-slate-500">Loading original communication…</div>;
  const text = state.body;
  const i = quote ? text.toLowerCase().indexOf(quote.toLowerCase()) : -1;
  return (
    <div className="flex h-full flex-col">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-b border-slate-200 px-4 py-2 text-[11px] text-slate-500">
        <span><b className="text-slate-700">From</b> {c.sender ?? "—"}</span>
        <span><b className="text-slate-700">Sent</b> <LocalTime iso={c.sentAt} /></span>
        <span className="col-span-2 truncate"><b className="text-slate-700">Subject</b> {c.subject ?? "(none)"} · {c.channel?.replace("_", " ")}</span>
        <span>Imported by {state.meta?.importedBy} · {state.meta?.importedAt.slice(0, 16).replace("T", " ")}</span>
        <span className="truncate font-mono">sha256 {state.meta?.sha.slice(0, 16)}…</span>
        <span className="col-span-2">{i >= 0 ? <span className="text-emerald-700">✓ Quote located verbatim in the stored original</span> : quote ? <span className="text-orange-700">⚠ Quote not found verbatim in the stored original</span> : null}</span>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-800">
        {i >= 0 ? <>{text.slice(0, i)}<mark className="rounded bg-amber-300 px-0.5 text-night-950">{text.slice(i, i + quote!.length)}</mark>{text.slice(i + quote!.length)}</> : text}
      </pre>
    </div>
  );
}

function FactsOnly({ r }: { r: EvidenceRef }) {
  if (!r.facts?.length) return <div className="p-4 text-sm text-slate-500">{r.revisionId ? "No extracted facts on record for this revision." : ""}</div>;
  return (
    <div className="h-full overflow-auto p-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Facts on record</div>
      <ul className="space-y-1.5">{r.facts.map((f, i) => <FactRow key={i} f={f} />)}</ul>
    </div>
  );
}
function FactRow({ f }: { f: NonNullable<EvidenceRef["facts"]>[number] }) {
  return (
    <li className="rounded-lg border border-slate-200 p-2 text-sm">
      <div className="flex justify-between gap-2 text-xs text-slate-500"><span>{f.label}</span><span>{f.origin}{f.page ? ` · p.${f.page}` : ""}</span></div>
      <div className="font-semibold">{f.value}</div>
      {f.evidence && <div className="text-[11px] italic text-slate-500">“{f.evidence}”</div>}
    </li>
  );
}

function ImageEvidence({ fileId }: { fileId: string }) {
  const [url, setUrl] = useState<string>();
  const [err, setErr] = useState("");
  useEffect(() => {
    let u: string | undefined;
    fetch(`/api/files/${encodeURIComponent(fileId)}`).then(async (res) => { if (!res.ok) throw new Error(`Could not load file (${res.status})`); u = URL.createObjectURL(await res.blob()); setUrl(u); }).catch((e) => setErr(e.message));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [fileId]);
  return <div className="h-full overflow-auto bg-slate-100 p-3">{err ? <div className="text-sm text-red-700">{err}</div> : url ? <img // eslint-disable-line @next/next/no-img-element
 src={url} alt="Original document" className="mx-auto max-w-full shadow" /> : <div className="text-sm text-slate-500">Loading…</div>}</div>;
}

function TextEvidence({ fileId, quote }: { fileId: string; quote?: string }) {
  const [text, setText] = useState<string>();
  useEffect(() => { fetch(`/api/files/${encodeURIComponent(fileId)}`).then((r) => r.text()).then(setText).catch(() => setText("Could not load file")); }, [fileId]);
  if (text === undefined) return <div className="p-4 text-sm text-slate-500">Loading…</div>;
  const i = quote ? text.toLowerCase().indexOf(quote.toLowerCase()) : -1;
  return (
    <pre className="h-full overflow-auto whitespace-pre-wrap bg-slate-50 p-4 font-mono text-xs text-slate-800">
      {i >= 0 ? <>{text.slice(0, i)}<mark className="rounded bg-amber-300 px-0.5 text-night-950">{text.slice(i, i + quote!.length)}</mark>{text.slice(i + quote!.length)}</> : text}
    </pre>
  );
}
