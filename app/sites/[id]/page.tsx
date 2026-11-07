import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { AppHeader } from "@/components/AppHeader";
import BuildRelease from "@/components/BuildRelease";
import ReviewPanel, { type ReviewView } from "@/components/ReviewPanel";
import UploadPanel from "@/components/UploadPanel";
import { STATUS_META, evaluateSite } from "@/lib/compliance";
import { PACKAGE_TEMPLATES, REQ_BY_ID, ROLE_LABEL, STAGES, stageIndex } from "@/lib/requirements";
import { latestRelease, packageReadiness, releaseStatus, revisionsOf } from "@/lib/release";
import { getReleases, getReviews, getSite } from "@/lib/store";

export const dynamic = "force-dynamic";

const ROLE_SHORT = { public: "Public", ahj: "AHJ", facility: "Facility", eqore: "EQORE", supplier: "Supplier" } as const;
const ITEM_META = {
  ready: { icon: "✓", cls: "text-emerald-600" },
  missing: { icon: "✕", cls: "text-red-600" },
  in_review: { icon: "◷", cls: "text-violet-600" },
  needs_eng_review: { icon: "!", cls: "text-orange-600" },
} as const;
const REL_META = {
  current: { label: "Current", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  pending_change: { label: "Change pending review", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  stale: { label: "STALE — rebuild required", cls: "bg-red-50 text-red-700 ring-red-200" },
} as const;

export default async function SitePage({ params }: { params: { id: string } }) {
  const site = getSite(params.id);
  if (!site) notFound();
  const ev = evaluateSite(site);
  const si = stageIndex(site.stage);
  const releases = getReleases(site.id);

  const h = headers();
  const host = process.env.PUBLIC_BASE_URL || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const qrUrl = `${host}/p/${site.id}`;
  const qr = await QRCode.toDataURL(qrUrl, { margin: 1, width: 220 });

  const reviews: ReviewView[] = getReviews(site.id)
    .filter((r) => r.status === "open")
    .map((r) => {
      const rev = site.documents.find((d) => d.id === r.revisionId)!;
      const prev = r.previousRevisionId ? site.documents.find((d) => d.id === r.previousRevisionId) : undefined;
      return {
        id: r.id,
        docName: REQ_BY_ID[r.requirementId]?.name ?? r.requirementId,
        revLabel: rev.revLabel,
        prevLabel: prev?.revLabel,
        fileName: rev.fileName,
        uploadedBy: rev.uploadedBy,
        uploadedAt: rev.uploadedAt,
        engine: rev.engine,
        synthetic: rev.synthetic,
        changes: r.changes,
        affectedReleases: r.affectedReleaseIds.map((id) => {
          const rel = releases.find((x) => x.id === id);
          return rel ? `${PACKAGE_TEMPLATES.find((t) => t.id === rel.templateId)?.name} R${rel.number}` : id;
        }),
        affectedDocs: r.affectedRequirementIds.filter((d) => revisionsOf(site, d).length).map((d) => REQ_BY_ID[d]?.name ?? d),
      };
    });

  const packages = PACKAGE_TEMPLATES.map((t) => {
    const ready = packageReadiness(site, t);
    const last = latestRelease(releases, site.id, t.id);
    return { t, ready, last, status: last ? releaseStatus(site, last) : undefined };
  });

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <div className="text-sm text-slate-500">
          <Link href="/" className="hover:underline">Portfolio</Link> / {site.id}
        </div>

        <section className="card flex flex-wrap items-start justify-between gap-6 p-5">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{site.name}</h1>
            <div className="text-sm text-slate-500">{site.address}</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-2 text-sm text-slate-600">
              <span>🔋 {site.vendor}</span>
              {site.inverter && <span>⚡ {site.inverter}</span>}
              <span>{site.powerKw} kW / {site.energyKwh} kWh</span>
              <span>Utility: {site.utility}</span>
              <span>AHJ: {site.ahj}</span>
              <span className="pill bg-slate-100 text-slate-700 ring-slate-200">Stage: {STAGES[si].label}</span>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-center">
              <div className={`text-4xl font-semibold tabular-nums ${ev.score >= 90 ? "text-emerald-600" : ev.score >= 70 ? "text-amber-600" : "text-red-600"}`}>{ev.score}%</div>
              <div className="text-xs text-slate-500">documents current</div>
              <div className="mt-1 text-xs text-slate-500">{ev.issues} open issues</div>
            </div>
            <a href={qrUrl} target="_blank" className="text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="Site QR code" className="h-24 w-24 rounded-lg border border-slate-200" />
              <div className="mt-1 text-xs text-slate-500">Site QR</div>
            </a>
          </div>
        </section>

        <ReviewPanel reviews={reviews} />

        {/* Submission packages */}
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Submission packages</h2>
            <span className="text-xs text-slate-500">Version-locked: only approved revisions, pinned by SHA-256. Checklists illustrative until EQORE confirms.</span>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {packages.map(({ t, ready, last, status }) => (
              <div key={t.id} className="card flex flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{t.name}</div>
                    <div className="text-xs text-slate-500">{t.audience}</div>
                  </div>
                  <span className="text-xs tabular-nums text-slate-500">{ready.readyCount}/{ready.items.length} ready</span>
                </div>
                <ul className="mt-3 space-y-1 text-sm">
                  {ready.items.map((i) => (
                    <li key={i.requirementId} className="flex items-start gap-2">
                      <span className={`w-3 font-bold ${ITEM_META[i.state].cls}`}>{ITEM_META[i.state].icon}</span>
                      <span className="flex-1">
                        {i.name}
                        <span className="text-xs text-slate-400">
                          {i.approved ? ` · Rev ${i.approved.revLabel}` : ""}
                          {i.pending ? ` · Rev ${i.pending.revLabel} in review` : ""}
                        </span>
                        {i.flags.map((f) => <span key={f} className="block text-xs text-orange-700">{f}</span>)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-auto space-y-2 pt-4">
                  {last && status && (
                    <div className="rounded-lg border border-slate-200 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <Link href={`/sites/${site.id}/releases/${last.id}`} className="font-mono text-sm font-semibold hover:underline">R{last.number}</Link>
                        <span className={`pill ${REL_META[status.state].cls}`}>{REL_META[status.state].label}</span>
                      </div>
                      <div className="text-xs text-slate-500">built {last.builtAt.slice(0, 10)} by {last.builtBy}</div>
                      {status.reasons.map((r) => <div key={r} className="mt-1 text-xs text-slate-700">• {r}</div>)}
                      <div className="mt-2 flex gap-2 text-xs">
                        <Link href={`/sites/${site.id}/releases/${last.id}`} className="text-indigo-600 hover:underline">View manifest</Link>
                        <a href={`/api/releases/${last.id}/download`} className="text-indigo-600 hover:underline">Download ZIP</a>
                      </div>
                    </div>
                  )}
                  <BuildRelease siteId={site.id} templateId={t.id} nextNumber={(last?.number ?? 0) + 1} canBuild={ready.canBuild} flags={ready.flags} />
                  {!ready.canBuild && <div className="text-xs text-red-600">Blocked: {ready.blockers.map((b) => b.name).join(", ")}</div>}
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-3">
          <section className="space-y-4 lg:col-span-2">
            <h2 className="text-lg font-semibold">Lifecycle documents</h2>
            <div className="flex flex-wrap gap-1.5">
              {STAGES.map((st, i) => {
                const states = ev.states.filter((s) => s.req.stage === st.id);
                const bad = states.filter((s) => ["missing", "outdated", "overdue"].includes(s.status)).length;
                return (
                  <div key={st.id} className={`rounded-md px-2 py-1 text-xs ${i === si ? "bg-slate-900 text-white" : i < si ? (bad ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800") : "bg-slate-100 text-slate-400"}`}>
                    {i + 1}. {st.short}{i <= si && bad ? ` · ${bad}` : ""}
                  </div>
                );
              })}
            </div>
            {STAGES.map((st, gi) => {
              const states = ev.states.filter((s) => s.req.stage === st.id);
              if (!states.length) return null;
              return (
                <div key={st.id} className="card overflow-hidden">
                  <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold">{gi + 1}. {st.label}</div>
                  <ul className="divide-y divide-slate-100">
                    {states.map((s) => {
                      const revs = revisionsOf(site, s.req.id);
                      return (
                        <li key={s.req.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                          <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_META[s.status].dot}`} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{s.req.name}</span>
                              <span className={`pill ${STATUS_META[s.status].color}`}>{STATUS_META[s.status].label}</span>
                            </div>
                            <div className="mt-0.5 text-xs text-slate-500">{s.reason}</div>
                            <div className="mt-0.5 font-mono text-[11px] text-slate-400">{s.req.codeRef}</div>
                            {revs.length > 0 && (
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {revs.map((r) => {
                                  const sup = r.status === "approved" && revs.find((x) => x.status === "approved")?.id !== r.id;
                                  return (
                                    <span key={r.id} title={`${r.fileName} · sha256 ${r.sha256.slice(0, 12)}…`} className={`rounded px-1.5 py-0.5 text-[11px] ${sup ? "bg-slate-100 text-slate-400 line-through" : r.status === "approved" ? "bg-emerald-50 text-emerald-700" : r.status === "rejected" ? "bg-red-50 text-red-500 line-through" : "bg-violet-50 text-violet-700"}`}>
                                      Rev {r.revLabel} · {sup ? "superseded" : r.status.replace("_", " ")}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                          <div className="flex gap-1">
                            {s.req.access.map((r) => (
                              <span key={r} title={ROLE_LABEL[r]} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${r === "public" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"}`}>{ROLE_SHORT[r]}</span>
                            ))}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </section>
          <aside className="space-y-4">
            <UploadPanel siteId={site.id} />
          </aside>
        </div>
      </main>
    </>
  );
}
