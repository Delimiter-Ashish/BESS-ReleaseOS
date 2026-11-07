"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { REQUIREMENTS } from "@/lib/requirements";
import type { Fact, FactChange } from "@/lib/types";

interface Result {
  requirementId: string;
  docTypeConfidence: number;
  title: string;
  effectiveDate?: string;
  revisionLabel?: string;
  summary: string;
  facts: Fact[];
  missingItems: string[];
  warnings: string[];
  engine: "claude" | "rules";
  fileId: string;
  sha256: string;
  fileName: string;
  duplicateOf: string | null;
  previous: { revLabel: string; fileName: string } | null;
  diffPreview: FactChange[];
  ms: number;
  error?: string;
}

const conf = (c: number) => (c >= 0.85 ? "text-emerald-700 bg-emerald-50" : c >= 0.6 ? "text-amber-700 bg-amber-50" : "text-red-700 bg-red-50");

export default function UploadPanel({ siteId }: { siteId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [reqId, setReqId] = useState("");
  const [date, setDate] = useState("");
  const [source, setSource] = useState("supplier");
  const [msg, setMsg] = useState("");
  const [drag, setDrag] = useState(false);
  const [name, setName] = useState("");

  async function run(f: File) {
    setName(f.name);
    setRes(null);
    setMsg("");
    setBusy(true);
    const fd = new FormData();
    fd.append("file", f);
    fd.append("siteId", siteId);
    const j = (await (await fetch("/api/extract", { method: "POST", body: fd })).json()) as Result;
    setRes(j);
    setReqId(j.requirementId);
    setDate(j.effectiveDate ?? new Date().toISOString().slice(0, 10));
    setBusy(false);
  }

  async function submit() {
    if (!res) return;
    setBusy(true);
    const r = await fetch(`/api/sites/${siteId}/revisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requirementId: reqId,
        fileId: res.fileId,
        fileName: res.fileName,
        sha256: res.sha256,
        facts: res.facts,
        effectiveDate: date,
        source,
        uploadedBy: source === "supplier" ? "Supplier portal" : "EQORE",
        summary: res.summary,
        aiConfidence: res.docTypeConfidence,
        engine: res.engine,
        synthetic: /sample|synthetic/i.test(res.fileName),
      }),
    });
    const j = await r.json();
    setBusy(false);
    if (!j.ok) return setMsg(j.error);
    setRes(null);
    setMsg(`Filed as Rev ${j.revision.revLabel} — in review. Approved packages are unchanged until an engineer approves.`);
    router.refresh();
  }

  return (
    <div className="card p-4">
      <div className="text-sm font-semibold">Upload a document or revision</div>
      <p className="mb-3 text-xs text-slate-500">AI reads it, extracts facts with evidence, and compares them with the approved revision. Nothing reaches a package until an engineer approves.</p>

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) run(f); }}
        onClick={() => input.current?.click()}
        className={`cursor-pointer rounded-lg border-2 border-dashed p-5 text-center text-sm transition ${drag ? "border-indigo-400 bg-indigo-50" : "border-slate-300 hover:bg-slate-50"}`}
      >
        {busy && !res ? <span className="animate-pulse text-indigo-600">Reading {name}…</span> : <span className="text-slate-500">📄 Drop PDF / scan / photo, or click</span>}
        <input ref={input} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && run(e.target.files[0])} />
      </div>
      {msg && <div className="mt-3 rounded-lg bg-slate-100 p-2 text-xs text-slate-700">{msg}</div>}
      {res?.error && <div className="mt-3 rounded bg-red-50 p-2 text-xs text-red-700">{res.error}</div>}

      {res && !res.error && (
        <div className="mt-4 space-y-3 text-sm">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{res.engine === "claude" ? "✨ Claude (multimodal)" : "⚙ Rules engine (offline)"} · {(res.ms / 1000).toFixed(1)}s</span>
            <span className={`rounded px-1.5 py-0.5 font-medium ${conf(res.docTypeConfidence)}`}>type {Math.round(res.docTypeConfidence * 100)}%</span>
          </div>
          <div className="font-mono text-[10px] text-slate-400">sha256 {res.sha256.slice(0, 24)}…</div>
          {res.duplicateOf && <div className="rounded bg-red-50 p-2 text-xs text-red-700">Duplicate of {res.duplicateOf} — identical bytes.</div>}

          <div className="grid grid-cols-2 gap-2">
            <label className="col-span-2 text-xs font-medium text-slate-600">
              Document type
              <select value={reqId} onChange={(e) => setReqId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                <option value="unknown">— choose —</option>
                {REQUIREMENTS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              Source
              <select value={source} onChange={(e) => setSource(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                {["supplier", "engineer", "eqore", "ahj", "utility", "facility"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              Doc date
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
          </div>
          {res.summary && <p className="text-xs text-slate-600">{res.summary}</p>}

          {res.previous && (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-2">
              <div className="text-xs font-semibold text-indigo-900">Compared with approved Rev {res.previous.revLabel}</div>
              {res.diffPreview.length === 0 ? (
                <div className="text-xs text-indigo-800">No fact changes detected.</div>
              ) : (
                <ul className="mt-1 space-y-1">
                  {res.diffPreview.map((c) => (
                    <li key={c.key} className="text-xs">
                      <b>{c.label}:</b> <span className="text-red-700 line-through">{c.before ?? "—"}</span> → <span className="font-semibold text-emerald-700">{c.after ?? "—"}</span>
                      {c.evidenceAfter && <div className="italic text-indigo-700/70">“{c.evidenceAfter}”{c.pageAfter ? ` · p.${c.pageAfter}` : ""}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div>
            <div className="mb-1 text-xs font-medium text-slate-600">Extracted facts ({res.facts.length})</div>
            <ul className="max-h-48 space-y-1 overflow-auto">
              {res.facts.map((f, i) => (
                <li key={i} className="rounded-lg border border-slate-200 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-500">{f.label}</span>
                    <span className={`rounded px-1 text-[10px] font-medium ${conf(f.confidence)}`}>{Math.round(f.confidence * 100)}%</span>
                  </div>
                  <div className="text-sm font-medium">{f.value}{f.unit ? ` ${f.unit}` : ""}</div>
                  {f.evidence && <div className="text-[11px] italic text-slate-400">“{f.evidence}”{f.page ? ` · p.${f.page}` : ""}</div>}
                </li>
              ))}
            </ul>
          </div>

          {res.missingItems.length > 0 && (
            <div className="rounded-lg bg-orange-50 p-2 text-xs text-orange-800"><b>Missing per requirement</b><ul className="list-disc pl-4">{res.missingItems.map((m, i) => <li key={i}>{m}</li>)}</ul></div>
          )}
          {res.warnings.length > 0 && (
            <div className="rounded-lg bg-red-50 p-2 text-xs text-red-800"><b>Warnings</b><ul className="list-disc pl-4">{res.warnings.map((m, i) => <li key={i}>{m}</li>)}</ul></div>
          )}

          <button disabled={busy || reqId === "unknown" || !!res.duplicateOf} onClick={submit} className="btn-primary w-full">
            Submit for engineer review →
          </button>
        </div>
      )}
    </div>
  );
}
