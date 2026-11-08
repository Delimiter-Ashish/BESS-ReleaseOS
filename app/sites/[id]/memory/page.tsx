import { Restricted } from "@/components/kit";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import ImportCommunication from "@/components/memory/ImportCommunication";
import MemoryItemCard, { type MemoryItemView } from "@/components/memory/MemoryItemCard";
import { can, getSession } from "@/lib/auth";
import { selectedProvider } from "@/lib/extract";
import { preSubmissionReport } from "@/lib/memory/presubmission";
import { latestApproved } from "@/lib/release";
import { DOCUMENT_TYPES, PACKAGE_TEMPLATES, REQ_BY_ID } from "@/lib/requirements";
import { getSite } from "@/lib/store";

export const dynamic = "force-dynamic";

const CAT_LABEL = { missing_document: "Missing documents", outdated_revision: "Outdated revisions", pending_review: "Pending reviews", dependency: "Engineering dependencies", consistency: "Cross-document discrepancies", requirement: "Confirmed requirements", action: "Stakeholder actions", question: "Open questions", decision: "Open decisions" } as const;
const SRC_LABEL = { package_template: "Checklist", dependency_graph: "Dependency graph", project_memory: "Project memory", consistency_check: "Cross-document check" } as const;

export default function MemoryPage({ params }: { params: { id: string } }) {
  const site = getSite(params.id);
  if (!site) notFound();
  const session = getSession();
  if (session.role !== "eqore") return <Restricted what="Project memory" role={session.role} />;
  const isEqore = can(session, "memory");
  const reports = PACKAGE_TEMPLATES.map((t) => preSubmissionReport(site, t.id, { redactEvidence: !isEqore })!);
  const items = site.memory ?? [];
  const views: MemoryItemView[] = items.map((m) => {
    const a = m.requirementId ? latestApproved(site, m.requirementId) : undefined;
    return { ...m, documentName: m.requirementId ? REQ_BY_ID[m.requirementId]?.name : undefined, duplicateOfTitle: m.duplicateOfId ? items.find((x) => x.id === m.duplicateOfId)?.title : undefined, approvedRevision: a ? { id: a.id, revLabel: a.revLabel, uploadedAt: a.uploadedAt } : undefined };
  });
  const groups = [
    { key: "suggested", title: "Suggestions awaiting confirmation", hint: "AI/rules proposals. Not authoritative and never blocking until a person confirms them.", list: views.filter((v) => v.status === "suggested") },
    { key: "confirmed", title: "Confirmed — open", hint: "Confirmed by EQORE. Blocking items gate the packages they apply to.", list: views.filter((v) => v.status === "confirmed") },
    { key: "resolved", title: "Resolved", hint: "Closed with a recorded note and identity.", list: views.filter((v) => v.status === "resolved") },
    { key: "closed", title: "Dismissed / merged", hint: "Kept for audit.", list: views.filter((v) => v.status === "dismissed" || v.status === "merged") },
  ];
  const packages = PACKAGE_TEMPLATES.map((t) => ({ id: t.id, name: t.name }));
  const docTypes = DOCUMENT_TYPES.map((d) => ({ id: d.id, name: d.name }));
  const comms = (site.communications ?? []).slice().reverse();

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <div className="text-sm text-slate-500"><Link href="/" className="hover:underline">Portfolio</Link> / <Link href={`/sites/${site.id}`} className="hover:underline">{site.name}</Link> / Project memory</div>
        <section className="card p-5">
          <h1 className="text-2xl font-semibold tracking-tight">Before we move forward, what are we forgetting?</h1>
          <p className="mt-1 text-sm text-slate-600">Pre-submission check for {site.name} · AHJ: {site.ahj} · Utility: {site.utility}. Combines the package checklist, approved revisions, engineering dependencies and <b>confirmed</b> project memory. Only confirmed blocking items can stop a release.</p>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          {reports.map((r) => (
            <div key={r.templateId} id={`check-${r.templateId}`} className={`card p-4 ${r.canBuild ? "border-emerald-200" : "border-red-200"}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">{r.templateName}</div>
                  <div className="text-xs text-slate-500">{r.audience}</div>
                </div>
                <span className={`pill ${r.canBuild ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-red-50 text-red-700 ring-red-200"}`}>{r.canBuild ? "Clear to sign off" : `${r.counts.blockers} blocker${r.counts.blockers === 1 ? "" : "s"}`}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {(Object.keys(CAT_LABEL) as (keyof typeof CAT_LABEL)[]).filter((c) => r.counts[c]).map((c) => <span key={c} className="pill bg-white text-slate-700 ring-slate-200">{CAT_LABEL[c]}: {r.counts[c]}</span>)}
              </div>
              <ul className="mt-3 space-y-2">
                {r.blockers.map((b, i) => (
                  <li key={i} className="rounded-lg bg-red-50/60 p-2 text-xs">
                    <div className="font-medium text-red-800">{b.message}</div>
                    <div className="mt-1 grid gap-0.5 text-[11px] text-slate-600">
                      <span><b>Source:</b> {b.source ? `${SRC_LABEL[b.source.kind]} — ${b.source.label}` : "—"}</span>
                      {b.source?.evidence && <span className="italic">“{b.source.evidence}”</span>}
                      {b.affectedDocument && <span><b>Document:</b> {b.affectedDocument}</span>}
                      <span><b>Responsible:</b> {b.responsibleParty ?? "not known"}</span>
                      {b.nextAction && <span className="text-slate-800"><b>Next:</b> {b.nextAction}</span>}
                    </div>
                  </li>
                ))}
                {r.canBuild && <li className="rounded-lg bg-emerald-50 p-2 text-xs text-emerald-800">All checks clear. An engineer can sign off and build the next release on the <Link className="underline" href={`/sites/${site.id}#pkg-${r.templateId}`}>site page</Link>.</li>}
              </ul>
              {r.advisories.length > 0 && (
                <div className="mt-3 space-y-1 border-t border-slate-100 pt-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Advisory (not blocking)</div>
                  {r.advisories.map((a) => <div key={a.memoryItemId} className="text-[11px] text-orange-800">◌ {a.message}</div>)}
                </div>
              )}
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-slate-500">Checklist ({r.checklist.filter((c) => c.state === "ready").length}/{r.checklist.length} ready)</summary>
                <ul className="mt-1 space-y-0.5">
                  {r.checklist.map((c) => <li key={c.requirementId} className={c.state === "ready" ? "text-slate-600" : "text-red-700"}>{c.state === "ready" ? "✓" : "✕"} {c.name}{c.approvedRevision ? ` · Rev ${c.approvedRevision}` : ""}{c.pendingRevision ? ` (Rev ${c.pendingRevision} pending)` : ""}{c.requiredBy === "project_memory" ? " · added by project memory" : ""}</li>)}
                </ul>
              </details>
            </div>
          ))}
        </section>

        {!isEqore ? (
          <div className="card p-4 text-sm text-slate-500">Project memory holds internal correspondence. Sign in as an EQORE user to view and manage it.</div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <ImportCommunication siteId={site.id} canImport={isEqore} provider={selectedProvider() === "openai" && process.env.OPENAI_API_KEY ? "OpenAI" : "deterministic rules"} />
              {groups.map((g) => g.list.length > 0 && (
                <section key={g.key} className="space-y-2">
                  <div>
                    <h2 className="text-sm font-semibold">{g.title} <span className="text-slate-400">({g.list.length})</span></h2>
                    <p className="text-xs text-slate-500">{g.hint}</p>
                  </div>
                  {g.list.map((v) => <MemoryItemCard key={v.id} siteId={site.id} item={v} packages={packages} docTypes={docTypes} canManage={isEqore} isEngineer={session.engineer} />)}
                </section>
              ))}
              {!items.length && <div className="card p-4 text-sm text-slate-500">No project memory yet. Import <code>sample-docs/SYNTHETIC_AHJ_Email_Ventilation.txt</code> to try the demo.</div>}
            </div>
            <aside className="space-y-3">
              <h2 className="text-sm font-semibold">Communications on record ({comms.length})</h2>
              {comms.map((c) => (
                <details key={c.id} id={c.id} className="card p-3 text-xs">
                  <summary className="cursor-pointer">
                    <span className="font-medium text-slate-800">{c.subject ?? "(no subject)"}</span>
                    <div className="text-[11px] text-slate-500">{c.sender} · {new Date(c.sentAt).toLocaleString()} · {c.channel.replace("_", " ")}</div>
                    <div className="text-[11px] text-slate-400">{c.id} · {c.analysis.engine === "openai" ? `OpenAI${c.analysis.model ? ` ${c.analysis.model}` : ""}` : `rules${c.analysis.fallback ? " (fallback)" : ""}`} · imported by {c.importedBy} · sha {c.contentSha256.slice(0, 10)}…</div>
                  </summary>
                  {c.analysis.summary && <p className="mt-2 text-slate-600">{c.analysis.summary}</p>}
                  {c.analysis.warnings.map((w) => <div key={w} className="mt-1 text-amber-800">⚠ {w}</div>)}
                  {c.analysis.documentReferences.length > 0 && <div className="mt-2 text-[11px] text-slate-500">Documents mentioned: {c.analysis.documentReferences.map((d) => `${d.reference}${d.revisionLabel ? ` Rev ${d.revisionLabel}` : ""}${d.linkedRevisionId ? " (on file)" : ""}`).join("; ")}</div>}
                  <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-700">{c.body}</pre>
                </details>
              ))}
            </aside>
          </div>
        )}
      </main>
    </>
  );
}
