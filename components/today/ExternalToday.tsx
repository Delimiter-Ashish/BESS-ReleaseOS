// Today for supplier / facility / AHJ / public. Built ONLY from records the site access policy shares with this role
// (lib/view-access.ts) — no portfolio totals, findings, review queues or internal notes are rendered or serialized.
import Link from "next/link";
import { DocStatusPill, Page, SyntheticNote } from "@/components/kit";
import type { Session } from "@/lib/auth";
import { clockMode, clockNow, localDate } from "@/lib/lifecycle/clock";
import { ensureLifecycle } from "@/lib/lifecycle/register";
import { lifecycleView } from "@/lib/lifecycle/status";
import { STAGES, stageIndex } from "@/lib/requirements";
import { canDownloadRelease } from "@/lib/studio/release-access";
import { getReleases, getSites, studioOf } from "@/lib/store";
import { externalScope } from "@/lib/view-access";
import { documentRegister } from "@/lib/workspace";

const ROLE_COPY: Record<string, { title: string; sub: string }> = {
  supplier: { title: "Documents requested from your company", sub: "Only the document types EQORE's access policy shares with suppliers. Upload a new revision and an EQORE engineer reviews it." },
  facility: { title: "Records shared with your facility", sub: "Operations documents, obligations and emergency information EQORE shares with the site owner." },
  ahj: { title: "Packages addressed to your office", sub: "Submission packages released to the authority, with every document authorized for you at signoff." },
};

export default function ExternalToday({ s }: { s: Session }) {
  if (s.role === "public") {
    return (
      <Page>
        <section className="card p-8">
          <div className="eyebrow">ReleaseOS</div>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Every battery needs a living record.</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">Choose a demo identity in the sidebar to continue. First responders: scan the QR code on the enclosure to open the site&apos;s published emergency information.</p>
        </section>
        <SyntheticNote />
      </Page>
    );
  }
  const copy = ROLE_COPY[s.role] ?? { title: "Shared records", sub: "" };
  const scope = externalScope(s, getSites(), documentRegister);
  const today = (tz: string) => localDate(clockNow(), tz);
  return (
    <Page>
      <section>
        <div className="eyebrow">{s.name}</div>
        <h1 className="mt-1 text-[1.7rem] font-semibold tracking-tight text-slate-900">{copy.title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">{copy.sub}</p>
      </section>
      {scope.length === 0 && <div className="card p-6 text-sm text-slate-500" data-testid="external-empty">Nothing has been shared with your role yet.</div>}
      {scope.map(({ site, rows }) => {
        const si = stageIndex(site.stage);
        const missing = rows.filter((r) => r.status === "missing");
        const mine = site.documents.filter((d) => d.uploadedById === s.userId).sort((a, b) => b.version - a.version);
        const lc = s.role === "facility" ? (ensureLifecycle(site, clockNow().toISOString()), site.lifecycle) : undefined;
        const lv = lc ? lifecycleView(site, lc, today(lc.timezone), clockMode(), s) : undefined;
        const pkgs = s.role === "ahj" ? getReleases(site.id).filter((r) => canDownloadRelease(s, r)) : [];
        return (
          <section key={site.id} className="card p-5" data-testid="external-project">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-base font-semibold text-slate-900">{site.name}</div>
                <div className="text-xs text-slate-500">{site.city}, {site.state} · stage {si + 1} of {STAGES.length}: {STAGES[si].label}</div>
              </div>
              <Link href={`/projects/${site.id}`} className="btn-ghost !text-xs">Open project</Link>
            </div>
            <div className="mt-3 flex gap-0.5" aria-hidden>{STAGES.map((st, i) => <div key={st.id} className={`h-1 flex-1 rounded-full ${i < si ? "bg-teal-500" : i === si ? "bg-cyan-400" : "bg-slate-200"}`} />)}</div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Shared documents ({rows.length})</div>
                <ul className="divide-y divide-slate-200 text-sm">
                  {rows.filter((r) => r.applicable || r.revisionId).slice(0, 10).map((r) => (
                    <li key={r.key} className="flex items-center justify-between gap-2 py-1.5"><span className="min-w-0 truncate">{r.docName}{r.revLabel ? ` · Rev ${r.revLabel}` : ""}</span><DocStatusPill s={r.status} /></li>
                  ))}
                </ul>
              </div>
              <div className="space-y-3 text-sm">
                {s.role === "supplier" && (<>
                  <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Requested now ({missing.length})</div>
                    {missing.length ? missing.map((r) => <div key={r.key} className="flex items-center justify-between py-1"><span>{r.docName}</span><Link href={`/inbox?project=${site.id}&expect=${r.requirementId}`} className="text-xs text-cyan-600 hover:underline">Upload →</Link></div>) : <div className="text-xs text-slate-500">Nothing requested.</div>}</div>
                  <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Your uploads ({mine.length})</div>
                    {mine.length ? mine.slice(0, 5).map((d) => <div key={d.id} className="flex items-center justify-between py-1"><span className="truncate">{d.fileName} · Rev {d.revLabel}</span><span className="text-xs text-slate-500">{d.status === "in_review" ? "awaiting EQORE review" : d.status}</span></div>) : <div className="text-xs text-slate-500">No uploads yet.</div>}</div>
                </>)}
                {lv && (
                  <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Obligations shared with you</div>
                    <div className="flex flex-wrap gap-1.5 text-xs">{(["overdue", "due_soon", "needs_review", "open", "completed"] as const).filter((k) => lv.counts[k]).map((k) => <span key={k} className="pill bg-slate-100 text-slate-700 ring-slate-200">{k.replace("_", " ")}: {lv.counts[k]}</span>)}</div>
                    <div className="mt-2 flex gap-2"><Link href={`/lifecycle?project=${site.id}`} className="btn-ghost !text-xs">Obligations & records</Link><Link href={`/p/${site.id}`} target="_blank" className="btn-ghost !text-xs">Public QR page ↗</Link></div>
                  </div>
                )}
                {s.role === "ahj" && (
                  <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Packages released to you ({pkgs.length})</div>
                    {pkgs.length ? pkgs.map((r) => <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-1"><span>{r.id}</span><span className="flex gap-2 text-xs">{(studioOf(r)?.outputs ?? []).map((o) => <a key={o.groupId} className="text-cyan-600 hover:underline" href={`/api/releases/${encodeURIComponent(r.id)}/pdf?output=${encodeURIComponent(o.groupId)}`}>{o.name} PDF</a>)}</span></div>) : <div className="text-xs text-slate-500">No package has been released to you for this project.</div>}</div>
                )}
              </div>
            </div>
          </section>
        );
      })}
      <SyntheticNote />
    </Page>
  );
}
