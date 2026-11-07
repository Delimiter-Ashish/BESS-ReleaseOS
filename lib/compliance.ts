import { CHANGE_LABEL, REQUIREMENTS, STAGES, stageIndex, type Requirement, type Role } from "./requirements";
import { TODAY } from "./seed";
import { dependencyFlags, latestApproved, pendingRevision } from "./release";
import type { ChangeEvent, DocRecord, Site } from "./types";

export type ReqStatus = "ok" | "due_soon" | "overdue" | "outdated" | "missing" | "todo" | "pending_review";

export const STATUS_META: Record<ReqStatus, { label: string; color: string; dot: string; rank: number }> = {
  missing: { label: "Missing", color: "bg-red-50 text-red-700 ring-red-200", dot: "bg-red-500", rank: 0 },
  outdated: { label: "Outdated", color: "bg-orange-50 text-orange-700 ring-orange-200", dot: "bg-orange-500", rank: 1 },
  overdue: { label: "Overdue", color: "bg-red-50 text-red-700 ring-red-200", dot: "bg-red-500", rank: 2 },
  pending_review: { label: "Needs review", color: "bg-violet-50 text-violet-700 ring-violet-200", dot: "bg-violet-500", rank: 3 },
  due_soon: { label: "Due soon", color: "bg-amber-50 text-amber-700 ring-amber-200", dot: "bg-amber-500", rank: 4 },
  todo: { label: "In progress", color: "bg-sky-50 text-sky-700 ring-sky-200", dot: "bg-sky-500", rank: 5 },
  ok: { label: "Current", color: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500", rank: 6 },
};

export interface ReqState {
  req: Requirement;
  status: ReqStatus;
  doc?: DocRecord;
  reason: string;
  dueDate?: string;
  triggeredBy?: ChangeEvent;
}

const day = 86400000;
const addDays = (d: string, n: number) => new Date(new Date(d).getTime() + n * day).toISOString().slice(0, 10);

export function applicableRequirements(site: Site): Requirement[] {
  const si = stageIndex(site.stage);
  return REQUIREMENTS.filter((r) => {
    if (r.stage === "decommissioning") return site.stage === "decommissioning";
    return stageIndex(r.stage) <= si;
  });
}

export function latestDoc(site: Site, reqId: string): DocRecord | undefined {
  return latestApproved(site, reqId);
}

export function evaluateRequirement(site: Site, req: Requirement, now = TODAY): ReqState {
  const doc = latestApproved(site, req.id);
  const pending = pendingRevision(site, req.id);
  const isCurrentStage = req.stage === site.stage;
  if (!doc) {
    if (pending) return { req, status: "pending_review", reason: `Rev ${pending.revLabel} uploaded, waiting for engineer approval` };
    if (isCurrentStage || req.optional)
      return { req, status: "todo", reason: req.optional ? "Optional — not enrolled yet" : `Needed to complete ${STAGES[stageIndex(req.stage)].label}` };
    return { req, status: "missing", reason: `Required by ${req.codeRef} — no approved document on file` };
  }
  if (pending) return { req, status: "pending_review", doc, reason: `Rev ${pending.revLabel} awaiting review · Rev ${doc.revLabel} is the approved version` };
  const flags = dependencyFlags(site, req.id);
  if (flags.length) return { req, status: "outdated", doc, reason: flags[0] };

  const trigger = site.events
    .filter((e) => req.triggers.includes(e.type) && e.date > doc.effectiveDate)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (trigger)
    return {
      req,
      status: "outdated",
      doc,
      triggeredBy: trigger,
      reason: `Site change on ${trigger.date} (${CHANGE_LABEL[trigger.type]}) after last update`,
    };

  if (req.recurrenceDays) {
    const due = addDays(doc.effectiveDate, req.recurrenceDays);
    const days = Math.round((new Date(due).getTime() - now.getTime()) / day);
    if (days < 0) return { req, status: "overdue", doc, dueDate: due, reason: `Refresh was due ${due} (${-days} days ago)` };
    if (days <= 45) return { req, status: "due_soon", doc, dueDate: due, reason: `Due ${due} (in ${days} days)` };
    return { req, status: "ok", doc, dueDate: due, reason: `Next refresh ${due}` };
  }
  return { req, status: "ok", doc, reason: `Rev ${doc.revLabel} · approved ${String(doc.approvedAt ?? doc.effectiveDate).slice(0, 10)}` };
}

export function evaluateSite(site: Site) {
  const states = applicableRequirements(site).map((r) => evaluateRequirement(site, r));
  const scored = states.filter((s) => !s.req.optional && s.status !== "todo");
  const okCount = scored.filter((s) => s.status === "ok" || s.status === "due_soon").length;
  const score = scored.length ? Math.round((okCount / scored.length) * 100) : 100;
  const count = (st: ReqStatus) => states.filter((s) => s.status === st).length;
  const issues = count("missing") + count("outdated") + count("overdue");
  const health: "red" | "amber" | "green" = issues > 0 ? "red" : count("due_soon") + count("pending_review") > 0 ? "amber" : "green";
  return {
    states,
    score,
    issues,
    health,
    counts: {
      missing: count("missing"),
      outdated: count("outdated"),
      overdue: count("overdue"),
      due_soon: count("due_soon"),
      pending_review: count("pending_review"),
      todo: count("todo"),
      ok: count("ok"),
    },
  };
}

/** Which requirements a proposed change would invalidate (for "what changed?" preview). */
export function impactOfChange(site: Site, type: ChangeEvent["type"]) {
  return applicableRequirements(site).filter((r) => r.triggers.includes(type));
}

export function canSee(req: Requirement, role: Role) {
  return role === "eqore" || req.access.includes(role);
}
