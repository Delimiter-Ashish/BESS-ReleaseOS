// Lifecycle assurance: register, deterministic due dates (site-local), change → impact → engineer review,
// maintenance events with reviewed evidence, stakeholder access, explicit emergency publication, release immutability.
// Frozen clock: RELEASEOS_CLOCK pins "now" to 2026-11-07 15:00Z. Store modules are imported AFTER setting it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Session } from "../lib/auth";

process.env.RELEASEOS_CLOCK = "2026-11-07T15:00:00Z";
const H = "S-1001";
const PM: Session = { userId: "arivera", name: "A. Rivera", role: "eqore", engineer: false, roles: ["eqore"] };
const ENG: Session = { userId: "mchen", name: "M. Chen, PE", role: "eqore", engineer: true, roles: ["eqore", "engineer"] };
const ENG2: Session = { userId: "rpatel", name: "R. Patel, PE", role: "eqore", engineer: true, roles: ["eqore", "engineer"] };
const FAC: Session = { userId: "facility", name: "Facility staff", role: "facility", engineer: false, roles: ["facility"] };
const SUP: Session = { userId: "supplier", name: "Supplier", role: "supplier", engineer: false, roles: ["supplier"] };
const AHJ: Session = { userId: "ahj", name: "Holliston Fire Marshal", role: "ahj", engineer: false, roles: ["ahj"] };
const code = async (fn: () => unknown) => { try { await fn(); return 0; } catch (e) { return (e as { status?: number }).status ?? -1; } };

async function mods() {
  const store = await import("../lib/store");
  const ops = await import("../lib/lifecycle/ops");
  const status = await import("../lib/lifecycle/status");
  const clock = await import("../lib/lifecycle/clock");
  const { readTextLayer } = await import("../lib/pdf");
  const { rulesExtract } = await import("../lib/extract");
  async function upload(name: string, requirementId: string, effectiveDate?: string) {
    const bytes = readFileSync(`sample-docs/${name}`);
    const layer = await readTextLayer("application/pdf", bytes);
    const { fileId, sha256 } = store.putFile(name, "application/pdf", bytes);
    const ex = store.saveExtraction({ siteId: H, fileId, sha256, fileName: name, mediaType: "application/pdf", textLayer: layer.joined, pageCount: layer.pageCount, result: { ...rulesExtract(name, layer), provider: "rules", fallback: false }, impacts: {}, createdBy: PM.userId });
    return store.submitRevision(H, { extractionId: ex.id, requirementId, effectiveDate }, PM);
  }
  const act = (a: Parameters<typeof ops.lifecycleAction>[1], s: Session) => ops.lifecycleAction(H, a, s);
  const view = (asOf: string, s: Session = PM) => { const site = store.getSite(H)!; return status.lifecycleView(site, site.lifecycle!, asOf, "frozen", s); };
  const ob = (asOf: string, pred: (o: ReturnType<typeof view>["obligations"][number]) => boolean, s: Session = PM) => view(asOf, s).obligations.find(pred);
  return { store, ops, status, clock, upload, act, view, ob };
}

test("clock: site-local calendar dates, day arithmetic, asOf parsing", async () => {
  const { clock } = await mods();
  assert.equal(clock.clockNow().toISOString().slice(0, 10), "2026-11-07", "frozen clock");
  assert.equal(clock.localDate("2026-11-13T03:00:00Z", "America/New_York"), "2026-11-12", "22:00 EST is still the 12th");
  assert.equal(clock.localDate("2026-11-13T05:30:00Z", "America/New_York"), "2026-11-13");
  assert.equal(clock.localDate("2026-11-13T07:30:00Z", "America/Los_Angeles"), "2026-11-12");
  assert.equal(clock.dayDiff("2026-11-07", "2026-11-12"), 5);
  assert.equal(clock.dayDiff("2026-11-13", "2026-11-12"), -1);
  assert.equal(clock.dayDiff("2026-10-31", "2026-11-02"), 2, "DST change does not skew whole-day arithmetic");
  assert.equal(clock.parseAsOf("2026-11-13T03:00:00Z", "America/New_York"), "2026-11-12");
  assert.equal(clock.parseAsOf("2026-02-30", "America/New_York"), null, "invalid calendar date rejected");
  assert.equal(clock.isDate("2026-02-29"), false);
});

test("register, stage applicability, deterministic due dates, maintenance evidence workflow", async () => {
  const { store, upload, act, view, ob } = await mods();
  store.resetStore();
  const site = store.getSite(H)!;
  const r1 = store.getRelease(`${H}-ahj_permit-R1`)!;
  const r1Sha = r1.snapshot!.sha256;

  // Register from the README model; no due dates anywhere by default (no invented NFPA deadlines).
  const lc = site.lifecycle!;
  assert.ok(lc.obligations.length >= 19 && lc.obligations.every((o) => !o.due && o.source.kind === "eqore_readme_table" && o.source.citation));
  const v0 = view("2026-11-07");
  assert.equal(v0.stage, "permitting");
  assert.equal(ob("2026-11-07", (o) => o.requirementId === "eop")!.status, "not_applicable", "EOP not applicable during permitting");
  assert.equal(ob("2026-11-07", (o) => o.requirementId === "decom_plan")!.status, "not_applicable");

  // Stage move: authorized EQORE action with a reason; facility cannot.
  assert.equal(await code(() => act({ action: "set_stage", to: "operations", note: "Commissioned" }, FAC)), 403);
  assert.equal(await code(() => act({ action: "set_stage", to: "operations", note: "" }, PM)), 400);
  await act({ action: "set_stage", to: "operations", note: "Commissioning complete; operating (synthetic)" }, PM);
  assert.equal(store.getSite(H)!.stage, "operations");
  assert.equal(ob("2026-11-07", (o) => o.requirementId === "eop")!.status, "completed", "seeded approved EOP Rev A");
  assert.equal(ob("2026-11-07", (o) => o.requirementId === "cx_report")!.status, "open");
  assert.equal(ob("2026-11-07", (o) => o.requirementId === "decom_report")!.status, "not_applicable", "decommissioning items stay not applicable in operations");
  assert.equal(view("2026-11-06").stage, "permitting", "historical stage from recorded transitions");

  // Project-specific scheduled record: due 2026-11-12, 7-day window.
  assert.equal(await code(() => act({ action: "add_obligation", requirementId: "ops_record", category: "operations_records", title: "Scheduled maintenance inspection record", dueDate: "2026-11-12", warningDays: 7, note: "Owner O&M agreement (synthetic)" }, FAC)), 403);
  const added = await act({ action: "add_obligation", requirementId: "ops_record", category: "operations_records", kind: "record", title: "Scheduled maintenance inspection record", dueDate: "2026-11-12", warningDays: 7, note: "Owner O&M agreement schedule (synthetic demo data)" }, PM);
  const mid = (added.obligation as { id: string }).id;
  const m = (asOf: string) => ob(asOf, (o) => o.id === mid)!;
  assert.equal(m("2026-11-07").due!.synthetic, true);
  assert.equal(m("2026-11-07").due!.basis, "project_specific");
  assert.equal(m("2026-11-01").status, "not_applicable", "before the stage move (history) the record did not apply yet");
  assert.equal(m("2026-11-07").status, "due_soon");
  assert.equal(m("2026-11-07").due!.daysRemaining, 5);
  assert.equal(m("2026-11-12").status, "due_soon", "due today is not overdue");
  assert.equal(m("2026-11-13").status, "overdue");
  const tz = store.getSite(H)!.lifecycle!.timezone;
  const { parseAsOf } = await import("../lib/lifecycle/clock");
  assert.equal(m(parseAsOf("2026-11-13T03:00:00Z", tz)!).status, "due_soon", "late evening on the 12th (site-local) is not yet overdue");
  assert.equal(m(parseAsOf("2026-11-13T05:30:00Z", tz)!).status, "overdue");

  // Warning-window boundary on a second project-specific record (due 2026-11-20, window 7 days).
  const q = await act({ action: "add_obligation", requirementId: "ops_record", category: "operations_records", kind: "record", title: "Fire-detection functional test record", dueDate: "2026-11-20", warningDays: 7, note: "Project test plan (synthetic demo data)" }, PM);
  const qid = (q.obligation as { id: string }).id;
  const qs = (asOf: string) => ob(asOf, (o) => o.id === qid)!.status;
  assert.equal(qs("2026-11-07"), "upcoming", "13 days out: not yet in the 7-day warning window");
  assert.equal(qs("2026-11-12"), "upcoming", "8 days out");
  assert.equal(qs("2026-11-13"), "due_soon", "exactly 7 days → inside the window");
  assert.equal(qs("2026-11-21"), "overdue");
  assert.equal(await code(() => act({ action: "add_obligation", requirementId: "ops_record", category: "operations_records", kind: "record", title: "Fire-detection functional test record", dueDate: "2026-11-20", note: "duplicate title" }, PM)), 409);
  assert.equal(await code(() => act({ action: "set_due", obligationId: qid, dueDate: "2026-13-01", note: "bad date" }, PM)), 400);

  // Event recorded by the facility: NOT complete. Supplier cannot record. Duplicates rejected. Future dates rejected.
  assert.equal(await code(() => act({ action: "record_event", obligationId: mid, type: "maintenance", performedOn: "2026-11-06", performedBy: "Tech", summary: "Inspection done" }, SUP)), 403);
  assert.equal(await code(() => act({ action: "record_event", obligationId: mid, type: "maintenance", performedOn: "2026-11-09", performedBy: "Tech", summary: "Inspection done" }, FAC)), 400);
  const evRes = await act({ action: "record_event", obligationId: mid, type: "maintenance", performedOn: "2026-11-06", performedBy: "EQORE field technician (fictional)", summary: "Enclosure, BMS log, HVAC filter, labels — no deficiencies (synthetic)" }, FAC);
  const evId = (evRes.event as { id: string }).id;
  assert.equal(await code(() => act({ action: "record_event", obligationId: mid, type: "maintenance", performedOn: "2026-11-06", performedBy: "Someone else", summary: "Same inspection again" }, PM)), 409, "duplicate event");
  assert.equal(m("2026-11-07").status, "awaiting_review");
  assert.equal(m("2026-11-13").status, "overdue", "an unverified event does not stop the clock");

  // Upload evidence: an uploaded (unapproved) file is not proof.
  const evDoc = await upload("SYNTHETIC_Maintenance_Inspection_Record_2026-11.pdf", "ops_record", "2026-11-06");
  assert.equal(await code(() => act({ action: "verify_completion", obligationId: mid, eventId: evId, evidenceRevisionId: evDoc.revision.id, note: "Looks fine" }, ENG)), 409);
  store.decideReview(evDoc.review.id, "approve", ENG2, "Maintenance record reviewed (synthetic)");
  assert.equal(await code(() => act({ action: "verify_completion", obligationId: mid, eventId: evId, evidenceRevisionId: evDoc.revision.id, note: "Verified" }, FAC)), 403, "facility cannot verify");
  assert.equal(await code(() => act({ action: "verify_completion", obligationId: mid, eventId: evId, evidenceRevisionId: evDoc.revision.id, note: "Verified" }, PM)), 403, "non-engineer cannot verify");
  await act({ action: "verify_completion", obligationId: mid, eventId: evId, evidenceRevisionId: evDoc.revision.id, note: "Record matches the scheduled scope (synthetic)" }, ENG);
  assert.equal(m("2026-11-07").status, "completed");
  assert.equal(m("2026-11-13").status, "completed", "verified before the due date → stays completed");
  assert.equal(await code(() => act({ action: "verify_completion", obligationId: mid, eventId: evId, evidenceRevisionId: evDoc.revision.id, note: "again" }, ENG)), 409);
  assert.ok(store.getDecisions(H).some((d) => d.kind === "lifecycle_review" && d.revisionId === evDoc.revision.id));
  // New cycle: setting the next due date archives the completion.
  await act({ action: "set_due", obligationId: mid, dueDate: "2027-05-12", note: "Next inspection per owner agreement (synthetic)" }, PM);
  assert.equal(m("2026-11-07").status, "upcoming");
  assert.equal(store.getSite(H)!.lifecycle!.obligations.find((o) => o.id === mid)!.pastCycles!.length, 1);

  assert.equal(store.getRelease(`${H}-ahj_permit-R1`)!.snapshot!.sha256, r1Sha, "R1 snapshot unchanged");
});

test("site change → impacted obligations → engineer review; negatives; access; QR publication; graph", async () => {
  const { store, ops, upload, act, view, ob } = await mods();
  store.resetStore();
  const r1 = store.getRelease(`${H}-ahj_permit-R1`)!;
  const { verifyReleaseSnapshot } = await import("@releaseos/release-core");
  const r1Sha = r1.snapshot!.sha256;
  await act({ action: "set_stage", to: "operations", note: "Commissioning complete (synthetic)" }, PM);
  const eventsBefore = store.getSite(H)!.events.length;

  // Unconfirmed suggestion (project-memory item from the rules analyzer) → proposed only, nothing flagged.
  const { parseEmailHeaders } = await import("../lib/memory/email");
  const { recordCommunication, validateImport } = await import("../lib/memory/register");
  const { rulesAnalyzeCommunication } = await import("../lib/memory/rules");
  const { groundCommunication } = await import("../lib/memory/schema");
  const body = readFileSync("sample-docs/SYNTHETIC_AHJ_Email_Ventilation.txt", "utf8");
  const h = parseEmailHeaders(body);
  const input = validateImport({ body, channel: "ahj_comment", sender: h.from, sentAt: h.date, subject: h.subject });
  const { items } = recordCommunication(H, input, { ...groundCommunication(rulesAnalyzeCommunication(body, { channel: input.channel, sender: input.sender }), body), engine: "rules", fallback: false }, PM);
  const suggestion = items.find((i) => i.status === "suggested")!;
  const sug = await act({ action: "propose_change", kind: "occupancy_change", description: "Possible layout change mentioned in correspondence", effectiveDate: "2026-11-01", memoryItemId: suggestion.id }, PM);
  assert.equal((sug.change as { origin: string }).origin, "memory_suggestion");
  assert.equal(store.getSite(H)!.lifecycle!.impacts.length, 0, "unconfirmed suggestion flags nothing");
  assert.equal(store.getSite(H)!.events.length, eventsBefore, "unconfirmed change is not in the site change log");
  await act({ action: "dismiss_change", changeId: (sug.change as { id: string }).id, note: "Not an actual site change" }, PM);

  // Unrelated equipment change: like-for-like monitoring gateway → must NOT flag the emergency plan.
  const unrel = await act({ action: "propose_change", kind: "monitoring_device_replace", description: "Monitoring gateway replaced like-for-like", from: "GW-100 gateway", to: "GW-100 gateway", effectiveDate: "2026-11-02" }, FAC);
  const unrelC = await act({ action: "confirm_change", changeId: (unrel.change as { id: string }).id, note: "Verified by EQORE field service" }, PM);
  const unrelImpacts = unrelC.impacts as { requirementId: string }[];
  assert.ok(!unrelImpacts.some((i) => i.requirementId === "eop" || i.requirementId === "om_manual"), "EOP / O&M not flagged by an unrelated device swap");
  const assessed = (unrelC.change as { assessment: { requirementId: string; flagged: boolean; reason: string }[] }).assessment;
  assert.match(assessed.find((x) => x.requirementId === "eop")!.reason, /do not include/);
  assert.equal(ob("2026-11-07", (o) => o.requirementId === "eop")!.status, "completed");

  // Real equipment change: inverter replacement. Proposed by facility; facility cannot confirm.
  const p = await act({ action: "propose_change", kind: "inverter_replace", description: "Both inverters replaced after warranty failure", component: "Inverter / PCS", from: "2 x Dynapower MPS125", to: "2 x Northbridge NPI-125", effectiveDate: "2026-11-05" }, FAC);
  const cid = (p.change as { id: string }).id;
  assert.equal(await code(() => act({ action: "propose_change", kind: "inverter_replace", description: "Same inverter swap entered twice", from: "2 x Dynapower MPS125", to: "2 x Northbridge NPI-125", effectiveDate: "2026-11-05" }, PM)), 409, "duplicate change");
  assert.equal(await code(() => act({ action: "confirm_change", changeId: cid, note: "Confirmed" }, FAC)), 403);
  assert.equal(await code(() => act({ action: "confirm_change", changeId: cid, note: "Confirmed" }, SUP)), 403);
  const conf = await act({ action: "confirm_change", changeId: cid, note: "Confirmed with field service work order (synthetic)" }, PM);
  const impacts = conf.impacts as { id: string; requirementId: string; evidence: { page: number; quote: string }[]; why: string; responsible: string; documentToUpdate: string }[];
  const eopImp = impacts.find((i) => i.requirementId === "eop")!;
  const omImp = impacts.find((i) => i.requirementId === "om_manual")!;
  assert.ok(eopImp && omImp, `EOP and O&M flagged (got ${impacts.map((i) => i.requirementId)})`);
  assert.ok(eopImp.evidence.length >= 1 && eopImp.evidence.every((e) => /MPS125/.test(e.quote) && e.page === 1), "EOP evidence quotes the replaced inverter");
  assert.ok(!eopImp.evidence.some((e) => /^A \d{4}/.test(e.quote)), "revision-history rows are not used as evidence");
  assert.ok(omImp.evidence.some((e) => e.page === 2), "O&M evidence includes the isolation procedure page");
  assert.match(eopImp.why, /not a finding of noncompliance/);
  assert.ok(eopImp.responsible && eopImp.documentToUpdate.includes("Rev A"));
  assert.ok(store.getSite(H)!.events.some((e) => e.id === cid && e.type === "inverter_replace"), "confirmed change recorded in the site change log");
  assert.equal(ob("2026-11-07", (o) => o.requirementId === "eop")!.status, "needs_review");

  // Resolution: wrong role, then no updated revision, then pending revision, then approved → resolved.
  assert.equal(await code(() => act({ action: "resolve_impact", impactId: eopImp.id, resolution: "new_revision_approved", note: "Updated" }, PM)), 403);
  assert.equal(await code(() => act({ action: "resolve_impact", impactId: eopImp.id, resolution: "new_revision_approved", note: "Updated" }, FAC)), 403);
  assert.equal(await code(() => act({ action: "resolve_impact", impactId: eopImp.id, resolution: "new_revision_approved", note: "Updated" }, ENG)), 409, "no updated revision yet");
  assert.equal(await code(() => act({ action: "resolve_impact", impactId: eopImp.id, resolution: "confirmed_no_change", note: "short" }, ENG)), 400);
  const eopB = await upload("SYNTHETIC_EOP_RevB.pdf", "eop", "2026-11-07");
  assert.equal(ob("2026-11-07", (o) => o.requirementId === "eop")!.status, "needs_review");
  assert.equal(await code(() => act({ action: "resolve_impact", impactId: eopImp.id, resolution: "new_revision_approved", note: "Updated" }, ENG)), 409, "Rev B still pending review");
  store.decideReview(eopB.review.id, "approve", ENG2, "Rev B reflects the Northbridge NPI-125 isolation procedure (synthetic)");
  await act({ action: "resolve_impact", impactId: eopImp.id, resolution: "new_revision_approved", note: "EOP Rev B approved; isolation steps updated" }, ENG);
  const eopNow = ob("2026-11-07", (o) => o.requirementId === "eop")!;
  assert.equal(eopNow.status, "completed");
  assert.equal(eopNow.currentRevision!.revLabel, "B");
  assert.equal(ob("2026-11-07", (o) => o.requirementId === "om_manual")!.status, "needs_review", "O&M still open — each obligation needs its own review");

  // Releases stay frozen.
  const r1After = store.getRelease(`${H}-ahj_permit-R1`)!;
  assert.equal(r1After.snapshot!.sha256, r1Sha);
  assert.equal(verifyReleaseSnapshot(r1After.snapshot!), true);
  assert.ok(!JSON.stringify(r1After.snapshot).includes("Northbridge NPI-125"), "historical snapshot does not absorb later changes");

  // Stakeholder access (server-side policy).
  const { canReadFile } = await import("../lib/studio/release-access");
  const eopFile = store.findRevision(store.getSite(H)!, eopB.revision.id)!.fileId!;
  assert.equal(canReadFile(FAC, eopFile), true, "facility may read the EOP");
  assert.equal(canReadFile(SUP, eopFile), false, "supplier may not");
  assert.equal(canReadFile(AHJ, eopFile), false, "AHJ not authorized for the EOP by policy");
  const facView = view("2026-11-07", FAC);
  assert.ok(facView.obligations.some((o) => o.requirementId === "eop") && facView.changes.length === 0 && facView.impacts.length === 0);
  assert.ok(facView.obligations.every((o) => !o.history));
  const supView = view("2026-11-07", SUP);
  assert.ok(!supView.obligations.some((o) => ["eop", "om_manual", "ops_record"].includes(o.requirementId)), "supplier sees no internal operations records");
  assert.ok(!JSON.stringify(view("2026-11-07", AHJ)).includes("work order"), "AHJ view carries no internal change notes");

  // QR publication: nothing public until an engineer explicitly publishes; only publishable types.
  assert.equal(ops.publicEmergency(H)!.publications.length, 0);
  const sheet = store.getSite(H)!.documents.find((d) => d.requirementId === "emergency_info_sheet")!;
  assert.equal(await code(() => act({ action: "publish_emergency", revisionId: sheet.id, note: "Publish" }, PM)), 403);
  const plan = store.getSite(H)!.documents.find((d) => d.requirementId === "plan_set" && d.status === "approved")!;
  assert.equal(await code(() => act({ action: "publish_emergency", revisionId: plan.id, note: "Publish plan set" }, ENG)), 409);
  await act({ action: "publish_emergency", revisionId: sheet.id, note: "Approved for first responders (synthetic)" }, ENG);
  const pub = ops.publicEmergency(H)!;
  assert.equal(pub.publications.length, 1);
  assert.equal(pub.publications[0].current, true);
  const pubJson = JSON.stringify(pub);
  assert.ok(!/EOP|work order|Rivera|Patel|Chen|Confirmed with/.test(pubJson.replace(/First-responder/g, "")) && !("contacts" in pub.site), "public payload: no EOP, notes, names or contacts");

  // Evidence graph: change → impact → obligation, resolution → decision.
  const { buildEvidenceGraph } = await import("../lib/guardian/graph");
  const g = buildEvidenceGraph(store.getSite(H)!, store.getReleases(H));
  assert.ok(g.edges.some((e) => e.type === "may_affect" && e.from === `chg:${cid}` && e.to === `imp:${eopImp.id}`));
  assert.ok(g.edges.some((e) => e.type === "resolved_by" && e.from === `imp:${eopImp.id}`));
  assert.ok(g.edges.some((e) => e.type === "compares" && e.from === `imp:${eopImp.id}` && /MPS125/.test(e.evidence ?? "")));
});
