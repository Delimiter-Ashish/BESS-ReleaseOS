"use client";
// Guardian Scan — a REAL execution of POST /api/sites/:id/preflight (Ashish's Project Guardian).
// The backend returns one report (no progress events), so while the request is in flight we show an honest
// indeterminate indicator and the real elapsed time. Check rows get their results only from the returned report.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runPreflight, type ApiResult } from "@/lib/api/client";
import type { PreflightFinding, PreflightReport } from "@/lib/guardian/types";
import type { RevisionEvidence } from "./evidence";
import FindingCard from "./FindingCard";

export interface ScanDoc { requirementId: string; name: string; state: string; revLabel?: string; fileName?: string; revisionId?: string; pendingLabel?: string }

const CHECKS: { id: string; label: string; cats: PreflightFinding["category"][] }[] = [
  { id: "records", label: "Checking project records", cats: [] },
  { id: "requirements", label: "Matching requirements", cats: ["requirement", "action", "question", "decision"] },
  { id: "revisions", label: "Verifying revisions", cats: ["missing_document", "outdated_revision", "pending_review", "change_since_release"] },
  { id: "conflicts", label: "Examining engineering conflicts", cats: ["dependency", "consistency"] },
  { id: "readiness", label: "Evaluating submission readiness", cats: [] },
];

const STATE_TONE: Record<string, string> = { ready: "ring-teal-300", missing: "ring-red-300", in_review: "ring-violet-300", pending_change: "ring-violet-300", needs_eng_review: "ring-amber-300" };
const STATE_TEXT: Record<string, string> = { ready: "Approved", missing: "Missing", in_review: "Awaiting first approval", pending_change: "New revision pending", needs_eng_review: "Engineer review open" };

export default function GuardianScan({ site, templateId, templateLabel, docs, byRev, autoRun, canRun, runLabel = "Run Guardian Scan", onReport, onShowInGraph, compact }: {
  site: { id: string; name: string }; templateId: string; templateLabel: string; docs: ScanDoc[]; byRev: RevisionEvidence; autoRun?: boolean; canRun: boolean;
  runLabel?: string; onReport?: (r: PreflightReport) => void; onShowInGraph?: (nodeId: string) => void; compact?: boolean;
}) {
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [result, setResult] = useState<ApiResult<PreflightReport>>();
  const [elapsed, setElapsed] = useState(0);
  const [docFilter, setDocFilter] = useState<string>();
  const [sevFilter, setSevFilter] = useState<"all" | "blocker" | "warning" | "info">("all");
  const t0 = useRef(0);
  const ran = useRef(false);

  const run = useCallback(async (withAi = false) => {
    setPhase("running"); setResult(undefined); setDocFilter(undefined);
    t0.current = performance.now(); setElapsed(0);
    const tick = setInterval(() => setElapsed(Math.round(performance.now() - t0.current)), 50);
    const r = await runPreflight(site.id, templateId, withAi);
    clearInterval(tick);
    setElapsed(r.ms);
    setResult(r); setPhase("done");
    if (r.state === "ok") onReport?.(r.data);
  }, [site.id, templateId, onReport]);

  useEffect(() => { if (autoRun && canRun && !ran.current) { ran.current = true; void run(); } }, [autoRun, canRun, run]);
  useEffect(() => { setPhase("idle"); setResult(undefined); ran.current = false; }, [site.id, templateId]);

  const report = result?.state === "ok" ? result.data : undefined;
  const affected = useMemo(() => {
    const m = new Map<string, { blocker: number; other: number }>();
    for (const f of report?.findings ?? []) for (const a of f.affectedFiles) {
      const e = m.get(a.requirementId) ?? { blocker: 0, other: 0 };
      if (f.severity === "blocker") e.blocker++; else e.other++;
      m.set(a.requirementId, e);
    }
    // Findings that name a document without a file (e.g. missing documents) are matched by checklist document name.
    for (const f of report?.findings ?? []) if (!f.affectedFiles.length) for (const d of docs) if (f.title.startsWith(`${d.name}:`)) {
      const e = m.get(d.requirementId) ?? { blocker: 0, other: 0 };
      if (f.severity === "blocker") e.blocker++; else e.other++;
      m.set(d.requirementId, e);
    }
    return m;
  }, [report, docs]);

  const matchesDoc = (f: PreflightFinding) => !docFilter || f.affectedFiles.some((a) => a.requirementId === docFilter) || f.title.startsWith(`${docs.find((d) => d.requirementId === docFilter)?.name}:`);
  const shown = (report?.findings ?? []).filter((f) => matchesDoc(f) && (sevFilter === "all" || f.severity === sevFilter));
  const checkResult = (c: (typeof CHECKS)[number]) => {
    if (!report) return undefined;
    if (c.id === "records") return { text: `${docs.length} checklist document${docs.length === 1 ? "" : "s"} · ${new Set(report.findings.flatMap((f) => f.affectedFiles.map((a) => a.revisionId))).size} revision(s) referenced`, bad: false };
    if (c.id === "readiness") return { text: report.canBuild ? "Gate clear — ready for authorized signoff" : `${report.counts.blocker} blocker${report.counts.blocker === 1 ? "" : "s"} — signoff not possible`, bad: !report.canBuild };
    const fs = report.findings.filter((f) => c.cats.includes(f.category));
    const b = fs.filter((f) => f.blocking).length;
    const extra = c.id === "conflicts" ? ` · ${report.consistency.checkedPairs} document pair(s) compared` : "";
    return { text: fs.length ? `${b} blocking · ${fs.length - b} advisory${extra}` : `Nothing found${extra}`, bad: b > 0 };
  };

  return (
    <div className="space-y-4">
      <div className={`relative overflow-hidden rounded-2xl border border-[rgba(34,211,238,0.18)] bg-night-950 ${compact ? "p-4" : "p-5"}`}>
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(500px_220px_at_80%_0%,rgba(34,211,238,0.12),transparent_70%)]" />
        <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {/* Layered document cards — the package's real checklist documents */}
          <div>
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#67e8f9]">{templateLabel}</div>
              <div className="text-[11px] text-ink-muted">{site.name}</div>
            </div>
            <div className="relative mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {docs.map((d, i) => {
                const a = affected.get(d.requirementId);
                const flagged = a && a.blocker > 0;
                return (
                  <button key={d.requirementId} type="button" onClick={() => setDocFilter(docFilter === d.requirementId ? undefined : d.requirementId)} disabled={!report}
                    style={{ transitionDelay: `${i * 30}ms` }}
                    className={`group relative overflow-hidden rounded-xl bg-[rgba(255,255,255,0.035)] p-2.5 text-left ring-1 ring-inset transition duration-300 ${phase === "running" ? "translate-y-[-2px] ring-[rgba(34,211,238,0.35)]" : flagged ? "ring-[rgba(248,113,113,0.6)] shadow-glow-red" : a ? "ring-[rgba(251,191,36,0.5)]" : report ? "ring-[rgba(45,212,191,0.35)]" : "ring-[rgba(148,163,184,0.15)]"} ${docFilter === d.requirementId ? "outline outline-2 outline-[#22d3ee]" : ""}`}>
                    {phase === "running" && <span aria-hidden className="ros-sweep pointer-events-none absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-transparent via-[rgba(34,211,238,0.18)] to-transparent" style={{ animationDelay: `${(i % 6) * 120}ms` }} />}
                    <div className="flex items-start justify-between gap-1">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="mt-0.5 shrink-0 text-ink-muted"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>
                      {a && <span className={`rounded-full px-1.5 text-[10px] font-semibold ${flagged ? "bg-[#f87171] text-night-950" : "bg-[#fbbf24] text-night-950"}`}>{a.blocker + a.other}</span>}
                    </div>
                    <div className="mt-1 line-clamp-2 text-[11px] font-medium leading-tight text-ink">{d.name}</div>
                    <div className="mt-0.5 truncate text-[10px] text-ink-muted">{d.revLabel ? `Rev ${d.revLabel}` : "—"}{d.pendingLabel ? ` · Rev ${d.pendingLabel} pending` : ""}</div>
                    <div className={`mt-1 inline-block rounded px-1 text-[9px] uppercase tracking-wide ring-1 ring-inset ${STATE_TONE[d.state] ?? "ring-slate-300"} text-ink-soft`}>{STATE_TEXT[d.state] ?? d.state}</div>
                  </button>
                );
              })}
            </div>
            {report && <div className="mt-2 text-[11px] text-ink-muted">Click a document to filter findings. Red = blocking finding, amber = advisory.</div>}
          </div>

          {/* Checks — results only from the returned report */}
          <div className="flex flex-col">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={!canRun || phase === "running"} onClick={() => run(false)} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-[#67e8f9] to-[#2dd4bf] px-4 py-2.5 text-sm font-semibold text-night-950 shadow-[0_10px_30px_-12px_rgba(34,211,238,0.8)] transition hover:brightness-110 disabled:opacity-40">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z" /></svg>
                {phase === "running" ? "Guardian is checking…" : report ? "Run again" : runLabel}
              </button>
              {report && <button type="button" disabled={phase === "running"} onClick={() => run(true)} className="rounded-xl px-3 py-2.5 text-xs font-medium text-ink-soft ring-1 ring-inset ring-[rgba(148,163,184,0.25)] hover:bg-[rgba(255,255,255,0.05)]" title="Optional OpenAI second opinion on cross-document findings. Advisory only — never changes the gate.">+ AI second opinion</button>}
              <span className="ml-auto font-mono text-[11px] tabular-nums text-ink-muted">{phase === "running" ? `${(elapsed / 1000).toFixed(2)} s` : result ? `server answered in ${result.ms} ms` : ""}</span>
            </div>
            {!canRun && <div className="mt-2 text-xs text-[#fde68a]">Guardian reads internal EQORE records (communications, reviews). Sign in as an EQORE user to run it — the server enforces this.</div>}
            {phase === "running" && <div className="relative mt-3 h-1 overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]" role="progressbar" aria-label="Guardian preflight running" aria-busy="true"><span className="ros-indeterminate absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-transparent via-[#22d3ee] to-transparent" /></div>}
            <ul className="mt-3 space-y-1.5">
              {CHECKS.map((c) => {
                const r = checkResult(c);
                return (
                  <li key={c.id} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 text-sm">
                    <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${r ? (r.bad ? "bg-[rgba(248,113,113,0.18)] text-[#fca5a5]" : "bg-[rgba(45,212,191,0.18)] text-[#5eead4]") : phase === "running" ? "ros-pulse bg-[rgba(34,211,238,0.15)] text-[#67e8f9]" : "bg-[rgba(255,255,255,0.05)] text-ink-muted"}`}>{r ? (r.bad ? "!" : "✓") : "·"}</span>
                    <span className="min-w-0">
                      <span className={r || phase === "running" ? "text-ink" : "text-ink-muted"}>{c.label}</span>
                      <span className="block text-[11px] text-ink-muted">{r ? r.text : phase === "running" ? "Included in the running preflight" : "Not run yet"}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            {result && result.state !== "ok" && (
              <div className="mt-3 rounded-lg bg-[rgba(248,113,113,0.12)] p-3 text-xs text-[#fecaca]">
                {result.state === "forbidden" ? "Not permitted: " : result.state === "unavailable" ? "Guardian backend not available: " : "Guardian failed: "}{result.error}. No results are shown because none were returned.
              </div>
            )}
            {report && (
              <div className={`mt-3 rounded-xl p-3 text-sm ring-1 ring-inset ${report.canBuild ? "bg-[rgba(45,212,191,0.08)] text-[#ccfbf1] ring-[rgba(45,212,191,0.3)]" : "bg-[rgba(248,113,113,0.08)] text-[#fecaca] ring-[rgba(248,113,113,0.3)]"}`}>
                {report.canBuild
                  ? <><b>All configured checks passed</b> for {templateLabel}. Ready for authorized engineer signoff — this is not a certification of code compliance.</>
                  : <><b>{report.counts.blocker} blocker{report.counts.blocker === 1 ? "" : "s"}</b> must be resolved before {templateLabel} can be signed off · {report.counts.warning} warning(s) · {report.counts.info} note(s).</>}
                <div className="mt-1 text-[11px] text-ink-muted">Ran {new Date(report.ranAt).toLocaleTimeString()} · AI: {report.consistency.ai === "openai" ? "OpenAI second opinion (advisory)" : report.consistency.ai === "unavailable" ? "requested but not configured" : "off"}{report.consistency.aiNote ? ` — ${report.consistency.aiNote}` : ""}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {report && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(["all", "blocker", "warning", "info"] as const).map((s) => (
              <button key={s} type="button" onClick={() => setSevFilter(s)} className={`rounded-full px-3 py-1 text-xs ${sevFilter === s ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
                {s === "all" ? `All (${report.findings.length})` : `${s[0].toUpperCase()}${s.slice(1)}s (${report.counts[s]})`}
              </button>
            ))}
            {docFilter && <button type="button" onClick={() => setDocFilter(undefined)} className="rounded-full bg-cyan-50 px-3 py-1 text-xs text-cyan-700 ring-1 ring-inset ring-cyan-200">Document: {docs.find((d) => d.requirementId === docFilter)?.name} ✕</button>}
          </div>
          {shown.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No findings match this filter.</div>
            : <div className="grid gap-3 xl:grid-cols-2">{shown.map((f, i) => <FindingCard key={f.id} f={f} index={i} site={site} byRev={byRev} onShowInGraph={onShowInGraph} highlighted={!!docFilter} />)}</div>}
        </div>
      )}
    </div>
  );
}
