"use client";
import Link from "next/link";
import { useState } from "react";
import type { ChainStep, EvidenceGraph, PreflightFinding, PreflightReport, TimeMachineReport } from "@/lib/guardian/types";

const SEV = {
  blocker: { label: "Blocks release", cls: "bg-red-50 text-red-700 ring-red-200", card: "border-red-200 bg-red-50/30" },
  warning: { label: "Review", cls: "bg-amber-50 text-amber-800 ring-amber-200", card: "border-amber-200 bg-amber-50/20" },
  info: { label: "Info", cls: "bg-slate-100 text-slate-600 ring-slate-200", card: "border-slate-200 bg-white" },
} as const;
const CLASS_LABEL = { verified_discrepancy: "Verified discrepancy", potential_inconsistency: "Potential inconsistency", explained_difference: "Explained difference", consistent: "Consistent", insufficient_evidence: "Insufficient evidence" } as const;

function Chain({ steps, onExplore }: { steps: ChainStep[]; onExplore: (id: string) => void }) {
  return (
    <ol className="flex flex-wrap items-center gap-1 text-[11px]">
      {steps.map((s, i) => (
        <li key={`${s.nodeId}-${i}`} className="flex items-center gap-1">
          {i > 0 && <span className="text-slate-400">{s.via ? `—${s.via}→` : "→"}</span>}
          {s.href ? <Link href={s.href} className="rounded bg-white px-1.5 py-0.5 text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50">{s.label}</Link> : <span className="rounded bg-white px-1.5 py-0.5 text-slate-700 ring-1 ring-slate-200">{s.label}</span>}
          <button onClick={() => onExplore(s.nodeId)} title="Show linked records" className="text-slate-400 hover:text-indigo-700">⌖</button>
        </li>
      ))}
    </ol>
  );
}

function FindingCard({ f, onExplore }: { f: PreflightFinding; onExplore: (id: string) => void }) {
  return (
    <div id={f.id} className={`rounded-xl border p-3 text-sm ${SEV[f.severity].card}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`pill ${SEV[f.severity].cls}`}>{SEV[f.severity].label}</span>
        <span className="pill bg-white text-slate-600 ring-slate-200">{f.category.replace(/_/g, " ")}</span>
        {f.consistencyClass && <span className="pill bg-white text-slate-700 ring-slate-300">{CLASS_LABEL[f.consistencyClass]}</span>}
        <span className="ml-auto font-mono text-[10px] text-slate-400">{f.id}</span>
      </div>
      <div className="mt-1.5 font-medium text-slate-900">{f.title}</div>
      {f.detail && <div className="mt-0.5 text-xs text-slate-600">{f.detail}</div>}
      {f.evidence.length > 0 && (
        <div className={`mt-2 grid gap-2 ${f.evidence.filter((e) => e.kind === "document").length === 2 ? "sm:grid-cols-2" : ""}`}>
          {f.evidence.map((e, i) => (
            <div key={i} className="rounded-lg bg-white p-2 text-xs ring-1 ring-slate-200">
              {e.quote && <div className="italic text-slate-800">“{e.quote}”</div>}
              <div className="mt-0.5 text-[11px] text-slate-500">
                {e.href ? <Link href={e.href} className="underline">{e.label}</Link> : e.label}
                {e.verified === true && <span className="ml-1 text-emerald-600">✓ verified</span>}
                {e.verified === false && e.quote && <span className="ml-1 text-slate-400">(recorded, not machine-verified)</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 grid gap-0.5 text-[11px] text-slate-600">
        {f.affectedFiles.length > 0 && <span><b>Files:</b> {f.affectedFiles.map((a, i) => <span key={a.revisionId}>{i > 0 && ", "}<Link href={a.href} className="underline">{a.fileName} (Rev {a.revLabel})</Link></span>)}</span>}
        <span><b>Responsible:</b> {f.responsibleRole ?? "not known"}</span>
        <span className="text-slate-800"><b>Next:</b> {f.nextAction}</span>
      </div>
      {f.chain.length > 0 && <div className="mt-2"><div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Evidence chain</div><Chain steps={f.chain} onExplore={onExplore} /></div>}
    </div>
  );
}

export default function Guardian({ siteId, templates, initialTemplate, releases, canRun, aiConfigured }: { siteId: string; templates: { id: string; name: string }[]; initialTemplate: string; releases: { id: string; label: string; templateId: string }[]; canRun: boolean; aiConfigured: boolean }) {
  const [tpl, setTpl] = useState(initialTemplate);
  const [ai, setAi] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [relId, setRelId] = useState(releases.find((r) => r.templateId === initialTemplate)?.id ?? releases[0]?.id ?? "");
  const [tm, setTm] = useState<TimeMachineReport | null>(null);
  const [graph, setGraph] = useState<{ focus: string; g: EvidenceGraph } | null>(null);

  async function run() {
    setBusy("preflight"); setErr("");
    const r = await fetch(`/api/sites/${siteId}/preflight`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateId: tpl, ai }) });
    const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
    setBusy("");
    if (!j.ok) return setErr(j.error);
    setReport(j.report);
  }
  async function travel() {
    setBusy("tm"); setErr("");
    const j = await (await fetch(`/api/sites/${siteId}/timemachine?releaseId=${encodeURIComponent(relId)}`)).json().catch(() => ({ ok: false, error: "request failed" }));
    setBusy("");
    if (!j.ok) return setErr(j.error);
    setTm(j.report);
  }
  async function explore(id: string) {
    const j = await (await fetch(`/api/sites/${siteId}/graph?focus=${encodeURIComponent(id)}&depth=1`)).json().catch(() => null);
    if (j?.ok) setGraph({ focus: id, g: j.graph });
  }

  if (!canRun) return <div className="card p-4 text-sm text-slate-500">Sign in as an EQORE user (PM or engineer) to run Preflight — it quotes internal communications.</div>;
  const groups = report ? (["blocker", "warning", "info"] as const).map((s) => ({ s, list: report.findings.filter((f) => f.severity === s) })) : [];
  const nodeLabel = (id: string) => graph?.g.nodes.find((n) => n.id === id);

  return (
    <div className="space-y-6">
      <section className="card space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-500">Package<br />
            <select value={tpl} onChange={(e) => { setTpl(e.target.value); setReport(null); }} className="mt-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm">{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-600" title={aiConfigured ? "Advisory OpenAI review of cross-document findings" : "OpenAI not configured on the server"}>
            <input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} disabled={!aiConfigured} />AI second opinion on discrepancies (advisory)
          </label>
          <button onClick={run} disabled={!!busy} className="btn-primary !py-1.5 !text-sm">{busy === "preflight" ? "Running…" : "Run Preflight"}</button>
          <span className="text-[11px] text-slate-400">Read-only: nothing is approved, resolved or released by running it.</span>
        </div>
        {err && <div className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{err}</div>}
        {report && (
          <div className={`rounded-lg p-3 text-sm ${report.canBuild ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}>
            <b>{report.templateName}:</b> {report.canBuild ? "no blockers — an engineer can sign off the next release." : `release blocked by ${report.counts.blocker} item(s).`}{" "}
            <span className="text-xs">{report.counts.warning} to review · {report.counts.info} informational · {report.consistency.checkedPairs} related document pairs checked ({Object.entries(report.consistency.byClass).filter(([, n]) => n).map(([k, n]) => `${n} ${CLASS_LABEL[k as keyof typeof CLASS_LABEL].toLowerCase()}`).join(", ") || "no comparable values"}) · AI: {report.consistency.ai}{report.lastRelease ? ` · last release R${report.lastRelease.number}` : ""}</span>
            {report.consistency.aiNote && <div className="mt-1 text-xs text-amber-800">{report.consistency.aiNote}</div>}
          </div>
        )}
      </section>

      {graph && (
        <section className="card space-y-2 p-4 text-xs">
          <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Linked records: {nodeLabel(graph.focus)?.label ?? graph.focus}</h2><button onClick={() => setGraph(null)} className="text-slate-400 hover:text-slate-700">close ✕</button></div>
          <ul className="space-y-1">
            {graph.g.edges.filter((e) => e.from === graph.focus || e.to === graph.focus).map((e) => {
              const other = e.from === graph.focus ? e.to : e.from;
              const n = nodeLabel(other);
              return (
                <li key={e.id} className="rounded bg-slate-50 p-1.5">
                  <span className="font-mono text-[10px] text-slate-400">{e.from === graph.focus ? `${e.type} →` : `← ${e.type}`}</span>{" "}
                  {n?.href ? <Link href={n.href} className="font-medium text-indigo-700 underline">{n.label}</Link> : <button onClick={() => explore(other)} className="font-medium text-slate-800 underline decoration-dotted">{n?.label ?? other}</button>}
                  <span className="text-slate-500"> — {e.reason}</span>{e.at && <span className="text-slate-400"> · {e.at.slice(0, 10)}</span>}
                  {e.evidence && <div className="italic text-slate-600">“{e.evidence}”</div>}
                </li>
              );
            })}
            {!graph.g.edges.length && <li className="text-slate-500">No linked records.</li>}
          </ul>
        </section>
      )}

      {groups.map(({ s, list }) => list.length > 0 && (
        <section key={s} className="space-y-2">
          <h2 className="text-sm font-semibold">{s === "blocker" ? "Why the release is blocked" : s === "warning" ? "Needs review (not blocking)" : "For information"} <span className="text-slate-400">({list.length})</span></h2>
          {list.map((f) => <FindingCard key={f.id} f={f} onExplore={explore} />)}
        </section>
      ))}

      <section className="card space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div><h2 className="text-sm font-semibold">Project Time Machine</h2><p className="text-xs text-slate-500">Compare a frozen release with today’s documents and requirements. The release itself is never modified.</p></div>
          <select value={relId} onChange={(e) => { setRelId(e.target.value); setTm(null); }} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">{releases.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
          <button onClick={travel} disabled={!relId || !!busy} className="btn-ghost !py-1.5 !text-sm">{busy === "tm" ? "Comparing…" : "Compare with today"}</button>
        </div>
        {tm && (
          <div className="space-y-3 text-xs">
            <div className={`rounded-lg p-2 ${tm.freshSubmissionRecommended ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900"}`}>
              <b>R{tm.release.number}</b> built {tm.release.builtAt.slice(0, 10)} by {tm.release.builtBy} · snapshot {tm.release.snapshotSha256.slice(0, 12)}… {tm.release.integrityVerified ? "✓ integrity verified" : "✕ INTEGRITY FAILED"}
              <ul className="mt-1 list-disc pl-4">{tm.attentionReasons.map((r) => <li key={r}>{r}</li>)}</ul>
            </div>
            {tm.replacedDocuments.length > 0 && <div><div className="font-semibold text-slate-700">Replaced or pending document versions</div>{tm.replacedDocuments.map((d) => <div key={`${d.requirementId}-${d.currentStatus}`} className="mt-1 rounded bg-slate-50 p-1.5">{d.name}: Rev {d.releasedRev} → {d.currentRevisionId ? <Link className="underline" href={`/sites/${siteId}/documents/${encodeURIComponent(d.currentRevisionId)}`}>Rev {d.currentRev}</Link> : d.currentRev} ({d.currentStatus}){d.factChanges.length > 0 && <span className="text-slate-500"> — {d.factChanges.map((c) => `${c.label}: ${c.before ?? "—"} → ${c.after ?? "—"}${c.significance === "material" ? " (material)" : ""}`).join("; ")}</span>}</div>)}</div>}
            {tm.addedChecklistDocuments.length > 0 && <div><div className="font-semibold text-slate-700">Documents required now that were not in the release</div>{tm.addedChecklistDocuments.map((d) => <div key={d.requirementId} className="mt-1">• {d.name} — {d.reason}</div>)}</div>}
            {tm.newRequirements.length > 0 && <div><div className="font-semibold text-slate-700">New requirements since the release</div>{tm.newRequirements.map((m) => <div key={m.memoryItemId} className="mt-1">• {m.title} <span className="text-slate-500">({m.status}{m.source ? `, ${m.source}` : ""})</span></div>)}</div>}
            {tm.newEngineeringTasks.length > 0 && <div><div className="font-semibold text-slate-700">Engineering reviews raised since</div>{tm.newEngineeringTasks.map((t) => <div key={t.id} className="mt-1">• {t.id} ({t.kind}, {t.status}) — {t.explanation.slice(0, 180)}</div>)}</div>}
            {tm.resolvedSinceRelease.length > 0 && <div><div className="font-semibold text-slate-700">Resolved since</div>{tm.resolvedSinceRelease.map((x) => <div key={x.id} className="mt-1">• {x.kind}: {x.label} <span className="text-slate-500">— {x.resolvedBy} {x.resolvedAt?.slice(0, 10)}</span></div>)}</div>}
            <div><div className="font-semibold text-slate-700">Current blockers ({tm.currentBlockers.length})</div>{tm.currentBlockers.length ? tm.currentBlockers.map((b, i) => <div key={i} className="mt-1">• <span className="font-mono text-[10px]">{b.code}</span> {b.message}</div>) : <div className="mt-1 text-emerald-700">None.</div>}</div>
          </div>
        )}
      </section>
    </div>
  );
}
