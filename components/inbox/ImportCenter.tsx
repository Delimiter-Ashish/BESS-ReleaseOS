"use client";
// Multi-document intake. Each file runs independently through the EXISTING two-step backend:
//   POST /api/extract (validate, hash, text layer, AI/rules extraction, diff preview)  →  POST /api/sites/:id/revisions (file for engineer review)
// A pending engineering review never blocks other uploads. ZIP archives are expanded in the browser and each
// supported file goes through the same path. Nothing here fabricates extraction output.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { EvidenceButton } from "@/components/evidence/EvidenceProvider";
import { ChangeTable, Confidence, EngineBadge, EvidenceStatus } from "@/components/ui";
import type { Fact, FactChange } from "@/lib/types";
import type { EvidenceRef } from "@/lib/workspace";

interface Extract {
  ok: boolean; error?: string; extractionId: string; requirementId: string; docTypeConfidence: number; title: string; revisionLabel?: string; documentNumber?: string;
  summary: string; facts: Fact[]; missingItems: string[]; warnings: string[]; engine: string; model?: string; fallback: boolean; fallbackReason?: string;
  embeddedInstructions: string[]; pageCount: number; sha256: string; fileId: string; mediaType: string; fileName: string; hasTextLayer: boolean; duplicateOf: string | null;
  previous: { revLabel: string; fileName: string } | null; diffPreview: FactChange[]; dependentsPreview: { id: string; name: string; onFile: boolean }[];
  aiSummary?: { text: string; source: string }; ms: number;
}
type Status = "queued" | "analyzing" | "ready" | "filing" | "filed" | "error";
interface CommResult { duplicate: boolean; engine: string; model?: string; fallback: boolean; summary: string; warnings: string[]; items: { id: string; title: string; kind: string; status: string }[]; communicationId: string }
interface Item {
  id: string; file: File; projectId: string; status: Status; origin?: string; result?: Extract; reqId: string; error?: string;
  filed?: { revLabel: string; reviewId: string; tasks: string[] }; open: boolean;
  /** document → /api/extract + /revisions; communication → /api/sites/:id/communications (Project Memory). */
  mode: "document" | "communication"; text?: string; comm?: CommResult;
}
const looksLikeEmail = (name: string, text: string) => /\.eml$/i.test(name) || (/\.txt$/i.test(name) && /^(from|subject|date|to):/im.test(text.slice(0, 1500)));

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 25;
const SUPPORTED = /\.(pdf|png|jpe?g|webp|txt|eml)$/i;
const CONCURRENCY = 2;
let seq = 0;

export default function ImportCenter({ projects, defaultProject, expect, canUpload, userName, requirements }: {
  projects: { id: string; name: string; stage: string }[]; defaultProject: string; expect?: string; canUpload: boolean; userName: string; requirements: { id: string; name: string }[];
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [projectId, setProjectId] = useState(defaultProject);
  const [items, setItems] = useState<Item[]>([]);
  const [drag, setDrag] = useState(false);
  const [notice, setNotice] = useState("");
  const running = useRef(0);
  const reqName = (id: string) => requirements.find((r) => r.id === id)?.name ?? "Unclassified";
  const projName = (id: string) => projects.find((p) => p.id === id)?.name ?? id;
  const patch = useCallback((id: string, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x))), []);

  async function addFiles(list: FileList | File[]) {
    setNotice("");
    const out: Item[] = [];
    const skipped: string[] = [];
    for (const f of Array.from(list)) {
      if (/\.zip$/i.test(f.name)) {
        try {
          const JSZip = (await import("jszip")).default;
          const zip = await JSZip.loadAsync(f);
          const entries = Object.values(zip.files).filter((e) => !e.dir && !/(^|\/)(__MACOSX|\.)/.test(e.name));
          let n = 0;
          for (const e of entries) {
            const base = e.name.split("/").pop()!;
            if (!SUPPORTED.test(base)) { skipped.push(`${base} (unsupported type)`); continue; }
            if (n >= MAX_ZIP_ENTRIES) { skipped.push(`${base} (more than ${MAX_ZIP_ENTRIES} files in archive)`); continue; }
            const blob = await e.async("blob");
            if (blob.size > MAX_BYTES) { skipped.push(`${base} (over 15 MB)`); continue; }
            out.push(await newItem(new File([blob], base), `from ${f.name}`));
            n++;
          }
        } catch {
          skipped.push(`${f.name} (could not read ZIP)`);
        }
        continue;
      }
      if (!SUPPORTED.test(f.name)) { skipped.push(`${f.name} (unsupported type)`); continue; }
      if (f.size > MAX_BYTES) { skipped.push(`${f.name} (over 15 MB)`); continue; }
      out.push(await newItem(f));
    }
    if (skipped.length) setNotice(`Skipped: ${skipped.join(", ")}`);
    setItems((xs) => [...out, ...xs]);
  }
  const newItem = async (file: File, origin?: string): Promise<Item> => {
    const text = /\.(txt|eml)$/i.test(file.name) ? await file.text().catch(() => "") : undefined;
    const mode = text !== undefined && looksLikeEmail(file.name, text) ? "communication" : "document";
    return { id: `u${++seq}`, file, projectId, status: "queued", origin, reqId: "unknown", open: false, mode, text };
  };

  const analyze = useCallback(async (it: Item) => {
    patch(it.id, { status: "analyzing", error: undefined });
    if (it.mode === "communication") {
      try {
        const body = it.text ?? (await it.file.text());
        const r = await fetch(`/api/sites/${it.projectId}/communications`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body, channel: /ahj|fire|building|plan review|marshal/i.test(body.slice(0, 1500)) ? "ahj_comment" : "email" }) });
        const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
        if (!j.ok) return patch(it.id, { status: "error", error: r.status === 403 ? "Only EQORE users can import communications (server-enforced)" : j.error ?? `Import failed (${r.status})` });
        const a = j.communication.analysis;
        patch(it.id, { status: "filed", open: true, comm: { duplicate: !!j.duplicate, engine: a.engine, model: a.model, fallback: a.fallback, summary: a.summary, warnings: a.warnings ?? [], communicationId: j.communication.id, items: (j.items ?? []).map((m: { id: string; title: string; kind: string; status: string }) => ({ id: m.id, title: m.title, kind: m.kind, status: m.status })) } });
        router.refresh();
      } catch {
        patch(it.id, { status: "error", error: "Network error while importing the communication" });
      }
      return;
    }
    const fd = new FormData();
    fd.append("file", it.file);
    fd.append("siteId", it.projectId);
    try {
      const r = await fetch("/api/extract", { method: "POST", body: fd });
      const j = (await r.json()) as Extract;
      if (!r.ok || !j.ok) return patch(it.id, { status: "error", error: j.error ?? `Analysis failed (${r.status})` });
      patch(it.id, { status: "ready", result: j, reqId: j.requirementId, open: true });
    } catch {
      patch(it.id, { status: "error", error: "Network error while analyzing" });
    }
  }, [patch, router]);

  // Queue pump: at most CONCURRENCY analyses in flight; everything else stays independent.
  useEffect(() => {
    const queued = items.filter((x) => x.status === "queued");
    const inFlight = items.filter((x) => x.status === "analyzing").length;
    running.current = inFlight;
    for (const it of queued.slice(0, Math.max(0, CONCURRENCY - inFlight))) void analyze(it);
  }, [items, analyze]);

  async function changeType(it: Item, rid: string) {
    patch(it.id, { reqId: rid });
    if (!it.result || rid === "unknown") return;
    const r = await fetch(`/api/extract/${it.result.extractionId}?requirementId=${encodeURIComponent(rid)}`);
    const j = await r.json();
    if (j.ok) patch(it.id, { reqId: rid, result: { ...it.result, previous: j.previous, diffPreview: j.diffPreview, dependentsPreview: j.dependentsPreview } });
  }

  async function file(it: Item) {
    if (!it.result || it.reqId === "unknown") return;
    patch(it.id, { status: "filing", error: undefined });
    try {
      const r = await fetch(`/api/sites/${it.projectId}/revisions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ extractionId: it.result.extractionId, requirementId: it.reqId }) });
      const j = await r.json();
      if (!j.ok) return patch(it.id, { status: "ready", error: j.error });
      patch(it.id, { status: "filed", open: false, filed: { revLabel: j.revision.revLabel, reviewId: j.review.id, tasks: (j.engineeringTasks ?? []).map((t: { dependentRequirementId: string }) => reqName(t.dependentRequirementId)) } });
      router.refresh(); // dashboards, badges and queues re-derive from the store
    } catch {
      patch(it.id, { status: "ready", error: "Network error while filing" });
    }
  }
  const fileAll = async () => { for (const it of items.filter((x) => x.status === "ready" && x.reqId !== "unknown" && !x.result?.duplicateOf)) await file(it); };

  const counts = { total: items.length, active: items.filter((x) => x.status === "queued" || x.status === "analyzing").length, ready: items.filter((x) => x.status === "ready" && x.reqId !== "unknown" && !x.result?.duplicateOf).length, filed: items.filter((x) => x.status === "filed").length, error: items.filter((x) => x.status === "error").length };
  const asDocument = (it: Item) => setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, mode: "document", status: "queued", comm: undefined, error: undefined } : x)));

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-slate-600">Assign new files to project
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="mt-1 block w-full max-w-xs rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm">
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.stage}</option>)}
            </select>
          </label>
          {expect && <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Expected document: <b>{reqName(expect)}</b> for {projName(defaultProject)}</div>}
          <div className="ml-auto text-xs text-slate-500">{canUpload ? `Uploading as ${userName}` : ""}</div>
        </div>
        {!canUpload ? (
          <div className="mt-3 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">Sign in as an EQORE project manager or supplier (sidebar → identity) to import documents. Currently: {userName}.</div>
        ) : (
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); void addFiles(e.dataTransfer.files); }}
            onClick={() => input.current?.click()}
            className={`mt-3 cursor-pointer rounded-xl border-2 border-dashed px-6 py-8 text-center transition ${drag ? "border-teal-500 bg-teal-50" : "border-slate-300 hover:border-slate-400 hover:bg-slate-50"}`}
          >
            <div className="text-sm font-medium text-slate-700">Drop documents or a ZIP folder here — or click to choose several files</div>
            <div className="mt-1 text-xs text-slate-500">PDF · PNG · JPEG · WEBP · TXT · EML · ZIP (expanded in your browser, up to {MAX_ZIP_ENTRIES} files) · 15 MB per file. Emails go to Project Memory; documents to extraction. Files are processed independently, {CONCURRENCY} at a time — a pending review never blocks another upload.</div>
            <div className="mt-2 text-[11px] text-slate-400">Demo: sample-docs/SYNTHETIC_Switchgear_Spec_RevB_600A.pdf (400 A → 600 A) · sample-docs/SYNTHETIC_AHJ_Email_Ventilation.txt (AHJ email) · sample-docs/demo/*</div>
            <input ref={input} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.eml,.zip" className="hidden" onChange={(e) => { const f = e.target.files; if (f) void addFiles(f); e.target.value = ""; }} />
          </div>
        )}
        {notice && <div className="mt-2 rounded-lg bg-orange-50 p-2 text-xs text-orange-800">{notice}</div>}
      </div>

      {items.length > 0 && (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
            <div className="text-sm font-semibold">This import · {counts.total} file{counts.total === 1 ? "" : "s"}</div>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              {counts.active > 0 && <span className="text-indigo-600">{counts.active} processing</span>}
              <span>{counts.ready} ready to file</span><span className="text-emerald-700">{counts.filed} filed for review</span>{counts.error > 0 && <span className="text-red-600">{counts.error} failed</span>}
              <button disabled={!counts.ready} onClick={fileAll} className="btn-primary !py-1 !text-xs">Submit {counts.ready || ""} classified for review</button>
              <button onClick={() => setItems((xs) => xs.filter((x) => x.status !== "filed"))} className="btn-ghost !py-1 !text-xs">Clear filed</button>
            </div>
          </div>
          <ul className="divide-y divide-slate-100">
            {items.map((it) => <Row key={it.id} it={it} items={items} reqName={reqName} projName={projName} requirements={requirements} onToggle={() => patch(it.id, { open: !it.open })} onType={(r) => changeType(it, r)} onFile={() => file(it)} onRetry={() => patch(it.id, { status: "queued" })} onRemove={() => setItems((xs) => xs.filter((x) => x.id !== it.id))} onAsDocument={() => asDocument(it)} />)}
          </ul>
        </div>
      )}
    </div>
  );
}

const STATUS_PILL: Record<Status, [string, string]> = {
  queued: ["Queued", "bg-slate-100 text-slate-600 ring-slate-200"],
  analyzing: ["Analyzing…", "bg-indigo-50 text-indigo-700 ring-indigo-200"],
  ready: ["Extracted · confirm type", "bg-sky-50 text-sky-700 ring-sky-200"],
  filing: ["Filing…", "bg-indigo-50 text-indigo-700 ring-indigo-200"],
  filed: ["Filed · in engineer review", "bg-violet-50 text-violet-700 ring-violet-200"],
  error: ["Failed", "bg-red-50 text-red-700 ring-red-200"],
};

const DOC_STEPS = ["Validate", "Extract", "Classify", "Compare", "Review task", "Project updated"];
const COMM_STEPS = ["Validate", "Extract requirements", "Suggestions recorded", "Awaiting human confirmation"];
/** Pipeline position derived only from this file's real request state. */
function Pipeline({ it }: { it: Item }) {
  const steps = it.mode === "communication" ? COMM_STEPS : DOC_STEPS;
  const done = it.mode === "communication"
    ? (it.status === "filed" ? 3 : 0)
    : it.status === "ready" ? 4 : it.status === "filing" ? 4 : it.status === "filed" ? 6 : 0;
  const active = it.status === "analyzing" ? (it.mode === "communication" ? [0, 1] : [0, 1, 2]) : it.status === "filing" ? [4] : [];
  const failedAt = it.status === "error" ? (it.result ? 4 : 0) : -1;
  return (
    <ol className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px]" aria-label="Processing pipeline">
      {steps.map((s, i) => {
        const st = failedAt === i ? "fail" : i < done ? "done" : active.includes(i) ? "active" : "todo";
        return (
          <li key={s} className="flex items-center gap-1">
            {i > 0 && <span className={`h-px w-3 ${i <= done ? "bg-teal-400" : "bg-slate-300"}`} />}
            <span className={`rounded-full px-1.5 py-0.5 ring-1 ring-inset ${st === "done" ? "bg-teal-50 text-teal-700 ring-teal-200" : st === "active" ? "ros-pulse bg-cyan-50 text-cyan-700 ring-cyan-300" : st === "fail" ? "bg-red-50 text-red-700 ring-red-200" : "text-slate-400 ring-slate-200"}`}>{s}</span>
          </li>
        );
      })}
      {it.status === "analyzing" && <span className="ml-1 text-slate-400">server-side, one request</span>}
    </ol>
  );
}

function Row({ it, items, reqName, projName, requirements, onToggle, onType, onFile, onRetry, onRemove, onAsDocument }: {
  it: Item; items: Item[]; reqName: (id: string) => string; projName: (id: string) => string; requirements: { id: string; name: string }[];
  onToggle: () => void; onType: (rid: string) => void; onFile: () => void; onRetry: () => void; onRemove: () => void; onAsDocument: () => void;
}) {
  const r = it.result;
  const material = r?.diffPreview.filter((c) => c.significance === "material") ?? [];
  const sameType = items.filter((x) => x.id !== it.id && x.projectId === it.projectId && x.reqId === it.reqId && it.reqId !== "unknown" && (x.status === "ready" || x.status === "filed"));
  const evidence = (f?: Fact): EvidenceRef | undefined => r ? {
    key: `${r.extractionId}:${f?.key ?? ""}`, projectId: it.projectId, projectName: projName(it.projectId), docName: reqName(it.reqId), revLabel: r.revisionLabel, revStatus: it.status === "filed" ? "in_review" : "not yet filed",
    fileName: r.fileName, fileId: r.fileId, mediaType: r.mediaType, page: f?.page, quote: f?.evidence, factLabel: f?.label, factValue: f ? `${f.value}${f.unit ? ` ${f.unit}` : ""}` : undefined,
    provenance: `Live upload · ${r.engine === "rules" ? "rule-extracted" : `AI-extracted (${r.engine})`}${r.fallback ? " · fallback" : ""}`,
    facts: r.facts.map((x) => ({ label: x.label, value: `${x.value}${x.unit ? ` ${x.unit}` : ""}`, evidence: x.evidence, page: x.page, verified: x.evidenceVerified, origin: x.origin })),
  } : undefined;
  const focusFact = material[0] ? r?.facts.find((f) => f.key === material[0].key) : r?.facts.find((f) => f.evidence);
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onToggle} className="text-slate-400 hover:text-slate-700" aria-label="Toggle details">{it.open ? "▾" : "▸"}</button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{it.file.name}</span>
            <span className={`pill ${STATUS_PILL[it.status][1]}`}>{it.status === "analyzing" && <span className="h-2 w-2 animate-spin rounded-full border border-indigo-600 border-t-transparent" />}{STATUS_PILL[it.status][0]}</span>
            {r?.duplicateOf && <span className="pill bg-red-50 text-red-700 ring-red-200">Duplicate of {r.duplicateOf}</span>}
            {material.length > 0 && <span className="pill bg-red-50 text-red-700 ring-red-200">{material.length} material change{material.length > 1 ? "s" : ""}</span>}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            {projName(it.projectId)} · {(it.file.size / 1024).toFixed(0)} KB{it.origin ? ` · ${it.origin}` : ""}
            {r && <> · <b className="text-slate-700">{reqName(it.reqId)}</b> ({Math.round(r.docTypeConfidence * 100)}% type confidence){r.revisionLabel ? ` · Rev ${r.revisionLabel}` : ""} · {r.facts.length} facts · {r.pageCount} page(s)</>}
          </div>
          {it.filed && <div className="mt-1 text-xs text-violet-700">Filed as Rev {it.filed.revLabel} → engineer review queue{it.filed.tasks.length ? ` · dependency review opened for ${it.filed.tasks.join(", ")}` : ""}. <a className="underline" href={`/reviews?item=${encodeURIComponent(it.filed.reviewId)}`}>Open review</a></div>}
          {it.error && <div className="mt-1 text-xs text-red-700">{it.error}</div>}
          {it.mode === "communication" && <div className="mt-0.5 text-[11px] text-cyan-700">Detected an email / communication → Project Memory (not a document revision)</div>}
          <Pipeline it={it} />
          {it.comm && (
            <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-700">
              {it.comm.duplicate ? "Already on record — no duplicate suggestions were created." : <>{it.comm.items.length} suggestion(s) from {it.comm.engine === "openai" ? `OpenAI${it.comm.model ? ` (${it.comm.model})` : ""}` : `deterministic rules${it.comm.fallback ? " (fallback)" : ""}`} · each needs a person to confirm before it counts.</>}
              <ul className="mt-1 space-y-0.5">{it.comm.items.map((m) => <li key={m.id}>◌ <span className="text-slate-500">{m.kind.replace("_", " ")}:</span> {m.title} <span className="text-[10px] text-slate-400">({m.status})</span></li>)}</ul>
              {it.comm.warnings.map((w) => <div key={w} className="mt-1 text-amber-700">⚠ {w}</div>)}
              <div className="mt-1.5 flex gap-3"><a className="text-cyan-600 underline" href={`/memory?project=${it.projectId}&type=ahj_requirement`}>Confirm in Action Center →</a><button type="button" onClick={onAsDocument} className="text-slate-500 underline">Import as a document instead</button></div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {r && <EvidenceButton refs={evidence(focusFact)} label="Original" />}
          {r && <EngineBadge engine={r.engine} model={r.model} fallback={r.fallback} />}
          {it.status === "ready" && <button disabled={it.reqId === "unknown" || !!r?.duplicateOf} onClick={onFile} className="btn-primary !py-1 !text-xs">Submit for review</button>}
          {it.status === "error" && <button onClick={onRetry} className="btn-ghost !py-1 !text-xs">Retry</button>}
          {(it.status === "error" || it.status === "ready" || it.status === "queued") && <button onClick={onRemove} className="text-xs text-slate-400 hover:text-slate-700">Remove</button>}
        </div>
      </div>

      {it.open && r && (
        <div className="mt-3 grid gap-4 pl-6 lg:grid-cols-2">
          <div className="space-y-3">
            <label className="block text-xs font-medium text-slate-600">Document type {it.status !== "ready" && <span className="text-slate-400">(locked after filing)</span>}
              <select disabled={it.status !== "ready"} value={it.reqId} onChange={(e) => onType(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm">
                <option value="unknown">— choose document type —</option>
                {requirements.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
              </select>
            </label>
            {sameType.length > 0 && it.status === "ready" && <div className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Another file in this import is also a {reqName(it.reqId)} for this project. Only the latest filed revision can be reviewed; filing this one supersedes any earlier pending upload of the same document.</div>}
            {r.fallback && <div className="rounded-lg border border-orange-200 bg-orange-50 p-2 text-xs text-orange-900"><b>Deterministic fallback.</b> {r.fallbackReason}. Facts come from labeled text-layer rules, not AI.</div>}
            {r.embeddedInstructions.length > 0 && <div className="rounded-lg border border-red-300 bg-red-50 p-2 text-xs text-red-800"><b>Embedded instructions detected and ignored.</b> “{r.embeddedInstructions[0]}”</div>}
            {r.warnings.length > 0 && <ul className="rounded-lg bg-red-50 p-2 text-xs text-red-800">{r.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}</ul>}
            <div className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">
              <div><b>Engineering review required:</b> yes — every filed revision needs an authorized engineer before it can enter a submission package.</div>
              {r.previous ? <div className="mt-1">Compared with approved Rev {r.previous.revLabel}: {material.length} material, {r.diffPreview.length - material.length} other difference(s).</div> : it.reqId !== "unknown" && <div className="mt-1">No approved revision of this type yet — this will be the first.</div>}
              {r.dependentsPreview.length > 0 && <div className="mt-1 text-amber-800">Filing opens dependency review for: {r.dependentsPreview.map((d) => `${d.name}${d.onFile ? "" : " (not on file — noted)"}`).join(", ")}</div>}
            </div>
            {r.aiSummary && <div className={`rounded-lg p-2.5 text-xs ${r.aiSummary.source === "openai" ? "bg-indigo-50 text-indigo-900" : "bg-slate-50 text-slate-700"}`}><b>{r.aiSummary.source === "openai" ? "AI summary (advisory)" : "Change summary"}:</b> {r.aiSummary.text}</div>}
          </div>
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-700">Extracted facts</div>
            <ul className="max-h-64 space-y-1 overflow-auto pr-1">
              {r.facts.map((f, i) => (
                <li key={i} className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 p-2">
                  <div className="min-w-0">
                    <div className="text-[11px] text-slate-500">{f.label}</div>
                    <div className="text-sm font-semibold">{f.value}{f.unit ? ` ${f.unit}` : ""}</div>
                    {f.evidence && <div className="truncate text-[11px] italic text-slate-500">“{f.evidence}”</div>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1"><span className="flex gap-1"><EvidenceStatus f={f} /><Confidence c={f.confidence} /></span>{f.evidence && <EvidenceButton refs={evidence(f)} label="Source" />}</div>
                </li>
              ))}
              {!r.facts.length && <li className="text-xs text-slate-500">No facts could be established from this file.</li>}
            </ul>
          </div>
          {r.previous && r.diffPreview.length > 0 && <div className="lg:col-span-2"><ChangeTable changes={r.diffPreview} /></div>}
        </div>
      )}
    </li>
  );
}
