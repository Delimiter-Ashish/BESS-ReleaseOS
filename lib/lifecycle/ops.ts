// Lifecycle mutations. Every action: server-side session identity → role check → validation → mutation of the
// EXISTING site record (Site.lifecycle, site.events, site.decisions) → history entry → persist(). No second store.
import { createHash, randomBytes } from "node:crypto";
import { AuthError, type Session } from "../auth";
import { readTextLayer } from "../pdf";
import { CHANGE_LABEL, DOCUMENT_TYPES, REQ_BY_ID, STAGES, stageIndex, type StageId } from "../requirements";
import { latestApproved, pendingRevision } from "../release";
import { bytesFor, findRevision, getSite, persist, StoreError } from "../store";
import type { DecisionRecord, Site } from "../types";
import { clockNow, isDate, isValidTimezone, localDate, nowIso } from "./clock";
import { assessChange, CHANGE_KIND_BY_ID } from "./impact";
import { CATEGORIES, ensureLifecycle, isApplicable, PUBLISHABLE_TYPES, stageLabel } from "./register";
import type { ComplianceEvent, EmergencyPublication, LifecycleAction, LifecycleState, Obligation, ObligationImpact, SiteChange } from "./types";


const short = () => randomBytes(4).toString("hex");
const text = (v: unknown, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : "");
function need(cond: unknown, status: number, msg: string): asserts cond { if (!cond) throw new StoreError(status, msg); }
const requireNote = (note: unknown, what: string) => { const n = text(note); need(n.length >= 5, 400, `A note (at least 5 characters) is required to ${what}`); return n; };

function requireRole(s: Session, roles: Session["role"][], what: string) {
  if (s.role === "public") throw new AuthError(401, "Sign in required");
  if (!roles.includes(s.role)) throw new AuthError(403, `${s.name} is not permitted to ${what}`);
}
function requireEngineer(s: Session, what: string) {
  if (s.role === "public") throw new AuthError(401, "Sign in required");
  if (!s.engineer) throw new AuthError(403, `${s.name} is not an authorized engineer — cannot ${what}`);
}

export function siteAndLifecycle(siteId: string, at = nowIso()) {
  const site = getSite(siteId);
  need(site, 404, "site not found");
  const created = ensureLifecycle(site, at);
  return { site, lc: site.lifecycle as LifecycleState, created };
}
const obligation = (lc: LifecycleState, id: unknown) => { const o = lc.obligations.find((x) => x.id === id); need(o, 404, "obligation not found"); return o; };
const log = (ob: Obligation, s: Session, at: string, action: string, detail: string) => { ob.history.push({ at, by: s.name, byId: s.userId, action, detail }); ob.updatedAt = at; };
const today = (lc: LifecycleState) => localDate(clockNow(), lc.timezone);

function decision(site: Site, s: Session, at: string, d: Pick<DecisionRecord, "kind" | "decision" | "note" | "taskIds"> & Partial<DecisionRecord>): DecisionRecord {
  const rec: DecisionRecord = { id: `DEC-${short()}`, siteId: site.id, reviewerId: s.userId, reviewerName: s.name, reviewerRoles: s.roles, at, ...d };
  (site.decisions ??= []).push(rec);
  return rec;
}

/** Text pages of the current approved revision for every obligation a change could touch (for evidence). */
async function candidatePages(site: Site, lc: LifecycleState, base: string) {
  const pages = new Map<string, string[]>();
  for (const ob of lc.obligations) {
    if (!ob.reviewTriggers.includes(base as never)) continue;
    const doc = latestApproved(site, ob.requirementId);
    if (!doc || pages.has(doc.id)) continue;
    if (doc.textLayer && doc.textLayer.trim().length > 20) {
      pages.set(doc.id, doc.textLayer.split(/\f?\[page \d+\]\n?/).filter((p, i) => i > 0 || p.trim()));
      continue;
    }
    try {
      const bytes = bytesFor(doc);
      if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") pages.set(doc.id, (await readTextLayer("application/pdf", bytes)).pages);
    } catch {
      /* unreadable → no evidence; the assessment says so */
    }
  }
  return pages;
}

export async function lifecycleAction(siteId: string, a: LifecycleAction, s: Session): Promise<Record<string, unknown>> {
  // Async work (text extraction) happens BEFORE any mutation; the mutation itself is synchronous.
  let pages: Map<string, string[]> | undefined;
  if (a.action === "confirm_change") {
    const { site, lc } = siteAndLifecycle(siteId);
    const ch = lc.changes.find((c) => c.id === a.changeId);
    if (ch) pages = await candidatePages(site, lc, ch.baseType);
  }
  const at = nowIso();
  const { site, lc } = siteAndLifecycle(siteId, at);
  const out = apply(site, lc, a, s, at, pages ?? new Map());
  persist();
  return out;
}

function apply(site: Site, lc: LifecycleState, a: LifecycleAction, s: Session, at: string, pages: Map<string, string[]>): Record<string, unknown> {
  switch (a.action) {
    case "set_stage": {
      requireRole(s, ["eqore"], "change the project stage");
      const to = a.to as StageId;
      need(STAGES.some((x) => x.id === to), 400, "unknown stage");
      need(to !== site.stage, 409, `The site is already at ${stageLabel(to)}`);
      const note = requireNote(a.note, "change the project stage");
      const tr = { from: site.stage, to, by: s.name, byId: s.userId, at, note };
      lc.stageHistory.push(tr);
      site.stage = to;
      for (const ob of lc.obligations) if (isApplicable(ob.stage, to) !== isApplicable(ob.stage, tr.from)) log(ob, s, at, isApplicable(ob.stage, to) ? "became_applicable" : "no_longer_applicable", `Stage ${stageLabel(tr.from)} → ${stageLabel(to)}`);
      return { transition: tr, direction: stageIndex(to) > stageIndex(tr.from) ? "forward" : "backward" };
    }
    case "settings": {
      requireRole(s, ["eqore"], "change lifecycle settings");
      const note = requireNote(a.note, "change lifecycle settings");
      if (a.warningDays !== undefined) { need(Number.isInteger(a.warningDays) && a.warningDays >= 0 && a.warningDays <= 365, 400, "warningDays must be an integer 0–365"); lc.warningDays = a.warningDays; }
      if (a.timezone !== undefined) { need(isValidTimezone(a.timezone), 400, "unknown time zone"); lc.timezone = a.timezone; }
      lc.settingsHistory.push({ at, by: s.name, timezone: lc.timezone, warningDays: lc.warningDays, note });
      return { warningDays: lc.warningDays, timezone: lc.timezone };
    }
    case "add_obligation": {
      requireRole(s, ["eqore"], "configure obligations");
      const req = REQ_BY_ID[a.requirementId];
      need(req && DOCUMENT_TYPES.includes(req), 400, "unknown document type");
      need(CATEGORIES.includes(a.category), 400, "unknown category");
      const title = text(a.title, 160);
      need(title.length >= 3, 400, "title required");
      const note = requireNote(a.note, "configure an obligation");
      need(!lc.obligations.some((o) => o.title.toLowerCase() === title.toLowerCase()), 409, `An obligation titled “${title}” already exists`);
      const ob: Obligation = {
        id: `OBL-${site.id}-${req.id}-${short()}`, siteId: site.id, category: a.category, requirementId: req.id, title, kind: a.kind === "document" ? "document" : "record", stage: req.stage,
        source: { kind: "project_config", citation: `Project-specific (configured by ${s.name})`, label: `Project configuration: ${note}` },
        responsible: text(a.responsible, 160) || "Facility operator + EQORE field service", reviewer: "engineer", reviewTriggers: [],
        createdAt: at, updatedAt: at, history: [{ at, by: s.name, byId: s.userId, action: "created", detail: `Project-specific obligation: ${note}` }],
      };
      lc.obligations.push(ob);
      if (a.dueDate !== undefined) setDue(lc, ob, s, at, a.dueDate, a.warningDays, note);
      return { obligation: ob };
    }
    case "set_due": {
      requireRole(s, ["eqore"], "set due dates");
      const ob = obligation(lc, a.obligationId);
      setDue(lc, ob, s, at, a.dueDate, a.warningDays, requireNote(a.note, "set a due date"));
      return { obligation: ob };
    }
    case "propose_change": {
      requireRole(s, ["eqore", "facility"], "record site changes");
      const kind = CHANGE_KIND_BY_ID[a.kind];
      need(kind, 400, "unknown change kind");
      need(isDate(a.effectiveDate), 400, "effectiveDate must be YYYY-MM-DD");
      need(a.effectiveDate <= today(lc), 400, "A site change can only be recorded once it has happened (effectiveDate is in the future)");
      const description = text(a.description, 600);
      need(description.length >= 5, 400, "description required");
      let origin: SiteChange["origin"] = "manual";
      if (a.memoryItemId) {
        const m = (site.memory ?? []).find((x) => x.id === a.memoryItemId);
        need(m, 404, "memory item not found");
        origin = "memory_suggestion";
      }
      const from = text(a.from, 120) || undefined, to = text(a.to, 120) || undefined;
      const dup = lc.changes.find((c) => c.status !== "dismissed" && c.kind === a.kind && c.effectiveDate === a.effectiveDate && (c.from ?? "") === (from ?? "") && (c.to ?? "") === (to ?? ""));
      need(!dup, 409, `This change is already recorded (${dup?.id}, ${dup?.status})`);
      const ch: SiteChange = { id: `CHG-${short()}`, siteId: site.id, kind: a.kind, baseType: kind.base, description, component: text(a.component, 120) || undefined, from, to, effectiveDate: a.effectiveDate, origin, memoryItemId: a.memoryItemId, status: "proposed", proposedBy: s.name, proposedById: s.userId, proposedAt: at };
      lc.changes.push(ch);
      return { change: ch, note: "Proposed only — no obligation is flagged until an EQORE user confirms the change." };
    }
    case "confirm_change":
    case "dismiss_change": {
      requireRole(s, ["eqore"], a.action === "confirm_change" ? "confirm site changes" : "dismiss site changes");
      const ch = lc.changes.find((c) => c.id === a.changeId);
      need(ch, 404, "change not found");
      need(ch.status === "proposed", 409, `Change is already ${ch.status}`);
      const note = requireNote(a.note, a.action === "confirm_change" ? "confirm a site change" : "dismiss a site change");
      Object.assign(ch, { decidedBy: s.name, decidedById: s.userId, decidedAt: at, decisionNote: note });
      if (a.action === "dismiss_change") { ch.status = "dismissed"; return { change: ch, impacts: [] }; }
      ch.status = "confirmed";
      // Existing site change log (feeds the portfolio compliance view's change triggers).
      site.events.push({ id: ch.id, type: ch.baseType, date: ch.effectiveDate, description: ch.description, by: s.name });
      const { assessment, impacts } = assessChange(site, lc, ch, (id) => pages.get(id));
      ch.assessment = assessment;
      const created: ObligationImpact[] = impacts.map((i) => ({ ...i, id: `IMP-${short()}`, raisedAt: at }));
      lc.impacts.push(...created);
      for (const i of created) log(obligation(lc, i.obligationId), s, at, "impact_raised", `${i.what} — engineer review requested${i.evidence.length ? ` (evidence: ${i.evidence.length} quote(s))` : ""}`);
      return { change: ch, impacts: created };
    }
    case "resolve_impact": {
      requireEngineer(s, "resolve a lifecycle review");
      const imp = lc.impacts.find((i) => i.id === a.impactId);
      need(imp, 404, "impact not found");
      need(imp.status === "open", 409, "already resolved");
      const note = requireNote(a.note, "resolve a lifecycle review");
      const ch = lc.changes.find((c) => c.id === imp.changeId)!;
      const ob = obligation(lc, imp.obligationId);
      let revisionId: string | undefined;
      if (a.resolution === "new_revision_approved") {
        const pend = pendingRevision(site, imp.requirementId);
        need(!pend, 409, `Rev ${pend?.revLabel} of ${REQ_BY_ID[imp.requirementId]?.name} is still awaiting engineer review — approve or reject it first`);
        const cur = latestApproved(site, imp.requirementId);
        const baseline = imp.baselineRevisionId ? findRevision(site, imp.baselineRevisionId) : undefined;
        need(cur && cur.id !== imp.baselineRevisionId && cur.version > (baseline?.version ?? 0) && (cur.approvedAt ?? "") >= (ch.decidedAt ?? ""), 409, `No revision of ${REQ_BY_ID[imp.requirementId]?.name} has been approved since the change was confirmed — upload the updated document and have it approved first`);
        revisionId = cur.id;
      } else {
        need(a.resolution === "confirmed_no_change", 400, "resolution must be new_revision_approved or confirmed_no_change");
        need(note.length >= 20, 400, "A no-change decision needs a justification of at least 20 characters");
      }
      const dec = decision(site, s, at, { kind: "lifecycle_review", decision: "resolved", note, taskIds: [imp.id], revisionId, contentSha256: revisionId ? findRevision(site, revisionId)?.sha256 : undefined });
      Object.assign(imp, { status: "resolved", resolution: a.resolution, resolvedBy: s.name, resolvedById: s.userId, resolvedAt: at, resolutionNote: note, resolutionRevisionId: revisionId, decisionId: dec.id });
      log(ob, s, at, "impact_resolved", `${a.resolution === "new_revision_approved" ? `Updated revision ${findRevision(site, revisionId!)?.revLabel} approved` : "Confirmed no change needed"} — ${note}`);
      return { impact: imp, decision: dec };
    }
    case "record_event": {
      requireRole(s, ["eqore", "facility"], "record maintenance, test, repair or training events");
      const ob = obligation(lc, a.obligationId);
      need(ob.kind === "record", 409, "Events can only be recorded against record-type obligations");
      need(isApplicable(ob.stage, site.stage), 409, `${ob.title} is not applicable at ${stageLabel(site.stage)}`);
      need(["maintenance", "test", "repair", "training", "inspection"].includes(a.type), 400, "unknown event type");
      need(isDate(a.performedOn), 400, "performedOn must be YYYY-MM-DD");
      need(a.performedOn <= today(lc), 400, "performedOn cannot be in the future");
      const performedBy = text(a.performedBy, 120), summary = text(a.summary, 600);
      need(performedBy && summary.length >= 5, 400, "performedBy and summary are required");
      const fingerprint = createHash("sha256").update(`${ob.id}|${a.type}|${a.performedOn}`).digest("hex").slice(0, 16);
      const dup = lc.events.find((e) => e.fingerprint === fingerprint);
      need(!dup, 409, `Duplicate: a ${a.type} record for ${ob.title} on ${a.performedOn} already exists (${dup?.id})`);
      const ev: ComplianceEvent = { id: `EVT-${short()}`, siteId: site.id, obligationId: ob.id, type: a.type, performedOn: a.performedOn, performedBy, summary, recordedBy: s.name, recordedById: s.userId, recordedAt: at, fingerprint };
      lc.events.push(ev);
      site.events.push({ id: ev.id, type: "maintenance_action", date: ev.performedOn, description: `${a.type}: ${summary}`, by: s.name });
      log(ob, s, at, "event_recorded", `${a.type} on ${a.performedOn} by ${performedBy} — not complete until evidence is reviewed`);
      const opsLog = lc.obligations.find((o) => o.requirementId === "ops_record" && o.kind === "document");
      if (opsLog && opsLog.id !== ob.id) log(opsLog, s, at, "log_entry_required", `${a.type} on ${a.performedOn} (${ev.id}) must be entered in the operations record`);
      return { event: ev };
    }
    case "verify_completion": {
      requireEngineer(s, "verify a maintenance/test record");
      const ob = obligation(lc, a.obligationId);
      const ev = lc.events.find((e) => e.id === a.eventId && e.obligationId === ob.id);
      need(ev, 404, "event not found for this obligation");
      need(!ev.evidenceRevisionId, 409, "This event is already verified");
      need(!(ob.completion && (!ob.due || ob.completion.forDueDate === ob.due.date)), 409, "This cycle is already completed");
      const rev = findRevision(site, a.evidenceRevisionId);
      need(rev, 404, "evidence revision not found");
      need(rev.requirementId === ob.requirementId, 409, `Evidence must be a ${REQ_BY_ID[ob.requirementId]?.name} document`);
      need(rev.status === "approved", 409, `Evidence Rev ${rev.revLabel} is ${rev.status} — an uploaded file is not proof until an engineer has reviewed and approved it`);
      need(!lc.events.some((e) => e.evidenceRevisionId === rev.id), 409, "That evidence is already linked to another event");
      const note = requireNote(a.note, "verify completion");
      const dec = decision(site, s, at, { kind: "lifecycle_review", decision: "resolved", note, taskIds: [ev.id], revisionId: rev.id, contentSha256: rev.sha256 });
      ev.evidenceRevisionId = rev.id;
      ob.completion = { forDueDate: ob.due?.date, eventId: ev.id, evidenceRevisionId: rev.id, decisionId: dec.id, verifiedBy: s.name, verifiedById: s.userId, verifiedAt: at, note };
      log(ob, s, at, "completed", `Verified against ${REQ_BY_ID[rev.requirementId]?.name} Rev ${rev.revLabel} (sha256 ${rev.sha256.slice(0, 12)}…)`);
      const opsLog = lc.obligations.find((o) => o.requirementId === "ops_record" && o.kind === "document");
      if (opsLog && opsLog.id !== ob.id) log(opsLog, s, at, "log_updated", `${ev.type} on ${ev.performedOn} evidenced by Rev ${rev.revLabel}`);
      return { obligation: ob, decision: dec };
    }
    case "publish_emergency": {
      requireEngineer(s, "approve public emergency information");
      const rev = findRevision(site, a.revisionId);
      need(rev, 404, "revision not found");
      need(PUBLISHABLE_TYPES.includes(rev.requirementId), 409, `${REQ_BY_ID[rev.requirementId]?.name ?? rev.requirementId} is not a publishable emergency document type`);
      need(rev.status === "approved" && latestApproved(site, rev.requirementId)?.id === rev.id, 409, "Only the current approved revision can be published");
      need(!lc.publications.some((p) => p.status === "published" && p.revisionId === rev.id), 409, "Already published");
      const note = requireNote(a.note, "publish emergency information");
      const pub: EmergencyPublication = { id: `PUB-${short()}`, siteId: site.id, revisionId: rev.id, requirementId: rev.requirementId, sha256: rev.sha256, title: `${REQ_BY_ID[rev.requirementId]?.name} Rev ${rev.revLabel}`, status: "published", publishedBy: s.name, publishedById: s.userId, publishedAt: at, note };
      lc.publications.push(pub);
      const dec = decision(site, s, at, { kind: "emergency_publication", decision: "approved", note, taskIds: [pub.id], revisionId: rev.id, contentSha256: rev.sha256 });
      return { publication: pub, decision: dec };
    }
    case "withdraw_emergency": {
      requireRole(s, ["eqore"], "withdraw public emergency information");
      const pub = lc.publications.find((p) => p.id === a.publicationId);
      need(pub && pub.status === "published", 404, "active publication not found");
      requireNote(a.note, "withdraw a publication");
      Object.assign(pub, { status: "withdrawn", withdrawnBy: s.name, withdrawnAt: at });
      return { publication: pub };
    }
  }
  throw new StoreError(400, "unknown action");
}

function setDue(lc: LifecycleState, ob: Obligation, s: Session, at: string, date: unknown, warningDays: unknown, note: string) {
  need(isDate(date), 400, "dueDate must be a valid YYYY-MM-DD date");
  if (warningDays !== undefined) need(Number.isInteger(warningDays) && (warningDays as number) >= 0 && (warningDays as number) <= 365, 400, "warningDays must be an integer 0–365");
  if (ob.completion && ob.completion.forDueDate !== date) { (ob.pastCycles ??= []).push(ob.completion); ob.completion = undefined; }
  const prev = ob.due?.date;
  ob.due = { date, warningDays: warningDays as number | undefined, basis: "project_specific", synthetic: true, setBy: s.name, setById: s.userId, setAt: at, note };
  log(ob, s, at, "due_set", `${prev ? `Due date ${prev} → ` : "Due date "}${date}${warningDays !== undefined ? `, warning window ${warningDays} days` : ""} — project-specific (synthetic demo data): ${note}`);
}

/** Public, explicitly published emergency information only (QR page). */
export function publicEmergency(siteId: string) {
  const site = getSite(siteId);
  if (!site) return null;
  const pubs = (site.lifecycle?.publications ?? []).filter((p) => p.status === "published").map((p) => {
    const rev = findRevision(site, p.revisionId);
    const current = !!rev && rev.status === "approved" && latestApproved(site, rev.requirementId)?.id === rev.id && rev.sha256 === p.sha256;
    return { id: p.id, title: p.title, publishedAt: p.publishedAt, sha256: p.sha256, current, href: current ? `/api/public/sites/${site.id}/emergency/${p.id}` : undefined };
  });
  return { site: { id: site.id, name: site.name, address: site.address, chemistry: site.chemistry, location: site.location, disconnectLocation: site.disconnectLocation }, publications: pubs };
}
export const CHANGE_TYPE_LABEL = CHANGE_LABEL;
