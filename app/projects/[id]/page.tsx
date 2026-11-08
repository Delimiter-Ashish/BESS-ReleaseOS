import Link from "next/link";
import { notFound } from "next/navigation";
import { Page, PageHeader, SectionTitle, SyntheticNote, Term } from "@/components/kit";
import DocumentRegister from "@/components/projects/DocumentRegister";
import { getSession } from "@/lib/auth";
import { customerOf, partiesFor } from "@/lib/demo-data";
import { PACKAGE_BLURB, pkgLabel, SECTION, STATE_NAME } from "@/lib/labels";
import { PACKAGE_TEMPLATES, STAGES, stageIndex } from "@/lib/requirements";
import { getSite } from "@/lib/store";
import { documentRegister, projectSummaries, readiness, TEMPLATE_STAGE } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default function Project({ params, searchParams }: { params: { id: string }; searchParams: { doc?: string; stage?: string } }) {
  const site = getSite(params.id);
  if (!site) notFound();
  const s = getSession();
  const p = projectSummaries().find((x) => x.id === site.id)!;
  const rows = documentRegister(site.id);
  const customer = customerOf(site.id)?.replace(/ \(fictional\)$/, "") ?? site.name;
  const inverterCount = site.inverter?.match(/^(\d+)\s*×/)?.[1];
  const pkgs = PACKAGE_TEMPLATES.map((t) => {
    const r = readiness(site.id, t.id)!;
    const later = stageIndex(TEMPLATE_STAGE[t.id]) > p.stageIndex && !r.releases.length;
    const latest = r.releases[0];
    const state = later ? "later" : latest && latest.state === "current" ? "released" : r.canBuild ? "ready" : r.status === "blocked" ? "blocked" : "review";
    return { t, r, state, latest };
  });
  const PKG_STATE = {
    later: { label: "Needed later", cls: "bg-slate-100 text-slate-600 ring-slate-200", note: (x: (typeof pkgs)[number]) => `Assembled at the ${STAGES[stageIndex(TEMPLATE_STAGE[x.t.id])].label} stage — not a current blocker.` },
    released: { label: "Released", cls: "bg-teal-50 text-teal-700 ring-teal-200", note: (x: (typeof pkgs)[number]) => `R${x.latest!.number} sealed by ${x.latest!.builtBy}. Awaiting external approval — permits and utility approvals are issued outside ReleaseOS.` },
    ready: { label: "Ready for authorized signoff", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", note: () => "All configured checks pass. An engineer signs off in Submission Studio." },
    blocked: { label: "Missing now", cls: "bg-red-50 text-red-700 ring-red-200", note: (x: (typeof pkgs)[number]) => x.r.issues[0]?.message ?? "Blocked by the release gate." },
    review: { label: "Pending engineer review", cls: "bg-violet-50 text-violet-700 ring-violet-200", note: (x: (typeof pkgs)[number]) => x.r.issues[0]?.message ?? "Engineer review open." },
  } as const;

  return (
    <Page>
      <PageHeader eyebrow={<><Link href="/projects" className="hover:underline">Projects</Link> · {site.id}</>} title={site.name}
        subtitle={`${site.city}, ${STATE_NAME[site.state] ?? site.state} · now in ${p.stageLabel} (stage ${p.stageIndex + 1} of ${STAGES.length}) · ${p.provenance}`}
        actions={<>
          {s.engineer ? <Link href={`/reviews?project=${site.id}`} className="btn-primary">Open reviews</Link> : <Link href={`/guardian?project=${site.id}&run=1`} className="btn-primary">Run Guardian Scan</Link>}
          <Link href={`/inbox?project=${site.id}`} className="btn-ghost">Import</Link>
          <Link href={`/submissions?project=${site.id}`} className="btn-ghost">Submission Studio</Link>
          <Link href={`/activity?project=${site.id}`} className="btn-ghost">{SECTION.audit}</Link>
          <Link href={`/qr#${site.id}`} className="btn-ghost">{SECTION.qr}</Link>
        </>} />

      <section className="card overflow-hidden">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="p-6">
            <div className="eyebrow">What are we building?</div>
            <p className="mt-2 text-xl font-medium leading-relaxed text-slate-900">
              A <Term t="kW">{site.powerKw} kW</Term> / <Term t="kWh">{site.energyKwh.toLocaleString()} kWh</Term> battery storage installation for {customer} in {site.city}, {STATE_NAME[site.state] ?? site.state}.
            </p>
            <p className="mt-2 text-sm text-slate-500">It can deliver up to {site.powerKw} kW at once and store {site.energyKwh.toLocaleString()} kWh of energy — about {Math.round((site.energyKwh / site.powerKw) * 10) / 10} hours at full power.</p>
            <details className="mt-4 text-xs text-slate-600">
              <summary className="cursor-pointer text-slate-500 hover:text-slate-800">Engineering details</summary>
              <dl className="mt-2 grid grid-cols-[140px_minmax(0,1fr)] gap-x-3 gap-y-1">
                <dt className="text-slate-500">Address</dt><dd>{site.address}</dd>
                <dt className="text-slate-500">Chemistry</dt><dd>{site.chemistry}</dd>
                <dt className="text-slate-500">Battery location</dt><dd>{site.location}</dd>
                <dt className="text-slate-500">Emergency disconnect</dt><dd>{site.disconnectLocation}</dd>
                <dt className="text-slate-500">Equipment</dt><dd>{site.vendor}{site.inverter ? ` + ${site.inverter}` : ""}</dd>
              </dl>
            </details>
          </div>
          <div className="grid grid-cols-2 gap-px bg-slate-200">
            {[
              { k: "Battery storage", v: site.vendor, d: "Stores electrical energy.", icon: "▮▮▮" },
              { k: "Power conversion", v: site.inverter ?? "Not specified", d: `${inverterCount ? `${inverterCount} inverters convert` : "Converts"} between the battery's DC and the building's AC system.`, icon: "⇄" },
              { k: "Grid connection", v: site.utility, d: <><Term t="Interconnection">Interconnection</Term> approval, then <Term t="PTO">PTO</Term>.</>, icon: "⌁" },
              { k: "Local approvals", v: site.ahj, d: <>The <Term t="AHJ">AHJ</Term>: building and fire officials who approve the installation.</>, icon: "⌂" },
            ].map((c) => (
              <div key={c.k} className="bg-white p-4">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><span className="text-cyan-600">{c.icon}</span>{c.k}</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{c.v}</div>
                <div className="mt-0.5 text-xs text-slate-500">{c.d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <SectionTitle eyebrow="Lifecycle" title={SECTION.lifecycle}>The full deployment, from contract to decommissioning. Each stage shows only that stage&apos;s documents.</SectionTitle>
        <div className="card p-4">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-11">
            {STAGES.map((st, i) => {
              const stRows = rows.filter((r) => r.stage === st.id);
              const n = (k: string) => stRows.filter((r) => r.status === k).length;
              const cur = i === p.stageIndex, past = i < p.stageIndex;
              return (
                <Link key={st.id} href={`/projects/${site.id}?stage=${st.id}#register`} className={`rounded-xl p-2.5 text-left transition hover:ring-1 hover:ring-cyan-300 ${cur ? "bg-[rgba(34,211,238,0.10)] ring-1 ring-cyan-300" : past ? "bg-slate-50" : "bg-slate-50/50"}`}>
                  <div className={`text-[10px] font-semibold uppercase tracking-wide ${cur ? "text-cyan-700" : past ? "text-slate-600" : "text-slate-400"}`}>{i + 1}. {st.short}</div>
                  <div className="mt-1 text-sm font-semibold tabular-nums text-slate-900">{n("approved")}<span className="text-slate-400">/{stRows.length}</span></div>
                  <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                    {n("missing") > 0 && <span className="text-red-600">{n("missing")} missing</span>}
                    {n("pending_review") > 0 && <span className="text-violet-600">{n("pending_review")} review</span>}
                    {n("outdated") > 0 && <span className="text-amber-600">{n("outdated")} outdated</span>}
                    {n("not_yet_required") > 0 && <span className="text-slate-400">{n("not_yet_required")} later</span>}
                  </div>
                  {cur && <div className="mt-1 text-[10px] font-medium text-cyan-700">Current stage</div>}
                </Link>
              );
            })}
          </div>
          <div className="mt-3 grid gap-3 text-xs md:grid-cols-2">
            <div className="rounded-lg bg-slate-50 p-3 text-slate-600"><b className="text-slate-800">Roadmap vs. packages.</b> The roadmap covers the whole deployment lifecycle. Document Packages (below) are specific checkpoints where a set of documents is handed to someone — for example, the Town Permit Application can be ready to submit even though building, electrical and fire permits have not been issued yet.</div>
            <div className="flex flex-wrap content-start gap-1.5">
              <span className="pill bg-red-50 text-red-700 ring-red-200">Missing now</span><span className="pill bg-slate-100 text-slate-600 ring-slate-200">Needed later</span>
              <span className="pill bg-violet-50 text-violet-700 ring-violet-200">Pending engineer review</span><span className="pill bg-amber-50 text-amber-700 ring-amber-200">Outdated revision</span>
              <span className="pill bg-emerald-50 text-emerald-700 ring-emerald-200">Ready for authorized signoff</span><span className="pill bg-teal-50 text-teal-700 ring-teal-200">Released · awaiting external approval</span>
            </div>
          </div>
        </div>
      </section>

      <section>
        <SectionTitle eyebrow="Checkpoints" title={SECTION.packages}>Readiness is decided by the backend release gate, including documents added by confirmed requirements from communications.</SectionTitle>
        <div className="grid gap-4 lg:grid-cols-3">
          {pkgs.map((x) => {
            const st = PKG_STATE[x.state as keyof typeof PKG_STATE];
            return (
              <div key={x.t.id} className="card flex flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <div><div className="font-semibold text-slate-900">{pkgLabel(x.t.id, x.t.name)}</div><div className="text-xs text-slate-500">{PACKAGE_BLURB[x.t.id] ?? x.t.audience}</div></div>
                  <span className={`pill whitespace-nowrap ${st.cls}`}>{st.label}</span>
                </div>
                <div className="mt-3 text-xs text-slate-600">{st.note(x)}</div>
                <div className="mt-2 text-[11px] text-slate-500">{x.r.readyCount}/{x.r.items.length} documents ready · {x.r.issues.length} gate issue{x.r.issues.length === 1 ? "" : "s"}{x.r.releases.length ? ` · ${x.r.releases.length} release(s)` : ""}</div>
                <div className="mt-auto flex flex-wrap gap-2 pt-3">
                  <Link href={`/submissions?project=${site.id}&package=${x.t.id}`} className="btn-ghost !py-1 !text-xs">Open in Studio</Link>
                  <Link href={`/guardian?project=${site.id}&template=${x.t.id}&run=1`} className="btn-ghost !py-1 !text-xs">Guardian scan</Link>
                  {x.latest && <Link href={`/sites/${site.id}/releases/${encodeURIComponent(x.latest.id)}`} className="btn-ghost !py-1 !text-xs">R{x.latest.number}</Link>}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-1">
          <div className="mb-2 text-sm font-semibold">Responsible parties</div>
          <ul className="space-y-1 text-xs">{partiesFor(site.id).map((x) => <li key={x.role + x.name} className="flex justify-between gap-2"><span className="text-slate-500">{x.role}</span><span className="text-right font-medium">{x.name}</span></li>)}</ul>
        </div>
        <div className="card p-4 text-xs text-slate-600 lg:col-span-2">
          <div className="mb-1 text-sm font-semibold text-slate-900">Where each piece of information comes from</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div><span className="pill bg-slate-100 text-slate-600 ring-slate-200">Synthetic demo record</span> metadata only — no original file is shown for it.</div>
            <div><span className="pill bg-sky-50 text-sky-700 ring-sky-200">EQORE reference structure</span> layout follows the EQORE-provided sample plan set.</div>
            <div><span className="pill bg-cyan-50 text-cyan-700 ring-cyan-200">Uploaded source file</span> original bytes stored and hashed on the server.</div>
            <div><span className="pill bg-indigo-50 text-indigo-700 ring-indigo-200">AI-extracted fact</span> advisory, with a page and quote to check.</div>
            <div><span className="pill bg-emerald-50 text-emerald-700 ring-emerald-200">Human-approved</span> an authorized engineer recorded a decision with a note.</div>
          </div>
        </div>
      </div>

      <section id="register" className="scroll-mt-6">
        <SectionTitle title="Document register">Every document this project needs — including ones added by confirmed AHJ requirements — with its revision, status, provenance and owner.</SectionTitle>
        <DocumentRegister rows={rows} focus={searchParams.doc} initialStage={searchParams.stage} />
      </section>
      <SyntheticNote />
    </Page>
  );
}
