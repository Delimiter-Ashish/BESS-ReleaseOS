"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EvidenceButton } from "@/components/evidence/EvidenceProvider";
import { LifecyclePill, SeverityDot } from "@/components/kit";
import ImportCommunication from "@/components/memory/ImportCommunication";
import MemoryItemCard, { type MemoryItemView } from "@/components/memory/MemoryItemCard";
import type { Finding, FindingType, Lifecycle } from "@/lib/workspace";

export interface MemoryContext {
  sites: { siteId: string; siteName: string; items: MemoryItemView[]; communications: number }[];
  packages: { id: string; name: string }[]; docTypes: { id: string; name: string }[];
  canManage: boolean; isEngineer: boolean; provider: string; focusItem?: string;
}

const TABS: { id: "all" | FindingType; label: string }[] = [
  { id: "all", label: "All findings" },
  { id: "missing_document", label: "Missing documents" },
  { id: "revision_review", label: "Revision reviews" },
  { id: "engineering_conflict", label: "Engineering dependencies" },
  { id: "outdated_release", label: "Outdated packages" },
  { id: "outdated_document", label: "Outdated documents" },
  { id: "ahj_requirement", label: "Project Memory · AHJ & communications" },
];
const TYPE_LABEL: Record<FindingType, string> = { missing_document: "Missing document", revision_review: "Revision review", engineering_conflict: "Engineering dependency", outdated_release: "Outdated package", outdated_document: "Outdated document", ahj_requirement: "AHJ requirement" };
const STEPS: Lifecycle[] = ["detected", "needs_confirmation", "action_required", "resolved"];

export default function ActionCenter({ findings, projects, initialProject, initialType, memory }: { findings: Finding[]; projects: { id: string; name: string }[]; initialProject?: string; initialType?: string; memory: MemoryContext }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>(TABS.some((t) => t.id === initialType) ? (initialType as FindingType) : "all");
  const [project, setProject] = useState(initialProject ?? "");
  const [severity, setSeverity] = useState("");
  const [owner, setOwner] = useState("");
  const [status, setStatus] = useState<"open" | "closed" | "all">("open");
  const [q, setQ] = useState("");

  useEffect(() => {
    const u = new URL(window.location.href);
    if (project) u.searchParams.set("project", project); else u.searchParams.delete("project");
    if (tab !== "all") u.searchParams.set("type", tab); else u.searchParams.delete("type");
    window.history.replaceState(null, "", u.toString());
  }, [project, tab]);

  const isOpen = (f: Finding) => f.lifecycle !== "resolved" && f.lifecycle !== "dismissed";
  const base = useMemo(() => findings.filter((f) => (!project || f.projectId === project) && (status === "all" || (status === "open" ? isOpen(f) : !isOpen(f)))), [findings, project, status]);
  const rows = base.filter((f) => (tab === "all" || f.type === tab) && (!severity || f.severity === severity) && (!owner || f.owner === owner) && (!q || `${f.title} ${f.detail} ${f.projectName} ${f.owner}`.toLowerCase().includes(q.toLowerCase())));
  const owners = Array.from(new Set(findings.map((f) => f.owner))).sort();
  const count = (t: (typeof TABS)[number]["id"]) => (t === "all" ? base.length : base.filter((f) => f.type === t).length);
  const blockers = base.filter((f) => f.blocking.length && isOpen(f));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        {[
          { label: "Open actions", v: base.filter((f) => f.lifecycle === "action_required").length, cls: "text-red-600" },
          { label: "Blocking a current submission", v: blockers.length, cls: "text-red-600" },
          { label: "Awaiting engineers", v: base.filter((f) => (f.type === "revision_review" || f.type === "engineering_conflict") && isOpen(f)).length, cls: "text-violet-700" },
          { label: "Detected, waiting on prerequisite", v: base.filter((f) => f.lifecycle === "detected").length, cls: "text-sky-700" },
        ].map((t) => <div key={t.label} className="card p-3"><div className="text-xs text-slate-500">{t.label}</div><div className={`text-2xl font-semibold tabular-nums ${t.cls}`}>{t.v}</div></div>)}
      </div>

      <div className="card overflow-hidden">
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-2 pt-2">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`whitespace-nowrap rounded-t-lg px-3 py-2 text-sm ${tab === t.id ? "border border-b-white border-slate-200 bg-white font-medium text-slate-900 -mb-px" : "text-slate-500 hover:text-slate-800"}`}>
              {t.label} <span className="ml-1 rounded-full bg-slate-100 px-1.5 text-[11px] tabular-nums text-slate-600">{count(t.id)}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search findings…" className="min-w-[180px] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
          <select value={project} onChange={(e) => setProject(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"><option value="">Any severity</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
          <select value={owner} onChange={(e) => setOwner(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"><option value="">Any owner</option>{owners.map((o) => <option key={o}>{o}</option>)}</select>
          <div className="flex overflow-hidden rounded-lg border border-slate-300 text-xs">{(["open", "closed", "all"] as const).map((s) => <button key={s} onClick={() => setStatus(s)} className={`px-2.5 py-1.5 capitalize ${status === s ? "bg-slate-900 text-white" : "bg-white text-slate-600"}`}>{s === "closed" ? "Resolved" : s}</button>)}</div>
        </div>

        {tab === "ahj_requirement" ? <MemoryPanel ctx={memory} project={project} status={status} q={q} /> : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">Nothing here{project ? " for this project" : ""}. {status === "open" && "Switch to “All” to see resolved items."}</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((f) => (
              <li key={f.id} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityDot s={f.severity} />
                    <span className="text-sm font-medium">{f.title}</span>
                    <span className="pill bg-slate-100 text-slate-600 ring-slate-200">{TYPE_LABEL[f.type]}</span>
                    <LifecyclePill l={f.lifecycle} />
                    {f.blocking.length > 0 && isOpen(f) && <span className="pill bg-red-600 text-white ring-red-600">Blocks {f.blocking.map((b) => b.replace(" package", "")).join(", ")}</span>}
                  </div>
                  <div className="mt-1 text-xs text-slate-600">{f.detail}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
                    <span>{f.projectName}</span>
                    <span>Owner: <b className="font-medium text-slate-700">{f.owner}</b></span>
                    <span>Record status: {f.backendStatus}</span>
                    <Stepper l={f.lifecycle} />
                  </div>
                </div>
                <div className="flex items-start gap-2 md:justify-end">
                  <EvidenceButton refs={f.evidence} />
                  <Link href={f.href} className="btn-ghost !py-1 !text-xs">{f.hrefLabel} →</Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stepper({ l }: { l: Lifecycle }) {
  if (l === "dismissed") return <span className="text-slate-400">Detected → Dismissed (superseded)</span>;
  const at = STEPS.indexOf(l);
  return (
    <span className="inline-flex items-center gap-1">
      {STEPS.map((s, i) => <span key={s} className={`inline-flex items-center gap-1 ${i <= at ? "text-slate-700" : "text-slate-300"}`}>{i > 0 && <span>→</span>}<span className={i === at ? "font-semibold" : ""}>{s === "needs_confirmation" ? "Confirm" : s === "action_required" ? "Action" : s[0].toUpperCase() + s.slice(1)}</span></span>)}
    </span>
  );
}

/** Live Project Memory (Ashish's backend: /api/sites/:id/communications, /api/sites/:id/memory/:itemId). */
function MemoryPanel({ ctx, project, status, q }: { ctx: MemoryContext; project: string; status: "open" | "closed" | "all"; q: string }) {
  const site = ctx.sites.find((x) => x.siteId === project) ?? ctx.sites.find((x) => x.siteId === "S-1001") ?? ctx.sites[0];
  const [importOpen, setImportOpen] = useState(false);
  const shownSites = project ? ctx.sites.filter((x) => x.siteId === project) : ctx.sites.filter((x) => x.items.length > 0);
  const open = (m: MemoryItemView) => m.status === "suggested" || m.status === "confirmed";
  const keep = (m: MemoryItemView) => (status === "all" || (status === "open" ? open(m) : !open(m))) && (!q || `${m.title} ${m.detail}`.toLowerCase().includes(q.toLowerCase()));
  useEffect(() => { if (ctx.focusItem) document.getElementById(`mem-${ctx.focusItem}`)?.scrollIntoView({ block: "center" }); }, [ctx.focusItem]);
  if (!ctx.canManage) return <div className="p-6 text-sm text-slate-600">Project Memory holds internal correspondence (emails, AHJ comments). Sign in as an EQORE user to view and confirm it — the server enforces this.</div>;
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
        <span>Communications become <b>suggestions</b> (AI or rules). A suggestion never blocks a submission until a person <b>confirms</b> it; requirements are resolved by an engineer against an approved revision.</span>
        <button type="button" onClick={() => setImportOpen(!importOpen)} className="btn-primary !py-1 !text-xs">{importOpen ? "Close import" : `Import a communication for ${site?.siteName ?? "project"}`}</button>
      </div>
      {importOpen && site && <ImportCommunication siteId={site.siteId} canImport={ctx.canManage} provider={ctx.provider} />}
      {shownSites.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No communications imported yet. Try <code>sample-docs/SYNTHETIC_AHJ_Email_Ventilation.txt</code> or <code>sample-docs/demo/SYNTHETIC_AHJ_Email_Holliston_Fire.txt</code> (synthetic).</div>}
      {shownSites.map((x) => {
        const items = x.items.filter(keep);
        return (
          <section key={x.siteId} className="space-y-2">
            <div className="flex items-baseline justify-between gap-2"><h3 className="text-sm font-semibold">{x.siteName}</h3><span className="text-[11px] text-slate-500">{x.communications} communication(s) · {x.items.filter((m) => m.status === "suggested").length} to confirm · {x.items.filter((m) => m.status === "confirmed").length} confirmed open</span></div>
            {items.length === 0 ? <div className="text-xs text-slate-500">Nothing {status === "open" ? "open" : "here"}.</div> : (
              <div className="grid gap-2 xl:grid-cols-2">{items.map((m) => <div key={m.id} id={`mem-${m.id}`} className={ctx.focusItem === m.id ? "rounded-xl ring-2 ring-cyan-400" : ""}><MemoryItemCard siteId={x.siteId} item={m} packages={ctx.packages} docTypes={ctx.docTypes} canManage={ctx.canManage} isEngineer={ctx.isEngineer} /></div>)}</div>
            )}
          </section>
        );
      })}
    </div>
  );
}
