import Link from "next/link";
import ImportCenter from "@/components/inbox/ImportCenter";
import { ago, DocStatusPill, Page, PageHeader, Restricted } from "@/components/kit";
import { can, getSession } from "@/lib/auth";
import { DOCUMENT_TYPES, REQ_BY_ID, STAGES, stageIndex } from "@/lib/requirements";
import { getSites } from "@/lib/store";
import { externalScope, isInternal } from "@/lib/view-access";
import { documentRegister, revisionProvenance } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default function Inbox({ searchParams }: { searchParams: { project?: string; expect?: string } }) {
  const s = getSession();
  if (!can(s, "upload")) return <Restricted what="The project inbox" role={s.role} />;
  // Suppliers: only projects / document types shared with them, and only their own recent uploads.
  const scope = isInternal(s) ? undefined : externalScope(s, getSites(), documentRegister);
  const sites = scope ? scope.map((x) => x.site) : getSites();
  const allowedTypes = scope ? new Set(scope.flatMap((x) => x.rows.map((r) => r.requirementId))) : undefined;
  const project = sites.some((x) => x.id === searchParams.project) ? searchParams.project! : sites.find((x) => x.id === "S-1001")?.id ?? sites[0]?.id ?? "";
  const expect = searchParams.expect && REQ_BY_ID[searchParams.expect] ? searchParams.expect : undefined;
  const recent = sites.flatMap((site) => site.documents.filter((d) => !scope || d.uploadedById === s.userId).map((d) => ({ d, site }))).sort((a, b) => (a.d.uploadedAt < b.d.uploadedAt ? 1 : -1)).slice(0, 10);
  return (
    <Page>
      <PageHeader eyebrow="Project Inbox" title="Import documents & communications" subtitle="Select project → upload → validate → extract → classify → compare → create review tasks → project updated. Each file runs independently: a pending engineer review never blocks the next upload." />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <ImportCenter
          projects={sites.map((x) => ({ id: x.id, name: x.name, stage: STAGES[stageIndex(x.stage)].label }))}
          defaultProject={project} expect={expect} canUpload={can(s, "upload")} userName={s.name}
          requirements={DOCUMENT_TYPES.filter((r) => !allowedTypes || allowedTypes.has(r.id)).map((r) => ({ id: r.id, name: r.name }))}
        />
        <aside className="space-y-4">
          <div className="card p-4">
            <div className="text-sm font-semibold">Other intake channels</div>
            <ul className="mt-2 space-y-2 text-sm">
              <li className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2"><span>Files & ZIP folders</span><span className="pill bg-emerald-50 text-emerald-700 ring-emerald-200">Live</span></li>
              <li className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2"><span>Email / AHJ communications<span className="block text-[11px] text-slate-500">.eml or header-style .txt → Project Memory</span></span><span className="pill bg-emerald-50 text-emerald-700 ring-emerald-200">Live</span></li>
              <li className="flex items-center justify-between rounded-lg border border-dashed border-slate-200 px-3 py-2 text-slate-400"><span>Google Drive sync</span><span className="pill bg-slate-100 text-slate-500 ring-slate-200">Upcoming</span></li>
            </ul>
            <p className="mt-2 text-[11px] text-slate-500">Communications are stored verbatim; extracted requirements stay <i>suggestions</i> until confirmed in the <a className="text-cyan-600 underline" href="/memory?type=ahj_requirement">Action Center</a>. Google Drive sync is not built.</p>
          </div>
          <div className="card">
            <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Recently received</div>
            <ul className="divide-y divide-slate-100">
              {recent.map(({ d, site }) => (
                <li key={d.id}>
                  <Link href={`/projects/${site.id}?doc=${d.requirementId}`} className="block px-4 py-2 hover:bg-slate-50">
                    <div className="flex items-center justify-between gap-2"><span className="truncate text-sm">{REQ_BY_ID[d.requirementId]?.name} Rev {d.revLabel}</span><DocStatusPill s={d.status === "in_review" ? "pending_review" : d.status === "uploaded" ? "received" : d.status} /></div>
                    <div className="truncate text-[11px] text-slate-500">{site.name} · {ago(d.uploadedAt)} · {revisionProvenance(d)}</div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </Page>
  );
}
