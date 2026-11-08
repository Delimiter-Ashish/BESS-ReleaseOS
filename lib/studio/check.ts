// Submission Studio verification (pure; bytes are read through an injected, hash-checked accessor).
// Blockers = the deterministic release gate (Guardian/readiness) + selection problems + recipient authorization.
import { checksum } from "@releaseos/release-core";
import { latestApproved, latestRelease, packageReadiness, pendingRevision } from "../release";
import { PACKAGE_TEMPLATES, REQ_BY_ID, TEMPLATE_BY_ID } from "../requirements";
import type { Release, Revision, Site } from "../types";
import { canReleaseTo, RECIPIENT_LABEL, RECIPIENTS, ruleFor, type Recipient } from "./access";
import type { Purpose, PurposeId, SelectionGroup, StudioCheck, StudioDocument, StudioIssue, StudioSelection } from "./types";

export const PURPOSES: Purpose[] = [
  { id: "ahj", name: "AHJ permit submission", templateId: "ahj_permit", recipient: "ahj", description: "Building & fire department permit package" },
  { id: "planning", name: "Planning board submission", templateId: "planning", recipient: "planning", description: "Site-plan review set for the planning board" },
  { id: "interconnection", name: "Utility interconnection submission", templateId: "interconnection", recipient: "utility", description: "Interconnection application package for the utility" },
  { id: "custom", name: "Custom submission", templateId: "ahj_permit", recipient: "ahj", description: "Choose the checklist and recipient" },
];

export const LIMITS = { groups: 8, documents: 60 };

export function resolvePurpose(sel: Pick<StudioSelection, "purpose" | "templateId" | "recipient">): Purpose {
  const p = PURPOSES.find((x) => x.id === sel.purpose);
  if (!p) throw new Error("unknown submission purpose");
  if (p.id !== "custom") return p;
  const templateId = sel.templateId && TEMPLATE_BY_ID[sel.templateId] ? sel.templateId : p.templateId;
  const recipient = (RECIPIENTS as string[]).includes(sel.recipient ?? "") ? (sel.recipient as Recipient) : p.recipient;
  return { ...p, templateId, recipient, name: `Custom: ${TEMPLATE_BY_ID[templateId].name} → ${RECIPIENT_LABEL[recipient]}` };
}

/** Byte-level PDF characteristics that merging may alter (scan only; nothing is modified). */
export function pdfCharacteristics(bytes: Buffer) {
  const head = bytes.subarray(0, 5).toString("latin1");
  if (head !== "%PDF-") return { isPdf: false, encrypted: false, traits: [] as string[] };
  const s = bytes.toString("latin1");
  const traits: string[] = [];
  if (/\/ByteRange\s*\[|\/Type\s*\/Sig\b|\/FT\s*\/Sig\b/.test(s)) traits.push("digital signature");
  if (/\/AcroForm\b/.test(s)) traits.push("interactive form fields");
  if (/\/JavaScript\b|\/JS\b/.test(s)) traits.push("embedded scripts");
  if (/\/EmbeddedFile\b/.test(s)) traits.push("file attachments");
  const encrypted = /\/Encrypt\b/.test(s);
  if (encrypted) traits.push("encryption");
  return { isPdf: true, encrypted, traits };
}

const stageGroup = (rid: string) => {
  const st = REQ_BY_ID[rid]?.stage;
  return st === "design" ? { id: "g-plans", name: "Plans and drawings" } : st === "procurement" ? { id: "g-equipment", name: "Equipment documentation" } : { id: "g-supporting", name: "Supporting documents" };
};

export function studioDocument(site: Site, rev: Revision, purpose: Purpose, requiredIds: Set<string>, bytesOf: (r: Revision) => Buffer): StudioDocument {
  const rule = ruleFor(site, rev.requirementId);
  let chars = { isPdf: false, encrypted: false, traits: [] as string[] };
  try { chars = pdfCharacteristics(bytesOf(rev)); } catch { /* integrity problems surface on generation */ }
  return {
    revisionId: rev.id, requirementId: rev.requirementId, name: REQ_BY_ID[rev.requirementId]?.name ?? rev.requirementId, revLabel: rev.revLabel,
    status: rev.status, current: latestApproved(site, rev.requirementId)?.id === rev.id, source: rev.source, uploadedBy: rev.uploadedBy, approvedBy: rev.approvedBy,
    sha256: rev.sha256, fileName: rev.fileName, isPdf: chars.isPdf, pageCount: rev.pageCount, requiredByPackage: requiredIds.has(rev.requirementId),
    policy: { view: rule.view, releaseTo: rule.releaseTo, isDefault: rule.isDefault, setBy: rule.setBy }, authorizedForRecipient: rule.releaseTo.includes(purpose.recipient),
    pdfCharacteristics: chars.traits,
  };
}

/** Documents available to select (latest approved + pending + older approved, newest first per type). */
export function availableDocuments(site: Site, purpose: Purpose, bytesOf: (r: Revision) => Buffer) {
  const ready = packageReadiness(site, TEMPLATE_BY_ID[purpose.templateId]);
  const required = new Set(ready.items.map((i) => i.requirementId));
  const docs = site.documents.filter((d) => d.status !== "rejected").sort((a, b) => (a.requirementId === b.requirementId ? b.version - a.version : a.requirementId.localeCompare(b.requirementId)));
  return docs.map((d) => studioDocument(site, d, purpose, required, bytesOf));
}

/** Suggested grouping: required documents' current approved revisions, split into plans vs equipment vs supporting. */
export function defaultGroups(site: Site, purpose: Purpose): SelectionGroup[] {
  const ready = packageReadiness(site, TEMPLATE_BY_ID[purpose.templateId]);
  const groups: SelectionGroup[] = [];
  for (const i of ready.items) {
    const rev = latestApproved(site, i.requirementId);
    if (!rev) continue;
    const g = stageGroup(i.requirementId);
    let grp = groups.find((x) => x.id === g.id);
    if (!grp) groups.push((grp = { id: g.id, name: g.name, revisionIds: [] }));
    grp.revisionIds.push(rev.id);
  }
  return groups.length ? groups : [{ id: "g-1", name: "Submission package", revisionIds: [] }];
}

export function nextReleaseId(site: Site, releases: Release[], templateId: string) {
  return `${site.id}-${templateId}-R${(latestRelease(releases, site.id, templateId)?.number ?? 0) + 1}`;
}

export function sanitizeGroups(groups: unknown): SelectionGroup[] {
  if (!Array.isArray(groups)) return [];
  return groups.slice(0, LIMITS.groups).map((g, i) => {
    const o = (g ?? {}) as Record<string, unknown>;
    const id = typeof o.id === "string" && /^[\w-]{1,40}$/.test(o.id) ? o.id : `g-${i + 1}`;
    const name = typeof o.name === "string" && o.name.trim() ? o.name.trim().slice(0, 80) : `Package part ${i + 1}`;
    const revisionIds = Array.isArray(o.revisionIds) ? o.revisionIds.filter((x): x is string => typeof x === "string").slice(0, LIMITS.documents).map((x) => x.slice(0, 200)) : [];
    return { id, name, revisionIds };
  });
}

/** Parse an untrusted request body into a selection (ids/names clamped; purpose validated by resolvePurpose). */
export function selectionFrom(b: Record<string, unknown>): StudioSelection {
  return { purpose: String(b.purpose ?? "") as PurposeId, templateId: typeof b.templateId === "string" ? b.templateId : undefined, recipient: typeof b.recipient === "string" ? (b.recipient as Recipient) : undefined, groups: sanitizeGroups(b.groups) };
}

export function studioCheck(site: Site, releases: Release[], sel: StudioSelection, bytesOf: (r: Revision) => Buffer): StudioCheck {
  const purpose = resolvePurpose(sel);
  const template = TEMPLATE_BY_ID[purpose.templateId];
  const ready = packageReadiness(site, template);
  const blockers: StudioIssue[] = [], warnings: StudioIssue[] = [];
  const name = (rid: string) => REQ_BY_ID[rid]?.name ?? rid;

  // 1) Deterministic release gate (missing / confirmed requirements / pending / outdated / engineering reviews / cross-document).
  for (const i of ready.issues) blockers.push({ code: i.code, severity: "blocker", message: i.message, requirementId: i.requirementId, evidence: i.source?.evidence, source: i.source, responsibleParty: i.responsibleParty, fix: i.nextAction ?? "Resolve before signoff" });
  for (const a of ready.advisories) warnings.push({ code: "UNCONFIRMED_SUGGESTION", severity: "warning", message: a.message, fix: "Confirm or dismiss on the Project memory page (unconfirmed suggestions never block)" });

  // 2) Selection
  const groups = sanitizeGroups(sel.groups);
  const required = new Set(ready.items.map((i) => i.requirementId));
  const seen = new Map<string, string>(), byType = new Map<string, string>();
  const resolved = groups.map((g) => {
    if (!g.revisionIds.length) warnings.push({ code: "EMPTY_GROUP", severity: "warning", groupId: g.id, message: `“${g.name}” has no documents and will not produce a PDF`, fix: "Add documents or remove the group" });
    const documents: StudioDocument[] = [];
    for (const id of g.revisionIds) {
      const rev = site.documents.find((d) => d.id === id);
      if (!rev) { blockers.push({ code: "UNKNOWN_DOCUMENT", severity: "blocker", revisionId: id, groupId: g.id, message: `Unknown document ${id}`, fix: "Remove it from the selection" }); continue; }
      if (seen.has(id)) { blockers.push({ code: "DUPLICATE_SELECTION", severity: "blocker", revisionId: id, groupId: g.id, message: `${name(rev.requirementId)} Rev ${rev.revLabel} is selected twice`, fix: "Remove the duplicate" }); continue; }
      seen.set(id, g.id);
      if (byType.has(rev.requirementId)) blockers.push({ code: "DUPLICATE_DOCUMENT_TYPE", severity: "blocker", revisionId: id, requirementId: rev.requirementId, message: `Two revisions of ${name(rev.requirementId)} are selected`, fix: "Keep only the current approved revision" });
      byType.set(rev.requirementId, id);
      const doc = studioDocument(site, rev, purpose, required, bytesOf);
      documents.push(doc);
      const approved = latestApproved(site, rev.requirementId);
      if (rev.status !== "approved") {
        const pend = pendingRevision(site, rev.requirementId)?.id === rev.id;
        blockers.push({ code: "SELECTED_NOT_APPROVED", severity: "blocker", revisionId: id, requirementId: rev.requirementId, message: `${name(rev.requirementId)} Rev ${rev.revLabel} is ${pend ? "pending engineer review" : rev.status.replace("_", " ")} — only approved revisions can be released`, responsibleParty: "EQORE engineer", fix: pend ? `Engineer: review Rev ${rev.revLabel} on the site page, then re-run checks` : "Select the current approved revision" });
      } else if (approved && approved.id !== rev.id) {
        blockers.push({ code: "SELECTED_OUTDATED_VERSION", severity: "blocker", revisionId: id, requirementId: rev.requirementId, message: `${name(rev.requirementId)}: Rev ${rev.revLabel} selected, but Rev ${approved.revLabel} is the current approved revision`, fix: `Replace with Rev ${approved.revLabel}` });
      }
      if (!doc.authorizedForRecipient) {
        const rule = ruleFor(site, rev.requirementId);
        blockers.push({ code: "NOT_AUTHORIZED_FOR_RECIPIENT", severity: "blocker", revisionId: id, requirementId: rev.requirementId, message: `${name(rev.requirementId)} is not authorized for release to ${RECIPIENT_LABEL[purpose.recipient]} (${rule.isDefault ? "no policy set — external release is never assumed" : `policy allows: ${rule.releaseTo.map((r) => RECIPIENT_LABEL[r]).join(", ") || "nobody"}; set by ${rule.setBy}`})`, responsibleParty: "EQORE document control", fix: `Remove it, or have EQORE authorize ${name(rev.requirementId)} for ${RECIPIENT_LABEL[purpose.recipient]} in the access policy (note required)` });
      }
      const chars = pdfCharacteristics((() => { try { return bytesOf(rev); } catch { return Buffer.alloc(0); } })());
      if (chars.encrypted) blockers.push({ code: "ENCRYPTED_SOURCE", severity: "blocker", revisionId: id, message: `${rev.fileName} is encrypted and cannot be merged`, fix: "Obtain an unencrypted copy (the encrypted original can still be shared separately)" });
      else if (!chars.isPdf) warnings.push({ code: "NON_PDF_SOURCE", severity: "warning", revisionId: id, message: `${rev.fileName} is not a PDF: the combined PDF will contain a labeled slip sheet; the original file is included in the ZIP`, fix: "Upload a PDF version if the recipient needs the pages inline" });
      if (chars.traits.filter((t) => t !== "encryption").length) warnings.push({ code: "PDF_FEATURES_MAY_CHANGE", severity: "warning", revisionId: id, message: `${rev.fileName} contains ${chars.traits.join(", ")}: merging copies pages, so signatures will not validate and forms/scripts may not survive in the combined PDF. The original is retained unchanged in the ZIP.`, fix: "Send the original file alongside the combined PDF if the recipient needs the signed/interactive version" });
    }
    return { ...g, documents };
  });
  if (!seen.size) blockers.push({ code: "EMPTY_SELECTION", severity: "blocker", message: "No documents selected", fix: "Add the approved documents for this submission" });
  for (const i of ready.items) {
    if (i.approved && !byType.has(i.requirementId)) {
      blockers.push({ code: "REQUIRED_NOT_SELECTED", severity: "blocker", requirementId: i.requirementId, message: `${i.name} is required for the ${template.name}${i.requiredBy.length ? " (confirmed project requirement)" : ""} but is not selected`, fix: `Add ${i.name} Rev ${i.approved.revLabel}` });
    }
  }

  const token = checksum({
    readiness: ready.token, purpose: purpose.id, templateId: purpose.templateId, recipient: purpose.recipient,
    groups: groups.map((g) => ({ i: g.id, n: g.name, r: g.revisionIds })),
    policy: Array.from(byType.keys()).sort().map((rid) => ({ rid, to: ruleFor(site, rid).releaseTo })),
    next: nextReleaseId(site, releases, purpose.templateId),
  });
  return { siteId: site.id, purpose, canGenerate: blockers.length === 0, token, readinessToken: ready.token, blockers, warnings, groups: resolved, nextReleaseId: nextReleaseId(site, releases, purpose.templateId), checkedAt: new Date().toISOString() };
}

export const purposeIds = PURPOSES.map((p) => p.id) as PurposeId[];
export { canReleaseTo, PACKAGE_TEMPLATES };
