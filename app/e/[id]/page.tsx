import { notFound } from "next/navigation";
import { publicEmergency } from "@/lib/lifecycle/ops";

export const dynamic = "force-dynamic";

/** Public QR landing page: ONLY emergency documents an engineer explicitly published. No contacts, notes or internal records. */
export default function EmergencyPage({ params }: { params: { id: string } }) {
  const data = publicEmergency(params.id);
  if (!data) notFound();
  const { site, publications } = data;
  const live = publications.filter((p) => p.current);
  return (
    <main className="mx-auto max-w-md space-y-4 bg-slate-100 p-4 pb-16">
      <div className="rounded-xl bg-red-600 p-4 text-white shadow">
        <div className="text-xs font-semibold uppercase tracking-wider opacity-80">Battery energy storage system — emergency information</div>
        <div className="mt-1 text-xl font-bold">{site.name}</div>
        <div className="text-sm opacity-90">{site.address}</div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg bg-white/15 p-2"><div className="text-[11px] opacity-80">Chemistry</div><div className="font-semibold">{site.chemistry.split(" (")[0]}</div></div>
          <div className="rounded-lg bg-white/15 p-2"><div className="text-[11px] opacity-80">ESS location</div><div className="font-semibold">{site.location}</div></div>
          <div className="col-span-2 rounded-lg bg-white/15 p-2"><div className="text-[11px] opacity-80">Disconnect</div><div className="font-semibold">{site.disconnectLocation}</div></div>
        </div>
      </div>
      <div className="card p-4">
        <div className="mb-2 text-sm font-bold">Published emergency documents</div>
        {live.length === 0 && <div className="text-sm text-slate-500" data-testid="none">No emergency documents have been published for this site.</div>}
        <ul className="divide-y divide-slate-100">
          {live.map((p) => (
            <li key={p.id} className="py-2" data-testid="publication">
              <a className="font-medium text-red-700 underline" href={p.href}>{p.title}</a>
              <div className="text-[11px] text-slate-500">Published {p.publishedAt.slice(0, 10)} · sha256 {p.sha256.slice(0, 12)}…</div>
            </li>
          ))}
        </ul>
        {publications.length > live.length && <div className="mt-2 text-xs text-amber-700">{publications.length - live.length} published item(s) were superseded and are pending re-publication.</div>}
      </div>
      <p className="text-center text-[11px] text-slate-500">Synthetic demo data. Not a substitute for on-site signage or incident command.</p>
    </main>
  );
}
