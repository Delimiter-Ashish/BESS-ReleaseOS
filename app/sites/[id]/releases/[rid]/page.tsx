import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { TEMPLATE_BY_ID } from "@/lib/requirements";
import { compareReleases, releaseStatus } from "@/lib/release";
import { getRelease, getReleases, getSite } from "@/lib/store";

export const dynamic = "force-dynamic";

const BANNER = {
  current: "bg-emerald-600",
  pending_change: "bg-amber-500",
  stale: "bg-red-600",
} as const;
const LABEL = { current: "CURRENT — ready for engineer signoff", pending_change: "CHANGE PENDING REVIEW — this release is still valid", stale: "STALE — a newer approved revision exists; rebuild before submitting" } as const;

export default function ReleasePage({ params }: { params: { id: string; rid: string } }) {
  const site = getSite(params.id);
  const rel = getRelease(params.rid);
  if (!site || !rel) notFound();
  const t = TEMPLATE_BY_ID[rel.templateId];
  const all = getReleases(site.id).filter((r) => r.templateId === rel.templateId).sort((a, b) => a.number - b.number);
  const prev = all.find((r) => r.number === rel.number - 1);
  const st = releaseStatus(site, rel);
  const cmp = compareReleases(site, prev, rel);
  const changed = cmp.filter((c) => c.changed);

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        <div className="text-sm text-slate-500">
          <Link href="/" className="hover:underline">Portfolio</Link> / <Link href={`/sites/${site.id}`} className="hover:underline">{site.name}</Link> / {t?.name} R{rel.number}
        </div>

        <section className="card overflow-hidden">
          <div className={`px-5 py-2 text-sm font-semibold text-white ${BANNER[st.state]}`}>{LABEL[st.state]}</div>
          <div className="flex flex-wrap items-start justify-between gap-4 p-5">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{t?.name} · <span className="font-mono">R{rel.number}</span></h1>
              <div className="text-sm text-slate-500">{site.name} · {site.address} · for {t?.audience}</div>
              <div className="mt-1 text-sm text-slate-600">Built {rel.builtAt.replace("T", " ").slice(0, 16)} UTC by {rel.builtBy}{rel.note ? ` — “${rel.note}”` : ""}</div>
              <div className="mt-1 font-mono text-xs text-slate-400">manifest sha256 {rel.manifestSha256}</div>
              {st.reasons.map((r) => <div key={r} className="mt-1 text-sm text-red-700">• {r}</div>)}
            </div>
            <div className="flex flex-col gap-2">
              <a href={`/api/releases/${rel.id}/download`} className="btn-primary">⬇ Download ZIP</a>
              <a href={`/api/releases/${rel.id}/download?format=json`} target="_blank" className="btn-ghost">MANIFEST.json</a>
            </div>
          </div>
          <div className="flex gap-2 border-t border-slate-100 px-5 py-2 text-xs">
            <span className="text-slate-500">History:</span>
            {all.map((r) => (
              <Link key={r.id} href={`/sites/${site.id}/releases/${r.id}`} className={`rounded px-2 py-0.5 font-mono ${r.id === rel.id ? "bg-slate-900 text-white" : "bg-slate-100 hover:bg-slate-200"}`}>R{r.number}</Link>
            ))}
          </div>
        </section>

        {prev && (
          <section className="card p-5">
            <h2 className="text-lg font-semibold">What changed since R{prev.number}</h2>
            {changed.length === 0 ? (
              <p className="text-sm text-slate-500">Same pinned revisions as R{prev.number}.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {changed.map((c) => (
                  <div key={c.requirementId} className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium">{c.name}: <span className="font-mono text-red-700 line-through">Rev {c.before?.revLabel ?? "—"}</span> → <span className="font-mono font-semibold text-emerald-700">Rev {c.after.revLabel}</span></div>
                      <div className="text-xs text-slate-500">approved by {c.approvedBy} · {String(c.approvedAt).slice(0, 10)}</div>
                    </div>
                    {c.factChanges.map((f) => (
                      <div key={f.key} className="mt-1 text-sm">
                        <span className="text-slate-600">{f.label}:</span> <span className="text-red-700">{f.before ?? "—"}</span> → <b className="text-emerald-700">{f.after ?? "—"}</b>
                        {f.evidenceAfter && <span className="ml-2 text-xs italic text-slate-500">“{f.evidenceAfter}”{f.pageAfter ? ` p.${f.pageAfter}` : ""}</span>}
                      </div>
                    ))}
                    <div className="mt-1 font-mono text-[11px] text-slate-400">{c.before?.sha256.slice(0, 16)}… → {c.after.sha256.slice(0, 16)}…</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <section className="card overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-2 text-sm font-semibold">Pinned documents ({rel.items.length})</div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-5 py-2">Document</th><th className="px-3 py-2">Rev</th><th className="px-3 py-2">File</th><th className="px-3 py-2">SHA-256</th><th className="px-3 py-2">Approved</th></tr>
            </thead>
            <tbody>
              {cmp.map((c) => (
                <tr key={c.requirementId} className={`border-t border-slate-100 ${c.changed && prev ? "bg-indigo-50/40" : ""}`}>
                  <td className="px-5 py-2 font-medium">{c.name}</td>
                  <td className="px-3 py-2 font-mono">{c.after.revLabel}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{c.after.fileName}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{c.after.sha256.slice(0, 16)}…</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{c.after.approvedBy} · {String(c.after.approvedAt ?? "").slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {rel.openFlags.length > 0 && (
          <section className="card border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <div className="font-semibold">Engineering flags acknowledged at build</div>
            {rel.openFlags.map((f) => <div key={f} className="mt-1">• {f}</div>)}
          </section>
        )}
        <p className="text-xs text-slate-500">Status means “ready for engineer signoff”. It is not a certification of code compliance. Package checklist: {t?.basis}.</p>
      </main>
    </>
  );
}
