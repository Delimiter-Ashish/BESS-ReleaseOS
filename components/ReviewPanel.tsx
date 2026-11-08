"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChangeTable, EngineBadge } from "@/components/ui";
import type { FactChange } from "@/lib/types";

export interface ReviewView {
  id: string;
  siteId: string;
  revisionId: string;
  docName: string;
  revLabel: string;
  prevLabel?: string;
  fileName: string;
  uploadedBy: string;
  uploadedAt: string;
  engine?: string;
  model?: string;
  synthetic?: boolean;
  changes: FactChange[];
  materialCount: number;
  aiSummary?: string;
  aiSummarySource?: string;
  affectedReleases: string[];
  raisedTasks: { id: string; dependent: string; status: string }[];
  missingDependents: string[];
  /** Open dependency tasks that target THIS document and can be resolved by approving it. */
  resolvable: { id: string; source: string; explanation: string; sourceApproved: boolean }[];
  selfUpload: boolean;
  warnings: string[];
}

export default function ReviewPanel({ reviews, canReview, userName }: { reviews: ReviewView[]; canReview: boolean; userName: string }) {
  const router = useRouter();
  const [note, setNote] = useState<Record<string, string>>({});
  const [resolve, setResolve] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<Record<string, string>>({});

  async function decide(r: ReviewView, decision: "approve" | "reject") {
    setBusy(r.id); setErr({ ...err, [r.id]: "" });
    const res = await fetch(`/api/reviews/${r.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, note: note[r.id] ?? "", resolveTaskIds: decision === "approve" ? resolve[r.id] ?? [] : [] }) });
    const j = await res.json();
    setBusy("");
    if (!j.ok) return setErr({ ...err, [r.id]: j.error });
    router.refresh();
  }

  if (!reviews.length) return null;
  return (
    <section className="card overflow-hidden border-violet-200">
      <div className="flex items-center justify-between border-b border-violet-200 bg-violet-50 px-4 py-2.5">
        <div className="text-sm font-semibold text-violet-900">Engineering review queue · {reviews.length} open</div>
        <div className="text-[11px] text-violet-700">{canReview ? `Deciding as ${userName}` : "Sign in as an engineer to decide"}</div>
      </div>
      <ul className="divide-y divide-slate-100">
        {reviews.map((r) => (
          <li key={r.id} className="space-y-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{r.docName}</span>
                  <span className="pill bg-violet-50 text-violet-700 ring-violet-200">Rev {r.revLabel}{r.prevLabel ? ` replaces approved Rev ${r.prevLabel}` : " (first)"}</span>
                  {r.materialCount > 0 && <span className="pill bg-red-50 text-red-700 ring-red-200">{r.materialCount} material change{r.materialCount > 1 ? "s" : ""}</span>}
                  {r.synthetic && <span className="pill bg-slate-100 text-slate-600 ring-slate-200">synthetic</span>}
                </div>
                <div className="text-xs text-slate-500">{r.fileName} · uploaded by {r.uploadedBy} · {r.uploadedAt.slice(0, 16).replace("T", " ")}</div>
              </div>
              <div className="flex items-center gap-2">
                <EngineBadge engine={r.engine} model={r.model} />
                <Link href={`/sites/${r.siteId}/documents/${encodeURIComponent(r.revisionId)}`} className="text-xs text-indigo-600 hover:underline">Open document →</Link>
              </div>
            </div>

            {r.aiSummary && <div className={`rounded-lg p-2.5 text-xs ${r.aiSummarySource === "openai" ? "bg-indigo-50 text-indigo-900" : "bg-slate-50 text-slate-700"}`}><b>{r.aiSummarySource === "openai" ? "AI summary (advisory)" : "Change summary"}:</b> {r.aiSummary}</div>}
            {r.prevLabel ? <ChangeTable changes={r.changes} /> : <div className="text-xs text-slate-500">First revision of this document — no comparison baseline.</div>}
            {r.warnings.length > 0 && <div className="rounded-lg bg-red-50 p-2 text-xs text-red-800">{r.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}</div>}

            {(r.affectedReleases.length > 0 || r.raisedTasks.length > 0 || r.missingDependents.length > 0) && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                <div className="mb-1 font-semibold">Impact (deterministic dependency graph)</div>
                {r.raisedTasks.map((t) => <div key={t.id}>• Dependency review opened: <b>{t.dependent}</b> <span className="text-amber-700">({t.status})</span></div>)}
                {r.missingDependents.map((d) => <div key={d}>• Potentially affected, not on file yet: {d}</div>)}
                {r.affectedReleases.map((a) => <div key={a}>• {a}: if approved, the release becomes <b>stale</b> and must be rebuilt (it stays unchanged and downloadable)</div>)}
              </div>
            )}

            {r.resolvable.length > 0 && (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-2.5 text-xs text-indigo-900">
                <div className="mb-1 font-semibold">Resolve dependency reviews with this approval</div>
                {r.resolvable.map((t) => (
                  <label key={t.id} className={`flex items-start gap-2 ${t.sourceApproved ? "" : "opacity-60"}`}>
                    <input type="checkbox" disabled={!t.sourceApproved} checked={(resolve[r.id] ?? []).includes(t.id)} onChange={(e) => setResolve({ ...resolve, [r.id]: e.target.checked ? [...(resolve[r.id] ?? []), t.id] : (resolve[r.id] ?? []).filter((x) => x !== t.id) })} className="mt-0.5" />
                    <span>{t.source} change · {t.sourceApproved ? "source approved" : "approve the source revision first"}</span>
                  </label>
                ))}
              </div>
            )}

            {canReview ? (
              <div className="space-y-2">
                {r.selfUpload && <div className="text-xs text-orange-700">You uploaded this revision — a different engineer must decide it (self-approval is blocked).</div>}
                <div className="flex flex-wrap gap-2">
                  <input value={note[r.id] ?? ""} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} placeholder="Decision note (required) — e.g. verified 600 VAC rating with supplier submittal" className="min-w-[240px] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
                  <button disabled={busy === r.id || r.selfUpload || (note[r.id] ?? "").trim().length < 3} onClick={() => decide(r, "approve")} className="btn bg-emerald-600 text-white hover:bg-emerald-700">✓ Approve Rev {r.revLabel}</button>
                  <button disabled={busy === r.id || r.selfUpload || (note[r.id] ?? "").trim().length < 3} onClick={() => decide(r, "reject")} className="btn-ghost">Reject</button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg bg-slate-50 p-2 text-xs text-slate-500">Approve / reject requires an authorized engineer (e.g. M. Chen, PE). AI never approves documents.</div>
            )}
            {err[r.id] && <div className="rounded bg-red-50 p-2 text-xs text-red-700">{err[r.id]}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}
