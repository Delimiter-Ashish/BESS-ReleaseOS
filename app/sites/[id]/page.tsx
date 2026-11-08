import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { AppHeader } from "@/components/AppHeader";
import BuildRelease from "@/components/BuildRelease";
import EngineeringTasks, { type TaskView } from "@/components/EngineeringTasks";
import ReviewPanel, { type ReviewView } from "@/components/ReviewPanel";
import UploadPanel from "@/components/UploadPanel";
import { can, getSession } from "@/lib/auth";
import { STATUS_META, evaluateSite } from "@/lib/compliance";
import { PACKAGE_TEMPLATES, REQ_BY_ID, ROLE_LABEL, STAGES, stageIndex } from "@/lib/requirements";
import { latestApproved, latestRelease, packageReadiness, releaseStatus, revisionsOf } from "@/lib/release";
import { getDecisions, getReleases, getReviews, getSite, storeStartedAt } from "@/lib/store";

export const dynamic = "force-dynamic";

const ROLE_SHORT = { public: "Public", ahj: "AHJ", facility: "Facility", eqore: "EQORE", supplier: "Supplier" } as const;
const ITEM_META = {
  ready: { icon: "✓", cls: "text-emerald-600", label: "" },
  missing: { icon: "✕", cls: "text-red-600", label: "missing" },
  in_review: { icon: "◷", cls: "text-violet-600", label: "awaiting first approval" },
  pending_change: { icon: "◷", cls: "text-violet-600", label: "revision pending review" },
  needs_eng_review: { icon: "!", cls: "text-orange-600", label: "dependency review open" },
} as const;
const REL_META = {
  current: { label: "Current", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  pending_change: { label: "Change pending review", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  stale: { label: "Stale — rebuild required", cls: "bg-red-50 text-red-700 ring-red-200" },
} as const;
const name = (rid: string) => REQ_BY_ID[rid]?.name ?? rid;

export default async function SitePage({ params }: { params: { id: string } }) {
  const site = getSite(params.id);
  if (!site) notFound();
  const session = getSession();
  const canReview = can(session, "review");
  // Blocker descriptions, review details, engineering tasks and decision notes are internal: signed-in users only.
  const signedIn = session.role !== "public";
  const ev = evaluateSite(site);
  const si = stageIndex(site.stage);
  const releases = getReleases(site.id);

  const h = headers();
  const host = process.env.PUBLIC_BASE_URL || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const qrUrl = `${host}/p/${site.id}`;
  const qr = await QRCode.toDataURL(qrUrl, { margin: 1, width: 220 });
  const engTasks = site.engTasks ?? [];

  const reviews: ReviewView[] = getReviews(site.id)
    .filter((r) => r.status === "open")
    .map((r) => {
      const rev = site.documents.find((d) => d.id === r.revisionId)!;
      const prev = r.previousRevisionId ? site.documents.find((d) => d.id === r.previousRevisionId) : undefined;
      return {
        id: r.id, siteId: site.id, revisionId: rev.id, docName: name(r.requirementId), revLabel: rev.revLabel, prevLabel: prev?.revLabel,
        fileName: rev.fileName, uploadedBy: rev.uploadedBy, uploadedAt: rev.uploadedAt, engine: rev.engine, model: rev.model, synthetic: rev.synthetic,
        changes: r.changes, materialCount: r.materialChangeCount ?? r.changes.filter((c) => c.significance === "material").length,
        aiSummary: r.aiSummary, aiSummarySource: r.aiSummarySource,
        affectedReleases: r.affectedReleaseIds.map((id) => { const rel = releases.find((x) => x.id === id); return rel ? `${PACKAGE_TEMPLATES.find((t) => t.id === rel.templateId)?.name} R${rel.number}` : id; }),
        raisedTasks: engTasks.filter((t) => t.sourceRevisionId === rev.id).map((t) => ({ id: t.id, dependent: name(t.dependentRequirementId), status: t.status })),
        missingDependents: (r.potentiallyAffectedMissing ?? []).map(name),
        resolvable: engTasks.filter((t) => t.status === "open" && t.dependentRequirementId === rev.requirementId).map((t) => ({ id: t.id, source: name(t.sourceRequirementId), explanation: t.explanation, sourceApproved: latestApproved(site, t.sourceRequirementId)?.id === t.sourceRevisionId })),
        selfUpload: !!rev.uploadedById && rev.uploadedById === session.userId,
        warnings: (rev.extractionWarnings ?? []).filter((w) => /embedded instructions|fallback/i.test(w)),
      };
    });

  const tasks: TaskView[] = engTasks.filter((t) => t.status !== "superseded").map((t) => {
    const src = site.documents.find((d) => d.id === t.sourceRevisionId);
    const dep = t.dependentRevisionId ? site.documents.find((d) => d.id === t.dependentRevisionId) : undefined;
    return { id: t.id, source: name(t.sourceRequirementId), sourceRev: src?.revLabel ?? "?", sourceApproved: src?.status === "approved" && latestApproved(site, t.sourceRequirementId)?.id === src.id, dependent: name(t.dependentRequirementId), dependentRev: dep?.revLabel, changedKeys: t.changedKeys, explanation: t.explanation, aiImpact: t.aiImpact, status: t.status, resolvedBy: t.resolvedBy, resolvedAt: t.resolvedAt, resolution: t.resolution, resolutionNote: t.resolutionNote, kind: t.kind, consistency: t.consistency?.map((c) => { const da = site.documents.find((d) => d.id === c.a.revisionId), db = site.documents.find((d) => d.id === c.b.revisionId); return { findingId: c.findingId, quantity: c.quantity, class: c.class, a: { ...c.a, doc: da ? `${name(da.requirementId)} Rev ${da.revLabel}` : undefined }, b: { ...c.b, doc: db ? `${name(db.requirementId)} Rev ${db.revLabel}` : undefined } }; }) };
  });

  const packages = PACKAGE_TEMPLATES.map((t) => {
    const ready = packageReadiness(site, t);
    const all = releases.filter((r) => r.templateId === t.id).sort((a, b) => b.number - a.number);
    const last = latestRelease(releases, site.id, t.id);
    return { t, ready, last, all, status: last ? releaseStatus(site, last) : undefined };
  });
  const audit = getDecisions(site.id).filter((d) => !d.seeded).slice().reverse();

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500"><span><Link href="/" className="hover:underline">Portfolio</Link> / {site.id}</span><span className="flex gap-2"><Link href={`/sites/${site.id}/lifecycle`} className="pill bg-orange-600 text-white ring-orange-600 hover:bg-orange-700">Compliance lifecycle →</Link><Link href={`/sites/${site.id}/studio`} className="pill bg-emerald-600 text-white ring-emerald-600 hover:bg-emerald-700">Submission Studio →</Link><Link href={`/sites/${site.id}/guardian`} className="pill bg-indigo-600 text-white ring-indigo-600 hover:bg-indigo-700">Project Guardian · Run Preflight →</Link><Link href={`/sites/${site.id}/memory`} className="pill bg-indigo-50 text-indigo-700 ring-indigo-200 hover:bg-indigo-100">Project memory &amp; pre-submission check →</Link></span></div>

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

        {/* Readiness at a glance */}
        <section className="grid gap-3 md:grid-cols-3">
          {packages.map(({ t, ready, last, status }) => (
            <a key={t.id} href={`#pkg-${t.id}`} className={`card flex items-center justify-between gap-3 p-3 transition hover:shadow ${ready.canBuild ? "border-emerald-200" : "border-red-200"}`}>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{t.name}</div>
                <div className="text-xs text-slate-500">{ready.readyCount}/{ready.items.length} ready{last ? ` · latest R${last.number}` : " · no release yet"}</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className={`pill ${ready.canBuild ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-red-50 text-red-700 ring-red-200"}`}>{ready.canBuild ? "Ready for signoff" : `${ready.issues.length} blocker${ready.issues.length === 1 ? "" : "s"}`}</span>
                {status && <span className={`pill ${REL_META[status.state].cls}`}>R{last!.number}: {REL_META[status.state].label}</span>}
              </div>
            </a>
          ))}
        </section>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <UploadPanel siteId={site.id} canUpload={can(session, "upload")} userName={session.name} />
            {signedIn ? (
              <>
                <ReviewPanel reviews={reviews} canReview={canReview} userName={session.name} />
                <EngineeringTasks siteId={site.id} tasks={tasks} canReview={canReview} />
              </>
            ) : (reviews.length > 0 || tasks.some((t) => t.status === "open")) && (
              <div className="card p-4 text-sm text-slate-600">{reviews.length} revision review(s) and {tasks.filter((t) => t.status === "open").length} engineering review(s) are open. Sign in to view details.</div>
            )}
          </div>
          <aside className="space-y-4">
            <div className="card p-4">
              <div className="text-sm font-semibold">Audit trail</div>
              <p className="mb-2 text-[11px] text-slate-500">Human decisions recorded with server-side identity.</p>
              {!signedIn ? (
                <div className="text-xs text-slate-500">Sign in to view decisions and reviewer notes.</div>
              ) : audit.length === 0 ? (
                <div className="text-xs text-slate-500">No decisions since the demo started ({storeStartedAt().slice(11, 16)} UTC). Seeded history is included in release snapshots.</div>
              ) : (
                <ol className="relative space-y-3 border-l border-slate-200 pl-4">
                  {audit.slice(0, 12).map((d) => (
                    <li key={d.id} className="text-xs">
                      <span className={`absolute -left-[5px] mt-1 h-2.5 w-2.5 rounded-full ${d.decision === "rejected" ? "bg-red-500" : d.kind === "release_signoff" ? "bg-indigo-500" : "bg-emerald-500"}`} />
                      <div className="font-medium text-slate-800">{d.kind === "revision_review" ? `Revision ${d.decision}` : d.kind === "dependency_resolution" ? "Dependency review resolved" : `Release signed off (${d.releaseId?.split("-").pop()})`}</div>
                      <div className="text-slate-500">{d.reviewerName} · {d.at.slice(11, 19)} UTC</div>
                      {d.revisionId && <div className="text-slate-500">{name(site.documents.find((x) => x.id === d.revisionId)?.requirementId ?? "")} Rev {site.documents.find((x) => x.id === d.revisionId)?.revLabel}</div>}
                      <div className="italic text-slate-600">“{d.note}”</div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <div className="card p-4 text-xs text-slate-500">
              <div className="mb-1 text-sm font-semibold text-slate-800">How decisions are made</div>
              <ul className="list-disc space-y-1 pl-4">
                <li>AI extracts facts and explains possible impacts. It never approves, resolves or releases.</li>
                <li>Material changes and dependency reviews block new releases until an authorized engineer records a decision.</li>
                <li>Releases freeze approved bytes, hashes and approvals. Older releases are never modified.</li>
                <li>State is persisted on the server (single process); release history survives restarts.</li>
              </ul>
            </div>
          </aside>
        </div>

        {/* Submission packages */}
        <section>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">Submission packages</h2>
            <span className="text-xs text-slate-500">Version-locked: only approved revisions, pinned by SHA-256. Checklists illustrative until EQORE confirms.</span>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {packages.map(({ t, ready, last, all, status }) => (
              <div key={t.id} id={`pkg-${t.id}`} className="card flex flex-col p-4">
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
                        {ITEM_META[i.state].label && <span className={`block text-xs ${ITEM_META[i.state].cls}`}>{ITEM_META[i.state].label}</span>}
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
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        {all.map((r) => <Link key={r.id} href={`/sites/${site.id}/releases/${r.id}`} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono hover:bg-slate-200">R{r.number}</Link>)}
                        <a href={`/api/releases/${last.id}/download`} className="text-indigo-600 hover:underline">Download ZIP</a>
                      </div>
                    </div>
                  )}
                  <BuildRelease siteId={site.id} templateId={t.id} nextNumber={(last?.number ?? 0) + 1} canBuild={ready.canBuild} canSign={can(session, "release")} token={ready.token} blockers={signedIn ? ready.issues.map((x) => x.message) : ready.issues.length ? [`${ready.issues.length} blocker(s) — sign in to view details`] : []} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4">
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
          <div className="grid gap-4 lg:grid-cols-2">
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
                                    <Link key={r.id} href={`/sites/${site.id}/documents/${encodeURIComponent(r.id)}`} title={`${r.fileName} · sha256 ${r.sha256.slice(0, 12)}…`} className={`rounded px-1.5 py-0.5 text-[11px] hover:ring-1 hover:ring-slate-300 ${sup ? "bg-slate-100 text-slate-400 line-through" : r.status === "approved" ? "bg-emerald-50 text-emerald-700" : r.status === "rejected" ? "bg-red-50 text-red-500 line-through" : "bg-violet-50 text-violet-700"}`}>
                                      Rev {r.revLabel} · {sup ? "superseded" : r.status.replace("_", " ")}
                                    </Link>
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
          </div>
        </section>
      </main>
    </>
  );
}
