import Link from "next/link";
import { Page, PageHeader, ReadinessPill, Restricted, SyntheticNote } from "@/components/kit";
import { getSession } from "@/lib/auth";
import { getSites } from "@/lib/store";
import { externalScope, isInternal, registerFor } from "@/lib/view-access";
import DocumentRegister from "@/components/projects/DocumentRegister";
import { pkgLabel } from "@/lib/labels";
import { STAGES } from "@/lib/requirements";
import { documentRegister, projectSummaries } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default function Projects({ searchParams }: { searchParams: { view?: string; status?: string } }) {
  const s = getSession();
  if (s.role === "public") return <Restricted what="The project portfolio" role={s.role} />;
  // External roles: only projects with document types shared with them; counts from those shared records only.
  const scope = isInternal(s) ? undefined : new Map(externalScope(s, getSites(), documentRegister).map((x) => [x.site.id, x.rows]));
  const projects = projectSummaries().filter((p) => !scope || scope.has(p.id)).map((p) => {
    if (!scope) return p;
    const rows = scope.get(p.id)!;
    return { ...p, documents: rows.filter((r) => r.revisionId).length, approved: rows.filter((r) => r.status === "approved").length, missing: rows.filter((r) => r.status === "missing").length, pendingReviews: 0, openDependencies: 0, packages: [] };
  });
  const register = searchParams.view === "register";
  return (
    <Page>
      <PageHeader eyebrow="Projects" title={register ? "Document register" : "Project portfolio"}
        subtitle={register ? "Every requirement for every project, with its latest revision, status, provenance and responsible party." : "Each project's lifecycle stage, document position and current submissions."}
        actions={<div className="flex overflow-hidden rounded-lg border border-slate-300 text-sm"><Link href="/projects" className={`px-3 py-1.5 ${!register ? "bg-slate-900 text-white" : "bg-white"}`}>Projects</Link><Link href="/projects?view=register" className={`px-3 py-1.5 ${register ? "bg-slate-900 text-white" : "bg-white"}`}>Document register</Link></div>} />
      {register ? <DocumentRegister rows={getSites().flatMap((site) => registerFor(s, site, documentRegister(site.id)))} showProject initialStatus={searchParams.status} /> : (
        <div className="space-y-3">
          {projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="card block p-4 transition hover:border-slate-300 hover:shadow">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><span className="text-base font-semibold">{p.name}</span><span className="text-xs text-slate-500">{p.id} · {p.city}, {p.state}</span></div>
                  <div className="text-xs text-slate-500">{p.customer} · {p.powerKw} kW / {p.energyKwh} kWh · {p.utility} · {p.ahj}</div>
                  <div className="mt-0.5 text-[11px] text-slate-400">{p.provenance}</div>
                </div>
                <div className="flex flex-wrap gap-4 text-center text-xs">
                  <div><div className="text-lg font-semibold tabular-nums">{p.approved}/{p.documents}</div><div className="text-slate-500">approved revisions</div></div>
                  <div><div className={`text-lg font-semibold tabular-nums ${p.missing ? "text-red-600" : "text-slate-400"}`}>{p.missing}</div><div className="text-slate-500">missing</div></div>
                  <div><div className={`text-lg font-semibold tabular-nums ${p.pendingReviews + p.openDependencies ? "text-violet-700" : "text-slate-400"}`}>{p.pendingReviews + p.openDependencies}</div><div className="text-slate-500">in review</div></div>
                  <div className="min-w-[160px] text-left">{p.packages.length ? p.packages.map((k) => <div key={k.templateId} className="flex items-center justify-between gap-2"><span className="text-slate-600">{pkgLabel(k.templateId, k.name)}</span><ReadinessPill s={k.status} /></div>) : <span className="text-slate-400">No submission at this stage</span>}</div>
                </div>
              </div>
              <div className="mt-3 flex gap-0.5">
                {STAGES.map((st, i) => <div key={st.id} title={st.label} className={`h-1.5 flex-1 rounded-full ${i < p.stageIndex ? "bg-teal-500" : i === p.stageIndex ? "bg-cyan-400" : "bg-slate-200"}`} />)}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">Stage {p.stageIndex + 1} of {STAGES.length}: <b className="text-slate-700">{p.stageLabel}</b></div>
            </Link>
          ))}
        </div>
      )}
      <SyntheticNote />
    </Page>
  );
}
