// Deterministic fallback for communication intelligence (no AI). Labeled "rules" everywhere it is shown.
// Sentence-level keyword patterns; evidence is always the exact sentence, so it is verifiable.
// Deliberately conservative: it may miss items, it must not invent them.
import { DOCUMENT_TYPES } from "../requirements";
import type { CommunicationChannel } from "./types";

/** Extra phrases that identify a document type in prose (beyond its catalog name). */
const DOC_SYNONYMS: Record<string, RegExp> = {
  ventilation_plan: /\b(ventilation|exhaust)\b[\w\s/&-]{0,30}\b(plan|design|calc\w*|drawing)s?\b|\bexplosion control\b/i,
  plan_set: /\bplan set\b|\bstamped plans?\b|\bdrawings? set\b/i,
  switchgear_datasheet: /\bswitchgear\b|\bac disconnect\b/i,
  inverter_datasheet: /\binverter\b|\bpcs\b/i,
  battery_datasheet: /\bbattery datasheet\b|\bbess datasheet\b/i,
  ul9540a_report: /\b9540a\b/i,
  ul9540_listing: /\bul\s*9540\b(?!a)/i,
  sds: /\bsafety data sheet\b|\bsds\b/i,
  eop: /\bemergency (operations|response) plan\b/i,
  signage: /\bsignage\b|\bplacards?\b|\bwarning labels?\b/i,
  utility_bill: /\butility bill\b/i,
  site_photos: /\bsite photos?\b/i,
  ix_application: /\binterconnection application\b/i,
  cx_plan: /\bcommissioning plan\b/i,
  cx_report: /\bcommissioning report\b/i,
};

const REQUIRE = /\b(please (provide|submit|include|send|update|revise|resubmit)|must (be )?(provide|submit|include|show|be)|shall|is required|are required|required (to|before|for)|need(s)? (to (be )?)?(provide|submit|include|an?|the|updated|revised)|resubmit|revise and resubmit|cannot (be )?(approve|accept|issue|proceed))\b/i;
const UPDATED = /\b(updated|revised|new|current|re-?issued?|latest)\b/i;
const BLOCKING = /\b(before (we|the (permit|application|submission))|prior to (approval|permit|issuance)|cannot (approve|accept|issue|proceed)|will not (be )?(approve|issue|accept)|required for (approval|permit))\b/i;
const DECISION = /\b(we (have )?(decided|agreed)|decision:|it was (decided|agreed)|will proceed with|we('| a)re going with)\b/i;
const ACTION = /\b(I|we|[A-Z][a-z]+) will (send|provide|submit|update|revise|confirm|schedule|follow up|prepare|issue)\b|\baction( item)?:/;
const DATE = /\b(20\d{2}-\d{2}-\d{2})\b/;

function sentences(body: string) {
  // Ignore header lines and quoted-reply markers; keep the original sentence text for evidence.
  const lines = body.split(/\r?\n/).filter((l) => !/^\s*(from|to|cc|sent|date|subject):/i.test(l)).map((l) => l.replace(/^\s*>+\s?/, ""));
  return lines.join("\n").split(/(?<=[.?!])\s+|\n{2,}|\n(?=\s*[-*•\d]+[.)]?\s)/).map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length >= 12);
}

function docTypeFor(s: string) {
  for (const [id, re] of Object.entries(DOC_SYNONYMS)) if (re.test(s)) return id;
  const byName = DOCUMENT_TYPES.find((r) => s.toLowerCase().includes(r.name.toLowerCase().split(" (")[0]));
  return byName?.id;
}

export function rulesAnalyzeCommunication(body: string, meta: { channel: CommunicationChannel; sender: string }) {
  const fromAhj = meta.channel === "ahj_comment" || /\b(fire|building|marshal|inspector|town of|city of|county|ahj|plan review)\b/i.test(meta.sender);
  const fromUtility = /\b(utility|eversource|national grid|pg&e|interconnection)\b/i.test(meta.sender);
  const templateIds = fromAhj ? ["ahj_permit"] : fromUtility ? ["interconnection"] : [];
  const authority = fromAhj ? "ahj" : fromUtility ? "utility" : null;
  const items: Record<string, unknown>[] = [];
  for (const s of sentences(body)) {
    if (/ignore (all |any )?(previous|prior) instructions|mark (this|it|all) (as )?(approved|resolved|complete)/i.test(s)) continue; // reported below
    const base = { evidence: s.slice(0, 400), detail: s.slice(0, 600), dueDate: s.match(DATE)?.[1] ?? null, responsibleParty: null, confidence: 0.6, decisionState: null };
    if (s.endsWith("?")) {
      items.push({ ...base, kind: "question", title: s.slice(0, 140), requirementId: docTypeFor(s) ?? null, templateIds, authority, proposedBlocking: false, requiresUpdatedRevision: false });
    } else if (REQUIRE.test(s)) {
      const rid = docTypeFor(s);
      const name = rid ? DOCUMENT_TYPES.find((r) => r.id === rid)!.name : undefined;
      items.push({ ...base, kind: "requirement", title: name ? `${UPDATED.test(s) ? "Provide updated" : "Provide"} ${name.toLowerCase()}` : s.slice(0, 140), requirementId: rid ?? null, templateIds, authority, proposedBlocking: fromAhj || BLOCKING.test(s), requiresUpdatedRevision: !!rid && UPDATED.test(s) });
    } else if (DECISION.test(s)) {
      items.push({ ...base, kind: "decision", title: s.slice(0, 140), requirementId: docTypeFor(s) ?? null, templateIds: [], authority: null, proposedBlocking: false, requiresUpdatedRevision: false, decisionState: "made" });
    } else if (ACTION.test(s)) {
      items.push({ ...base, kind: "action_item", title: s.slice(0, 140), requirementId: docTypeFor(s) ?? null, templateIds: [], authority: null, responsibleParty: s.match(/\b([A-Z][a-z]+) will\b/)?.[1] ?? null, proposedBlocking: false, requiresUpdatedRevision: false });
    }
  }
  const injected = body.split(/\r?\n/).filter((l) => /ignore (all |any )?(previous|prior) instructions|mark (this|it|all) (as )?(approved|resolved|complete)|system prompt/i.test(l)).map((l) => l.trim()).slice(0, 5);
  const refs = sentences(body).flatMap((s) => {
    const rid = docTypeFor(s);
    if (!rid) return [];
    const rev = s.match(/\brev(?:ision)?\.?\s*([A-Z0-9]{1,3})\b/i)?.[1] ?? null;
    return [{ reference: DOCUMENT_TYPES.find((r) => r.id === rid)!.name, requirementId: rid, revisionLabel: rev, evidence: s.slice(0, 400) }];
  });
  return {
    summary: `Deterministic keyword scan found ${items.length} candidate item(s). Not AI — verify each suggestion.`,
    items, documentReferences: refs, stakeholders: [{ name: meta.sender, organization: null, role: null }],
    embeddedInstructionsDetected: injected, warnings: [],
  };
}
