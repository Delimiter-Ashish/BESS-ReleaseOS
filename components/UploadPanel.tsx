"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ChangeTable, Confidence, EngineBadge, EvidenceStatus, Hash } from "@/components/ui";
import { DOCUMENT_TYPES as REQUIREMENTS } from "@/lib/requirements";
import type { Fact, FactChange } from "@/lib/types";

interface Result {
  ok: boolean;
  error?: string;
  extractionId: string;
  requirementId: string;
  docTypeConfidence: number;
  title: string;
  documentNumber?: string;
  effectiveDate?: string;
  revisionLabel?: string;
  manufacturer?: string;
  summary: string;
  facts: Fact[];
  missingItems: string[];
  warnings: string[];
  engine: "openai" | "claude" | "rules";
  provider: string;
  fallback: boolean;
  fallbackReason?: string;
  model?: string;
  isScanned: boolean;
  embeddedInstructions: string[];
  pageCount: number;
  sha256: string;
  fileName: string;
  hasTextLayer: boolean;
  duplicateOf: string | null;
  previous: { revLabel: string; fileName: string } | null;
  diffPreview: FactChange[];
  dependentsPreview: { id: string; name: string; onFile: boolean }[];
  aiSummary?: { text: string; source: string };
  explainError?: string;
  ms: number;
}

export default function UploadPanel({ siteId, canUpload, userName }: { siteId: string; canUpload: boolean; userName: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"idle" | "analyzing" | "review" | "filing">("idle");
  const [res, setRes] = useState<Result | null>(null);
  const [reqId, setReqId] = useState("");
  const [date, setDate] = useState("");
  const [source, setSource] = useState("supplier");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [drag, setDrag] = useState(false);
  const [name, setName] = useState("");

  async function run(f: File) {
    setName(f.name); setRes(null); setMsg(null); setPhase("analyzing");
    if (f.size > 15 * 1024 * 1024) { setPhase("idle"); return setMsg({ tone: "err", text: "File is larger than the 15 MB limit." }); }
    const fd = new FormData();
    fd.append("file", f);
    fd.append("siteId", siteId);
    try {
      const r = await fetch("/api/extract", { method: "POST", body: fd });
      const j = (await r.json()) as Result;
      if (!r.ok || !j.ok) { setPhase("idle"); return setMsg({ tone: "err", text: j.error ?? `Upload failed (${r.status})` }); }
      setRes(j); setReqId(j.requirementId); setDate(j.effectiveDate ?? new Date().toISOString().slice(0, 10)); setPhase("review");
    } catch {
      setPhase("idle"); setMsg({ tone: "err", text: "Network error while analyzing the document." });
    }
  }

  async function changeType(rid: string) {
    setReqId(rid);
    if (!res || rid === "unknown") return;
    const r = await fetch(`/api/extract/${res.extractionId}?requirementId=${encodeURIComponent(rid)}`);
    const j = await r.json();
    if (j.ok) setRes({ ...res, previous: j.previous, diffPreview: j.diffPreview, dependentsPreview: j.dependentsPreview });
  }

  async function submit() {
    if (!res) return;
    setPhase("filing");
    const r = await fetch(`/api/sites/${siteId}/revisions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ extractionId: res.extractionId, requirementId: reqId, effectiveDate: date, source }) });
    const j = await r.json();
    if (!j.ok) { setPhase("review"); return setMsg({ tone: "err", text: j.error }); }
    setRes(null); setPhase("idle");
    const n = j.engineeringTasks?.length ?? 0;
    setMsg({ tone: "ok", text: `Filed as Rev ${j.revision.revLabel} — in engineer review.${n ? ` ${n} dependency review task(s) opened.` : ""} Approved packages are unchanged until an engineer decides.` });
    router.refresh();
  }

  const material = res?.diffPreview.filter((c) => c.significance === "material") ?? [];

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-slate-200 bg-gradient-to-r from-slate-900 to-slate-700 px-4 py-3 text-white">
        <div className="text-sm font-semibold">Document intelligence · upload a revision</div>
        <p className="text-xs text-slate-300">AI reads the PDF, extracts facts with evidence, compares with the approved revision. Nothing enters a package until an engineer approves.</p>
      </div>
      <div className="p-4">
        {!canUpload ? (
          <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">Sign in as an EQORE or supplier user (top right) to upload. Signed in as: {userName}.</div>
        ) : (
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) run(f); }}
            onClick={() => phase !== "analyzing" && input.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed p-5 text-center text-sm transition ${drag ? "border-indigo-400 bg-indigo-50" : "border-slate-300 hover:border-slate-400 hover:bg-slate-50"}`}
          >
            {phase === "analyzing" ? (
              <div className="space-y-2 text-left">
                <div className="flex items-center gap-2 font-medium text-indigo-700"><span className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" /> Analyzing {name}…</div>
                <ul className="space-y-0.5 pl-5 text-xs text-slate-500">
                  <li>Validating file type from bytes · computing SHA-256 on the server</li>
                  <li>Reading the PDF text layer (for evidence verification)</li>
                  <li>Structured extraction (provider shown when done; AI may take 10–60 s)</li>
                  <li>Comparing with the approved revision · dependency impact</li>
                </ul>
              </div>
            ) : (
              <>
                <div className="text-slate-600">📄 Drop a PDF, scan or photo — or click to browse</div>
                <div className="mt-1 text-[11px] text-slate-400">PDF · PNG · JPEG · WEBP · TXT · max 15 MB / 40 pages · demo: sample-docs/SYNTHETIC_Switchgear_Spec_RevB.pdf</div>
              </>
            )}
            <input ref={input} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) run(f); }} />
          </div>
        )}
        {msg && <div className={`mt-3 rounded-lg p-2.5 text-xs ${msg.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.text}</div>}

        {res && (
          <div className="mt-4 space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <EngineBadge engine={res.engine} model={res.model} fallback={res.fallback} />
              <span className="text-xs text-slate-500">{(res.ms / 1000).toFixed(1)} s · {res.pageCount} page(s) · {res.hasTextLayer ? "text layer ✓" : "no text layer (scan)"}</span>
            </div>
            {res.fallback && <div className="rounded-lg border border-orange-200 bg-orange-50 p-2.5 text-xs text-orange-900"><b>Deterministic fallback.</b> {res.fallbackReason}. Results come from labeled text-layer rules, not AI.</div>}
            {res.embeddedInstructions.length > 0 && (
              <div className="rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs text-red-800"><b>⚠ Embedded instructions detected and ignored.</b> The document contains text addressed to an AI. Application rules still require human engineering review.<div className="mt-1 italic">“{res.embeddedInstructions[0]}”</div></div>
            )}
            <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-xs">
              <div className="flex items-center justify-between"><span className="text-slate-500">SHA-256 (server)</span><Hash h={res.sha256} n={20} /></div>
              {res.duplicateOf && <div className="font-medium text-red-700">Duplicate of {res.duplicateOf} — identical bytes.</div>}
              {res.title && <div><span className="text-slate-500">Title:</span> {res.title}</div>}
              {(res.revisionLabel || res.documentNumber) && <div><span className="text-slate-500">Document:</span> {res.documentNumber ?? "—"} · Rev {res.revisionLabel ?? "?"}{res.manufacturer ? ` · ${res.manufacturer}` : ""}</div>}
              {res.summary && <div className="text-slate-600">{res.summary}</div>}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="col-span-2 text-xs font-medium text-slate-600">
                Document type <span className="font-normal text-slate-400">· classified at {Math.round(res.docTypeConfidence * 100)}% confidence — correct it if wrong</span>
                <select value={reqId} onChange={(e) => changeType(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                  <option value="unknown">— choose —</option>
                  {REQUIREMENTS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </label>
              <label className="text-xs font-medium text-slate-600">Source
                <select value={source} onChange={(e) => setSource(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                  {["supplier", "engineer", "eqore", "ahj", "utility", "facility"].map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              <label className="text-xs font-medium text-slate-600">Doc date
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
              </label>
            </div>

            {res.previous ? (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <div className="text-xs font-semibold text-slate-700">Compared with approved Rev {res.previous.revLabel}</div>
                  <div className="text-[11px] text-slate-500">{material.length} material · {res.diffPreview.length - material.length} other</div>
                </div>
                {res.aiSummary && <div className={`rounded-lg p-2.5 text-xs ${res.aiSummary.source === "openai" ? "bg-indigo-50 text-indigo-900" : "bg-slate-50 text-slate-700"}`}><b>{res.aiSummary.source === "openai" ? "AI summary" : "Summary"}:</b> {res.aiSummary.text}</div>}
                {res.explainError && <div className="text-[11px] text-orange-700">{res.explainError}</div>}
                <ChangeTable changes={res.diffPreview} />
                {res.dependentsPreview.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                    <b>Dependency graph:</b> filing this revision opens engineering review for
                    <ul className="mt-1 list-disc pl-4">{res.dependentsPreview.map((d) => <li key={d.id}>{d.name}{d.onFile ? "" : " (not on file — noted only)"}</li>)}</ul>
                  </div>
                )}
              </div>
            ) : (
              reqId !== "unknown" && <div className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">No approved revision of this type yet — this will be the first revision.</div>
            )}

            <details className="group" open={!res.previous}>
              <summary className="cursor-pointer text-xs font-semibold text-slate-700">Extracted facts ({res.facts.length})</summary>
              <ul className="mt-2 max-h-72 space-y-1.5 overflow-auto pr-1">
                {res.facts.map((f, i) => (
                  <li key={i} className="rounded-lg border border-slate-200 p-2">
                    <div className="flex items-center justify-between gap-2"><span className="text-xs text-slate-500">{f.label}</span><span className="flex items-center gap-1"><EvidenceStatus f={f} /><Confidence c={f.confidence} /></span></div>
                    <div className="text-sm font-semibold">{f.value}{f.unit ? ` ${f.unit}` : ""}</div>
                    {f.evidence && <div className="text-[11px] italic text-slate-500">“{f.evidence}”</div>}
                    {f.note && <div className="text-[11px] text-amber-700">{f.note}</div>}
                  </li>
                ))}
                {!res.facts.length && <li className="text-xs text-slate-500">No facts could be established.</li>}
              </ul>
            </details>

            {res.missingItems.length > 0 && <div className="rounded-lg bg-orange-50 p-2.5 text-xs text-orange-800"><b>Possibly missing (per requirement)</b><ul className="list-disc pl-4">{res.missingItems.map((m, i) => <li key={i}>{m}</li>)}</ul></div>}
            {res.warnings.length > 0 && <div className="rounded-lg bg-red-50 p-2.5 text-xs text-red-800"><b>Warnings</b><ul className="list-disc pl-4">{res.warnings.map((m, i) => <li key={i}>{m}</li>)}</ul></div>}

            <div className="flex gap-2">
              <button disabled={phase === "filing" || reqId === "unknown" || !!res.duplicateOf} onClick={submit} className="btn-primary flex-1">{phase === "filing" ? "Filing…" : "Submit for engineer review →"}</button>
              <button onClick={() => { setRes(null); setPhase("idle"); }} className="btn-ghost">Discard</button>
            </div>
            <p className="text-[11px] text-slate-400">AI output is advisory. Approval, readiness and releases are governed by deterministic rules and authorized engineers.</p>
          </div>
        )}
      </div>
    </div>
  );
}
