// Durability: communications, confirmed requirements, uploaded bytes, reviews and releases survive a reload from disk.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Session } from "../lib/auth";

const dir = mkdtempSync(join(tmpdir(), "releaseos-persist-"));
process.env.RELEASEOS_DATA_DIR = dir;
process.env.RELEASEOS_PERSIST = "on";

const PM: Session = { userId: "arivera", name: "A. Rivera", role: "eqore", engineer: false, roles: ["eqore"] };
const ENG: Session = { userId: "mchen", name: "M. Chen, PE", role: "eqore", engineer: true, roles: ["eqore", "engineer"] };

test("state survives a restart; tampered state is rejected", async () => {
  const store = await import("../lib/store");
  const reg = await import("../lib/memory/register");
  const { groundCommunication } = await import("../lib/memory/schema");
  const { rulesAnalyzeCommunication } = await import("../lib/memory/rules");
  const { rulesExtract } = await import("../lib/extract");
  const { readTextLayer } = await import("../lib/pdf");
  try {
    store.resetStore();
    const body = readFileSync("sample-docs/SYNTHETIC_AHJ_Email_Ventilation.txt", "utf8");
    const input = reg.validateImport({ body, channel: "ahj_comment", sender: "Lt. Dana Okafor, Holliston Fire Department (SYNTHETIC)", sentAt: "2026-11-05T14:14:00Z" });
    const analysis = { ...groundCommunication(rulesAnalyzeCommunication(body, { channel: "ahj_comment", sender: input.sender }), body), engine: "rules" as const, fallback: false };
    const { communication, items } = reg.recordCommunication("S-1001", input, analysis, PM);
    const req = items.find((i) => i.requirementId === "ventilation_plan")!;
    reg.confirmItem("S-1001", req.id, PM, { note: "Applies", blocking: true, templateIds: ["ahj_permit"] });

    const bytes = readFileSync("sample-docs/SYNTHETIC_Ventilation_Plan_RevA.pdf");
    const layer = await readTextLayer("application/pdf", bytes);
    const { fileId, sha256 } = store.putFile("SYNTHETIC_Ventilation_Plan_RevA.pdf", "application/pdf", bytes);
    const ex = store.saveExtraction({ siteId: "S-1001", fileId, sha256, fileName: "SYNTHETIC_Ventilation_Plan_RevA.pdf", mediaType: "application/pdf", textLayer: layer.joined, pageCount: layer.pageCount, result: { ...rulesExtract("v.pdf", layer), provider: "rules", fallback: false }, impacts: {}, createdBy: PM.userId });
    const { revision, review } = store.submitRevision("S-1001", { extractionId: ex.id, requirementId: "ventilation_plan" }, PM);
    store.decideReview(review.id, "approve", ENG, "ok (synthetic)");
    const r1 = store.getReleases("S-1001").find((r) => r.templateId === "ahj_permit")!.snapshot!.sha256;

    // Simulated restart: drop the in-memory working set and reload from disk.
    store.reloadFromDisk();
    const site = store.getSite("S-1001")!;
    assert.equal(site.communications?.find((c) => c.id === communication.id)?.body, body, "original communication survives");
    assert.equal(site.memory?.find((m) => m.id === req.id)?.status, "confirmed", "confirmed requirement survives");
    const rev = site.documents.find((d) => d.id === revision.id)!;
    assert.equal(rev.status, "approved");
    assert.equal(store.bytesFor(rev).equals(bytes), true, "uploaded evidence bytes survive and re-hash correctly");
    assert.equal(store.getReleases("S-1001").find((r) => r.templateId === "ahj_permit")!.snapshot!.sha256, r1, "release history survives unchanged");

    // Tampering with a release snapshot on disk is detected: the state is quarantined, not loaded.
    const p = join(dir, "state.json");
    const st = JSON.parse(readFileSync(p, "utf8"));
    st.releases[0].snapshot.documents[0].revisionLabel = "Z";
    writeFileSync(p, JSON.stringify(st));
    const errs: unknown[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => errs.push(a);
    try { store.reloadFromDisk(); } finally { console.error = orig; }
    assert.equal(store.getSite("S-1001")!.memory?.length ?? 0, 0, "tampered state rejected; started from the seed");
    assert.ok(errs.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
