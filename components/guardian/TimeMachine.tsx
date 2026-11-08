"use client";
// Project Time Machine over GET /api/sites/:id/timemachine?releaseId= (frozen snapshot vs current candidate state).
// Every row and timestamp comes from the backend report; nothing is inferred or invented here.
import Link from "next/link";
import { useEffect, useState } from "react";
import { EvidenceButton } from "@/components/evidence/EvidenceProvider";
import { fetchTimeMachine, type ApiResult } from "@/lib/api/client";
import type { TimeMachineReport } from "@/lib/guardian/types";
import type { RevisionEvidence } from "./evidence";

export interface ReleaseOption { id: string; number: number; builtAt: string; builtBy: string; templateId: string; templateLabel: string; items: { requirementId: string; name: string; revLabel: string; fileName: string; revisionId: string }[] }

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");

export default function TimeMachine({ site, releases, byRev, initialRelease }: { site: { id: string; name: string }; releases: ReleaseOption[]; byRev: RevisionEvidence; initialRelease?: string }) {
  const [rid, setRid] = useState(initialRelease && releases.some((r) => r.id === initialRelease) ? initialRelease : releases[0]?.id);
  const [res, setRes] = useState<ApiResult<TimeMachineReport>>();
  useEffect(() => { if (!rid) return; let live = true; setRes(undefined); fetchTimeMachine(site.id, rid).then((r) => live && setRes(r)); return () => { live = false; }; }, [site.id, rid]);

  if (!releases.length) return <div className="card p-6 text-sm text-slate-600"><div className="font-semibold text-slate-900">No sealed release yet for {site.name}</div>The Time Machine compares a frozen release snapshot with today&apos;s project state. Build a first release in Submission Studio to start the history.</div>;
  const rel = releases.find((r) => r.id === rid)!;
  const rep = res?.state === "ok" ? res.data : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500">Compare</span>
        <div className="flex flex-wrap gap-1">
          {releases.map((r) => <button key={r.id} type="button" onClick={() => setRid(r.id)} className={`rounded-full px-3 py-1 text-xs ring-1 ring-inset ${r.id === rid ? "bg-cyan-50 text-cyan-700 ring-cyan-300" : "text-slate-600 ring-slate-300 hover:bg-slate-100"}`}>{r.templateLabel} R{r.number}</button>)}
        </div>
        <span className="text-xs text-slate-500">with</span>
        <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white">Current state</span>
      </div>

      {!res ? <div className="card grid h-48 place-items-center text-sm text-slate-500">Reading the frozen snapshot and current state…</div>
        : res.state !== "ok" ? <div className="card p-4 text-sm text-red-700">Time Machine unavailable: {res.error}</div>
        : rep && (
        <>
          <div className={`rounded-2xl p-4 text-sm ring-1 ring-inset ${rep.freshSubmissionRecommended ? "bg-amber-50 text-amber-900 ring-amber-300" : "bg-emerald-50 text-emerald-900 ring-emerald-300"}`}>
            <b>{rep.freshSubmissionRecommended ? `A fresh submission is recommended — R${rep.release.number} no longer reflects the project.` : `R${rep.release.number} still reflects the current approved state.`}</b>
            <ul className="mt-1 space-y-0.5 text-xs">{rep.attentionReasons.map((r) => <li key={r}>• {r}</li>)}</ul>
          </div>

          <ol className="relative grid gap-4 lg:grid-cols-4">
            <span aria-hidden className="absolute left-0 right-0 top-[22px] hidden h-px bg-gradient-to-r from-cyan-400 via-amber-400 to-teal-400 opacity-40 lg:block" />
            <Step n={1} title="Previously approved" tone="#22d3ee" at={rep.release.builtAt}>
              <div className="text-sm font-semibold text-slate-900">{rel.templateLabel} R{rep.release.number}</div>
              <div className="text-[11px] text-slate-500">Sealed by {rep.release.builtBy}</div>
              <div className={`mt-1 text-[11px] ${rep.release.integrityVerified ? "text-emerald-700" : "text-red-700"}`}>{rep.release.integrityVerified ? "✓ Snapshot integrity re-verified" : "✕ Snapshot failed verification"} · <span className="font-mono">{rep.release.snapshotSha256.slice(0, 12)}…</span></div>
              <ul className="mt-2 space-y-1">{rel.items.map((i) => <li key={i.revisionId} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-1 text-[11px]"><span className="truncate">{i.name}</span><span className="shrink-0 font-mono text-slate-500">Rev {i.revLabel}</span></li>)}</ul>
              <Link href={`/sites/${site.id}/releases/${rep.release.id}`} className="mt-2 inline-block text-[11px] text-cyan-600 hover:underline">Open frozen release ↗</Link>
            </Step>

            <Step n={2} title="New information arrived" tone="#a78bfa">
              {rep.replacedDocuments.length + rep.newRequirements.length + rep.addedChecklistDocuments.length === 0 && <Empty>No new revisions or requirements since R{rep.release.number}.</Empty>}
              {rep.replacedDocuments.map((d) => (
                <Card key={d.requirementId + d.currentStatus} tone={d.currentStatus === "approved" ? "amber" : "violet"}>
                  <div className="font-medium">{d.name}</div>
                  <div className="text-[11px] text-slate-500">R{rep.release.number} pinned Rev {d.releasedRev} → Rev {d.currentRev} {d.currentStatus === "approved" ? "now approved" : "pending review"}</div>
                  {d.factChanges.filter((c) => c.significance === "material").map((c) => <div key={c.label} className="mt-0.5 text-[11px] text-red-700">{c.label}: {c.before ?? "—"} → {c.after ?? "—"}</div>)}
                  {d.currentRevisionId && byRev[d.currentRevisionId] && <div className="mt-1"><EvidenceButton refs={byRev[d.currentRevisionId]} label={`Rev ${d.currentRev}`} /></div>}
                </Card>
              ))}
              {rep.newRequirements.map((m) => <Card key={m.memoryItemId} tone={m.status.startsWith("suggested") ? "cyan" : "amber"}><div className="font-medium">{m.title}</div><div className="text-[11px] text-slate-500">{m.status}{m.source ? ` · ${m.source}` : ""}{m.confirmedAt ? ` · confirmed ${when(m.confirmedAt)}` : ""}</div></Card>)}
              {rep.addedChecklistDocuments.map((d) => <Card key={d.requirementId} tone="amber"><div className="font-medium">{d.name} added to the checklist</div><div className="text-[11px] text-slate-500">{d.reason}</div></Card>)}
            </Step>

            <Step n={3} title="Guardian findings" tone="#fbbf24">
              {rep.newEngineeringTasks.length === 0 && rep.currentBlockers.length === 0 && <Empty>No new review tasks and no current blockers.</Empty>}
              {rep.newEngineeringTasks.map((t) => <Card key={t.id} tone={t.status === "open" ? "amber" : "slate"}><div className="font-medium">{t.kind === "consistency" ? "Cross-document review" : "Dependency review"} · {t.status}</div><div className="text-[11px] text-slate-500">{t.explanation}</div><div className="text-[10px] text-slate-400">raised {when(t.createdAt)}</div></Card>)}
              {rep.currentBlockers.length > 0 && <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Current blockers ({rep.currentBlockers.length})</div>}
              {rep.currentBlockers.map((b, i) => <div key={i} className="rounded-md bg-red-50 px-2 py-1 text-[11px] text-red-800"><span className="font-mono text-[10px] opacity-70">{b.code}</span> {b.message}</div>)}
            </Step>

            <Step n={4} title="Current state" tone="#2dd4bf" at={rep.comparedAt}>
              {rep.resolvedSinceRelease.length === 0 ? <Empty>Nothing resolved since R{rep.release.number}.</Empty> : rep.resolvedSinceRelease.map((r) => <Card key={r.id} tone="green"><div className="font-medium">{r.label}</div><div className="text-[11px] text-slate-500">{r.kind} · {r.resolvedBy ?? "—"} · {when(r.resolvedAt)}</div></Card>)}
              <div className={`mt-2 rounded-lg p-2 text-xs ${rep.currentBlockers.length ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{rep.currentBlockers.length ? `${rep.currentBlockers.length} blocker(s) before R${rep.release.number + 1}` : `Gate clear — R${rep.release.number + 1} can be signed off`}</div>
            </Step>
          </ol>
        </>
      )}
    </div>
  );
}

function Step({ n, title, tone, at, children }: { n: number; title: string; tone: string; at?: string; children: React.ReactNode }) {
  return (
    <li className="relative min-w-0">
      <div className="mb-2 flex items-center gap-2">
        <span className="relative z-10 grid h-11 w-11 place-items-center rounded-full bg-night-900 text-sm font-bold ring-2" style={{ color: tone, boxShadow: `0 0 0 2px ${tone}55`, borderColor: tone }}>{n}</span>
        <div><div className="text-sm font-semibold text-slate-900">{title}</div>{at && <div className="text-[10px] text-slate-500">{when(at)}</div>}</div>
      </div>
      <div className="card space-y-2 p-3">{children}</div>
    </li>
  );
}
const TONES = { amber: "border-l-amber-400", violet: "border-l-violet-400", cyan: "border-l-cyan-400", green: "border-l-emerald-400", slate: "border-l-slate-400" } as const;
const Card = ({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) => <div className={`rounded-md border border-slate-200 border-l-2 ${TONES[tone]} bg-slate-50 px-2 py-1.5 text-xs`}>{children}</div>;
const Empty = ({ children }: { children: React.ReactNode }) => <div className="text-[11px] text-slate-400">{children}</div>;
