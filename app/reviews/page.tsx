import { Page, PageHeader, Restricted } from "@/components/kit";
import ReviewInbox from "@/components/reviews/ReviewInbox";
import { can, getSession } from "@/lib/auth";
import { getSites } from "@/lib/store";
import { reviewQueue } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default function Reviews({ searchParams }: { searchParams: { item?: string; project?: string; status?: string; kind?: string } }) {
  const s = getSession();
  if (s.role !== "eqore") return <Restricted what="Engineering review" role={s.role} />;
  const items = reviewQueue(s);
  const status = searchParams.status === "all" || searchParams.status === "closed" ? searchParams.status : undefined;
  return (
    <Page>
      <PageHeader eyebrow={s.engineer ? "Engineering" : "Engineer Reviews (read-only)"}
        title={searchParams.kind === "dependency" ? "Dependency impacts" : searchParams.kind === "revision" ? "Revision comparisons" : s.engineer ? "Assigned reviews" : "Engineering review queue"}
        subtitle={s.engineer
          ? "Every revision awaiting approval and every dependency or cross-document review, across your projects. Inspect the original evidence, compare revisions, then approve or reject — one document at a time, with a required note. Other items stay pending and never block new uploads."
          : "Only an authorized engineer can approve or reject. You can inspect evidence here; the server refuses approvals from other identities."} />
      <ReviewInbox items={items} canReview={can(s, "review")} userName={s.name} initialItem={searchParams.item} initialProject={searchParams.project} initialStatus={status} initialKind={searchParams.kind === "dependency" || searchParams.kind === "revision" ? searchParams.kind : undefined} projects={getSites().map((x) => ({ id: x.id, name: x.name }))} />
    </Page>
  );
}
