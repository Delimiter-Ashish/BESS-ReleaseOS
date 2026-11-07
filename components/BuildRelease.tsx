"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function BuildRelease({ siteId, templateId, nextNumber, canBuild, flags }: { siteId: string; templateId: string; nextNumber: number; canBuild: boolean; flags: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [ack, setAck] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function build() {
    setBusy(true);
    setErr("");
    const r = await fetch(`/api/sites/${siteId}/releases`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateId, note, acknowledgeFlags: ack, by: "R. Patel (EQORE engineer)" }) });
    const j = await r.json();
    setBusy(false);
    if (!j.ok) return setErr(j.error);
    setOpen(false);
    router.push(`/sites/${siteId}/releases/${j.release.id}`);
  }

  if (!open)
    return (
      <button disabled={!canBuild} onClick={() => setOpen(true)} className="btn-primary !py-1.5 !text-xs" title={canBuild ? "" : "Blocked: missing or unapproved documents"}>
        ⟳ Build R{nextNumber}
      </button>
    );
  return (
    <div className="w-full space-y-2 rounded-lg border border-slate-300 bg-slate-50 p-3">
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Release note (why rebuilt)" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
      {flags.length > 0 && (
        <label className="flex items-start gap-2 text-xs text-amber-900">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
          <span>I reviewed the engineering flags ({flags.length}) and confirm the package can go out. Recorded in the manifest.</span>
        </label>
      )}
      {err && <div className="text-xs text-red-700">{err}</div>}
      <div className="flex gap-2">
        <button disabled={busy || (flags.length > 0 && !ack)} onClick={build} className="btn-primary !py-1.5 !text-xs">Build version-locked R{nextNumber}</button>
        <button onClick={() => setOpen(false)} className="btn-ghost !py-1.5 !text-xs">Cancel</button>
      </div>
    </div>
  );
}
