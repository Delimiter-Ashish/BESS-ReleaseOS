import { headers } from "next/headers";
import Link from "next/link";
import QRCode from "qrcode";
import { Page, PageHeader, SyntheticNote } from "@/components/kit";
import { getSession } from "@/lib/auth";
import { publicEmergency } from "@/lib/lifecycle/ops";
import { getSites } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Emergency Access / Site QR (signed-in users): each code opens the public first-responder page (/p/:id), which shows only engineer-published documents. */
export default async function QrAccess() {
  if (getSession().role === "public") {
    return (
      <Page>
        <PageHeader eyebrow="Records" title="Emergency Access / Site QR" subtitle="Sign in to manage site QR codes. First responders: scan the code on the enclosure to open the site's published emergency information." />
      </Page>
    );
  }
  const h = headers();
  const host = process.env.PUBLIC_BASE_URL || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const sites = getSites();
  const codes = await Promise.all(sites.map(async (s) => ({ s, live: (publicEmergency(s.id)?.publications ?? []).filter((p) => p.current), url: `${host}/p/${s.id}`, img: await QRCode.toDataURL(`${host}/p/${s.id}`, { margin: 1, width: 240, color: { dark: "#060912", light: "#ffffff" } }) })));
  return (
    <Page>
      <PageHeader eyebrow="Records" title="Emergency Access / Site QR" subtitle="A code on each battery enclosure opens a public, read-only page for first responders. It shows only emergency documents an authorized engineer explicitly published (Lifecycle → First-responder publication), and only while they are the current approved revision. Nothing is public by default." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {codes.map(({ s, live, url, img }) => (
          <div key={s.id} id={s.id} className="card scroll-mt-6 flex gap-4 p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img} alt={`QR code for ${s.name}`} className="h-28 w-28 shrink-0 rounded-lg" />
            <div className="min-w-0 text-sm">
              <div className="font-semibold text-slate-900">{s.name}</div>
              <div className="text-xs text-slate-500">{s.address}</div>
              <div className="mt-1 text-xs text-slate-600">{live.length ? `Published: ${live.map((p) => p.title).join(", ")}` : "Nothing published yet — the public page is empty."}</div>
              <div className="mt-2 flex flex-wrap gap-2"><Link href={`/p/${s.id}`} target="_blank" className="btn-ghost !py-1 !text-xs">Open public view ↗</Link><Link href={`/lifecycle?project=${s.id}#publications`} className="btn-ghost !py-1 !text-xs">Manage publication</Link></div>
              <div className="mt-1 truncate font-mono text-[10px] text-slate-400">{url}</div>
            </div>
          </div>
        ))}
      </div>
      <SyntheticNote />
    </Page>
  );
}
