import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import RoleLogin from "@/components/RoleLogin";
import { STATUS_META, canSee, evaluateSite } from "@/lib/compliance";
import { ROLE_LABEL, type Role } from "@/lib/requirements";
import { getSite } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function PublicSitePage({ params }: { params: { id: string } }) {
  const site = getSite(params.id);
  if (!site) notFound();
  const role = (cookies().get("role")?.value as Role) || "public";
  const ev = evaluateSite(site);
  const visible = ev.states.filter((s) => canSee(s.req, role));
  const om = ev.states.find((s) => s.req.id === "om_manual");

  return (
    <main className="mx-auto max-w-md space-y-4 bg-slate-100 p-4 pb-16">
      <div className="rounded-xl bg-red-600 p-4 text-white shadow">
        <div className="text-xs font-semibold uppercase tracking-wider opacity-80">Battery energy storage system</div>
        <div className="mt-1 text-xl font-bold">{site.name}</div>
        <div className="text-sm opacity-90">{site.address}</div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg bg-white/15 p-2"><div className="text-[11px] opacity-80">Chemistry</div><div className="font-semibold">{site.chemistry.split(" (")[0]}</div></div>
          <div className="rounded-lg bg-white/15 p-2"><div className="text-[11px] opacity-80">Size</div><div className="font-semibold">{site.energyKwh} kWh / {site.powerKw} kW</div></div>
          <div className="col-span-2 rounded-lg bg-white/15 p-2"><div className="text-[11px] opacity-80">ESS location</div><div className="font-semibold">{site.location}</div></div>
          <div className="col-span-2 rounded-lg bg-white/15 p-2"><div className="text-[11px] opacity-80">Disconnect</div><div className="font-semibold">{site.disconnectLocation}</div></div>
        </div>
      </div>

      <div className="card p-4">
        <div className="mb-2 text-sm font-bold">Emergency contacts</div>
        {site.contacts.map((c) => (
          <a key={c.role} href={`tel:${c.phone.replace(/\D/g, "")}`} className="mb-2 flex items-center justify-between rounded-lg bg-slate-50 p-3">
            <div><div className="text-xs text-slate-500">{c.role}</div><div className="font-medium">{c.name}</div></div>
            <div className="font-semibold text-red-600">📞 {c.phone}</div>
          </a>
        ))}
      </div>

      <div className="card p-4">
        <div className="mb-2 text-sm font-bold">Safe shutdown (from O&amp;M manual)</div>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Do not open battery enclosures. Stay upwind; treat smoke as toxic and flammable.</li>
          <li>Open the AC disconnect: <b>{site.disconnectLocation}</b>.</li>
          <li>Press the ESS emergency stop on the enclosure if safely accessible.</li>
          <li>Call EQORE 24/7 response for remote isolation and BMS status.</li>
          <li>Apply water for exposure protection per pre-incident plan; monitor for re-ignition.</li>
        </ol>
        {om && (
          <div className={`mt-3 pill ${STATUS_META[om.status].color}`}>O&amp;M manual {STATUS_META[om.status].label.toLowerCase()} · {om.doc ? `updated ${om.doc.effectiveDate}` : "not on file"}</div>
        )}
      </div>

      <div className="card p-4">
        <div className="mb-1 flex items-center justify-between">
          <div className="text-sm font-bold">Documents</div>
          <span className="pill bg-slate-100 text-slate-700 ring-slate-200">{ROLE_LABEL[role]}</span>
        </div>
        <ul className="divide-y divide-slate-100">
          {visible.map((s) => (
            <li key={s.req.id} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{s.req.name}</div>
                <div className="text-xs text-slate-400">{s.doc ? `v${s.doc.version} · ${s.doc.effectiveDate}` : "Not on file"}</div>
              </div>
              <span className={`pill shrink-0 ${STATUS_META[s.status].color}`}>{STATUS_META[s.status].label}</span>
            </li>
          ))}
        </ul>
        {role === "public" && <div className="mt-2 text-xs text-slate-500">More documents available to AHJ, facility staff and EQORE after login.</div>}
      </div>

      <RoleLogin current={role} />
    </main>
  );
}
