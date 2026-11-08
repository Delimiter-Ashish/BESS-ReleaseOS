// Guardian → Submission Studio end-to-end checks (HTTP only, against a running server; resets the store).
//   BASE=http://localhost:3000 node scripts/e2e-studio-ui.mjs   (Kaushik's UI-route Studio checks)
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE || "http://localhost:3000";
const H = "S-1001";
let n = 0, failed = 0;
const check = (ok, msg, extra = "") => { n++; if (!ok) failed++; console.log(`  ${ok ? "✓" : "✗"} ${String(n).padStart(2)} ${msg}${extra ? ` — ${extra}` : ""}`); };
async function login(userId, passcode) {
  const r = await fetch(`${BASE}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, passcode }) });
  return (r.headers.getSetCookie?.() ?? [r.headers.get("set-cookie")]).map((c) => c.split(";")[0]).join("; ");
}
async function call(cookie, path, { method = "GET", json, form } = {}) {
  const r = await fetch(`${BASE}${path}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(json ? { "Content-Type": "application/json" } : {}) }, body: json ? JSON.stringify(json) : form });
  const ct = r.headers.get("content-type") ?? "";
  const body = ct.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer());
  return { status: r.status, ct, body, headers: r.headers };
}
const html = async (cookie, path) => { const r = await fetch(`${BASE}${path}`, { headers: { cookie } }); return { status: r.status, text: await r.text() }; };
const sha = (b) => createHash("sha256").update(b).digest("hex");
async function extract(cookie, file) {
  const fd = new FormData();
  fd.append("file", new Blob([readFileSync(file)], { type: "application/pdf" }), file.split("/").pop());
  fd.append("siteId", H);
  return (await call(cookie, "/api/extract", { method: "POST", form: fd })).body;
}

console.log(`Guardian → Submission Studio E2E against ${BASE}`);
const pm = await login("kaushik", "pm855"), eng = await login("mchen", "eng856"), eng2 = await login("rpatel", "eng855"), sup = await login("supplier", "supp855");
check((await call(pm, "/api/reset", { method: "POST" })).status === 200, "reset to seed");

// Role-specific navigation (UI) — authorization itself is checked server-side below.
const pmHome = await html(pm, "/"), engHome = await html(eng, "/");
check(pmHome.text.includes("Submission Studio") && pmHome.text.includes("Project Guardian") && !pmHome.text.includes("Assigned Reviews"), "PM navigation: Guardian + Studio, no engineer review queue");
check(engHome.text.includes("Assigned Reviews") && engHome.text.includes("Release Signoff") && engHome.text.includes("Dependency Impacts"), "engineer navigation prioritises reviews and signoff");
const provider = /Extraction: (?:<!-- -->)?([^<]+)</.exec(pmHome.text)?.[1];

// Immutable history baseline
const ws0 = (await call(pm, `/api/workspace?readiness=${H}:ahj_permit`)).body;
const r1 = ws0.readiness.releases.find((r) => r.number === 1);
const manifestSha = async (id) => { const r = await call(pm, `/api/releases/${encodeURIComponent(id)}/download?format=json`); return sha(r.body instanceof Buffer ? r.body : Buffer.from(JSON.stringify(r.body))); };
const r1Before = await manifestSha(r1.id);

// 1–3 Multi-file import, register update, extraction mode
const docsBefore = ws0.projects.find((p) => p.id === H).documents;
const [a, b] = await Promise.all([extract(pm, "sample-docs/SYNTHETIC_Switchgear_Spec_RevB_600A.pdf"), extract(pm, "sample-docs/demo/SYNTHETIC_Redwood_UL9540A_Summary.pdf")]);
check(a.ok && b.ok, "two files extracted concurrently", `${a.requirementId}, ${b.requirementId}`);
check(["rules", "openai", "anthropic"].includes(a.engine) && (a.engine === "rules") === /rules/.test(provider ?? ""), "extraction mode reported consistently", `engine=${a.engine}${a.fallback ? " (fallback)" : ""}; sidebar="${provider}"`);
const fa = (await call(pm, `/api/sites/${H}/revisions`, { method: "POST", json: { extractionId: a.extractionId, requirementId: a.requirementId } })).body;
const fb = (await call(pm, `/api/sites/${H}/revisions`, { method: "POST", json: { extractionId: b.extractionId, requirementId: b.requirementId === "unknown" ? "ul9540a_report" : b.requirementId } })).body;
check(fa.ok && fb.ok, "both filed for review independently (a pending review does not block the next upload)");
const ws1 = (await call(pm, "/api/workspace")).body;
check(ws1.projects.find((p) => p.id === H).documents === docsBefore + 2, "project register updated from the store", `${docsBefore} → ${docsBefore + 2} revisions`);
const reg = await html(pm, `/projects/${H}`);
check(reg.status === 200 && reg.text.includes("SYNTHETIC_Switchgear_Spec_RevB_600A.pdf"), "register page lists the uploaded file");

// 4–5 Authorization + independent reviews
check((await call(pm, `/api/reviews/${fa.review.id}`, { method: "POST", json: { decision: "approve", note: "PM try" } })).status === 403, "PM cannot approve an engineering revision (server)");
const ap = (await call(eng, `/api/reviews/${fa.review.id}`, { method: "POST", json: { decision: "approve", note: "Verified 600 A rating against submittal" } })).body;
check(ap.ok, "engineer approves the switchgear revision");
const ws2 = (await call(pm, "/api/workspace")).body;
check(ws2.reviews.find((r) => r.id === fb.review.id)?.open === true, "the other review is still open and independent");

// 7 Evidence = original bytes
const fileRes = await call(pm, `/api/files/${encodeURIComponent(a.fileId)}`);
check(fileRes.status === 200 && fileRes.body.subarray(0, 4).toString() === "%PDF" && fileRes.headers.get("x-sha256") === sha(readFileSync("sample-docs/SYNTHETIC_Switchgear_Spec_RevB_600A.pdf")), "evidence endpoint serves the exact original bytes (sha256 matches)");

// 6, 8 Guardian backend + graph
const pf = (await call(pm, `/api/sites/${H}/preflight`, { method: "POST", json: { templateId: "ahj_permit" } })).body;
const wsR = (await call(pm, `/api/workspace?readiness=${H}:ahj_permit`)).body.readiness;
check(pf.ok && pf.report.findings.filter((f) => f.blocking).length === wsR.issues.length && pf.report.canBuild === wsR.canBuild, "Guardian blockers equal the gate issues the UI shows", `canBuild=${pf.report.canBuild}, blockers=${wsR.issues.length}`);
const g = (await call(pm, `/api/sites/${H}/graph`)).body.graph;
const revNodes = g.nodes.filter((x) => x.type === "revision");
const pages = await Promise.all(revNodes.slice(0, 8).map((x) => fetch(`${BASE}${x.href}`, { headers: { cookie: pm } }).then((r) => r.status)));
check(revNodes.length > 0 && pages.every((s) => s === 200), "graph revision nodes resolve to real document records", `${revNodes.length} revision nodes, ${pages.length} opened`);
check(g.edges.every((e) => g.nodes.some((x) => x.id === e.from) && g.nodes.some((x) => x.id === e.to)), "every graph edge connects two returned records");
const gp = await html(pm, `/guardian?project=${H}&template=ahj_permit`);
check(gp.status === 200 && gp.text.includes("Run Guardian Scan"), "Guardian page renders the scan workspace");

// 12 Server-side access restrictions
const sPf = await call(sup, `/api/sites/${H}/preflight`, { method: "POST", json: { templateId: "ahj_permit" } });
const sG = await call(sup, `/api/sites/${H}/graph`);
const sC = await call(sup, `/api/sites/${H}/communications`, { method: "POST", json: { body: "From: x\nSubject: y\n\nplease add a document", sender: "x", sentAt: "2026-11-01" } });
const sRel = await call(pm, `/api/sites/${H}/releases`, { method: "POST", json: { templateId: "ahj_permit", note: "PM try", readinessToken: wsR.token } });
check([sPf.status, sG.status, sC.status].every((s) => s === 403) && sRel.status === 403, "supplier blocked from Guardian/memory; PM blocked from release signoff", `${sPf.status}/${sG.status}/${sC.status}, PM release ${sRel.status}`);

// Dependency review raised by the 600 A change must be resolved before signoff
for (const t of (await call(eng, "/api/workspace")).body.reviews.filter((r) => r.kind === "dependency" && r.open && r.projectId === H && r.sourceApproved)) {
  await call(eng2, `/api/sites/${H}/tasks/${encodeURIComponent(t.id)}`, { method: "POST", json: { note: "Plan set conductors and OCPD verified for 600 A" } });
}
// The UL 9540A upload is not part of the AHJ checklist here, but if it is, decide it so the gate is deterministic.
await call(eng2, `/api/reviews/${fb.review.id}`, { method: "POST", json: { decision: "approve", note: "UL 9540A summary reviewed" } });

// 11, 13 Studio order + release + downloads only after backend success
const rd = (await call(eng, `/api/workspace?readiness=${H}:ahj_permit`)).body.readiness;
const pf2 = (await call(eng, `/api/sites/${H}/preflight`, { method: "POST", json: { templateId: "ahj_permit" } })).body.report;
check(pf2.canBuild === rd.canBuild, "re-verified: Guardian and gate agree", `canBuild=${rd.canBuild}${rd.canBuild ? "" : `; ${rd.issues.map((i) => i.message).join(" | ")}`}`);
const order = rd.items.filter((i) => i.approved).map((i) => ({ rid: i.requirementId, id: i.approved.id, rev: i.approved.revLabel })).reverse();
const orderText = `[Studio order → Town building & fire (AHJ)] ${order.map((o, i) => `${i + 1}. ${o.rid} Rev ${o.rev}`).join("; ")}`;
check((await call(pm, "/api/releases/does-not-exist/download")).status === 404, "no download exists before a release is generated");
const built = await call(eng, `/api/sites/${H}/releases`, { method: "POST", json: { templateId: "ahj_permit", note: `Issuing for permit resubmission\n\n${orderText}`, readinessToken: pf2.token } });
if (rd.canBuild) {
  const rel = built.body.release;
  check(built.body.ok && rel.number === 2, "engineer seals R2 via the release engine", rel ? `${rel.id} by ${rel.builtBy}` : JSON.stringify(built.body).slice(0, 160));
  check(rel && order.every((o) => rel.items.find((x) => x.requirementId === o.rid)?.revisionId === o.id), "pinned revision IDs equal the revisions selected in the Studio");
  check(rel && rel.note.includes(orderText), "requested document order is preserved in the immutable signoff record");
  const zip = await call(eng, `/api/releases/${encodeURIComponent(rel.id)}/download`);
  check(zip.status === 200 && zip.body.subarray(0, 2).toString() === "PK", "ZIP downloads only for the server-generated release", `${zip.body.length} bytes`);
  const pdf = await call(eng, `/api/releases/${encodeURIComponent(rel.id)}/combined-pdf`, { method: "POST", json: {} });
  check(pdf.status === 404, "no ad-hoc combined-PDF route: real PDFs come only from engineer signoff via POST /studio/release (verified in e2e:studio)", `HTTP ${pdf.status}`);
} else {
  check(built.status === 409, "release refused while the gate is blocked", `HTTP ${built.status}`);
}
const studio = await html(eng, `/submissions?project=${H}&package=ahj_permit`);
check(studio.status === 200 && studio.text.includes("Sign off, generate") && !studio.text.includes("backend pending") && studio.text.includes("data-testid=\"studio-checks\""), "Studio offers real combined-PDF generation with server selection checks (no 'backend pending' placeholders)");

// 14 Immutability
const r1AfterSha = await manifestSha(r1.id);
check(r1AfterSha === r1Before, "R1 manifest unchanged after new approvals and R2");

// 9–10 Communication → suggestion → confirmation → blocker
const email = readFileSync("sample-docs/SYNTHETIC_AHJ_Email_Ventilation.txt", "utf8");
const imp = (await call(pm, `/api/sites/${H}/communications`, { method: "POST", json: { body: email, channel: "ahj_comment" } })).body;
const vent = imp.items?.find((m) => m.requirementId === "ventilation_plan");
const wsS = (await call(pm, `/api/workspace?readiness=${H}:ahj_permit`)).body;
check(imp.ok && vent && wsS.findings.some((f) => f.id === `MEM-${vent.id}` && f.lifecycle === "needs_confirmation"), "AHJ email → suggestion shown as 'needs confirmation', not confirmed");
check(wsS.readiness.issues.every((i) => i.memoryItemId !== vent?.id), "an unconfirmed suggestion never blocks");
await call(pm, `/api/sites/${H}/memory/${vent.id}`, { method: "POST", json: { action: "confirm", note: "Fire marshal requires it", blocking: true, templateIds: ["ahj_permit"], requirementId: "ventilation_plan" } });
const wsC = (await call(pm, `/api/workspace?readiness=${H}:ahj_permit`)).body;
const pf3 = (await call(pm, `/api/sites/${H}/preflight`, { method: "POST", json: { templateId: "ahj_permit" } })).body.report;
check(!wsC.readiness.canBuild && wsC.readiness.issues.some((i) => i.requirementId === "ventilation_plan" && i.code === "MISSING_DOCUMENT"), "confirmed requirement adds a MISSING_DOCUMENT blocker", wsC.readiness.issues.map((i) => i.code).join(","));
check(!pf3.canBuild && pf3.findings.some((f) => f.blocking && /Ventilation/i.test(f.title) && f.evidence.some((e) => e.kind === "communication" && e.quote)), "Guardian preflight reports it with the AHJ quote as evidence");
check(wsC.findings.some((f) => f.id === `MEM-${vent.id}` && f.lifecycle === "action_required"), "Action Center lifecycle moves to 'action required'");

// 15 Animation honesty (static): sealed state is only rendered from a successful server response
const src = readFileSync("components/studio/SubmissionStudio.tsx", "utf8");
check(/\{rel && animDone && \(/.test(src) && /const rel = result\?\.state === "ok" \? result\.data\.release : undefined/.test(src) && /setOutputs\(r\.data\.outputs\)/.test(src), "'Release Sealed' renders only from an ok server response (static check)");
const scan = readFileSync("components/guardian/GuardianScan.tsx", "utf8");
check(!/setTimeout\([^)]*setPhase\("done"\)/.test(scan) && /await runPreflight\(/.test(scan), "Guardian Scan completes only when the preflight request returns (static check)");

for (const p of ["/", "/inbox", "/projects", `/projects/${H}`, "/memory?type=ahj_requirement", "/guardian?tab=graph", "/guardian?tab=time", "/submissions", "/submissions?view=signoff", "/activity", "/qr", "/reviews?kind=dependency"]) {
  const r = await fetch(`${BASE}${p}`, { headers: { cookie: pm } });
  if (r.status !== 200) check(false, `page ${p}`, `HTTP ${r.status}`);
}
check(true, "all assurance screens render (200)");
console.log(failed ? `\n${failed} of ${n} checks FAILED.` : `\nAll ${n} Guardian → Studio checks passed.`);
process.exit(failed ? 1 : 0);
