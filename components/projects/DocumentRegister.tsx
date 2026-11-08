"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EvidenceButton } from "@/components/evidence/EvidenceProvider";
import { DocStatusPill, fmtDate } from "@/components/kit";
import type { DocStatus, RegisterRow } from "@/lib/workspace";

const ORDER: DocStatus[] = ["missing", "pending_review", "outdated", "rejected", "received", "approved", "not_yet_required"];
const LABEL: Record<DocStatus, string> = { missing: "Missing now", pending_review: "Pending engineer review", outdated: "Outdated revision", rejected: "Rejected", received: "Received", approved: "Approved", not_yet_required: "Needed later" };

export default function DocumentRegister({ rows, showProject, focus, initialStatus, initialStage }: { rows: RegisterRow[]; showProject?: boolean; focus?: string; initialStatus?: string; initialStage?: string }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | DocStatus | "applicable">(initialStatus && (ORDER as string[]).includes(initialStatus) ? (initialStatus as DocStatus) : focus || initialStage ? "" : "applicable");
  const [project, setProject] = useState("");
  const [stage, setStage] = useState(initialStage ?? "");
  const projects = Array.from(new Map(rows.map((r) => [r.projectId, r.projectName])).entries());
  const stages = Array.from(new Map(rows.map((r) => [r.stage, r.stageLabel])).entries());
  const shown = useMemo(() => rows.filter((r) =>
    (!project || r.projectId === project) && (!stage || r.stage === stage) &&
    (status === "" || (status === "applicable" ? r.status !== "not_yet_required" : r.status === status)) &&
    (!q || `${r.docName} ${r.fileName ?? ""} ${r.projectName} ${r.owner} ${r.codeRef}`.toLowerCase().includes(q.toLowerCase()))), [rows, project, stage, status, q]);
  const counts = Object.fromEntries(ORDER.map((s) => [s, rows.filter((r) => (!project || r.projectId === project) && r.status === s).length])) as Record<DocStatus, number>;

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap gap-1.5 border-b border-slate-100 px-3 pt-3">
        <button onClick={() => setStatus("applicable")} className={`rounded-full px-3 py-1 text-xs ${status === "applicable" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}>Applicable now</button>
        <button onClick={() => setStatus("")} className={`rounded-full px-3 py-1 text-xs ${status === "" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}>All ({rows.filter((r) => !project || r.projectId === project).length})</button>
        {ORDER.map((s) => counts[s] > 0 && <button key={s} onClick={() => setStatus(s)} className={`rounded-full px-3 py-1 text-xs ${status === s ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}>{LABEL[s]} ({counts[s]})</button>)}
      </div>
      <div className="flex flex-wrap gap-2 p-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents, files, owners, code references…" className="min-w-[200px] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        {showProject && <select value={project} onChange={(e) => setProject(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"><option value="">All projects</option>{projects.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>}
        <select value={stage} onChange={(e) => setStage(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"><option value="">All stages</option>{stages.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr>{showProject && <th className="px-3 py-2">Project</th>}<th className="px-3 py-2">Document</th><th className="px-3 py-2">Stage</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Revision / file</th><th className="px-3 py-2">Provenance</th><th className="px-3 py-2">Responsible</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key} id={`doc-${r.requirementId}`} className={`border-t border-slate-100 align-top ${focus === r.requirementId ? "bg-amber-50" : ""}`}>
                {showProject && <td className="px-3 py-2 text-xs"><Link href={`/projects/${r.projectId}`} className="hover:underline">{r.projectName}</Link></td>}
                <td className="px-3 py-2">
                  <div className="font-medium">{r.docName}</div>
                  <div className="text-[11px] text-slate-400">{r.codeRef}{r.inPackage.length ? ` · in ${r.inPackage.join(", ")}` : ""}</div>
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">{r.stageLabel}</td>
                <td className="px-3 py-2"><DocStatusPill s={r.status} /><div className="mt-1 max-w-[240px] text-[11px] text-slate-500">{r.reason}</div></td>
                <td className="px-3 py-2 text-xs">
                  {r.revLabel ? <><div>Rev {r.revLabel} · {fmtDate(r.uploadedAt)}</div><div className="max-w-[200px] truncate text-[11px] text-slate-400">{r.fileName}</div></> : <span className="text-slate-400">—</span>}
                  {r.revisions.length > 1 && <div className="mt-1 flex flex-wrap gap-1">{r.revisions.map((v) => <Link key={v.id} href={`/sites/${r.projectId}/documents/${encodeURIComponent(v.id)}`} className={`rounded px-1 text-[10px] ${v.superseded || v.status === "rejected" ? "bg-slate-100 text-slate-400 line-through" : v.status === "approved" ? "bg-emerald-50 text-emerald-700" : "bg-violet-50 text-violet-700"}`}>{v.revLabel}</Link>)}</div>}
                </td>
                <td className="px-3 py-2 text-[11px] text-slate-500"><div className="max-w-[180px]">{r.provenance}</div></td>
                <td className="px-3 py-2 text-xs text-slate-600">{r.owner}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex flex-col items-end gap-1">
                    {r.evidence && <EvidenceButton refs={r.evidence} label={r.status === "missing" ? "Requirement" : "View"} />}
                    {r.status === "missing" && <Link href={`/inbox?project=${r.projectId}&expect=${r.requirementId}`} className="text-[11px] text-indigo-600 hover:underline">Import →</Link>}
                    {r.status === "pending_review" && <Link href={`/reviews?project=${r.projectId}`} className="text-[11px] text-indigo-600 hover:underline">Review →</Link>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <div className="p-8 text-center text-sm text-slate-500">No documents match.</div>}
      </div>
    </div>
  );
}
