import Link from "next/link";
import { ago, DocStatusPill, MetricTile, Page, ReadinessPill, SeverityDot, SyntheticNote } from "@/components/kit";
import ExternalToday from "@/components/today/ExternalToday";
import { getSession } from "@/lib/auth";
import { guardianPortfolio } from "@/lib/guardian-view";
import { pkgLabel } from "@/lib/labels";
import { FINDING_LABEL, findings, reviewQueue, todayMetrics } from "@/lib/workspace";

export const dynamic = "force-dynamic";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default async function Today() {
  const s = await getSession();
  // Supplier / facility / AHJ / public: only records shared with them by the access policy (no portfolio data at all).
  if (s.role !== "eqore") return <ExternalToday s={s} />;
  const m = todayMetrics();
  const all = findings(s);
  const guardian = await guardianPortfolio();
  const attention = all.filter((f) => (f.lifecycle === "action_required" || f.lifecycle === "needs_confirmation") && f.severity !== "low").slice(0, 7);
  const revisions = reviewQueue(s).filter((r) => r.kind === "revision").slice(0, 5);
  const plain = s.name.replace(/,.*$/, "").trim();
  const first = plain.split(" ")[0];
  const firstName = s.userId === "public" ? "" : /^[A-Z]\.?$/.test(first) ? plain : first;
  const hero = guardian.find((g) => g.projectId === "S-1001") ?? guardian[0];
  const guardianBlockers = guardian.reduce((n, g) => n + g.blockers, 0);
  const openActions = all.filter((f) => f.lifecycle === "action_required").length;
  const toConfirm = all.filter((f) => f.lifecycle === "needs_confirmation").length;
  const engineer = s.engineer;
  const runHref = hero ? `/guardian?project=${hero.projectId}&template=${hero.templateId}&run=1` : "/guardian";
  const prepareHref = hero ? `/submissions?project=${hero.projectId}&package=${hero.templateId}` : "/submissions";

  return (
    <Page>
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div>
          <h1 className="mt-1 text-[1.7rem] font-semibold tracking-tight text-slate-900">{greeting()}{firstName ? `, ${firstName}` : ""}. Here&apos;s what your projects need today.</h1>
          {s.userId === "public" && <p className="mt-1 text-sm text-slate-500">Choose a demo identity in the sidebar to import documents, review or sign off.</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {engineer ? <Link href="/reviews" className="btn-primary">Open assigned reviews</Link> : <Link href="/inbox" className="btn-ghost">Import documents</Link>}
          {engineer && <Link href="/submissions?view=signoff" className="btn-ghost">Release signoff</Link>}
        </div>
      </section>

      {/* Hero — every number below is computed from the store / the Guardian preflight. */}
      <section className="relative overflow-hidden rounded-3xl border border-[rgba(34,211,238,0.18)] bg-night-950 p-6 shadow-2xl sm:p-8">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_300px_at_85%_0%,rgba(34,211,238,0.16),transparent_70%),radial-gradient(600px_300px_at_0%_100%,rgba(30,58,138,0.35),transparent_70%)]" />
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:32px_32px]" />
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#67e8f9]">Selected submission{hero ? ` · ${hero.projectName} · ${pkgLabel(hero.templateId, hero.templateName)}` : ""}</div>
            <h2 className="mt-2 text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl">What are we forgetting before our next submission?</h2>
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-soft">
              Guardian checks every document, revision, engineering dependency and confirmed AHJ requirement for a package — and tells you exactly what is missing, why it matters, where the evidence is and who needs to act.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Link href={prepareHref} data-testid="cta-prepare" className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-[#67e8f9] to-[#2dd4bf] px-5 py-3 text-sm font-semibold text-night-950 shadow-[0_10px_30px_-10px_rgba(34,211,238,0.8)] transition hover:brightness-110">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 3l8 4-8 4-8-4 8-4zM4 12l8 4 8-4M4 17l8 4 8-4" /></svg>
                Prepare Submission
              </Link>
              <Link href={runHref} data-testid="cta-guardian" className="inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-ink ring-1 ring-inset ring-[rgba(85,221,229,0.4)] transition hover:bg-[rgba(85,221,229,0.08)]">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z" /></svg>
                Run Project Guardian
              </Link>
              <Link href="/memory" className="px-2 py-3 text-sm text-ink-muted transition hover:text-ink">Action Center →</Link>
            </div>
            {hero && <div className="mt-3 text-xs text-ink-muted">Blockers here are this package&apos;s release gate only. {hero.canBuild && m.missingNow > 0 ? `It is ready even though ${m.missingNow} lifecycle document(s) elsewhere in the portfolio are missing — those belong to other stages or packages and do not block it.` : "Results come from the server preflight — nothing is precomputed or simulated."}</div>}
          </div>
          <div className="grid grid-cols-3 gap-3 lg:w-[380px]">
            {[
              { v: hero?.blockers ?? 0, l: `${(hero?.blockers ?? 0) === 1 ? "blocker" : "blockers"}${hero ? ` · ${pkgLabel(hero.templateId)}` : ""}`, c: (hero?.blockers ?? 0) ? "text-[#fca5a5]" : "text-[#5eead4]" },
              { v: openActions, l: "open actions · portfolio", c: "text-[#fde68a]" },
              { v: toConfirm, l: "to confirm · portfolio", c: "text-[#67e8f9]" },
            ].map((x) => (
              <div key={x.l} className="rounded-2xl bg-[rgba(255,255,255,0.04)] p-3 ring-1 ring-inset ring-[rgba(148,163,184,0.14)]">
                <div className={`text-3xl font-semibold tabular-nums ${x.c}`}>{x.v}</div>
                <div className="mt-0.5 text-[11px] leading-tight text-ink-muted">{x.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="-mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Across the portfolio lifecycle</h2>
        <span className="text-[11px] text-slate-500">All projects, all stages — not the selected submission</span>
      </div>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricTile label="Missing now" value={m.missingNow} sub="for each project's current stage" href="/projects?view=register&status=missing" tone={m.missingNow ? "red" : "green"}
          how={<>Unique (project, document type) pairs that apply at the project&apos;s current or earlier stage — or are required by one of its current packages — with no revision on file. A document needed by two packages counts once.</>} />
        <MetricTile label="Pending engineer reviews" value={m.pendingReviews + m.openDependencies} sub={`${m.pendingReviews} revision · ${m.openDependencies} dependency`} href="/reviews" tone="violet"
          how={<>Open revision review tasks plus open engineering dependency / cross-document review tasks in the store. Each is decided independently by an authorized engineer.</>} />
        <MetricTile label="Outdated approved documents" value={m.outdatedDocs} sub="approved, but flagged outdated" href="/projects?view=register&status=outdated" tone={m.outdatedDocs ? "amber" : "green"}
          how={<>Approved revisions whose requirement rule marks them outdated or overdue (lib/compliance.ts), e.g. a document that must be re-issued after a change.</>} />
        <MetricTile label="Open Guardian blockers" value={guardianBlockers} sub={`${guardian.length} current package checks`} href="/guardian" tone={guardianBlockers ? "red" : "green"}
          how={<>Sum of blocking findings returned by the Project Guardian preflight (POST /api/sites/:id/preflight logic) for every project&apos;s current packages. Blocking findings are exactly the release gate.</>} />
        <MetricTile label="Blocked packages" value={m.blockedSubmissions.length} sub="current packages not ready" href="/submissions?status=blocked" tone={m.blockedSubmissions.length ? "red" : "green"}
          how={<>Current packages (the package that matches the project&apos;s stage, or one already released) where the backend gate reports canBuild = false.</>} />
        <MetricTile label="Needed later" value={m.neededLater} sub="future-stage requirements" href="/projects?view=register&status=not_yet_required"
          how={<>Requirements that belong to later lifecycle stages (e.g. commissioning records for a project in permitting). Shown so nothing is forgotten — never counted as missing.</>} />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold">What needs attention today?</h2>
            <Link href="/memory" className="text-xs text-cyan-600 hover:underline">All findings →</Link>
          </div>
          {attention.length === 0 ? <div className="p-6 text-center text-sm text-slate-500">Nothing urgent.</div> : (
            <ul className="divide-y divide-slate-200">
              {attention.map((f) => (
                <li key={f.id}>
                  <Link href={f.href} className="flex items-start gap-3 px-4 py-3 transition hover:bg-slate-50">
                    <span className="mt-1.5"><SeverityDot s={f.severity} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-900">{f.title}</span>
                        <span className="pill bg-slate-100 text-slate-600 ring-slate-200">{FINDING_LABEL[f.type]}</span>
                        {f.lifecycle === "needs_confirmation" && <span className="pill bg-cyan-50 text-cyan-700 ring-cyan-200">Needs confirmation</span>}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">{f.projectName} · {f.detail}</span>
                      {f.blocking.length > 0 && <span className="mt-0.5 block text-[11px] text-red-600">Blocks {f.blocking.map((b) => b).join(", ")}</span>}
                    </span>
                    <span className="shrink-0 text-right text-xs text-slate-500">{f.owner}<span className="block text-cyan-600">{f.hrefLabel} →</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">Guardian · current packages</div>
          <ul className="divide-y divide-slate-200">
            {guardian.map((g) => (
              <li key={g.projectId + g.templateId}>
                <Link href={`/guardian?project=${g.projectId}&template=${g.templateId}`} className="block px-4 py-3 transition hover:bg-slate-50">
                  <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{g.projectName}</span><ReadinessPill s={g.canBuild ? "ready" : "blocked"} /></div>
                  <div className="mt-0.5 text-[11px] text-slate-500">{pkgLabel(g.templateId, g.templateName)} · {g.blockers} blocker{g.blockers === 1 ? "" : "s"} · {g.warnings} warning{g.warnings === 1 ? "" : "s"}</div>
                  {g.topBlockers[0] && <div className="mt-0.5 truncate text-[11px] text-slate-600">Next: {g.topBlockers[0].nextAction}</div>}
                </Link>
              </li>
            ))}
            {guardian.length === 0 && <li className="px-4 py-3 text-xs text-slate-500">No package is due at the projects&apos; current stages.</li>}
          </ul>
        </section>

        <section className="card lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold">Latest revision activity</h2>
            {engineer && <Link href="/reviews?status=all" className="text-xs text-cyan-600 hover:underline">Review inbox →</Link>}
          </div>
          <ul className="divide-y divide-slate-200">
            {revisions.map((r) => (
              <li key={r.id}>
                <Link href={engineer ? `/reviews?item=${encodeURIComponent(r.id)}` : `/projects/${r.projectId}?doc=${r.requirementId}`} className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{r.docName} Rev {r.revLabel}{r.prevLabel ? <span className="font-normal text-slate-500"> (replaces Rev {r.prevLabel})</span> : null}</span>
                    <span className="block truncate text-xs text-slate-500">{r.projectName} · {r.reason}</span>
                  </span>
                  <span className={`pill ${r.open ? "bg-violet-50 text-violet-700 ring-violet-200" : r.status === "approved" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-100 text-slate-600 ring-slate-200"}`}>{r.open ? "Awaiting engineer" : r.status}</span>
                  <span className="w-20 text-right text-[11px] text-slate-400">{ago(r.decidedAt ?? r.uploadedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold">Recently received</h2>
            <Link href="/inbox" className="text-xs text-cyan-600 hover:underline">Inbox →</Link>
          </div>
          <ul className="divide-y divide-slate-200">
            {m.recentDocuments.map((d) => (
              <li key={d.id}>
                <Link href={`/projects/${d.projectId}?doc=${d.requirementId}`} className="block px-4 py-2.5 transition hover:bg-slate-50">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm">{d.docName} Rev {d.revLabel}</span>
                    <DocStatusPill s={d.status === "in_review" ? "pending_review" : d.status === "uploaded" ? "received" : d.status} />
                  </div>
                  <div className="truncate text-[11px] text-slate-500">{d.projectName} · {d.uploadedBy} · {ago(d.uploadedAt)}</div>
                  <div className="text-[10px] text-slate-400">{d.provenance}</div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <div className="eyebrow !text-slate-500">Before</div>
          <div className="mt-1 text-base font-semibold">Drive folders, email threads and memory</div>
          <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
            <li>• Supplier revisions arrive by email; someone has to notice that Rev B replaced Rev A.</li>
            <li>• AHJ comments live in an inbox — nobody is sure they reached the permit package.</li>
            <li>• Engineers check dependent drawings when they remember to.</li>
            <li>• A package is assembled by hand from whatever is in the folder that day.</li>
          </ul>
        </div>
        <div className="card border-[rgba(34,211,238,0.25)] p-5">
          <div className="eyebrow">With ReleaseOS</div>
          <div className="mt-1 text-base font-semibold">One evidence-backed record per project</div>
          <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
            <li>• Every upload is hashed, extracted with page evidence and compared with the approved revision.</li>
            <li>• Communications become <i>suggested</i> requirements; a person confirms them before they count.</li>
            <li>• Material changes open engineer reviews on dependent documents automatically.</li>
            <li>• Guardian runs the release gate before submission; engineers seal immutable releases.</li>
          </ul>
          <div className="mt-2 text-[11px] text-slate-400">We do not claim measured time savings — this is the workflow difference, not a benchmark.</div>
        </div>
      </section>
      <SyntheticNote />
    </Page>
  );
}
