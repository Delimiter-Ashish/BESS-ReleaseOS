"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Engineer signoff for a new release. Server re-checks readiness with the optimistic token; nothing here is trusted. */
export default function BuildRelease({ siteId, templateId, nextNumber, canBuild, canSign, token, blockers }: { siteId: string; templateId: string; nextNumber: number; canBuild: boolean; canSign: boolean; token: string; blockers: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function build() {
    setBusy(true); setErr("");
    const r = await fetch(`/api/sites/${siteId}/releases`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateId, note, readinessToken: token }) });
    const j = await r.json();
    setBusy(false);
    if (!j.ok) { setErr(j.error); if (r.status === 409) router.refresh(); return; }
    setOpen(false);
    router.push(`/sites/${siteId}/releases/${j.release.id}`);
  }

  if (!open)
    return (
      <div className="space-y-1">
        <button disabled={!canBuild || !canSign} onClick={() => setOpen(true)} className="btn-primary w-full !py-1.5 !text-xs" title={!canBuild ? "Blocked — resolve the issues listed" : !canSign ? "Engineer signoff required" : ""}>
          {canBuild ? `⟳ Sign off & build R${nextNumber}` : `R${nextNumber} blocked`}
        </button>
        {canBuild && !canSign && <div className="text-[11px] text-slate-500">Ready — an authorized engineer must sign off.</div>}
        {!canBuild && blockers.length > 0 && (
          <ul className="space-y-0.5 text-[11px] text-red-700">{blockers.slice(0, 4).map((b) => <li key={b}>• {b}</li>)}{blockers.length > 4 && <li>• +{blockers.length - 4} more</li>}</ul>
        )}
      </div>
    );
  return (
    <div className="w-full space-y-2 rounded-lg border border-slate-300 bg-slate-50 p-3">
      <div className="text-xs font-semibold text-slate-700">Engineer signoff for R{nextNumber}</div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Signoff note (required) — why this package is being issued" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
      <p className="text-[11px] text-slate-500">Freezes the approved revisions, hashes, approvals and manifest into an immutable snapshot. “Ready for submission” — not a certification of code compliance.</p>
      {err && <div className="text-xs text-red-700">{err}</div>}
      <div className="flex gap-2">
        <button disabled={busy || note.trim().length < 3} onClick={build} className="btn-primary !py-1.5 !text-xs">{busy ? "Sealing…" : `Build version-locked R${nextNumber}`}</button>
        <button onClick={() => setOpen(false)} className="btn-ghost !py-1.5 !text-xs">Cancel</button>
      </div>
    </div>
  );
}
