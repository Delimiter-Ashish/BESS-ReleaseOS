"use client";
// Multi-item engineer review queue. Each decision targets exactly one review/task id through the existing
// authorized endpoints (/api/reviews/:id, /api/sites/:id/tasks/:taskId). Nothing is approved in bulk.
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { EvidenceButton } from "@/components/evidence/EvidenceProvider";
import { ago, fmtDate } from "@/components/kit";
import { ChangeTable, EngineBadge } from "@/components/ui";
import type { ReviewItem } from "@/lib/workspace";

const PdfViewer = dynamic(() => import("@/components/evidence/PdfViewer"), { ssr: false });

type StatusFilter = "open" | "closed" | "all";

export default function ReviewInbox({ items, canReview, userName, initialItem, initialProject, initialStatus, initialKind, projects }: {
  items: ReviewItem[]; canReview: boolean; userName: string; initialItem?: string; initialProject?: string; initialStatus?: StatusFilter; initialKind?: "revision" | "dependency"; projects: { id: string; name: string }[];
}) {
  const [q, setQ] = useState("");
  const [project, setProject] = useState(initialProject ?? "");
  const [kind, setKind] = useState<"" | "revision" | "dependency">(initialKind ?? "");
  const [priority, setPriority] = useState<"" | "high" | "normal">("");
  const initialSel = items.find((i) => i.id === initialItem);
  const [status, setStatus] = useState<StatusFilter>(initialStatus ?? (initialSel && !initialSel.open ? "all" : "open"));
  const [selected, setSelected] = useState<string | undefined>(initialItem);

  const rows = useMemo(() => items.filter((i) =>
    (!project || i.projectId === project) && (!kind || i.kind === kind) && (!priority || i.priority === priority) &&
    (status === "all" || (status === "open" ? i.open : !i.open)) &&
    (!q || `${i.projectName} ${i.docName} ${i.fileName ?? ""} ${i.reason} ${i.revLabel}`.toLowerCase().includes(q.toLowerCase()))), [items, project, kind, priority, status, q]);
  const sel = items.find((i) => i.id === selected);

  useEffect(() => {
    const u = new URL(window.location.href);
    if (selected) u.searchParams.set("item", selected); else u.searchParams.delete("item");
    window.history.replaceState(null, "", u.toString());
  }, [selected]);

  // Keyboard: ↑/↓ move through the visible queue.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const i = rows.findIndex((r) => r.id === selected);
      const next = rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) { e.preventDefault(); setSelected(next.id); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, selected]);

  const openCount = items.filter((i) => i.open).length;
  return (
    <div className={`grid grid-cols-1 gap-4 ${sel ? "xl:grid-cols-[minmax(0,1fr)_minmax(420px,44%)]" : ""}`}>
      <div className="card min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents, projects, reasons…" className="min-w-[200px] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
          <select value={project} onChange={(e) => setProject(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"><option value="">All review types</option><option value="revision">Revision approval</option><option value="dependency">Dependency review</option></select>
          <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"><option value="">Any priority</option><option value="high">High</option><option value="normal">Normal</option></select>
          <div className="flex overflow-hidden rounded-lg border border-slate-300 text-xs">
            {(["open", "closed", "all"] as const).map((s) => <button key={s} onClick={() => setStatus(s)} className={`px-2.5 py-1.5 ${status === s ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>{s === "open" ? `Pending (${openCount})` : s === "closed" ? "Decided" : "All"}</button>)}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr><th className="px-3 py-2">Project</th><th className="px-3 py-2">Document</th><th className="px-3 py-2">Rev</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Reason for review</th><th className="px-3 py-2">Priority</th><th className="px-3 py-2">Received</th><th className="px-3 py-2">Reviewer</th><th className="px-3 py-2">Status</th></tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} onClick={() => setSelected(i.id)} className={`cursor-pointer border-t border-slate-100 align-top hover:bg-slate-50 ${selected === i.id ? "bg-indigo-50/70 hover:bg-indigo-50" : ""}`} aria-selected={selected === i.id}>
                  <td className="px-3 py-2 text-xs text-slate-600">{i.projectName}</td>
                  <td className="px-3 py-2"><div className="font-medium">{i.docName}</div><div className="max-w-[220px] truncate text-[11px] text-slate-400">{i.fileName}</div></td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">{i.kind === "dependency" ? `Rev ${i.revLabel}` : i.prevLabel ? `${i.prevLabel} → ${i.revLabel}` : i.revLabel}</td>
                  <td className="px-3 py-2 text-xs">{i.kind === "dependency" ? <span className="pill bg-orange-50 text-orange-800 ring-orange-200">{i.docType === "Cross-document conflict" ? "Conflict" : "Dependency"}</span> : <span className="pill bg-slate-100 text-slate-700 ring-slate-200">Revision</span>}</td>
                  <td className="px-3 py-2 text-xs text-slate-600"><div className="max-w-[260px]">{i.reason}</div></td>
                  <td className="px-3 py-2">{i.priority === "high" ? <span className="pill bg-red-50 text-red-700 ring-red-200">High</span> : <span className="text-xs text-slate-500">Normal</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500">{ago(i.uploadedAt)}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{i.reviewer}</td>
                  <td className="px-3 py-2"><StatusPill i={i} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <div className="p-8 text-center text-sm text-slate-500">{status === "open" ? "No pending reviews match these filters." : "No reviews match these filters."}</div>}
        </div>
        <div className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-400">{rows.length} shown · click a row (or use ↑ ↓) to inspect · decisions apply to the selected item only</div>
      </div>
      {sel && <Panel key={sel.id} i={sel} canReview={canReview} userName={userName} onClose={() => setSelected(undefined)} />}
    </div>
  );
}

function StatusPill({ i }: { i: ReviewItem }) {
  if (i.open) return i.kind === "dependency" && !i.sourceApproved ? <span className="pill bg-sky-50 text-sky-700 ring-sky-200">Waiting on source</span> : <span className="pill bg-violet-50 text-violet-700 ring-violet-200">Pending</span>;
  const cls = i.status === "approved" || i.status === "resolved" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200";
  return <span className={`pill ${cls}`}>{i.status}</span>;
}

function Panel({ i, canReview, userName, onClose }: { i: ReviewItem; canReview: boolean; userName: string; onClose: () => void }) {
  const router = useRouter();
  const [tab, setTab] = useState<"details" | "evidence" | "compare">(i.evidenceNew?.fileId ? "evidence" : "details");
  const [note, setNote] = useState("");
  const [resolve, setResolve] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");

  async function post(url: string, body: unknown, label: string) {
    setBusy(label); setErr(""); setDone("");
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!j.ok) { setErr(j.error ?? `Failed (${r.status})`); return; }
      setDone(label === "approve" ? "Approved and recorded." : label === "reject" ? "Rejected and recorded." : "Dependency review resolved and recorded.");
      setNote("");
      router.refresh();
    } catch { setErr("Network error"); } finally { setBusy(""); }
  }
  const noteOk = note.trim().length >= 3;

  return (
    <aside className="card flex min-h-[70vh] min-w-0 flex-col overflow-hidden xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)]">
      <header className="flex items-start justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{i.projectName} · {i.kind === "dependency" ? "Dependency review" : "Revision approval"}</div>
          <div className="text-base font-semibold">{i.docName} {i.kind === "dependency" ? `Rev ${i.revLabel}` : `Rev ${i.revLabel}`}{i.prevLabel ? <span className="font-normal text-slate-500"> · replaces approved Rev {i.prevLabel}</span> : null}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500"><StatusPill i={i} /><span>{i.provenance}</span>{i.engine && i.kind === "revision" && <EngineBadge engine={i.engine} model={i.model} />}</div>
        </div>
        <div className="flex items-center gap-1">
          {i.revisionId && <Link href={`/sites/${i.projectId}/documents/${encodeURIComponent(i.kind === "dependency" ? i.revisionId : i.revisionId)}`} className="btn-ghost !px-2 !py-1 !text-xs" title="Full document page">↗</Link>}
          <button onClick={onClose} className="btn-ghost !px-2 !py-1" aria-label="Close panel">✕</button>
        </div>
      </header>
      <div className="flex gap-1 border-b border-slate-200 px-3 py-2 text-xs">
        {(["evidence", "compare", "details"] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={`rounded-md px-2.5 py-1 font-medium ${tab === t ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{t === "evidence" ? "Evidence" : t === "compare" ? (i.kind === "dependency" ? "Source change" : "Compare revisions") : "Impact & details"}</button>)}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "evidence" && <EvidenceTab i={i} />}
        {tab === "compare" && (
          <div className="space-y-3 p-4">
            {i.kind === "revision" ? (i.prevLabel ? <ChangeTable changes={i.changes} /> : <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">First revision of this document — there is no approved baseline to compare against.</div>)
              : <div className="space-y-2 text-sm"><p className="text-slate-700">{i.explanation}</p><div className="flex flex-wrap gap-1">{i.changedKeys?.map((k) => <span key={k} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">{k}</span>)}</div></div>}
            <div className="flex flex-wrap gap-2">
              {i.evidenceNew && <EvidenceButton refs={[i.evidenceNew, ...(i.evidencePrev ? [i.evidencePrev] : [])]} label={i.kind === "dependency" ? "Open changed source" : `Open Rev ${i.revLabel}`} />}
              {i.evidencePrev && <EvidenceButton refs={[i.evidenceNew!, i.evidencePrev]} index={1} label={i.kind === "dependency" ? `Open ${i.dependentName} Rev ${i.revLabel}` : `Open Rev ${i.prevLabel}`} />}
            </div>
          </div>
        )}
        {tab === "details" && (
          <div className="space-y-3 p-4 text-sm">
            <div className="text-xs text-slate-500">Received {fmtDate(i.uploadedAt)} · {i.fileName ?? "—"}</div>
            {i.aiSummary && <div className={`rounded-lg p-2.5 text-xs ${i.aiSummarySource === "openai" ? "bg-indigo-50 text-indigo-900" : "bg-slate-50 text-slate-700"}`}><b>{i.aiSummarySource === "openai" ? "AI summary (advisory)" : "Change summary"}:</b> {i.aiSummary}</div>}
            {i.aiImpact && <div className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900"><b>Possible consequences (advisory):</b> {i.aiImpact}</div>}
            {(i.raisedTasks.length > 0 || i.missingDependents.length > 0 || i.affectedReleases.length > 0) ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <div className="mb-1 font-semibold">Engineering impact (deterministic dependency graph)</div>
                {i.raisedTasks.map((t) => <div key={t.id}>• Dependency review: <b>{t.dependent}</b> <span className="text-amber-700">({t.status})</span></div>)}
                {i.missingDependents.map((d) => <div key={d}>• Potentially affected, not on file yet: {d}</div>)}
                {i.affectedReleases.map((a) => <div key={a}>• {a}: approving makes this package <b>stale</b> (it stays immutable and downloadable)</div>)}
              </div>
            ) : i.kind === "revision" && <div className="text-xs text-slate-500">No dependent documents or released packages are affected.</div>}
            {i.warnings.length > 0 && <div className="rounded-lg bg-red-50 p-2 text-xs text-red-800">{i.warnings.map((w, k) => <div key={k}>⚠ {w}</div>)}</div>}
            {!i.open && <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700"><b>Decision:</b> {i.status} by {i.decidedBy ?? "—"} · {fmtDate(i.decidedAt)}{i.decisionNote ? <div className="mt-1 italic">“{i.decisionNote}”</div> : null}</div>}
          </div>
        )}
      </div>

      {i.open && (
        <footer className="space-y-2 border-t border-slate-200 bg-slate-50 p-3">
          {!canReview ? (
            <div className="text-xs text-slate-600">Approval requires an authorized engineer (switch identity in the sidebar, e.g. M. Chen, PE). Signed in as {userName}. AI never approves documents.</div>
          ) : i.kind === "dependency" && !i.sourceApproved ? (
            <div className="text-xs text-sky-800">Waiting for the changed source revision to be approved — a dependency review cannot be resolved before that.</div>
          ) : i.selfUpload ? (
            <div className="text-xs text-orange-700">You uploaded this revision — a different engineer must decide it (self-approval is blocked by the server).</div>
          ) : (
            <>
              {i.resolvable.length > 0 && (
                <div className="rounded-lg border border-indigo-200 bg-white p-2 text-xs text-indigo-900">
                  <div className="font-semibold">Also resolve dependency reviews that this revision answers</div>
                  {i.resolvable.map((t) => <label key={t.id} className={`mt-1 flex items-center gap-2 ${t.sourceApproved ? "" : "opacity-50"}`}><input type="checkbox" disabled={!t.sourceApproved} checked={resolve.includes(t.id)} onChange={(e) => setResolve(e.target.checked ? [...resolve, t.id] : resolve.filter((x) => x !== t.id))} />{t.source} change{t.sourceApproved ? "" : " (approve the source first)"}</label>)}
                </div>
              )}
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={i.kind === "dependency" ? "Engineering justification (required) — e.g. ESS-13.0 conductors and OCPD rated for 600 A; plan set remains valid" : "Review note (required) — e.g. verified 600 A rating against supplier submittal"} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <div className="flex flex-wrap gap-2">
                {i.kind === "revision" ? (
                  <>
                    <button disabled={!!busy || !noteOk} onClick={() => post(`/api/reviews/${encodeURIComponent(i.id)}`, { decision: "approve", note, resolveTaskIds: resolve }, "approve")} className="btn bg-emerald-600 text-white hover:bg-emerald-700">{busy === "approve" ? "Approving…" : `Approve Rev ${i.revLabel}`}</button>
                    <button disabled={!!busy || !noteOk} onClick={() => post(`/api/reviews/${encodeURIComponent(i.id)}`, { decision: "reject", note }, "reject")} className="btn-ghost">{busy === "reject" ? "Rejecting…" : "Reject"}</button>
                  </>
                ) : (
                  <button disabled={!!busy || !noteOk} onClick={() => post(`/api/sites/${i.projectId}/tasks/${encodeURIComponent(i.id)}`, { note }, "resolve")} className="btn-primary">{busy === "resolve" ? "Recording…" : `Confirm ${i.dependentName} still valid`}</button>
                )}
                <span className="self-center text-[11px] text-slate-500">Deciding as {userName} · only this item is affected</span>
              </div>
            </>
          )}
          {err && <div className="rounded bg-red-50 p-2 text-xs text-red-700">{err}</div>}
        </footer>
      )}
      {done && <div className="border-t border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{done} Queues, readiness and dashboards have been refreshed.</div>}
    </aside>
  );
}

function EvidenceTab({ i }: { i: ReviewItem }) {
  const [which, setWhich] = useState<"new" | "prev">("new");
  const ev = which === "new" ? i.evidenceNew : i.evidencePrev;
  return (
    <div className="flex h-full min-h-[480px] flex-col">
      {(i.evidencePrev || i.evidenceNew) && (
        <div className="flex flex-wrap items-center gap-1 px-3 pt-2 text-xs">
          {i.evidenceNew && <button onClick={() => setWhich("new")} className={`rounded-md px-2 py-1 ${which === "new" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700"}`}>{i.kind === "dependency" ? `Changed source · Rev ${i.evidenceNew.revLabel}` : `New · Rev ${i.revLabel}`}</button>}
          {i.evidencePrev && <button onClick={() => setWhich("prev")} className={`rounded-md px-2 py-1 ${which === "prev" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700"}`}>{i.kind === "dependency" ? `${i.dependentName} · Rev ${i.revLabel}` : `Approved · Rev ${i.prevLabel}`}</button>}
          {ev && <EvidenceButton refs={[i.evidenceNew, i.evidencePrev].filter((x): x is NonNullable<typeof x> => !!x)} index={which === "new" ? 0 : 1} label="Open in drawer" className="ml-auto" />}
        </div>
      )}
      {ev ? (
        <>
          {(ev.quote || ev.factLabel) && <div className="mx-3 mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs"><b>{ev.factLabel}{ev.factValue ? `: ${ev.factValue}` : ""}</b>{ev.page ? ` · p.${ev.page}` : ""}{ev.quote && <div className="italic">“{ev.quote}”</div>}</div>}
          <div className="text-[10px] text-slate-400 px-3 pt-1">{ev.fileName} · {ev.provenance}</div>
          <div className="mt-2 min-h-[420px] flex-1 border-t border-slate-200">
            {ev.fileId && (!ev.mediaType || ev.mediaType === "application/pdf") ? <PdfViewer key={ev.key} fileId={ev.fileId} page={ev.page} quote={ev.quote} />
              : <div className="space-y-2 p-4 text-sm text-slate-600"><div className="rounded-lg bg-slate-50 p-3 text-xs">{ev.note ?? (ev.fileId ? "This file type opens in the evidence drawer." : "No original file on record.")}</div>{ev.facts?.map((f, k) => <div key={k} className="rounded border border-slate-200 p-2 text-xs"><span className="text-slate-500">{f.label}:</span> <b>{f.value}</b>{f.evidence ? <span className="italic text-slate-500"> — “{f.evidence}”</span> : null}</div>)}</div>}
          </div>
        </>
      ) : <div className="p-4 text-sm text-slate-500">No evidence attached.</div>}
    </div>
  );
}
