import { Restricted } from "@/components/kit";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import Guardian from "@/components/guardian/Guardian";
import { can, getSession } from "@/lib/auth";
import { aiAvailable } from "@/lib/guardian/ai";
import { PACKAGE_TEMPLATES, TEMPLATE_BY_ID } from "@/lib/requirements";
import { getReleases, getSite } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function GuardianPage({ params, searchParams }: { params: { id: string }; searchParams: { template?: string } }) {
  const site = getSite(params.id);
  if (!site) notFound();
  const session = getSession();
  if (session.role !== "eqore") return <Restricted what="Project Guardian" role={session.role} />;
  const tpl = TEMPLATE_BY_ID[searchParams.template ?? ""] ? searchParams.template! : "ahj_permit";
  const releases = getReleases(site.id).filter((r) => r.snapshot).sort((a, b) => b.builtAt.localeCompare(a.builtAt))
    .map((r) => ({ id: r.id, templateId: r.templateId, label: `${TEMPLATE_BY_ID[r.templateId]?.name ?? r.templateId} R${r.number} (${r.builtAt.slice(0, 10)})` }));
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        <div className="text-sm text-slate-500"><Link href="/" className="hover:underline">Portfolio</Link> / <Link href={`/sites/${site.id}`} className="hover:underline">{site.name}</Link> / Project Guardian</div>
        <section className="card p-5">
          <h1 className="text-2xl font-semibold tracking-tight">Project Guardian — what are we forgetting?</h1>
          <p className="mt-1 text-sm text-slate-600">
            Preflight a submission for {site.name}: missing and outdated documents, confirmed AHJ requirements, open engineering reviews,
            cross-document discrepancies (same equipment, same interface — not just two revisions of one file), and changes since the last release.
            Every finding links to its evidence. Only the deterministic release gate blocks; AI opinions are advisory. Nothing here certifies code compliance.
          </p>
          <div className="mt-2 flex gap-3 text-xs"><Link href={`/sites/${site.id}/memory`} className="text-indigo-700 underline">Project memory →</Link><Link href={`/sites/${site.id}`} className="text-indigo-700 underline">Site workspace (reviews, uploads, releases) →</Link></div>
        </section>
        <Guardian siteId={site.id} templates={PACKAGE_TEMPLATES.map((t) => ({ id: t.id, name: t.name }))} initialTemplate={tpl} releases={releases} canRun={can(session, "memory")} aiConfigured={aiAvailable()} />
      </main>
    </>
  );
}
