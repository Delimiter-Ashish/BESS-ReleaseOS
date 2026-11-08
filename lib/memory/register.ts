// Project memory register: the ONLY place memory records are mutated. Rules enforced here:
//  - AI/rules output is stored as status "suggested" and can never block, resolve, or release anything.
//  - Confirm/dismiss: EQORE users (PM or engineer), session identity, note required.
//  - Resolve: requirements → authorized engineer, checked deterministically against an APPROVED revision;
//    actions / questions / decisions → EQORE user. Note required. Everything appended to item.history.
//  - The same communication imported twice is detected by a normalized-content hash (no second AI call).
//  - The same item arriving from another communication is flagged as a duplicate and merged on confirmation.
import { createHash, randomUUID } from "node:crypto";
import type { Session } from "../auth";
import { latestApproved, revisionsOf } from "../release";
import { PACKAGE_TEMPLATES, REQ_BY_ID } from "../requirements";
import { getSite, persist, StoreError } from "../store";
import type { Site } from "../types";
import type { AnalysisResult } from "./analyze";
import { requestedAt } from "./readiness";
import { normalizeText } from "./schema";
import type { Communication, CommunicationChannel, MemoryHistoryEntry, MemoryItem } from "./types";

const nowIso = () => new Date().toISOString();
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const CHANNELS: CommunicationChannel[] = ["email", "ahj_comment", "engineering_note", "meeting_note", "other"];
const TEMPLATE_IDS = new Set(PACKAGE_TEMPLATES.map((t) => t.id));
const ACTIVE: MemoryItem["status"][] = ["suggested", "confirmed", "resolved"];

export const LIMITS = { bodyMin: 20, bodyMax: 50_000 };

function siteOr404(siteId: string): Site {
  const site = getSite(siteId);
  if (!site) throw new StoreError(404, "site not found");
  return site;
}
function requireEqore(s: Session) {
  if (s.role !== "eqore") throw new StoreError(403, `${s.name} cannot manage project memory (EQORE users only)`);
}
function requireNote(note: string | undefined, what: string) {
  const n = (note ?? "").trim();
  if (n.length < 3) throw new StoreError(400, `${what} requires a written note`);
  return n.slice(0, 1000);
}
const hist = (s: Session, action: MemoryHistoryEntry["action"], note?: string): MemoryHistoryEntry => ({ at: nowIso(), byId: s.userId, byName: s.name, action, note });

export const contentHash = (body: string) => sha(normalizeText(body));

const STOP = new Set(["the", "a", "an", "and", "or", "of", "for", "to", "please", "provide", "submit", "updated", "update", "revised", "new", "with", "on", "in", "be", "is", "are", "must", "shall"]);
/** Same requirement for the same document type = same item, regardless of wording. Otherwise kind + key words. */
export function fingerprint(kind: MemoryItem["kind"], title: string, requirementId?: string) {
  if (kind === "requirement" && requirementId) return `requirement|${requirementId}`;
  const words = Array.from(new Set(normalizeText(title).replace(/[^a-z0-9 ]/g, " ").split(" ").filter((w) => w.length > 2 && !STOP.has(w)))).sort();
  return `${kind}|${requirementId ?? ""}|${words.join(" ")}`;
}

export function findDuplicateCommunication(siteId: string, body: string) {
  const h = contentHash(body);
  return (siteOr404(siteId).communications ?? []).find((c) => c.contentSha256 === h);
}

export interface ImportInput { channel: CommunicationChannel; sender: string; senderOrg?: string; recipients?: string[]; sentAt: string; subject?: string; body: string }

/** Validate importer-supplied metadata (the AI never sets sender/time). */
export function validateImport(input: Partial<ImportInput>): ImportInput {
  const body = (input.body ?? "").replace(/\r\n/g, "\n");
  if (body.trim().length < LIMITS.bodyMin) throw new StoreError(400, "Paste the communication text (at least a sentence)");
  if (body.length > LIMITS.bodyMax) throw new StoreError(413, `Communication too long (max ${LIMITS.bodyMax.toLocaleString()} characters)`);
  const sender = (input.sender ?? "").trim().slice(0, 200);
  if (!sender) throw new StoreError(400, "Sender is required (who sent this?)");
  const t = Date.parse(input.sentAt ?? "");
  if (!Number.isFinite(t)) throw new StoreError(400, "A valid sent date/time is required");
  if (t > Date.now() + 24 * 3600_000) throw new StoreError(400, "Sent date is in the future");
  const channel = CHANNELS.includes(input.channel as CommunicationChannel) ? (input.channel as CommunicationChannel) : "email";
  return { channel, sender, senderOrg: input.senderOrg?.trim().slice(0, 200) || undefined, recipients: (input.recipients ?? []).map((r) => r.trim().slice(0, 200)).filter(Boolean).slice(0, 20), sentAt: new Date(t).toISOString(), subject: input.subject?.trim().slice(0, 300) || undefined, body };
}

/** Store the ORIGINAL communication + its analysis; every extracted item becomes a "suggested" memory item. */
export function recordCommunication(siteId: string, input: ImportInput, analysis: AnalysisResult, session: Session) {
  requireEqore(session);
  const site = siteOr404(siteId);
  const dup = findDuplicateCommunication(siteId, input.body);
  if (dup) return { communication: dup, items: (site.memory ?? []).filter((m) => dup.itemIds.includes(m.id)), duplicate: true as const };

  const id = `COM-${randomUUID().slice(0, 8)}`;
  const at = nowIso();
  const memory = (site.memory ??= []);
  const refs = analysis.documentReferences.map((r) => {
    const linked = r.requirementId ? revisionsOf(site, r.requirementId).find((d) => (r.revisionLabel ? d.revLabel === r.revisionLabel : d.status === "approved")) : undefined;
    return { ...r, linkedRevisionId: linked?.id };
  });
  const items: MemoryItem[] = [];
  const seen = new Set<string>();
  for (const g of analysis.items) {
    const fp = fingerprint(g.kind, g.title, g.requirementId);
    if (seen.has(fp)) continue; // the same item twice in one message
    seen.add(fp);
    const existing = memory.find((m) => m.fingerprint === fp && ACTIVE.includes(m.status));
    const item: MemoryItem = {
      id: `MEM-${randomUUID().slice(0, 8)}`, siteId, kind: g.kind, title: g.title, detail: g.detail, status: "suggested",
      origin: analysis.engine, model: analysis.model, confidence: g.confidence,
      sources: [{ communicationId: id, sender: input.sender, sentAt: input.sentAt, channel: input.channel, subject: input.subject, evidence: g.evidence, evidenceVerified: g.evidenceVerified }],
      requirementId: g.requirementId, templateIds: g.templateIds, requiresUpdatedRevision: g.requiresUpdatedRevision,
      relatedRevisionIds: refs.filter((r) => r.linkedRevisionId && r.requirementId === g.requirementId).map((r) => r.linkedRevisionId!),
      authority: g.authority, responsibleParty: g.responsibleParty, dueDate: g.dueDate, decisionState: g.decisionState,
      blocking: false, proposedBlocking: g.proposedBlocking, fingerprint: fp, duplicateOfId: existing?.id,
      history: [{ at, byId: analysis.engine, byName: analysis.engine === "openai" ? `OpenAI${analysis.model ? ` (${analysis.model})` : ""}` : "Deterministic rules", action: "suggested", note: g.note }],
      createdAt: at,
    };
    items.push(item);
  }
  const communication: Communication = {
    id, siteId, channel: input.channel, subject: input.subject, sender: input.sender, senderOrg: input.senderOrg, recipients: input.recipients ?? [],
    sentAt: input.sentAt, body: input.body, contentSha256: contentHash(input.body),
    importedById: session.userId, importedBy: session.name, importedAt: at,
    analysis: { engine: analysis.engine, model: analysis.model, fallback: analysis.fallback, summary: analysis.summary, warnings: analysis.warnings, embeddedInstructionsDetected: analysis.embeddedInstructionsDetected, stakeholders: analysis.stakeholders, documentReferences: refs },
    itemIds: items.map((i) => i.id), synthetic: /synthetic/i.test(input.body.slice(0, 2000)) || /synthetic/i.test(input.subject ?? ""),
  };
  (site.communications ??= []).push(communication);
  memory.push(...items);
  persist();
  return { communication, items, duplicate: false as const };
}

function itemOr404(site: Site, itemId: string) {
  const m = (site.memory ?? []).find((x) => x.id === itemId);
  if (!m) throw new StoreError(404, "memory item not found");
  return m;
}

export interface ConfirmInput {
  note?: string;
  blocking?: boolean;
  templateIds?: string[];
  requirementId?: string | null;
  responsibleParty?: string;
  dueDate?: string;
  requiresUpdatedRevision?: boolean;
  /** For a suggestion flagged as a duplicate: true = keep as a separate item instead of merging. */
  asNew?: boolean;
}

/** Human confirms a suggestion's applicability (optionally correcting AI fields). Duplicates merge into the existing item. */
export function confirmItem(siteId: string, itemId: string, session: Session, input: ConfirmInput) {
  requireEqore(session);
  const text = requireNote(input.note, "Confirming a project-memory item");
  const site = siteOr404(siteId);
  const m = itemOr404(site, itemId);
  if (m.status !== "suggested") throw new StoreError(409, `Item is already ${m.status}`);

  const target = m.duplicateOfId && !input.asNew ? (site.memory ?? []).find((x) => x.id === m.duplicateOfId && ACTIVE.includes(x.status)) : undefined;
  if (target) {
    for (const s of m.sources) if (!target.sources.some((t) => t.communicationId === s.communicationId)) target.sources.push(s);
    target.history.push(hist(session, "source_added", `Merged duplicate ${m.id}: ${text}`));
    Object.assign(m, { status: "merged", mergedIntoId: target.id });
    m.history.push(hist(session, "merged", `Merged into ${target.id}: ${text}`));
    persist();
    return { item: target, merged: m };
  }

  if (input.requirementId !== undefined) {
    if (input.requirementId === null || input.requirementId === "") m.requirementId = undefined;
    else if (REQ_BY_ID[input.requirementId]) m.requirementId = input.requirementId;
    else throw new StoreError(400, "Unknown document type");
  }
  if (input.templateIds) {
    const bad = input.templateIds.filter((t) => !TEMPLATE_IDS.has(t));
    if (bad.length) throw new StoreError(400, `Unknown package: ${bad.join(", ")}`);
    m.templateIds = Array.from(new Set(input.templateIds));
  }
  if (input.responsibleParty !== undefined) m.responsibleParty = input.responsibleParty.trim().slice(0, 120) || undefined;
  if (input.dueDate !== undefined) m.dueDate = /^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) ? input.dueDate : undefined;
  if (input.requiresUpdatedRevision !== undefined) m.requiresUpdatedRevision = !!input.requiresUpdatedRevision && !!m.requirementId;
  m.blocking = input.blocking ?? m.proposedBlocking;
  if (m.blocking && !m.templateIds.length) throw new StoreError(400, "Choose at least one submission package for a blocking item");
  m.fingerprint = fingerprint(m.kind, m.title, m.requirementId);
  if (input.asNew) m.duplicateOfId = undefined;
  Object.assign(m, { status: "confirmed", confirmedById: session.userId, confirmedBy: session.name, confirmedAt: nowIso(), confirmNote: text });
  m.history.push(hist(session, "confirmed", `${text}${m.blocking ? ` — blocking for ${m.templateIds.join(", ")}` : " — non-blocking"}`));
  persist();
  return { item: m };
}

export function dismissItem(siteId: string, itemId: string, session: Session, note?: string) {
  requireEqore(session);
  const text = requireNote(note, "Dismissing a suggestion");
  const site = siteOr404(siteId);
  const m = itemOr404(site, itemId);
  if (m.status !== "suggested" && m.status !== "confirmed") throw new StoreError(409, `Item is already ${m.status}`);
  Object.assign(m, { status: "dismissed", dismissedBy: session.name, dismissedAt: nowIso(), dismissNote: text, blocking: false });
  m.history.push(hist(session, "dismissed", text));
  persist();
  return { item: m };
}

/** Close a confirmed item. Requirements: engineer + deterministic document check. Others: EQORE user. */
export function resolveItem(siteId: string, itemId: string, session: Session, input: { note?: string; revisionId?: string }) {
  requireEqore(session);
  const site = siteOr404(siteId);
  const m = itemOr404(site, itemId);
  if (m.status !== "confirmed") throw new StoreError(409, m.status === "suggested" ? "Confirm the suggestion before resolving it" : `Item is already ${m.status}`);
  if (m.kind === "requirement" && !session.engineer) throw new StoreError(403, `${session.name} is not an authorized engineer — requirements are resolved by engineers`);
  const text = requireNote(input.note, "Resolving a project-memory item");
  if (m.kind === "requirement" && m.requirementId) {
    const name = REQ_BY_ID[m.requirementId]?.name ?? m.requirementId;
    const approved = latestApproved(site, m.requirementId);
    const rev = input.revisionId ? site.documents.find((d) => d.id === input.revisionId) : approved;
    if (!rev) throw new StoreError(409, `No approved ${name} on file — upload it and have an engineer approve it first`);
    if (rev.requirementId !== m.requirementId) throw new StoreError(400, `Revision is not a ${name}`);
    if (rev.status !== "approved" || approved?.id !== rev.id) throw new StoreError(409, `${name} Rev ${rev.revLabel} is not the current approved revision`);
    const since = requestedAt(m);
    if (m.requiresUpdatedRevision && rev.uploadedAt < since) throw new StoreError(409, `${name} Rev ${rev.revLabel} predates the request (${since.slice(0, 10)}) — an updated revision is required`);
    Object.assign(m, { resolvedRevisionId: rev.id, resolvedRevisionSha256: rev.sha256 });
  }
  Object.assign(m, { status: "resolved", resolvedById: session.userId, resolvedBy: session.name, resolvedAt: nowIso(), resolutionNote: text });
  if (m.kind === "decision") m.decisionState = "made";
  m.history.push(hist(session, "resolved", m.resolvedRevisionId ? `${text} (satisfied by ${m.resolvedRevisionId}, sha256 ${m.resolvedRevisionSha256?.slice(0, 12)}…)` : text));
  persist();
  return { item: m };
}

export const getMemory = (siteId: string) => {
  const site = siteOr404(siteId);
  return { items: site.memory ?? [], communications: site.communications ?? [] };
};
