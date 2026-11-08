// Store-level end-to-end: the full revision → review → release workflow, without HTTP.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { unzipSync } from "fflate";
import { createHash } from "node:crypto";
import type { Session } from "../lib/auth";
import { rulesExtract } from "../lib/extract";
import { readTextLayer } from "../lib/pdf";
import { compareSnapshots, packageReadiness } from "../lib/release";
import { TEMPLATE_BY_ID } from "../lib/requirements";
import * as store from "../lib/store";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const PM: Session = { userId: "arivera", name: "A. Rivera", role: "eqore", engineer: false, roles: ["eqore"] };
const ENG: Session = { userId: "mchen", name: "M. Chen, PE", role: "eqore", engineer: true, roles: ["eqore", "engineer"] };
const ENG2: Session = { userId: "rpatel", name: "R. Patel, PE", role: "eqore", engineer: true, roles: ["eqore", "engineer"] };
const H = "S-1001";

async function upload(name: string, by: Session) {
  const bytes = readFileSync(`sample-docs/${name}`);
  const layer = await readTextLayer("application/pdf", bytes);
  const { fileId, sha256 } = store.putFile(name, "application/pdf", bytes);
  const result = { ...rulesExtract(name, layer), provider: "rules" as const, fallback: false };
  return store.saveExtraction({ siteId: H, fileId, sha256, fileName: name, mediaType: "application/pdf", textLayer: layer.joined, pageCount: layer.pageCount, result, impacts: {}, createdBy: by.userId });
}
const code = (fn: () => unknown) => { try { fn(); return 0; } catch (e) { return (e as { status?: number }).status ?? -1; } };

test("480 V → 600 V revision: detected, blocks release, resolved by authorized engineers, R2 built, R1 unchanged", async () => {
  store.resetStore();
  const site = store.getSite(H)!;
  const r1 = store.getReleases(H).find((r) => r.number === 1)!;
  assert.ok(store.verifyRelease(r1), "seeded R1 is a sealed, verifiable snapshot");
  const r1Sha = r1.snapshot!.sha256;
  const r1Zip = store.releaseZip(r1.id);
  const r1Switch = r1.items.find((i) => i.requirementId === "switchgear_datasheet")!;
  assert.equal(r1Switch.fileName, "SYNTHETIC_Switchgear_Spec_RevA.pdf");

  // Missing-document example: hero interconnection package is blocked by the absent utility bill.
  const ix = packageReadiness(site, TEMPLATE_BY_ID.interconnection);
  assert.ok(ix.issues.some((i) => i.code === "MISSING_DOCUMENT" && i.requirementId === "utility_bill"));

  // Upload Rev B as the PM.
  const ex = await upload("SYNTHETIC_Switchgear_Spec_RevB.pdf", PM);
  assert.equal(code(() => store.submitRevision(H, { extractionId: ex.id, requirementId: "switchgear_datasheet" }, ENG)), 403, "only the uploader can file their extraction");
  const { revision, review, engineeringTasks } = store.submitRevision(H, { extractionId: ex.id, requirementId: "switchgear_datasheet" }, PM);
  assert.equal(revision.revLabel, "B");
  assert.equal(revision.status, "in_review");
  const volt = review.changes.find((c) => c.key === "rating.voltage_v")!;
  assert.equal(volt.significance, "material");
  assert.equal(volt.before, "480 VAC");
  assert.equal(volt.after, "600 VAC");
  assert.equal(volt.pageAfter, 2);
  assert.match(volt.evidenceAfter!, /600 VAC/);
  assert.equal(review.materialChangeCount, 1);
  const deps = engineeringTasks.map((t) => t.dependentRequirementId).sort();
  assert.deepEqual(deps, ["ix_application", "plan_set"]);
  assert.ok(review.potentiallyAffectedMissing?.includes("signage"));

  // Release blocked while material revision + dependency review are unresolved.
  const ahj = TEMPLATE_BY_ID.ahj_permit;
  let ready = packageReadiness(site, ahj);
  assert.equal(ready.canBuild, false);
  assert.ok(ready.issues.some((i) => i.code === "PENDING_REVIEW"));
  assert.ok(ready.issues.some((i) => i.code === "CHANGED_SOURCE"));
  assert.equal(code(() => store.buildRelease(H, "ahj_permit", ENG, "try", ready.token)), 409);

  // Unauthorized / invalid actions are rejected.
  assert.equal(code(() => store.decideReview(review.id, "approve", PM, "looks fine")), 403, "non-engineer cannot approve");
  assert.equal(code(() => store.buildRelease(H, "ahj_permit", PM, "x", ready.token)), 403, "non-engineer cannot release");
  assert.equal(code(() => store.decideReview(review.id, "approve", ENG, "")), 400, "note required");
  const planTask = engineeringTasks.find((t) => t.dependentRequirementId === "plan_set")!;
  assert.equal(code(() => store.resolveEngineeringTask(H, planTask.id, ENG, "plan ok")), 409, "source must be approved first");

  // Approve the revision (engineer, recorded).
  const dec = store.decideReview(review.id, "approve", ENG, "Verified 600 VAC rating with supplier submittal");
  assert.equal(dec.decision.reviewerId, "mchen");
  assert.equal(dec.revision.status, "approved");
  ready = packageReadiness(site, ahj);
  assert.equal(ready.canBuild, false, "approving the source does not clear dependent reviews");
  assert.deepEqual(ready.issues.map((i) => i.code), ["CHANGED_SOURCE"]);

  // Resolve the plan-set dependency review.
  store.resolveEngineeringTask(H, planTask.id, ENG2, "ESS-13.0 conductors and OCPD are 600 V rated; plan set remains valid (synthetic)");
  ready = packageReadiness(site, ahj);
  assert.equal(ready.canBuild, true);
  assert.equal(code(() => store.buildRelease(H, "ahj_permit", ENG, "R2 build", "stale-token")), 409, "stale readiness token rejected");

  const r2 = store.buildRelease(H, "ahj_permit", ENG2, "Rev B switchgear (600 VAC) approved; plan set confirmed", ready.token);
  assert.equal(r2.number, 2);
  assert.ok(store.verifyRelease(r2));
  assert.equal(r2.items.find((i) => i.requirementId === "switchgear_datasheet")!.revLabel, "B");

  // R2 ZIP: every document's bytes match the frozen manifest hashes.
  const zip = store.releaseZip(r2.id);
  const files = unzipSync(zip.bytes);
  for (const m of r2.snapshot!.manifest) assert.equal(sha(files[m.archivePath]), m.sha256);
  assert.ok(files["MANIFEST.json"] && files["INDEX.txt"] && files["snapshot.json"]);

  // R1 unchanged: same snapshot hash, byte-identical ZIP, still pins Rev A.
  const r1After = store.getRelease(r1.id)!;
  assert.equal(r1After.snapshot!.sha256, r1Sha);
  assert.ok(store.verifyRelease(r1After));
  assert.deepEqual(Buffer.from(store.releaseZip(r1.id).bytes), Buffer.from(r1Zip.bytes));
  assert.equal(r1After.items.find((i) => i.requirementId === "switchgear_datasheet")!.revLabel, "A");

  // Historical comparison from frozen snapshots.
  const cmp = compareSnapshots(r1After, r2);
  assert.equal(cmp.core!.updated.length, 1);
  const sw = cmp.docs.find((d) => d.requirementId === "switchgear_datasheet")!;
  assert.ok(sw.changed);
  assert.equal(sw.factChanges.find((c) => c.key === "rating.voltage_v")?.after, "600 VAC");
  assert.deepEqual(cmp.core!.updated[0].semanticChanges.find((c) => c.field === "voltageV")?.newValue, [600]);

  // Audit trail recorded server-side identities.
  const kinds = store.getDecisions(H).filter((d) => !d.seeded).map((d) => `${d.kind}:${d.reviewerId}`);
  assert.deepEqual(kinds, ["revision_review:mchen", "dependency_resolution:rpatel", "release_signoff:rpatel"]);
});

test("self-approval blocked; rejection supersedes dependency tasks; duplicate upload rejected", async () => {
  store.resetStore();
  const ex = await upload("SYNTHETIC_Switchgear_Spec_RevB.pdf", ENG);
  const { review, engineeringTasks } = store.submitRevision(H, { extractionId: ex.id, requirementId: "switchgear_datasheet" }, ENG);
  assert.equal(code(() => store.decideReview(review.id, "approve", ENG, "self")), 403);
  store.decideReview(review.id, "reject", ENG2, "Voltage change not authorized by utility");
  const site = store.getSite(H)!;
  for (const t of engineeringTasks) assert.equal(site.engTasks!.find((x) => x.id === t.id)!.status, "superseded");
  assert.equal(packageReadiness(site, TEMPLATE_BY_ID.ahj_permit).canBuild, true, "rejected revision no longer blocks; Rev A remains approved");
  const again = await upload("SYNTHETIC_Switchgear_Spec_RevB.pdf", ENG);
  assert.equal(code(() => store.submitRevision(H, { extractionId: again.id, requirementId: "switchgear_datasheet" }, ENG)), 409);
});

test("dependent re-issue path: plan set Rev C approval resolves its dependency task", async () => {
  store.resetStore();
  const ex = await upload("SYNTHETIC_Switchgear_Spec_RevB.pdf", PM);
  const { review, engineeringTasks } = store.submitRevision(H, { extractionId: ex.id, requirementId: "switchgear_datasheet" }, PM);
  store.decideReview(review.id, "approve", ENG, "ok 600 VAC");
  const planTask = engineeringTasks.find((t) => t.dependentRequirementId === "plan_set")!;
  const exC = await upload("SYNTHETIC_Plan_Set_RevC.pdf", PM);
  assert.equal(exC.result.requirementId, "plan_set");
  const c = store.submitRevision(H, { extractionId: exC.id, requirementId: "plan_set" }, PM);
  assert.equal(c.revision.revLabel, "C");
  assert.equal(c.review.changes.find((x) => x.key === "rating.voltage_v")?.after, "600 VAC");
  store.decideReview(c.review.id, "approve", ENG2, "Plan set Rev C updates ESS-13.0 for 600 VAC", [planTask.id]);
  const site = store.getSite(H)!;
  assert.equal(site.engTasks!.find((t) => t.id === planTask.id)!.resolution, "new_revision_approved");
  assert.equal(packageReadiness(site, TEMPLATE_BY_ID.ahj_permit).canBuild, true);
});
