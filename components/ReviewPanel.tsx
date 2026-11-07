"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FactChange } from "@/lib/types";

export interface ReviewView {
  id: string;
  docName: string;
  revLabel: string;
  prevLabel?: string;
  fileName: string;
  uploadedBy: string;
  uploadedAt: string;
  engine?: string;
  synthetic?: boolean;
  changes: FactChange[];
  affectedReleases: string[];
  affectedDocs: string[];
}

export default function ReviewPanel({ reviews }: { reviews: ReviewView[] }) {
  const router = useRouter();
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  async function decide(id: string, decision: "approve" | "reject") {
    setBusy(id);
    const r = await fetch(`/api/reviews/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, note: note[id], by: "R. Patel (EQORE engineer)" }) });
    const j = await r.json();
    setBusy("");
    if (!j.ok) setErr(j.error);
    router.refresh();
  }

  if (!reviews.length) return null;
  return (
    <section className="card overflow-hidden border-violet-200">
      <div className="border-b border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-900">Engineer review queue · {reviews.length} open</div>
      {err && <div className="bg-red-50 px-4 py-2 text-xs text-red-700">{err}</div>}
      <ul className="divide-y divide-slate-100">
        {reviews.map((r) => (
          <li key={r.id} className="space-y-3 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <span className="font-semibold">{r.docName}</span> <span className="pill bg-violet-50 text-violet-700 ring-violet-200">Rev {r.revLabel}{r.prevLabel ? ` replaces Rev ${r.prevLabel}` : " (first)"}</span>
                {r.synthetic && <span className="pill ml-1 bg-slate-100 text-slate-600 ring-slate-200">synthetic</span>}
              </div>
              <span className="text-xs text-slate-500">{r.fileName} · {r.uploadedBy} · {r.uploadedAt}{r.engine ? ` · ${r.engine}` : ""}</span>
            </div>

            {r.changes.length > 0 ? (
              <table className="w-full overflow-hidden rounded-lg text-sm ring-1 ring-slate-200">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr><th className="px-3 py-1.5">Fact</th><th className="px-3 py-1.5">Approved</th><th className="px-3 py-1.5">This revision</th><th className="px-3 py-1.5">Evidence</th></tr>
                </thead>
                <tbody>
                  {r.changes.map((c) => (
                    <tr key={c.key} className="border-t border-slate-100">
                      <td className="px-3 py-1.5 text-slate-600">{c.label}</td>
                      <td className="px-3 py-1.5 text-red-700">{c.before ?? "—"}</td>
                      <td className="px-3 py-1.5 font-semibold text-emerald-700">{c.after ?? "—"}</td>
                      <td className="px-3 py-1.5 text-xs italic text-slate-500">{c.evidenceAfter ? `“${c.evidenceAfter}”` : ""}{c.pageAfter ? ` p.${c.pageAfter}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-xs text-slate-500">No fact-level changes detected (or no previous approved revision).</div>
            )}

            {(r.affectedReleases.length > 0 || r.affectedDocs.length > 0) && (
              <div className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
                <b>If approved:</b>
                {r.affectedReleases.map((a) => <div key={a}>• {a} becomes <b>stale</b> and must be rebuilt</div>)}
                {r.affectedDocs.map((a) => <div key={a}>• {a} flagged for engineering review (may need re-issue)</div>)}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <input value={note[r.id] ?? ""} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} placeholder="Decision note (e.g. verified 600 A rating with supplier)" className="min-w-[220px] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
              <button disabled={busy === r.id} onClick={() => decide(r.id, "approve")} className="btn-primary">✓ Approve Rev {r.revLabel}</button>
              <button disabled={busy === r.id} onClick={() => decide(r.id, "reject")} className="btn-ghost">Reject</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
