import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import PortfolioTable, { type Row } from "@/components/PortfolioTable";
import { STATUS_META, evaluateSite } from "@/lib/compliance";
import { STAGES, stageIndex } from "@/lib/requirements";
import { getReleases, getReviews, getSites } from "@/lib/store";
import { releaseStatus } from "@/lib/release";

export const dynamic = "force-dynamic";

export default function Home() {
  const sites = getSites();
  const evals = sites.map((s) => ({ site: s, ev: evaluateSite(s) }));

  const rows: Row[] = evals.map(({ site, ev }) => ({
    id: site.id,
    name: site.name,
    city: site.city,
    state: site.state,
    stage: site.stage,
    stageLabel: STAGES[stageIndex(site.stage)].label,
    utility: site.utility,
    kwh: site.energyKwh,
    score: ev.score,
    health: ev.health,
    missing: ev.counts.missing,
    outdated: ev.counts.outdated,
    overdue: ev.counts.overdue,
    dueSoon: ev.counts.due_soon,
    review: ev.counts.pending_review,
  }));

  const totalDocs = sites.reduce((n, s) => n + s.documents.length, 0);
  const openIssues = evals.reduce((n, e) => n + e.ev.issues, 0);
  const red = evals.filter((e) => e.ev.health === "red").length;
  const dueSoon = evals.reduce((n, e) => n + e.ev.counts.due_soon, 0);
  const rels = getReleases();
  const staleRel = rels.filter((r) => { const s = sites.find((x) => x.id === r.siteId)!; return r.number === Math.max(...rels.filter((y) => y.siteId === r.siteId && y.templateId === r.templateId).map((y) => y.number)) && releaseStatus(s, r).state === "stale"; }).length;
  const openReviews = getReviews().filter((r) => r.status === "open").length;
  const openDeps = sites.reduce((n, s) => n + (s.engTasks ?? []).filter((t) => t.status === "open").length, 0);
  const totalMwh = sites.reduce((n, s) => n + s.energyKwh, 0) / 1000;

  const actionItems = evals
    .flatMap(({ site, ev }) =>
      ev.states
        .filter((s) => ["missing", "outdated", "overdue", "due_soon"].includes(s.status))
        .map((s) => ({ site, s })),
    )
    .sort((a, b) => STATUS_META[a.s.status].rank - STATUS_META[b.s.status].rank)
    .slice(0, 8);

  const stageCounts = STAGES.map((st) => ({ ...st, n: sites.filter((s) => s.stage === st.id).length }));

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Portfolio compliance</h1>
            <p className="text-sm text-slate-500">Every document a battery project needs — contract, supplier docs, permits, NFPA 855 — every revision, and version-locked submission packages.</p>
          </div>
        </div>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-5">
          {[
            { k: "Sites", v: sites.length, sub: `${totalMwh.toFixed(1)} MWh storage` },
            { k: "Documents tracked", v: totalDocs.toLocaleString(), sub: "revisions across 11 lifecycle stages" },
            { k: "Open issues", v: openIssues, sub: "missing · outdated · overdue", tone: "text-red-600" },
            { k: "Sites needing action", v: red, sub: `${Math.round((red / sites.length) * 100)}% of portfolio`, tone: "text-orange-600" },
            { k: "Engineering review", v: openReviews + openDeps, sub: `${openReviews} revision(s) · ${openDeps} dependency review(s) · ${staleRel} stale package(s) · ${dueSoon} due soon`, tone: "text-violet-600" },
          ].map((t) => (
            <div key={t.k} className="card p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{t.k}</div>
              <div className={`mt-1 text-3xl font-semibold tabular-nums ${t.tone ?? ""}`}>{t.v}</div>
              <div className="mt-1 text-xs text-slate-500">{t.sub}</div>
            </div>
          ))}
        </section>

        <section className="card p-4">
          <div className="mb-3 text-sm font-medium text-slate-700">Projects by lifecycle stage</div>
          <div className="flex h-9 overflow-hidden rounded-lg">
            {stageCounts.map((st, i) => (
              <div
                key={st.id}
                style={{ flexGrow: st.n || 0.0001 }}
                className={`flex items-center justify-center border-r border-white text-xs font-medium text-white ${["bg-slate-300", "bg-slate-400", "bg-slate-500", "bg-slate-600", "bg-sky-400", "bg-sky-500", "bg-sky-600", "bg-indigo-500", "bg-indigo-600", "bg-emerald-600", "bg-stone-500"][i]}`}
                title={`${st.label}: ${st.n}`}
              >
                {st.n > 3 ? `${st.short} ${st.n}` : st.n || ""}
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-3">
          <section className="lg:col-span-2">
            <PortfolioTable rows={rows} />
          </section>
          <section className="card h-fit p-4">
            <div className="mb-3 text-sm font-semibold">Top action items</div>
            <ul className="space-y-3">
              {actionItems.map(({ site, s }) => (
                <li key={site.id + s.req.id}>
                  <Link href={`/sites/${site.id}`} className="block rounded-lg p-2 hover:bg-slate-50">
                    <div className="flex items-center gap-2">
                      <span className={`pill ${STATUS_META[s.status].color}`}>{STATUS_META[s.status].label}</span>
                      <span className="truncate text-sm font-medium">{s.req.name}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {site.name} · {site.city}, {site.state}
                    </div>
                    <div className="text-xs text-slate-400">{s.reason}</div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
    </>
  );
}
