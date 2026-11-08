import ActionCenter, { type MemoryContext } from "@/components/memory/ActionCenter";
import { Page, PageHeader, Restricted } from "@/components/kit";
import { can, getSession } from "@/lib/auth";
import { selectedProvider } from "@/lib/extract";
import { pkgLabel } from "@/lib/labels";
import { latestApproved } from "@/lib/release";
import { DOCUMENT_TYPES, PACKAGE_TEMPLATES, REQ_BY_ID } from "@/lib/requirements";
import { getSites } from "@/lib/store";
import { findings } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default function Memory({ searchParams }: { searchParams: { project?: string; type?: string; item?: string } }) {
  const s = getSession();
  if (s.role !== "eqore") return <Restricted what="The Action Center" role={s.role} />;
  const sites = getSites();
  const project = sites.some((x) => x.id === searchParams.project) ? searchParams.project : undefined;
  const canManage = can(s, "memory");
  // Same view model as Ashish's /sites/[id]/memory page (MemoryItemView), so his MemoryItemCard is reused unchanged.
  const memory: MemoryContext = {
    sites: sites.map((site) => {
      const items = canManage ? site.memory ?? [] : [];
      return {
        siteId: site.id, siteName: site.name, communications: canManage ? (site.communications ?? []).length : 0,
        items: items.map((m) => {
          const a = m.requirementId ? latestApproved(site, m.requirementId) : undefined;
          return { ...m, documentName: m.requirementId ? REQ_BY_ID[m.requirementId]?.name : undefined, duplicateOfTitle: m.duplicateOfId ? items.find((x) => x.id === m.duplicateOfId)?.title : undefined, approvedRevision: a ? { id: a.id, revLabel: a.revLabel, uploadedAt: a.uploadedAt } : undefined };
        }),
      };
    }),
    packages: PACKAGE_TEMPLATES.map((t) => ({ id: t.id, name: pkgLabel(t.id, t.name) })),
    docTypes: DOCUMENT_TYPES.map((d) => ({ id: d.id, name: d.name })),
    canManage, isEngineer: s.engineer, provider: selectedProvider() === "openai" && process.env.OPENAI_API_KEY ? "OpenAI" : "deterministic rules", focusItem: searchParams.item,
  };
  const visible = findings(s).filter((f) => canManage || f.type !== "ahj_requirement");
  return (
    <Page>
      <PageHeader eyebrow="Project Guardian · Action Center" title="What are we forgetting?" subtitle="Every finding is computed from project records — missing documents, revisions awaiting engineers, cross-document conflicts, outdated packages and requirements from communications — and links to its original evidence." />
      {/* Keyed on the URL parameters: a finding's "Resolve →" link (same route, ?type=…&item=…) must remount with that tab and focus. */}
      <ActionCenter key={`${project ?? ""}|${searchParams.type ?? ""}|${searchParams.item ?? ""}`} findings={visible} projects={sites.map((x) => ({ id: x.id, name: x.name }))} initialProject={project} initialType={searchParams.type} memory={memory} />
    </Page>
  );
}
