"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MemoryItem } from "@/lib/memory/types";

export interface MemoryItemView extends MemoryItem {
  documentName?: string;
  duplicateOfTitle?: string;
  /** Current approved revision of the requirement's document type (for resolution). */
  approvedRevision?: { id: string; revLabel: string; uploadedAt: string };
}

const KIND = {
  requirement: { label: "Requirement", cls: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
  decision: { label: "Decision", cls: "bg-sky-50 text-sky-700 ring-sky-200" },
  action_item: { label: "Action item", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  question: { label: "Open question", cls: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200" },
} as const;
const STATUS = {
  suggested: "bg-orange-50 text-orange-800 ring-orange-200",
  confirmed: "bg-red-50 text-red-700 ring-red-200",
  resolved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  dismissed: "bg-slate-100 text-slate-500 ring-slate-200",
  merged: "bg-slate-100 text-slate-500 ring-slate-200",
} as const;

export default function MemoryItemCard({ siteId, item, packages, docTypes, canManage, isEngineer }: { siteId: string; item: MemoryItemView; packages: { id: string; name: string }[]; docTypes: { id: string; name: string }[]; canManage: boolean; isEngineer: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [tpl, setTpl] = useState<string[]>(item.templateIds);
  const [blocking, setBlocking] = useState(item.status === "suggested" ? item.proposedBlocking : item.blocking);
  const [rid, setRid] = useState(item.requirementId ?? "");
  const [owner, setOwner] = useState(item.responsibleParty ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function act(action: "confirm" | "dismiss" | "resolve", extra: Record<string, unknown> = {}) {
    setBusy(true); setErr("");
    const payload = action === "confirm" ? { action, note, blocking, templateIds: tpl, requirementId: rid || null, responsibleParty: owner, ...extra } : { action, note, ...extra };
    const r = await fetch(`/api/sites/${siteId}/memory/${item.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
    setBusy(false);
    if (!j.ok) return setErr(j.error);
    setNote("");
    router.refresh();
  }

  const resolveHint = item.kind === "requirement" && item.requirementId
    ? item.approvedRevision ? `Will record ${item.documentName} Rev ${item.approvedRevision.revLabel} as satisfying this requirement (checked server-side).` : `No approved ${item.documentName} yet — upload it on the site page and have an engineer approve it.`
    : "Record how this was closed.";

  return (
    <div className={`rounded-xl border p-3 text-sm ${item.status === "confirmed" && item.blocking ? "border-red-200 bg-red-50/30" : "border-slate-200 bg-white"}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`pill ${KIND[item.kind].cls}`}>{KIND[item.kind].label}</span>
        <span className={`pill ${STATUS[item.status]}`}>{item.status === "suggested" ? `${item.origin === "openai" ? "AI" : "Rules"} suggestion` : item.status}{item.status === "confirmed" && item.blocking ? " · blocking" : ""}</span>
        {item.documentName && <span className="pill bg-slate-100 text-slate-700 ring-slate-200">📄 {item.documentName}{item.requiresUpdatedRevision ? " (updated revision)" : ""}</span>}
        {item.templateIds.map((t) => <span key={t} className="pill bg-white text-slate-600 ring-slate-200">{packages.find((p) => p.id === t)?.name ?? t}</span>)}
        <span className="ml-auto font-mono text-[10px] text-slate-400">{item.id}</span>
      </div>
      <div className="mt-1.5 font-medium text-slate-900">{item.title}</div>
      {item.detail && item.detail !== item.title && <div className="text-xs text-slate-600">{item.detail}</div>}
      <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-slate-500">
        {item.responsibleParty && <span>Owner: {item.responsibleParty}</span>}
        {item.dueDate && <span>Due {item.dueDate}</span>}
        {item.decisionState && <span>Decision {item.decisionState}</span>}
        <span>Confidence {Math.round(item.confidence * 100)}%</span>
      </div>
      {item.sources.map((s) => (
        <blockquote key={s.communicationId} className="mt-2 border-l-2 border-slate-300 pl-2 text-xs">
          <span className="italic text-slate-700">“{s.evidence}”</span>
          <div className="mt-0.5 text-[11px] text-slate-500">
            {s.sender} · {new Date(s.sentAt).toLocaleString()} · <a href={`#${s.communicationId}`} className="underline">{s.communicationId}</a>{" "}
            {s.evidenceVerified ? <span className="text-emerald-600">✓ quote found in original</span> : <span className="text-orange-700">⚠ quote not found in original — verify</span>}
          </div>
        </blockquote>
      ))}
      {item.duplicateOfId && item.status === "suggested" && <div className="mt-2 rounded-md bg-amber-50 p-2 text-[11px] text-amber-900">Possible duplicate of <b>{item.duplicateOfId}</b> “{item.duplicateOfTitle}”. Confirming merges this source into it.</div>}
      {item.status === "confirmed" && <div className="mt-2 text-[11px] text-slate-500">Confirmed by {item.confirmedBy} {item.confirmedAt?.slice(0, 16).replace("T", " ")}: {item.confirmNote}</div>}
      {item.status === "resolved" && <div className="mt-2 text-[11px] text-emerald-700">Resolved by {item.resolvedBy} {item.resolvedAt?.slice(0, 16).replace("T", " ")}: {item.resolutionNote}{item.resolvedRevisionId ? ` · satisfied by ${item.resolvedRevisionId}` : ""}</div>}
      {item.status === "dismissed" && <div className="mt-2 text-[11px] text-slate-500">Dismissed by {item.dismissedBy}: {item.dismissNote}</div>}
      {item.status === "merged" && <div className="mt-2 text-[11px] text-slate-500">Merged into {item.mergedIntoId}</div>}

      {canManage && item.status === "suggested" && (
        <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-2">
          {!item.duplicateOfId && (
            <>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="text-slate-500">Applies to:</span>
                {packages.map((p) => (
                  <label key={p.id} className="flex items-center gap-1"><input type="checkbox" checked={tpl.includes(p.id)} onChange={(e) => setTpl(e.target.checked ? [...tpl, p.id] : tpl.filter((x) => x !== p.id))} />{p.name}</label>
                ))}
                <label className="flex items-center gap-1 font-medium text-red-700"><input type="checkbox" checked={blocking} onChange={(e) => setBlocking(e.target.checked)} />Blocks submission</label>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <select value={rid} onChange={(e) => setRid(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
                  <option value="">No document type</option>
                  {docTypes.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Responsible party" className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
              </div>
            </>
          )}
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (required) — why this applies / why not" className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs" />
          <div className="flex flex-wrap gap-2">
            <button disabled={busy} onClick={() => act("confirm")} className="btn-primary !py-1 !text-xs">{item.duplicateOfId ? "Merge into existing" : "Confirm"}</button>
            {item.duplicateOfId && <button disabled={busy} onClick={() => act("confirm", { asNew: true })} className="btn-ghost !py-1 !text-xs">Confirm as new item</button>}
            <button disabled={busy} onClick={() => act("dismiss")} className="btn-ghost !py-1 !text-xs">Dismiss</button>
          </div>
        </div>
      )}
      {canManage && item.status === "confirmed" && (
        <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-2">
          <div className="text-[11px] text-slate-500">{resolveHint}{item.kind === "requirement" && !isEngineer ? " Requirements are resolved by an authorized engineer." : ""}</div>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Resolution note (required)" className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs" />
          <div className="flex gap-2">
            <button disabled={busy || (item.kind === "requirement" && !isEngineer)} onClick={() => act("resolve")} className="btn-primary !py-1 !text-xs">{item.kind === "question" ? "Record answer" : item.kind === "decision" ? "Record decision" : item.kind === "action_item" ? "Mark done" : "Resolve requirement"}</button>
            <button disabled={busy} onClick={() => act("dismiss")} className="btn-ghost !py-1 !text-xs">No longer applies</button>
          </div>
        </div>
      )}
      {err && <div className="mt-2 rounded-md bg-red-50 p-2 text-xs text-red-700">{err}</div>}
    </div>
  );
}
