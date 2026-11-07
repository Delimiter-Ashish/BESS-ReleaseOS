"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface TaskView {
  id: string;
  source: string;
  sourceRev: string;
  sourceApproved: boolean;
  dependent: string;
  dependentRev?: string;
  changedKeys: string[];
  explanation: string;
  aiImpact?: string;
  status: string;
  resolvedBy?: string;
  resolvedAt?: string;
  resolution?: string;
  resolutionNote?: string;
}

export default function EngineeringTasks({ siteId, tasks, canReview }: { siteId: string; tasks: TaskView[]; canReview: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<Record<string, string>>({});
  const open = tasks.filter((t) => t.status === "open");
  const done = tasks.filter((t) => t.status !== "open").slice(-4).reverse();

  async function resolve(t: TaskView) {
    setBusy(t.id); setErr({ ...err, [t.id]: "" });
    const r = await fetch(`/api/sites/${siteId}/tasks/${t.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: note[t.id] ?? "" }) });
    const j = await r.json();
    setBusy("");
    if (!j.ok) return setErr({ ...err, [t.id]: j.error });
    router.refresh();
  }

  if (!tasks.length) return null;
  return (
    <section className="card overflow-hidden border-orange-200">
      <div className="flex items-center justify-between border-b border-orange-200 bg-orange-50 px-4 py-2.5">
        <div className="text-sm font-semibold text-orange-900">Dependency reviews · {open.length} open</div>
        <div className="text-[11px] text-orange-800">Raised by rules from the dependency graph · block releases until resolved</div>
      </div>
      <ul className="divide-y divide-slate-100">
        {open.map((t) => (
          <li key={t.id} className="space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="pill bg-slate-100 text-slate-700 ring-slate-200">{t.source} Rev {t.sourceRev}</span>
              <span className="text-slate-400">→ affects →</span>
              <span className="pill bg-orange-50 text-orange-800 ring-orange-200">{t.dependent}{t.dependentRev ? ` Rev ${t.dependentRev}` : ""}</span>
              {t.changedKeys.map((k) => <span key={k} className="font-mono text-[11px] text-slate-500">{k}</span>)}
            </div>
            <p className="text-xs text-slate-600">{t.explanation}</p>
            {t.aiImpact && <p className="rounded-md bg-amber-50 p-2 text-[11px] text-amber-900"><b>Possible consequences (advisory):</b> {t.aiImpact}</p>}
            {!t.sourceApproved ? (
              <div className="text-xs text-violet-700">◷ Waiting for the source revision to be approved — the dependency review cannot be resolved before that.</div>
            ) : canReview ? (
              <div className="flex flex-wrap gap-2">
                <input value={note[t.id] ?? ""} onChange={(e) => setNote({ ...note, [t.id]: e.target.value })} placeholder="Engineering justification (required) — or upload a revised dependent document" className="min-w-[240px] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
                <button disabled={busy === t.id || (note[t.id] ?? "").trim().length < 3} onClick={() => resolve(t)} className="btn-primary">Confirm still valid</button>
              </div>
            ) : (
              <div className="text-xs text-slate-500">An authorized engineer must confirm the dependent document or approve a revised one.</div>
            )}
            {err[t.id] && <div className="rounded bg-red-50 p-2 text-xs text-red-700">{err[t.id]}</div>}
          </li>
        ))}
        {done.length > 0 && (
          <li className="bg-slate-50/60 p-4">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Recently closed</div>
            {done.map((t) => (
              <div key={t.id} className="text-xs text-slate-600">
                {t.status === "resolved" ? "✓" : "–"} {t.dependent} ← {t.source} Rev {t.sourceRev}: <b>{t.status}</b>
                {t.resolvedBy ? ` by ${t.resolvedBy}` : ""}{t.resolution ? ` (${t.resolution.replace(/_/g, " ")})` : ""}{t.resolutionNote ? ` — “${t.resolutionNote}”` : ""}
              </div>
            ))}
          </li>
        )}
      </ul>
    </section>
  );
}
