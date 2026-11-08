// Submission Studio: select → verify → resolve → combined PDF release, plus access-policy enforcement.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { verifyReleaseSnapshot } from "@releaseos/release-core";
import type { Session } from "../lib/auth";
import { rulesExtract } from "../lib/extract";
import { parseEmailHeaders } from "../lib/memory/email";
import { confirmItem, recordCommunication, resolveItem, validateImport } from "../lib/memory/register";
import { rulesAnalyzeCommunication } from "../lib/memory/rules";
import { groundExtraction } from "../lib/ai/schema";
import { groundCommunication } from "../lib/memory/schema";
import { readTextLayer } from "../lib/pdf";
import { audiencesOf, canReleaseTo, canViewRevision } from "../lib/studio/access";
import { defaultGroups, pdfCharacteristics, PURPOSES, studioCheck } from "../lib/studio/check";
import { generateStudioRelease } from "../lib/studio/generate";
import { buildCombinedPdf } from "../lib/studio/pdf";
import { canDownloadRelease, canReadFile } from "../lib/studio/release-access";
import type { StudioSelection } from "../lib/studio/types";
import * as store from "../lib/store";

const PM: Session = { userId: "arivera", name: "A. Rivera", role: "eqore", engineer: false, roles: ["eqore"] };
const ENG: Session = { userId: "mchen", name: "M. Chen, PE", role: "eqore", engineer: true, roles: ["eqore", "engineer"] };
const ENG2: Session = { userId: "rpatel", name: "R. Patel, PE", role: "eqore", engineer: true, roles: ["eqore", "engineer"] };
const SUP: Session = { userId: "supplier", name: "Supplier", role: "supplier", engineer: false, roles: ["supplier"] };
const AHJ: Session = { userId: "ahj", name: "Holliston Fire Marshal", role: "ahj", engineer: false, roles: ["ahj"] };
const H = "S-1001";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const code = async (fn: () => unknown) => { try { await fn(); return 0; } catch (e) { return (e as { status?: number }).status ?? -1; } };
const check = (sel: StudioSelection) => studioCheck(store.getSite(H)!, store.getReleases(H), sel, store.bytesFor);
async function file(name: string, requirementId: string) {
  const bytes = readFileSync(`sample-docs/${name}`);
  const layer = await readTextLayer("application/pdf", bytes);
  const { fileId, sha256 } = store.putFile(name, "application/pdf", bytes);
  const ex = store.saveExtraction({ siteId: H, fileId, sha256, fileName: name, mediaType: "application/pdf", textLayer: layer.joined, pageCount: layer.pageCount, result: { ...rulesExtract(name, layer), provider: "rules", fallback: false }, impacts: {}, createdBy: PM.userId });
  return store.submitRevision(H, { extractionId: ex.id, requirementId }, PM);
}
async function pageTexts(bytes: Uint8Array) { return (await readTextLayer("application/pdf", Buffer.from(bytes))).pages; }
void groundExtraction;

test("access policy: separate visibility and release permission; defaults never authorize external release", () => {
  store.resetStore();
  const site = store.getSite(H)!;
  const proposal = site.documents.find((d) => d.requirementId === "proposal")!;
  const plan = site.documents.find((d) => d.requirementId === "plan_set" && d.revLabel === "B")!;
  const battery = site.documents.find((d) => d.requirementId === "battery_datasheet")!;
  assert.deepEqual(audiencesOf(ENG), ["eqore_staff", "engineer"]);
  assert.equal(canViewRevision(PM, site, proposal), true);
  assert.equal(canViewRevision(SUP, site, proposal), false, "supplier cannot see internal EQORE commercial documents");
  assert.equal(canViewRevision(SUP, site, plan), false, "plan set not shared with suppliers");
  assert.equal(canViewRevision(SUP, site, battery), true, "supplier datasheets are visible to suppliers");
  assert.equal(canViewRevision(AHJ, site, plan), true);
  assert.equal(canReadFile(SUP, plan.fileId!), false);
  assert.equal(canReadFile(SUP, battery.fileId!), true);
  assert.equal(canReleaseTo(site, "proposal", "ahj"), false);
  assert.equal(canReleaseTo(site, "plan_set", "ahj"), true);
  const other = store.getSites().find((x) => x.id !== "S-1001" && !x.accessPolicy)!; // CSV portfolio: any site without a policy
  assert.equal(canReleaseTo(other, "plan_set", "ahj"), false, "no policy → never externally releasable");
  assert.equal(other.documents.length ? canViewRevision(PM, other, other.documents[0]) : true, true);
});

test("Studio demo: select → verify (missing requirement + pending review) → resolve → combined PDFs → frozen release; R1 unchanged", async () => {
  store.resetStore();
  const site = store.getSite(H)!;
  const r1 = store.getReleases(H).find((r) => r.id === `${H}-ahj_permit-R1`)!;
  const r1Sha = r1.snapshot!.sha256, r1Zip = Buffer.from(store.releaseZip(r1.id).bytes);

  // 2–3. AHJ purpose, default selection in two groups, then manual reordering
  const ahj = PURPOSES.find((p) => p.id === "ahj")!;
  const groups = defaultGroups(site, ahj);
  assert.deepEqual(groups.map((g) => g.name), ["Plans and drawings", "Equipment documentation"]);
  let sel: StudioSelection = { purpose: "ahj", groups };
  let c = check(sel);
  assert.equal(c.canGenerate, true, JSON.stringify(c.blockers));

  // An internal document is refused for an external recipient (server-side check).
  const proposal = site.documents.find((d) => d.requirementId === "proposal")!;
  c = check({ ...sel, groups: [...groups, { id: "g-x", name: "Extra", revisionIds: [proposal.id] }] });
  assert.ok(c.blockers.some((b) => b.code === "NOT_AUTHORIZED_FOR_RECIPIENT" && b.revisionId === proposal.id));

  // 4–5. AHJ email → confirmed requirement (missing document) + switchgear Rev B pending review
  const body = readFileSync("sample-docs/SYNTHETIC_AHJ_Email_Ventilation.txt", "utf8");
  const h = parseEmailHeaders(body);
  const input = validateImport({ body, channel: "ahj_comment", sender: h.from, sentAt: h.date, subject: h.subject });
  const { items } = recordCommunication(H, input, { ...groundCommunication(rulesAnalyzeCommunication(body, { channel: input.channel, sender: input.sender }), body), engine: "rules", fallback: false }, PM);
  const req = items.find((i) => i.requirementId === "ventilation_plan")!;
  confirmItem(H, req.id, PM, { note: "Applies to the permit resubmission", blocking: true, templateIds: ["ahj_permit"] });
  const sw = await file("SYNTHETIC_Switchgear_Spec_RevB.pdf", "switchgear_datasheet");
  c = check(sel);
  assert.equal(c.canGenerate, false);
  assert.ok(c.blockers.some((b) => b.code === "MISSING_DOCUMENT" && b.requirementId === "ventilation_plan" && b.source?.kind === "project_memory"), "confirmed missing requirement");
  assert.ok(c.blockers.some((b) => b.code === "PENDING_REVIEW" && b.requirementId === "switchgear_datasheet"), "pending document review");
  await assert.rejects(generateStudioRelease(H, sel, ENG, "should be blocked", c.token), (e: { status: number }) => e.status === 409);

  // 6. Resolve through existing authorized workflows
  store.decideReview(sw.review.id, "approve", ENG, "Rev B 600 VAC confirmed (synthetic)");
  const planTask = site.engTasks!.find((t) => t.status === "open" && t.dependentRequirementId === "plan_set")!;
  const pc = await file("SYNTHETIC_Plan_Set_RevC.pdf", "plan_set");
  store.decideReview(pc.review.id, "approve", ENG2, "ESS-13.0 updated to 600 VAC NSG-4000 (synthetic)", [planTask.id]);
  const vent = await file("SYNTHETIC_Ventilation_Plan_RevA.pdf", "ventilation_plan");
  store.decideReview(vent.review.id, "approve", ENG, "Ventilation plan reviewed (synthetic)");
  resolveItem(H, req.id, ENG2, { note: "Rev A answers Fire comment 1" });
  c = check(sel);
  assert.ok(c.blockers.some((b) => b.code === "SELECTED_OUTDATED_VERSION" && b.requirementId === "switchgear_datasheet"), "old switchgear Rev A still selected");
  assert.ok(c.blockers.some((b) => b.code === "REQUIRED_NOT_SELECTED" && b.requirementId === "ventilation_plan"), "required ventilation plan not selected yet");

  // Update the selection: current revisions, ventilation plan in the plans group, custom order.
  const cur = (rid: string) => site.documents.filter((d) => d.requirementId === rid && d.status === "approved").sort((a, b) => b.version - a.version)[0].id;
  sel = { purpose: "ahj", groups: [
    { id: "g-plans", name: "Plans and drawings", revisionIds: [cur("plan_set"), cur("ventilation_plan")] },
    { id: "g-equipment", name: "Equipment documentation", revisionIds: [cur("switchgear_datasheet"), cur("inverter_datasheet"), cur("battery_datasheet"), cur("ul9540_listing"), cur("ul9540a_report"), cur("sds")] },
  ] };
  c = check(sel);
  assert.equal(c.canGenerate, true, JSON.stringify(c.blockers.map((b) => b.message)));
  assert.equal(await code(() => generateStudioRelease(H, sel, PM, "PM cannot sign", c.token)), 403);
  assert.equal(await code(() => generateStudioRelease(H, sel, ENG2, "stale", "0".repeat(64))), 409);

  // 7. Generate combined PDFs + release
  const { release, outputs } = await generateStudioRelease(H, sel, ENG2, "R2 AHJ resubmission: ventilation plan, switchgear Rev B, plan set Rev C", c.token);
  assert.equal(release.id, `${H}-ahj_permit-R2`);
  assert.deepEqual(release.items.map((i) => i.revisionId), sel.groups.flatMap((g) => g.revisionIds), "pinned in the selected order");

  // 8. Verify page counts, order, hashes, frozen metadata
  assert.equal(outputs.length, 2);
  for (let gi = 0; gi < outputs.length; gi++) {
    const o = outputs[gi];
    const f = store.getFile(o.fileId)!;
    assert.equal(sha(f.bytes), o.sha256);
    const pdf = await PDFDocument.load(f.bytes);
    const expected = o.coverPages + sel.groups[gi].revisionIds.reduce((n, id) => n + (store.findRevision(site, id)!.pageCount ?? 1), 0);
    assert.equal(pdf.getPageCount(), expected, `${o.name} page count`);
    assert.equal(o.pageCount, expected);
    assert.deepEqual(o.entries.map((e) => e.revisionId), sel.groups[gi].revisionIds, "file order");
    const texts = await pageTexts(f.bytes);
    const cover = texts.slice(0, o.coverPages).join("\n");
    for (const e of o.entries) {
      assert.ok(cover.includes(e.sourceSha256), `cover lists sha256 of ${e.fileName}`);
      assert.equal(e.sourceSha256, sha(store.bytesFor(store.findRevision(site, e.revisionId)!)), "entry hash = source bytes");
      const src = await pageTexts(store.bytesFor(store.findRevision(site, e.revisionId)!));
      assert.equal(texts[e.startPage - 1].trim(), src[0].trim(), `${e.fileName} first page at p.${e.startPage}`);
    }
    assert.ok(cover.indexOf(o.entries[0].fileName) < cover.indexOf(o.entries[o.entries.length - 1].fileName), "index order");
  }
  assert.equal(outputs[0].pageCount, 1 + 2 + 2); // cover + plan set Rev C (2) + ventilation plan (2)
  assert.equal(outputs[1].pageCount, 1 + 2 + 1 + 1 + 1 + 1 + 1);
  const snap = release.snapshot!;
  assert.ok(verifyReleaseSnapshot(snap));
  const st = store.studioOf(release)!;
  assert.equal(st.recipient, "ahj");
  assert.deepEqual(st.groups.map((g) => g.items.map((i) => i.revisionId)), sel.groups.map((g) => g.revisionIds));
  assert.ok(st.policyDecisions.every((d) => d.authorized && d.releaseTo.includes("ahj")));
  assert.deepEqual(st.outputs.map((o) => o.sha256), outputs.map((o) => o.sha256));
  // Originals preserved: release ZIP carries the untouched source bytes AND the combined PDFs.
  const zip = unzipSync(store.releaseZip(release.id).bytes);
  for (const m of snap.manifest) assert.equal(sha(zip[m.archivePath]), m.sha256);
  for (const o of outputs) assert.equal(sha(zip[`combined/${o.fileName}`]), o.sha256);

  // 9. Access: supplier cannot get internal documents or the AHJ package; the AHJ can receive its package; R1 stays EQORE-only.
  assert.equal(canDownloadRelease(SUP, release), false);
  assert.equal(canDownloadRelease(AHJ, release), true);
  assert.equal(canDownloadRelease(AHJ, r1), false, "seeded history has no frozen access decisions");
  assert.equal(canReadFile(SUP, outputs[0].fileId), false);

  // 10. Historical release unchanged
  assert.equal(store.getRelease(r1.id)!.snapshot!.sha256, r1Sha);
  assert.ok(Buffer.from(store.releaseZip(r1.id).bytes).equals(r1Zip));
});

test("combined PDF builder: slip sheet for non-PDF sources, multi-page index, characteristics detected", async () => {
  store.resetStore();
  const site = store.getSite(H)!;
  const proposal = site.documents.find((d) => d.requirementId === "proposal")!; // placeholder text bytes
  const plan = site.documents.find((d) => d.requirementId === "plan_set" && d.revLabel === "B")!;
  const docs = Array.from({ length: 14 }, (_, i) => (i % 2 ? { rev: proposal, name: "Proposal", bytes: store.bytesFor(proposal) } : { rev: plan, name: "Plan set", bytes: store.bytesFor(plan) }));
  const out = await buildCombinedPdf({ title: "Test", releaseId: "T-R1", siteLine: "x", recipientLabel: "AHJ", builtAt: new Date().toISOString(), builtBy: "test", groupName: "1 of 1", docs });
  assert.equal(out.coverPages, 2, "index spills to a second page");
  assert.equal(out.pageCount, 2 + 7 * 2 + 7 * 1);
  assert.equal(out.entries.filter((e) => e.rendering === "slip_sheet").length, 7);
  assert.ok(out.warnings.some((w) => /not a PDF/.test(w)));
  assert.equal((await PDFDocument.load(out.bytes)).getPageCount(), out.pageCount);
  const signed = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Sig /ByteRange [0 1 2 3] >> endobj\n2 0 obj << /AcroForm 3 0 R >> endobj\n");
  assert.deepEqual(pdfCharacteristics(signed).traits, ["digital signature", "interactive form fields"]);
  assert.equal(pdfCharacteristics(Buffer.from("%PDF-1.4 /Encrypt 5 0 R")).encrypted, true);
});
