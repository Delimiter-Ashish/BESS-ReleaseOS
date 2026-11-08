import Link from "next/link";
import { Page, PageHeader, ReadinessPill, SyntheticNote } from "@/components/kit";
import SubmissionStudio, { type LibraryDoc, type StudioRelease } from "@/components/studio/SubmissionStudio";
import { can, getSession } from "@/lib/auth";
import { pkgLabel } from "@/lib/labels";
import { latestApproved, pendingRevision, revisionsOf } from "@/lib/release";
import { PACKAGE_TEMPLATES, REQ_BY_ID, STAGES, stageIndex } from "@/lib/requirements";
import { getReleases, getSites } from "@/lib/store";
import { documentRegister, evidenceForRevision, projectSummaries, readiness, relevantTemplates, type EvidenceRef } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default function Submissions({ searchParams }: { searchParams: { project?: string; package?: string; status?: string; view?: string } }) {
  const s = getSession();
  const sites = getSites();
  const portfolio = projectSummaries().flatMap((p) => p.packages.map((k) => ({ ...k, projectId: p.id, projectName: p.name })));

  // Engineer landing: every current package, ready-for-signoff first.
  if (searchParams.view === "signoff" || searchParams.status === "blocked") {
    const list = (searchParams.status === "blocked" ? portfolio.filter((k) => k.status !== "ready") : portfolio).slice().sort((a, b) => (a.status === "ready" ? -1 : 0) - (b.status === "ready" ? -1 : 0));
    return (
      <Page>
        <PageHeader eyebrow={searchParams.view === "signoff" ? "Release Signoff" : "Submission Studio"} title={searchParams.view === "signoff" ? "Packages awaiting authorized signoff" : "Blocked packages"}
          subtitle="Each project's current package, as reported by the backend release gate. Open one to verify it with Guardian and — as an authorized engineer — sign off and seal a release." />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((k) => (
            <Link key={k.projectId + k.templateId} href={`/submissions?project=${k.projectId}&package=${k.templateId}`} className="card block p-4 transition hover:border-slate-300 hover:shadow-glow">
              <div className="flex items-center justify-between gap-2"><span className="text-xs text-slate-500">{k.projectName}</span><ReadinessPill s={k.status} /></div>
              <div className="mt-1 text-base font-semibold">{pkgLabel(k.templateId, k.name)}</div>
              <div className="mt-1 text-xs text-slate-500">{k.issues} gate issue{k.issues === 1 ? "" : "s"} · {k.status === "ready" ? "ready for authorized engineer signoff" : "resolve blockers first"}</div>
            </Link>
          ))}
          {list.length === 0 && <div className="text-sm text-slate-500">No packages match.</div>}
        </div>
        <SyntheticNote />
      </Page>
    );
  }

  const site = sites.find((x) => x.id === searchParams.project) ?? sites.find((x) => x.id === "S-1001")!;
  const current = relevantTemplates(site);
  const tpl = PACKAGE_TEMPLATES.find((t) => t.id === searchParams.package) ?? current[0] ?? PACKAGE_TEMPLATES[0];
  const r = readiness(site.id, tpl.id)!;
  const required = new Set(r.items.map((i) => i.requirementId));
  const reg = documentRegister(site.id);
  const library: LibraryDoc[] = reg.map((row) => {
    const a = latestApproved(site, row.requirementId);
    const p = pendingRevision(site, row.requirementId);
    const req = REQ_BY_ID[row.requirementId];
    return {
      requirementId: row.requirementId, name: row.docName, stage: row.stageLabel, status: row.status, reason: row.reason, required: required.has(row.requirementId),
      approved: a ? { id: a.id, revLabel: a.revLabel, fileName: a.fileName, sha256: a.sha256, approvedBy: a.approvedBy, approvedAt: a.approvedAt, hasFile: !!a.fileId } : undefined,
      pending: p ? { id: p.id, revLabel: p.revLabel } : undefined,
      revisionCount: revisionsOf(site, row.requirementId).length,
      access: req?.access ?? [], provenance: a ? row.provenance : "—", owner: row.owner,
    };
  });
  const byRev: Record<string, EvidenceRef> = Object.fromEntries(site.documents.map((d) => [d.id, evidenceForRevision(site, d)]));
  const releases: StudioRelease[] = getReleases(site.id).filter((x) => x.templateId === tpl.id).sort((a, b) => b.number - a.number).map((x) => {
    const st = r.releases.find((y) => y.id === x.id);
    return { id: x.id, number: x.number, builtAt: x.builtAt, builtBy: x.builtBy, note: x.note, state: st?.state ?? "current", reasons: st?.reasons ?? [], manifestSha256: x.manifestSha256, items: x.items.map((i) => ({ requirementId: i.requirementId, name: REQ_BY_ID[i.requirementId]?.name ?? i.requirementId, revLabel: i.revLabel, revisionId: i.revisionId, fileName: i.fileName, sha256: i.sha256 })) };
  });

  return (
    <Page>
      <PageHeader eyebrow="Submission Studio" title="Prepare a verified submission"
        subtitle="Choose the submission, pick and order the approved documents, let Guardian verify the package against the real project state, then an authorized engineer signs off and the release engine seals it." />
      <SubmissionStudio
        key={site.id + tpl.id}
        site={{ id: site.id, name: site.name, stage: STAGES[stageIndex(site.stage)].label }}
        sites={sites.map((x) => ({ id: x.id, name: x.name }))}
        purposes={PACKAGE_TEMPLATES.map((t) => ({ templateId: t.id, label: pkgLabel(t.id, t.name), audience: t.audience, current: current.some((c) => c.id === t.id) }))}
        templateId={tpl.id} templateLabel={pkgLabel(tpl.id, tpl.name)} basis={tpl.basis}
        readiness={r} library={library} byRev={byRev} releases={releases}
        canSign={can(s, "release")} canVerify={can(s, "memory")} userName={s.name} isEngineer={s.engineer}
      />
      <SyntheticNote />
    </Page>
  );
}
