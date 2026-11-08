"use client";
import Link from "next/link";
import { EvidenceButton } from "@/components/evidence/EvidenceProvider";
import type { PreflightFinding } from "@/lib/guardian/types";
import { CATEGORY_LABEL, findingEvidence, type RevisionEvidence } from "./evidence";

const SEV = {
  blocker: { label: "Blocker", cls: "bg-red-50 text-red-700 ring-red-200", bar: "bg-red-400" },
  warning: { label: "Warning", cls: "bg-amber-50 text-amber-700 ring-amber-200", bar: "bg-amber-400" },
  info: { label: "Info", cls: "bg-sky-50 text-sky-700 ring-sky-200", bar: "bg-sky-400" },
} as const;

const CLASS_LABEL: Record<string, string> = {
  verified_discrepancy: "Verified discrepancy", needs_clarification: "Needs engineering clarification", potential_inconsistency: "Potential inconsistency", explained_difference: "Explained difference",
  consistent: "Consistent", insufficient_evidence: "Insufficient evidence",
};

/** One Guardian finding, rendered exactly from the backend report. */
export default function FindingCard({ f, site, byRev, onShowInGraph, highlighted, index = 0 }: { f: PreflightFinding; site: { id: string; name: string }; byRev: RevisionEvidence; onShowInGraph?: (nodeId: string) => void; highlighted?: boolean; index?: number }) {
  const ev = findingEvidence(f, site, byRev);
  const quoted = f.evidence.filter((e) => e.quote);
  const other = f.evidence.filter((e) => !e.quote);
  const sev = SEV[f.severity];
  return (
    <article id={f.id} style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }} className={`ros-rise relative overflow-hidden rounded-xl border bg-white/70 p-4 transition ${highlighted ? "border-amber-300 shadow-glow-amber" : "border-slate-200"}`}>
      <span className={`absolute inset-y-0 left-0 w-1 ${sev.bar}`} aria-hidden />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`pill ${sev.cls}`}>{sev.label}</span>
        <span className="pill bg-slate-100 text-slate-700 ring-slate-200">{f.id.startsWith("ADV-") ? "Unconfirmed suggestion" : CATEGORY_LABEL[f.category]}</span>
        {f.consistencyClass && <span className="pill bg-violet-50 text-violet-700 ring-violet-200">{CLASS_LABEL[f.consistencyClass]}</span>}
        {f.blocking ? <span className="pill bg-red-50 text-red-700 ring-red-200">Blocks release (release gate)</span> : <span className="text-[11px] text-slate-500">Advisory — does not block</span>}
        <span className="ml-auto font-mono text-[10px] text-slate-400">{f.id}</span>
      </div>

      <h3 className="mt-2 text-sm font-semibold leading-snug text-slate-900">{f.title}</h3>

      <dl className="mt-2 grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[110px_minmax(0,1fr)]">
        <dt className="text-slate-500">Why it matters</dt>
        <dd className="text-slate-700">{f.detail || (f.blocking ? "The release gate will not allow a submission package to be sealed until this is resolved." : "Shown so reviewers see it before submitting.")}</dd>
        <dt className="text-slate-500">Who acts</dt>
        <dd className="font-medium text-slate-800">{f.responsibleRole ?? "Not recorded"}</dd>
        <dt className="text-slate-500">What resolves it</dt>
        <dd className="text-slate-800">{f.nextAction}</dd>
        {f.affectedFiles.length > 0 && (<>
          <dt className="text-slate-500">Affected</dt>
          <dd className="flex flex-wrap gap-1">{f.affectedFiles.map((a) => <span key={a.revisionId} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">{a.fileName} · Rev {a.revLabel}</span>)}</dd>
        </>)}
      </dl>

      {quoted.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {quoted.map((e, i) => (
            <blockquote key={i} className="rounded-lg border-l-2 border-amber-400 bg-amber-50/60 px-3 py-1.5 text-xs">
              <span className="italic text-slate-800">“{e.quote}”</span>
              <div className="mt-0.5 text-[11px] text-slate-500">{e.label}{e.verified === false ? <span className="ml-1 text-orange-700">· quote not verified</span> : e.verified ? <span className="ml-1 text-emerald-700">· verified in source</span> : null}</div>
            </blockquote>
          ))}
        </div>
      )}
      {other.length > 0 && <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">{other.map((e, i) => e.href ? <Link key={i} href={e.href} className="hover:text-cyan-600 hover:underline">{e.label} ↗</Link> : <span key={i}>{e.label}</span>)}</div>}

      {f.chain.length > 0 && (
        <ol className="mt-3 flex flex-wrap items-center gap-1 text-[11px]" aria-label="Evidence chain">
          {f.chain.map((c, i) => (
            <li key={c.nodeId + i} className="flex items-center gap-1">
              {i > 0 && <span className="text-slate-400" title={c.via}>→{c.via ? <span className="ml-0.5 hidden text-[10px] text-slate-400 sm:inline">{c.via}</span> : null}</span>}
              <button type="button" onClick={() => onShowInGraph?.(c.nodeId)} disabled={!onShowInGraph} title={onShowInGraph ? "Show in evidence graph" : c.label}
                className="max-w-[260px] truncate rounded-md bg-slate-100 px-1.5 py-0.5 text-slate-700 ring-1 ring-inset ring-slate-200 transition enabled:hover:bg-cyan-50 enabled:hover:text-cyan-700 enabled:hover:ring-cyan-200">{c.label}</button>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {ev.length > 0 ? <EvidenceButton refs={ev} label={`View evidence${ev.length > 1 ? ` (${ev.length})` : ""}`} /> : <span className="text-[11px] text-slate-400">No original document for this finding (checklist / task record)</span>}
        {f.affectedFiles[0] && <Link href={f.affectedFiles[0].href} className="text-[11px] text-cyan-600 hover:underline">Open document page ↗</Link>}
      </div>
    </article>
  );
}
