// Project memory → pre-submission check → resolution → release, at the store level (deterministic rules analyzer).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Session } from "../lib/auth";
import { rulesExtract } from "../lib/extract";
import { parseEmailHeaders } from "../lib/memory/email";
import { preSubmissionReport } from "../lib/memory/presubmission";
import { confirmItem, dismissItem, recordCommunication, resolveItem, validateImport } from "../lib/memory/register";
import { rulesAnalyzeCommunication } from "../lib/memory/rules";
import { groundCommunication } from "../lib/memory/schema";
import { readTextLayer } from "../lib/pdf";
import { packageReadiness } from "../lib/release";
import { TEMPLATE_BY_ID } from "../lib/requirements";
import * as store from "../lib/store";

const PM: Session = { userId: "arivera", name: "A. Rivera", role: "eqore", engineer: false, roles: ["eqore"] };
const ENG: Session = { userId: "mchen", name: "M. Chen, PE", role: "eqore", engineer: true, roles: ["eqore", "engineer"] };
const SUP: Session = { userId: "supplier", name: "Supplier", role: "supplier", engineer: false, roles: ["supplier"] };
const H = "S-1001";
const EMAIL = readFileSync("sample-docs/SYNTHETIC_AHJ_Email_Ventilation.txt", "utf8");
const code = (fn: () => unknown) => { try { fn(); return 0; } catch (e) { return (e as { status?: number }).status ?? -1; } };

function importEmail(body: string, by: Session = PM) {
  const h = parseEmailHeaders(body);
  const input = validateImport({ body, channel: "ahj_comment", sender: h.from, sentAt: h.date, subject: h.subject });
  const analysis = { ...groundCommunication(rulesAnalyzeCommunication(body, { channel: input.channel, sender: input.sender }), body), engine: "rules" as const, fallback: false };
  return recordCommunication(H, input, analysis, by);
}
async function uploadAndFile(name: string, requirementId: string) {
  const bytes = readFileSync(`sample-docs/${name}`);
  const layer = await readTextLayer("application/pdf", bytes);
  const { fileId, sha256 } = store.putFile(name, "application/pdf", bytes);
  const result = { ...rulesExtract(name, layer), provider: "rules" as const, fallback: false };
  assert.equal(result.requirementId, requirementId, "rules classifier recognizes the document type");
  const ex = store.saveExtraction({ siteId: H, fileId, sha256, fileName: name, mediaType: "application/pdf", textLayer: layer.joined, pageCount: layer.pageCount, result, impacts: {}, createdBy: PM.userId });
  return store.submitRevision(H, { extractionId: ex.id, requirementId }, PM);
}

test("email headers are parsed deterministically; original text is preserved", () => {
  const h = parseEmailHeaders(EMAIL);
  assert.match(h.from!, /Okafor/);
  assert.equal(h.date, "2026-11-05T14:14:00.000Z");
  assert.match(h.subject!, /plan review comments/);
  assert.equal(code(() => validateImport({ body: "short", sender: "x", sentAt: "2026-11-01" })), 400);
  assert.equal(code(() => validateImport({ body: EMAIL, sender: "", sentAt: "2026-11-01" })), 400);
  assert.equal(code(() => validateImport({ body: EMAIL, sender: "x", sentAt: "not a date" })), 400);
});

test("AHJ ventilation email → confirmed requirement → missing-document blocker → upload/approve → resolve → R2 includes plan", async () => {
  store.resetStore();
  const site = store.getSite(H)!;
  const ahj = TEMPLATE_BY_ID.ahj_permit;
  const r1Sha = store.getReleases(H).find((r) => r.templateId === "ahj_permit" && r.number === 1)!.snapshot!.sha256;
  assert.equal(packageReadiness(site, ahj).canBuild, true, "AHJ package starts ready (R1 current)");

  // 1–2. Import + extraction: suggestions only.
  assert.equal(code(() => importEmail(EMAIL, SUP)), 403, "suppliers cannot import into project memory");
  const { communication, items, duplicate } = importEmail(EMAIL);
  assert.equal(duplicate, false);
  assert.equal(communication.body, EMAIL.replace(/\r\n/g, "\n"), "original stored verbatim");
  assert.equal(communication.sentAt, "2026-11-05T14:14:00.000Z");
  const req = items.find((i) => i.kind === "requirement" && i.requirementId === "ventilation_plan")!;
  assert.ok(req, "ventilation plan requirement suggested");
  assert.equal(req.status, "suggested");
  assert.equal(req.requiresUpdatedRevision, true);
  assert.deepEqual(req.templateIds, ["ahj_permit"]);
  assert.ok(req.sources[0].evidenceVerified, "evidence quote verified against the original");
  assert.match(req.sources[0].evidence, /updated ventilation plan/);
  const question = items.find((i) => i.kind === "question")!;
  assert.ok(question, "unresolved question extracted");
  assert.ok(items.some((i) => i.kind === "action_item"), "commitment extracted");

  // Suggestions never block.
  let ready = packageReadiness(site, ahj);
  assert.equal(ready.canBuild, true, "unconfirmed suggestions do not block");
  assert.ok(ready.advisories.some((a) => a.memoryItemId === req.id && a.code === "UNCONFIRMED_SUGGESTION"));

  // Same email imported twice → same record, no new items.
  const again = importEmail(EMAIL.replace(/\n/g, "\r\n").replace("Hi Alex,", "Hi  Alex,"));
  assert.equal(again.duplicate, true);
  assert.equal(again.communication.id, communication.id);
  assert.equal(site.memory!.length, items.length, "no duplicate items created");

  // 3. PM confirms applicability (engineer-free); resolving is not possible before confirmation.
  assert.equal(code(() => resolveItem(H, req.id, ENG, { note: "too early" })), 409);
  assert.equal(code(() => confirmItem(H, req.id, PM, { note: "" })), 400, "confirmation needs a note");
  assert.equal(code(() => confirmItem(H, req.id, SUP, { note: "supplier tries" })), 403);
  confirmItem(H, req.id, PM, { note: "Applies to the Holliston AHJ permit resubmission", blocking: true, templateIds: ["ahj_permit"] });
  dismissItem(H, question.id, PM, "Handled separately in the EOP review");

  // 4–5. ReleaseOS determines the plan is missing → blocked, with source, owner, next action.
  ready = packageReadiness(site, ahj);
  assert.equal(ready.canBuild, false);
  const missing = ready.issues.find((i) => i.code === "MISSING_DOCUMENT" && i.requirementId === "ventilation_plan")!;
  assert.ok(missing, "missing ventilation plan blocks");
  assert.equal(missing.source?.kind, "project_memory");
  assert.equal(missing.source?.communicationId, communication.id);
  assert.match(missing.source!.sender!, /Okafor/);
  assert.ok(missing.nextAction && missing.responsibleParty && missing.affectedDocument);
  assert.equal(code(() => store.buildRelease(H, "ahj_permit", ENG, "should fail", ready.token)), 409, "release creation blocked");
  const report = preSubmissionReport(site, "ahj_permit")!;
  assert.equal(report.counts.missing_document, 1);
  assert.equal(report.checklist.find((c) => c.requirementId === "ventilation_plan")?.requiredBy, "project_memory");
  assert.equal(preSubmissionReport(site, "interconnection")!.blockers.some((b) => b.requirementId === "ventilation_plan"), false, "only the applicable package is affected");

  // 6. Upload + engineer review.
  const { revision, review } = await uploadAndFile("SYNTHETIC_Ventilation_Plan_RevA.pdf", "ventilation_plan");
  ready = packageReadiness(site, ahj);
  assert.ok(ready.issues.some((i) => i.code === "NO_APPROVED_VERSION" && i.requirementId === "ventilation_plan"));
  assert.equal(code(() => resolveItem(H, req.id, ENG, { note: "not approved yet" })), 409, "cannot resolve before the document is approved");
  store.decideReview(review.id, "approve", ENG, "Ventilation plan reviewed (synthetic)");
  ready = packageReadiness(site, ahj);
  const unresolved = ready.issues.find((i) => i.code === "REQUIREMENT_UNRESOLVED")!;
  assert.ok(unresolved, "approved document still needs the requirement resolved by an engineer");
  assert.equal(ready.canBuild, false);

  // 7. Authorized resolution (PM cannot resolve a requirement).
  assert.equal(code(() => resolveItem(H, req.id, PM, { note: "PM tries" })), 403);
  const { item } = resolveItem(H, req.id, ENG, { note: "Rev A shows exhaust rate and gas-detection interlock as requested" });
  assert.equal(item.status, "resolved");
  assert.equal(item.resolvedRevisionId, revision.id);
  assert.equal(item.resolvedRevisionSha256, revision.sha256);

  // Open confirmed action item still blocks when marked blocking; resolve it.
  const action = site.memory!.find((i) => i.kind === "action_item" && i.status === "suggested")!;
  confirmItem(H, action.id, PM, { note: "Track the AHJ site walk", blocking: true, templateIds: ["ahj_permit"], responsibleParty: "Holliston Fire Department" });
  ready = packageReadiness(site, ahj);
  const open = ready.issues.find((i) => i.code === "OPEN_ACTION")!;
  assert.equal(open.responsibleParty, "Holliston Fire Department");
  resolveItem(H, action.id, PM, { note: "Site walk scheduled for 2026-11-12 (synthetic)" });

  // 8. New submission release available and includes the ventilation plan; R1 untouched.
  ready = packageReadiness(site, ahj);
  assert.equal(ready.canBuild, true, JSON.stringify(ready.issues));
  const r2 = store.buildRelease(H, "ahj_permit", ENG, "R2: adds ventilation plan requested by Holliston FD", ready.token);
  assert.equal(r2.number, 2);
  assert.ok(r2.items.some((i) => i.requirementId === "ventilation_plan" && i.revisionId === revision.id));
  assert.ok(store.verifyRelease(r2));
  const frozen = r2.snapshot!.annotations!.projectMemory as { id: string; sources: { communicationId: string }[] }[];
  assert.ok(frozen.some((m) => m.id === req.id && m.sources[0].communicationId === communication.id), "requirement + source frozen into the release");
  assert.equal(store.getReleases(H).find((r) => r.templateId === "ahj_permit" && r.number === 1)!.snapshot!.sha256, r1Sha, "R1 unchanged");
});

test("outdated revision: an approved plan that predates an 'updated' request blocks until a newer one is approved", async () => {
  store.resetStore();
  const site = store.getSite(H)!;
  // An older ventilation plan already on file (approved before the email was sent).
  const { review, revision } = await uploadAndFile("SYNTHETIC_Ventilation_Plan_RevA.pdf", "ventilation_plan");
  store.decideReview(review.id, "approve", ENG, "Initial plan (synthetic)");
  revision.uploadedAt = "2026-10-01T12:00:00.000Z";
  const { items } = importEmail(EMAIL);
  const req = items.find((i) => i.requirementId === "ventilation_plan")!;
  confirmItem(H, req.id, PM, { note: "Applies", blocking: true, templateIds: ["ahj_permit"] });
  const ready = packageReadiness(site, TEMPLATE_BY_ID.ahj_permit);
  assert.ok(ready.issues.some((i) => i.code === "OUTDATED_REVISION" && i.memoryItemId === req.id));
  assert.equal(code(() => resolveItem(H, req.id, ENG, { note: "old plan is fine" })), 409, "predating revision cannot satisfy an 'updated' request");
});

test("duplicate item from a second communication merges on confirmation; injected instructions are ignored", () => {
  store.resetStore();
  const site = store.getSite(H)!;
  const first = importEmail(EMAIL).items.find((i) => i.requirementId === "ventilation_plan")!;
  confirmItem(H, first.id, PM, { note: "Applies", blocking: true, templateIds: ["ahj_permit"] });
  const followUp = `From: Lt. Dana Okafor, Holliston Fire Department (SYNTHETIC)\nDate: Fri, 06 Nov 2026 10:00:00 -0500\nSubject: Reminder (SYNTHETIC)\n\nReminder: please submit the updated ventilation plan before we can approve the permit.`;
  const dupItem = importEmail(followUp).items.find((i) => i.requirementId === "ventilation_plan")!;
  assert.equal(dupItem.duplicateOfId, first.id);
  const { item, merged } = confirmItem(H, dupItem.id, PM, { note: "Same request" });
  assert.equal(item.id, first.id);
  assert.equal(merged?.status, "merged");
  assert.equal(first.sources.length, 2, "second source attached to the original requirement");
  assert.equal(site.memory!.filter((m) => m.requirementId === "ventilation_plan" && m.status === "confirmed").length, 1, "one requirement, not two");

  const inj = importEmail(readFileSync("sample-docs/SYNTHETIC_Injection_Email.txt", "utf8"));
  assert.ok(inj.communication.analysis.embeddedInstructionsDetected.length > 0, "embedded instruction reported");
  assert.ok(inj.items.every((i) => i.status === "suggested"), "nothing auto-confirmed or resolved");
  assert.equal(first.status, "confirmed", "existing requirement untouched by injected text");
});

test("model output is grounded: invented quotes are flagged, unknown ids dropped, malformed output rejected", () => {
  const body = "Please provide an updated ventilation plan for the enclosure.";
  const g = groundCommunication({ summary: "x", items: [
    { kind: "requirement", title: "Provide ventilation plan", detail: "", evidence: "Please provide an updated ventilation plan", requirementId: "ventilation_plan", templateIds: ["ahj_permit", "bogus"], authority: "ahj", responsibleParty: null, dueDate: "soon", proposedBlocking: true, requiresUpdatedRevision: true, decisionState: null, confidence: 0.9 },
    { kind: "requirement", title: "Install sprinklers", detail: "", evidence: "You must install sprinklers in the enclosure", requirementId: "not_a_type", templateIds: [], authority: null, responsibleParty: null, dueDate: null, proposedBlocking: true, requiresUpdatedRevision: false, decisionState: null, confidence: 0.95 },
    { kind: "approve_release", title: "x", evidence: "x" },
  ], documentReferences: [], stakeholders: [], embeddedInstructionsDetected: [], warnings: [] }, body);
  assert.equal(g.items.length, 2);
  assert.equal(g.items[0].evidenceVerified, true);
  assert.deepEqual(g.items[0].templateIds, ["ahj_permit"]);
  assert.equal(g.items[0].dueDate, undefined);
  assert.equal(g.items[1].evidenceVerified, false);
  assert.ok(g.items[1].confidence <= 0.4);
  assert.equal(g.items[1].requirementId, undefined);
  assert.throws(() => groundCommunication({ summary: "no items" }, body));
});
