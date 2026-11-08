import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import Lifecycle from "@/components/lifecycle/Lifecycle";
import UploadPanel from "@/components/UploadPanel";
import { can, getSession } from "@/lib/auth";
import { getSite } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function LifecyclePage({ params }: { params: { id: string } }) {
  const site = getSite(params.id);
  if (!site) notFound();
  const session = getSession();
  const signedIn = session.role !== "public";
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <div className="text-sm text-slate-500"><Link href="/" className="hover:underline">Portfolio</Link> / <Link href={`/sites/${site.id}`} className="hover:underline">{site.name}</Link> / Compliance lifecycle</div>
        <section className="card p-5">
          <h1 className="text-2xl font-semibold tracking-tight">Compliance lifecycle</h1>
          <p className="mt-1 text-sm text-slate-600">
            Documentation obligations for {site.name} from commissioning through operation, maintenance and decommissioning: what is required now,
            what is coming due or overdue, and what needs re-review after a confirmed site change. Uses the same documents, approvals and access policy as the rest of ReleaseOS.
          </p>
          <div className="mt-2 flex gap-3 text-xs"><Link href={`/sites/${site.id}`} className="text-indigo-700 underline">Site workspace →</Link><Link href={`/sites/${site.id}/guardian`} className="text-indigo-700 underline">Project Guardian →</Link><Link href={`/e/${site.id}`} className="text-indigo-700 underline">Public emergency page →</Link></div>
        </section>
        {signedIn ? (
          <>
            <Lifecycle siteId={site.id} isEqore={session.role === "eqore"} isEngineer={session.engineer} canRecord={session.role === "eqore" || session.role === "facility"} />
            {can(session, "upload") && session.role === "eqore" && <section id="upload"><UploadPanel siteId={site.id} canUpload userName={session.name} /></section>}
          </>
        ) : (
          <div className="card p-5 text-sm text-slate-600">Sign in to view lifecycle obligations. First responders: see the <Link className="underline" href={`/e/${site.id}`}>published emergency information</Link>.</div>
        )}
      </main>
    </>
  );
}
