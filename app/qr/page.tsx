import { headers } from "next/headers";
import Link from "next/link";
import QRCode from "qrcode";
import { Page, PageHeader, SyntheticNote } from "@/components/kit";
import { getSites } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Emergency Access / Site QR: each code opens the existing public first-responder view (/p/:id). */
export default async function QrAccess() {
  const h = headers();
  const host = process.env.PUBLIC_BASE_URL || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const sites = getSites();
  const codes = await Promise.all(sites.map(async (s) => ({ s, url: `${host}/p/${s.id}`, img: await QRCode.toDataURL(`${host}/p/${s.id}`, { margin: 1, width: 240, color: { dark: "#060912", light: "#ffffff" } }) })));
  return (
    <Page>
      <PageHeader eyebrow="Records" title="Emergency Access / Site QR" subtitle="A code on each battery enclosure opens a public, read-only page for first responders: location, emergency disconnect, chemistry and 24/7 contacts. Internal documents, communications and reviews are never shown there." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {codes.map(({ s, url, img }) => (
          <div key={s.id} id={s.id} className="card scroll-mt-6 flex gap-4 p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img} alt={`QR code for ${s.name}`} className="h-28 w-28 shrink-0 rounded-lg" />
            <div className="min-w-0 text-sm">
              <div className="font-semibold text-slate-900">{s.name}</div>
              <div className="text-xs text-slate-500">{s.address}</div>
              <div className="mt-1 text-xs text-slate-600">Disconnect: {s.disconnectLocation}</div>
              <div className="mt-2 flex flex-wrap gap-2"><Link href={`/p/${s.id}`} target="_blank" className="btn-ghost !py-1 !text-xs">Open public view ↗</Link></div>
              <div className="mt-1 truncate font-mono text-[10px] text-slate-400">{url}</div>
            </div>
          </div>
        ))}
      </div>
      <SyntheticNote />
    </Page>
  );
}
