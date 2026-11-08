import GuardianWorkspace from "@/components/guardian/GuardianWorkspace";
import type { ReleaseOption } from "@/components/guardian/TimeMachine";
import { Page, PageHeader, SyntheticNote, Restricted } from "@/components/kit";
import { can, getSession } from "@/lib/auth";
import { pkgLabel } from "@/lib/labels";
import { PACKAGE_TEMPLATES, REQ_BY_ID } from "@/lib/requirements";
import { getReleases, getSites } from "@/lib/store";
import { evidenceForRevision, readiness, relevantTemplates, type EvidenceRef } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default function GuardianPage({ searchParams }: { searchParams: { project?: string; template?: string; tab?: string; run?: string; focus?: string; release?: string } }) {
  const s = getSession();
  if (s.role !== "eqore") return <Restricted what="Project Guardian" role={s.role} />;
  const sites = getSites();
  const site = sites.find((x) => x.id === searchParams.project) ?? sites.find((x) => x.id === "S-1001")!;
  const current = relevantTemplates(site);
  const tpl = PACKAGE_TEMPLATES.find((t) => t.id === searchParams.template) ?? current[0] ?? PACKAGE_TEMPLATES[0];
  const r = readiness(site.id, tpl.id)!;
  const byRev: Record<string, EvidenceRef> = Object.fromEntries(site.documents.map((d) => [d.id, evidenceForRevision(site, d)]));
  const releases: ReleaseOption[] = getReleases(site.id).slice().sort((a, b) => (a.builtAt < b.builtAt ? 1 : -1)).map((x) => ({
    id: x.id, number: x.number, builtAt: x.builtAt, builtBy: x.builtBy, templateId: x.templateId, templateLabel: pkgLabel(x.templateId),
    items: x.items.map((i) => ({ requirementId: i.requirementId, name: REQ_BY_ID[i.requirementId]?.name ?? i.requirementId, revLabel: i.revLabel, fileName: i.fileName, revisionId: i.revisionId })),
  }));
  const tab = searchParams.tab === "graph" || searchParams.tab === "time" ? searchParams.tab : "scan";
  return (
    <Page>
      <PageHeader eyebrow="Project Guardian" title="Before we proceed, what are we forgetting?"
        subtitle="Guardian runs the release gate and the cross-document checks on the real project record — documents, revisions, engineering reviews and confirmed requirements from communications. AI may suggest; people confirm; engineers approve." />
      <GuardianWorkspace
        site={{ id: site.id, name: site.name }} sites={sites.map((x) => ({ id: x.id, name: x.name }))}
        templates={PACKAGE_TEMPLATES.map((t) => ({ id: t.id, label: pkgLabel(t.id, t.name), current: current.some((c) => c.id === t.id) }))}
        templateId={tpl.id} templateLabel={pkgLabel(tpl.id, tpl.name)}
        docs={r.items.map((i) => ({ requirementId: i.requirementId, name: i.name, state: i.state, revLabel: i.approved?.revLabel ?? i.pending?.revLabel, pendingLabel: i.approved && i.pending ? i.pending.revLabel : undefined, fileName: i.approved?.fileName, revisionId: i.approved?.id }))}
        byRev={byRev} releases={releases} canRun={can(s, "memory")}
        initialTab={tab} autoRun={searchParams.run === "1"} initialFocus={searchParams.focus} initialRelease={searchParams.release}
      />
      <SyntheticNote />
    </Page>
  );
}
