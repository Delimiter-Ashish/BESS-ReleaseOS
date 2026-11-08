import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import Studio from "@/components/studio/Studio";
import { can, getSession } from "@/lib/auth";
import { getSite } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function StudioPage({ params }: { params: { id: string } }) {
  const site = getSite(params.id);
  if (!site) notFound();
  const session = getSession();
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <div className="text-sm text-slate-500"><Link href="/" className="hover:underline">Portfolio</Link> / <Link href={`/sites/${site.id}`} className="hover:underline">{site.name}</Link> / Submission Studio</div>
        <section className="card p-5">
          <h1 className="text-2xl font-semibold tracking-tight">Submission Studio</h1>
          <p className="mt-1 text-sm text-slate-600">
            Assemble a submission for {site.name}: choose the purpose, select and order approved documents into one or more combined PDFs,
            verify with Project Guardian and the access policy, then an engineer signs off. Originals are preserved; the package is frozen and hash-verified.
            Not a certification of code compliance.
          </p>
          <div className="mt-2 flex gap-3 text-xs"><Link href={`/sites/${site.id}/guardian`} className="text-indigo-700 underline">Project Guardian →</Link><Link href={`/sites/${site.id}/memory`} className="text-indigo-700 underline">Project memory →</Link><Link href={`/sites/${site.id}`} className="text-indigo-700 underline">Site workspace →</Link></div>
        </section>
        <Studio siteId={site.id} isEqore={can(session, "memory")} isEngineer={session.engineer} userName={session.name} />
      </main>
    </>
  );
}
