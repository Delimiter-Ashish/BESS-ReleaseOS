import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { ChangeTable, Hash } from "@/components/ui";
import { pinnedFromSnapshot } from "@/lib/engine-adapter";
import { compareSnapshots, frozenRevisions, releaseStatus } from "@/lib/release";
import { REQ_BY_ID } from "@/lib/requirements";
import { getRelease, getReleases, getSite, verifyRelease, studioOf } from "@/lib/store";
import type { DecisionRecord, EngineeringTask } from "@/lib/types";

export const dynamic = "force-dynamic";

const BANNER = { current: "bg-emerald-600", pending_change: "bg-amber-500", stale: "bg-red-600" } as const;
const LABEL = {
  current: "CURRENT — ready for engineer signoff",
  pending_change: "CHANGE PENDING REVIEW — this release is still valid",
  stale: "SUPERSEDED IN LIVE DATA — a newer approved revision exists; this frozen release is unchanged",
} as const;

export default function ReleasePage({ params, searchParams }: { params: { id: string; rid: string }; searchParams: { compare?: string } }) {
  const site = getSite(params.id);
  const rel = getRelease(params.rid);
  if (!site || !rel?.snapshot) notFound();
  const snap = rel.snapshot;
  const studio = studioOf(rel);
  const a = (snap.annotations ?? {}) as { templateName?: string; audience?: string; basis?: string; disclaimer?: string; signoff?: { name: string; roles: string[]; note: string; at: string }; decisions?: DecisionRecord[]; engineeringTasks?: EngineeringTask[] };
  const all = getReleases(site.id).filter((r) => r.templateId === rel.templateId).sort((x, y) => x.number - y.number);
  const other = searchParams.compare ? all.find((r) => r.id === searchParams.compare) : all.find((r) => r.number === rel.number - 1);
  const st = releaseStatus(site, rel);
  const verified = verifyRelease(rel);
  const pins = pinnedFromSnapshot(snap);
  const revs = frozenRevisions(rel);
  const cmp = other && other.id !== rel.id ? (other.number < rel.number ? compareSnapshots(other, rel) : compareSnapshots(rel, other)) : null;
  const [olderN, newerN] = other ? (other.number < rel.number ? [other.number, rel.number] : [rel.number, other.number]) : [0, 0];
  const changed = cmp?.docs.filter((d) => d.changed) ?? [];

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        <div className="text-sm text-slate-500">
          <Link href="/" className="hover:underline">Portfolio</Link> / <Link href={`/sites/${site.id}`} className="hover:underline">{site.name}</Link> / {a.templateName} R{rel.number}
        </div>

        <section className="card overflow-hidden">
          <div className={`px-5 py-2 text-sm font-semibold text-white ${BANNER[st.state]}`}>{LABEL[st.state]}</div>
          <div className="flex flex-wrap items-start justify-between gap-4 p-5">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight">{a.templateName} · <span className="font-mono">R{rel.number}</span></h1>
              <div className="text-sm text-slate-500">{snap.site.name} · AHJ {snap.site.jurisdiction} · for {a.audience}</div>
              <div className="text-sm text-slate-700">Signed off {snap.builtAt.replace("T", " ").slice(0, 16)} UTC by <b>{a.signoff?.name ?? rel.builtBy}</b>{a.signoff?.roles?.length ? ` (${a.signoff.roles.join(", ")})` : ""}</div>
              {(a.signoff?.note ?? snap.signoffNotes) && <div className="text-sm italic text-slate-600">“{a.signoff?.note ?? snap.signoffNotes}”</div>}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className={`pill ${verified ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-red-50 text-red-700 ring-red-200"}`}>{verified ? "✓ Snapshot integrity verified" : "✕ Integrity check failed"}</span>
                <span className="font-mono text-[11px] text-slate-500">snapshot sha256 {snap.sha256}</span>
              </div>
              {st.reasons.map((r) => <div key={r} className="text-xs text-slate-600">• {r}</div>)}
            </div>
            <div className="flex flex-col gap-2">
              <a href={`/api/releases/${rel.id}/download`} className="btn-primary">⬇ Download ZIP</a>
              <a href={`/api/releases/${rel.id}/download?format=json`} target="_blank" className="btn-ghost">MANIFEST.json</a>
              <a href={`/api/releases/${rel.id}/download?format=snapshot`} target="_blank" className="btn-ghost">snapshot.json</a>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-2 text-xs">
            <span className="text-slate-500">History:</span>
            {all.map((r) => <Link key={r.id} href={`/sites/${site.id}/releases/${r.id}`} className={`rounded px-2 py-0.5 font-mono ${r.id === rel.id ? "bg-slate-900 text-white" : "bg-slate-100 hover:bg-slate-200"}`}>R{r.number}</Link>)}
            {all.length > 1 && <span className="ml-3 text-slate-500">Compare with:</span>}
            {all.filter((r) => r.id !== rel.id).map((r) => <Link key={r.id} href={`/sites/${site.id}/releases/${rel.id}?compare=${r.id}`} className={`rounded px-2 py-0.5 font-mono ${other?.id === r.id ? "bg-indigo-600 text-white" : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100"}`}>R{r.number}</Link>)}
          </div>
        </section>

        {studio && (
          <section className="card space-y-3 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">Submission package (frozen)</h2>
              <span className="text-xs text-slate-500">{studio.purposeName} · recipient: <b>{studio.recipientLabel}</b> · assembled in Submission Studio</span>
            </div>
            <p className="text-xs text-slate-500">{studio.disclaimer}</p>
            <div className="grid gap-3 md:grid-cols-2">
              {studio.outputs.map((o) => (
                <div key={o.groupId} className="rounded-lg bg-slate-50 p-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2"><a href={`/api/releases/${encodeURIComponent(rel.id)}/pdf?output=${encodeURIComponent(o.groupId)}`} className="btn-primary !py-1 !text-xs">⬇ {o.fileName}</a><span>{o.pageCount} pages</span></div>
                  <div className="mt-1 font-mono text-[10px] text-slate-500">sha256 {o.sha256}</div>
                  <ol className="mt-2 space-y-0.5">{o.entries.map((e) => <li key={e.order}>{e.order}. {e.name} Rev {e.revLabel} — pp. {e.startPage}–{e.startPage + e.pageCount - 1}{e.rendering === "slip_sheet" ? " (slip sheet)" : ""}</li>)}</ol>
                  {o.warnings.map((w) => <div key={w} className="mt-1 text-amber-800">⚠ {w}</div>)}
                </div>
              ))}
            </div>
            <details className="text-xs"><summary className="cursor-pointer text-slate-600">Access decisions frozen at build time ({studio.policyDecisions.length})</summary>
              <ul className="mt-1 space-y-0.5">{studio.policyDecisions.map((d) => <li key={d.revisionId}>{d.authorized ? "✓" : "✕"} {d.requirementId} → {studio.recipientLabel} · releasable to: {d.releaseTo.join(", ") || "nobody"} · rule by {d.ruleSetBy ?? "default"}{d.ruleSetAt ? ` (${d.ruleSetAt.slice(0, 10)})` : ""}</li>)}</ul>
            </details>
          </section>
        )}

        {cmp && (
          <section className="card p-5">
            <h2 className="text-lg font-semibold">R{olderN} → R{newerN}: what changed</h2>
            <p className="text-xs text-slate-500">Computed from the two frozen snapshots only (release-core compareReleases) — live data is never consulted.</p>
            {cmp.core && <div className="mt-2 flex gap-3 text-xs"><span className="pill bg-emerald-50 text-emerald-700 ring-emerald-200">{cmp.core.added.length} added</span><span className="pill bg-red-50 text-red-700 ring-red-200">{cmp.core.removed.length} removed</span><span className="pill bg-indigo-50 text-indigo-700 ring-indigo-200">{cmp.core.updated.length} updated</span></div>}
            {changed.length === 0 ? <p className="mt-3 text-sm text-slate-500">Same pinned revisions.</p> : (
              <div className="mt-3 space-y-4">
                {changed.map((c) => (
                  <div key={c.requirementId} className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium">{c.name}: <span className="font-mono text-slate-500 line-through">Rev {c.before?.revLabel ?? "—"}</span> → <span className="font-mono font-semibold text-emerald-700">Rev {c.after?.revLabel ?? "—"}</span></div>
                      <div className="text-xs text-slate-500">approved by {c.after?.approvedBy ?? "—"}</div>
                    </div>
                    <ChangeTable changes={c.factChanges} showImpact={false} />
                    <div className="mt-1 font-mono text-[11px] text-slate-400">{c.before?.sha256.slice(0, 16)}… → {c.after?.sha256.slice(0, 16)}…</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <section className="card overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-2 text-sm font-semibold">Pinned documents ({pins.length}) — frozen at build</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-2">Document</th><th className="px-3 py-2">Rev</th><th className="px-3 py-2">File</th><th className="px-3 py-2">SHA-256</th><th className="px-3 py-2">Approved</th></tr></thead>
              <tbody>
                {pins.map((p) => {
                  const changedRow = changed.some((c) => c.requirementId === p.requirementId);
                  return (
                    <tr key={p.revisionId} className={`border-t border-slate-100 ${changedRow ? "bg-indigo-50/40" : ""}`}>
                      <td className="px-5 py-2 font-medium">{REQ_BY_ID[p.requirementId]?.name ?? p.requirementId}</td>
                      <td className="px-3 py-2 font-mono">{p.revLabel}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">{revs.find((r) => r.id === p.revisionId)?.fileId ? <Link href={`/sites/${site.id}/documents/${encodeURIComponent(p.revisionId)}`} className="text-indigo-600 hover:underline">{p.fileName}</Link> : p.fileName}</td>
                      <td className="px-3 py-2"><Hash h={p.sha256} n={16} /></td>
                      <td className="px-3 py-2 text-xs text-slate-600">{p.approvedBy} · {String(p.approvedAt ?? "").slice(0, 10)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid gap-6 md:grid-cols-2">
          <section className="card p-5">
            <h2 className="text-sm font-semibold">Approvals frozen in this release ({a.decisions?.length ?? 0})</h2>
            <ul className="mt-2 max-h-64 space-y-1.5 overflow-auto text-xs">
              {(a.decisions ?? []).slice().reverse().map((d) => <li key={d.id} className="rounded border border-slate-100 p-1.5"><b>{d.kind.replace(/_/g, " ")}</b> · {d.decision} by {d.reviewerName}{d.seeded ? " (seeded)" : ""} · {d.at.slice(0, 10)}<div className="text-slate-500">“{d.note}”</div></li>)}
            </ul>
          </section>
          <section className="card p-5">
            <h2 className="text-sm font-semibold">Dependency reviews resolved before signoff ({a.engineeringTasks?.length ?? 0})</h2>
            {(a.engineeringTasks ?? []).length === 0 ? <p className="mt-1 text-xs text-slate-500">None required.</p> : (
              <ul className="mt-2 space-y-1.5 text-xs">{a.engineeringTasks!.map((t) => <li key={t.id} className="rounded border border-slate-100 p-1.5"><b>{REQ_BY_ID[t.dependentRequirementId]?.name}</b> ← {REQ_BY_ID[t.sourceRequirementId]?.name}: {t.resolution?.replace(/_/g, " ")} by {t.resolvedBy}<div className="text-slate-500">“{t.resolutionNote}”</div></li>)}</ul>
            )}
          </section>
        </div>
        <p className="text-xs text-slate-500">{a.disclaimer} Package checklist: {a.basis}</p>
      </main>
    </>
  );
}
