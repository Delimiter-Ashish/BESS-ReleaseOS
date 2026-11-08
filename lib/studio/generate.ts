// Submission Studio generation: verify → build combined PDF(s) from approved bytes → store → seal the release.
// Shared by the API route and the tests so both exercise exactly the same path.
import type { Session } from "../auth";
import { bytesFor, commitStudioRelease, findRevision, getReleases, getSite, putFile, StoreError } from "../store";
import { RECIPIENT_LABEL } from "./access";
import { studioCheck } from "./check";
import { buildCombinedPdf } from "./pdf";
import type { CombinedPdfOutput, StudioSelection } from "./types";

const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "part";

export async function generateStudioRelease(siteId: string, sel: StudioSelection, session: Session, note: string | undefined, token: string | undefined) {
  if (!session.engineer) throw new StoreError(403, `${session.name} is not an authorized engineer`);
  const site = getSite(siteId);
  if (!site) throw new StoreError(404, "site not found");
  let check;
  try { check = studioCheck(site, getReleases(site.id), sel, bytesFor); } catch (e) { throw new StoreError(400, (e as Error).message); }
  if (!token || token !== check.token) throw new StoreError(409, "Selection, documents or access policy changed since the check — run the check again", { token: check.token });
  if (!check.canGenerate) throw new StoreError(409, `Blocked: ${check.blockers.map((x) => x.message).join("; ")}`, { blockers: check.blockers });
  const builtAt = new Date().toISOString();
  const groups = check.groups.filter((g) => g.documents.length);
  const outputs: CombinedPdfOutput[] = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const built = await buildCombinedPdf({
      title: `${check.purpose.name} - ${g.name}`, releaseId: check.nextReleaseId, siteLine: `${site.name}, ${site.address} (${site.id})`,
      recipientLabel: RECIPIENT_LABEL[check.purpose.recipient], builtAt, builtBy: session.name, groupName: `${i + 1} of ${groups.length}: ${g.name}`,
      docs: g.documents.map((d) => { const rev = findRevision(site, d.revisionId)!; return { rev, name: d.name, bytes: bytesFor(rev) }; }),
    });
    const fileName = `${check.nextReleaseId}_${i + 1}_${slug(g.name)}.pdf`;
    const { fileId } = putFile(fileName, "application/pdf", built.bytes);
    outputs.push({ groupId: g.id, name: g.name, fileName, fileId, sha256: built.sha256, pageCount: built.pageCount, coverPages: built.coverPages, entries: built.entries, warnings: built.warnings });
  }
  const release = commitStudioRelease(site.id, sel, session, note, token, builtAt, outputs);
  return { release, outputs };
}
