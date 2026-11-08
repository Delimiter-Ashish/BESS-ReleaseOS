import Link from "next/link";
import { Page, PageHeader, SyntheticNote } from "@/components/kit";
import Lifecycle from "@/components/lifecycle/Lifecycle";
import { getSession } from "@/lib/auth";
import { getSites } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Compliance lifecycle: obligations after submission (commissioning → operations → decommissioning). Data: GET/POST /api/sites/:id/lifecycle. */
export default function LifecyclePage({ searchParams }: { searchParams: { project?: string } }) {
  const s = getSession();
  const sites = getSites();
  const site = sites.find((x) => x.id === searchParams.project) ?? sites.find((x) => x.id === "S-1001") ?? sites[0];
  return (
    <Page>
      <PageHeader eyebrow="Lifecycle" title="Obligations & deadlines"
        subtitle="What each site must keep current after submission — commissioning, O&M, maintenance records, emergency plans and decommissioning — what is coming due or overdue, and what needs re-review after a confirmed site change."
        actions={<>
          <form className="flex items-center gap-2" action="/lifecycle">
            <select name="project" defaultValue={site.id} className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900" aria-label="Project">
              {sites.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <button className="btn-ghost">Open</button>
          </form>
          <Link href={`/projects/${site.id}`} className="btn-ghost">Project</Link>
          <Link href={`/p/${site.id}`} target="_blank" className="btn-ghost">Public QR page ↗</Link>
        </>} />
      {s.role === "public"
        ? <div className="card p-5 text-sm text-slate-600">Sign in to view lifecycle obligations. First responders: open the site&apos;s <Link className="underline" href={`/p/${site.id}`}>published emergency information</Link>.</div>
        : <Lifecycle key={site.id} siteId={site.id} isEqore={s.role === "eqore"} isEngineer={s.engineer} canRecord={s.role === "eqore" || s.role === "facility"} />}
      <SyntheticNote />
    </Page>
  );
}
