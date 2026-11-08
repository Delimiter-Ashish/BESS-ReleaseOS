"use client";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { runPreflight } from "@/lib/api/client";
import type { PreflightReport } from "@/lib/guardian/types";
import EvidenceGraph from "./EvidenceGraph";
import type { RevisionEvidence } from "./evidence";
import GuardianScan, { type ScanDoc } from "./GuardianScan";
import TimeMachine, { type ReleaseOption } from "./TimeMachine";

type Tab = "scan" | "graph" | "time";

export default function GuardianWorkspace(props: {
  site: { id: string; name: string }; sites: { id: string; name: string }[];
  templates: { id: string; label: string; current: boolean }[]; templateId: string; templateLabel: string;
  docs: ScanDoc[]; byRev: RevisionEvidence; releases: ReleaseOption[]; canRun: boolean;
  initialTab: Tab; autoRun: boolean; initialFocus?: string; initialRelease?: string;
}) {
  const router = useRouter();
  const path = usePathname();
  const [tab, setTab] = useState<Tab>(props.initialTab);
  const [report, setReport] = useState<PreflightReport>();
  const [focus, setFocus] = useState<string | undefined>(props.initialFocus);
  const nav = (p: Record<string, string>) => {
    const u = new URLSearchParams({ project: props.site.id, template: props.templateId, tab, ...p });
    router.push(`${path}?${u.toString()}`);
  };
  // The graph's "next responsible action" comes from the preflight report; load it (read-only) if no scan has run yet.
  useEffect(() => {
    if (tab !== "graph" || report || !props.canRun) return;
    let live = true;
    runPreflight(props.site.id, props.templateId).then((r) => { if (live && r.state === "ok") setReport(r.data); });
    return () => { live = false; };
  }, [tab, report, props.canRun, props.site.id, props.templateId]);
  const showInGraph = useCallback((nodeId: string) => { setFocus(nodeId); setTab("graph"); window.scrollTo({ top: 0, behavior: "smooth" }); }, []);
  const switchTab = (t: Tab) => { setTab(t); const u = new URL(window.location.href); u.searchParams.set("tab", t); u.searchParams.delete("run"); window.history.replaceState(null, "", u.toString()); };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs text-slate-500">Project
          <select value={props.site.id} onChange={(e) => nav({ project: e.target.value, template: "" })} className="ml-2 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900">
            {props.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap gap-1">
          {props.templates.map((t) => (
            <button key={t.id} type="button" onClick={() => nav({ template: t.id })} className={`rounded-full px-3 py-1 text-xs ring-1 ring-inset transition ${t.id === props.templateId ? "bg-cyan-50 text-cyan-700 ring-cyan-300" : "text-slate-600 ring-slate-300 hover:bg-slate-100"}`}>
              {t.label}{t.current ? <span className="ml-1 text-[10px] text-slate-500">· current</span> : null}
            </button>
          ))}
        </div>
        <div role="tablist" className="ml-auto flex overflow-hidden rounded-xl border border-slate-300 bg-night-800 text-sm">
          {([["scan", "Guardian Scan"], ["graph", "Evidence Graph"], ["time", "Time Machine"]] as const).map(([id, l]) => (
            <button key={id} role="tab" aria-selected={tab === id} type="button" onClick={() => switchTab(id)} className={`px-4 py-2 transition ${tab === id ? "bg-[rgba(34,211,238,0.12)] font-medium text-cyan-700" : "text-slate-600 hover:bg-slate-100"}`}>{l}</button>
          ))}
        </div>
      </div>

      <div hidden={tab !== "scan"}>
        <GuardianScan key={props.site.id + props.templateId} site={props.site} templateId={props.templateId} templateLabel={props.templateLabel} docs={props.docs} byRev={props.byRev} autoRun={props.autoRun} canRun={props.canRun} onReport={setReport} onShowInGraph={showInGraph} />
      </div>
      {tab === "graph" && (props.canRun
        ? <EvidenceGraph key={props.site.id} site={props.site} byRev={props.byRev} report={report} focusId={focus} onFocus={setFocus} />
        : <div className="card p-6 text-sm text-slate-600">The evidence graph links internal EQORE communications and reviews. Sign in as an EQORE user — the server enforces this.</div>)}
      {tab === "time" && (props.canRun
        ? <TimeMachine key={props.site.id} site={props.site} releases={props.releases} byRev={props.byRev} initialRelease={props.initialRelease} />
        : <div className="card p-6 text-sm text-slate-600">Sign in as an EQORE user to compare releases with the current state.</div>)}
    </div>
  );
}
