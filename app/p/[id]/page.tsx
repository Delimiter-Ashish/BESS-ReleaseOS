import { notFound } from "next/navigation";
import { publicEmergency } from "@/lib/lifecycle/ops";

export const dynamic = "force-dynamic";

/**
 * Public first-responder QR page. Shows ONLY emergency documents an authorized engineer explicitly published
 * (Lifecycle → First-responder publication), and only while each is still the current approved revision with a
 * matching SHA-256. No hard-coded instructions, contacts, internal records, communications or review state.
 */
export default async function PublicEmergencyPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const data = publicEmergency(params.id);
  if (!data) notFound();
  const { site, publications } = data;
  const live = publications.filter((p) => p.current);
  return (
    <main className="mx-auto min-h-screen max-w-md space-y-4 bg-[#0b0f1a] p-4 pb-16 text-white">
      <div className="rounded-2xl bg-gradient-to-b from-red-600 to-red-700 p-4 shadow-lg">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-80">Battery energy storage system · emergency information</div>
        <div className="mt-1 text-xl font-bold">{site.name}</div>
        <div className="text-sm opacity-90">{site.address}</div>
      </div>
      <div className="rounded-2xl bg-white p-4 text-slate-900 shadow">
        <div className="mb-2 text-sm font-bold">Published emergency documents</div>
        {live.length === 0 && <div className="text-sm text-slate-600" data-testid="none">No emergency information has been published for this site yet. Follow on-site signage and incident command.</div>}
        <ul className="divide-y divide-slate-100">
          {live.map((p) => (
            <li key={p.id} className="py-3" data-testid="publication">
              <a className="text-base font-semibold text-red-700 underline" href={p.href}>{p.title}</a>
              <div className="text-[11px] text-slate-500">Approved for publication {p.publishedAt.slice(0, 10)} · sha256 {p.sha256.slice(0, 12)}…</div>
            </li>
          ))}
        </ul>
        {publications.length > live.length && <div className="mt-2 text-xs text-amber-700">{publications.length - live.length} previously published item(s) were superseded and are withheld until EQORE re-publishes them.</div>}
      </div>
      <p className="text-center text-[11px] text-slate-400">Synthetic demo data. Only engineer-approved information appears here. Not a substitute for on-site signage or incident command.</p>
    </main>
  );
}
