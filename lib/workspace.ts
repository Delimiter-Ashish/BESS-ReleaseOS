// ===== Project Assurance view models (owner: Kaushik) =====
// Pure, read-only projections of THE store (lib/store.ts). Every screen derives its metrics and queues from here,
// so uploads, reviews and releases are reflected everywhere after a refresh. No state is kept in this module.
import { can, type Session } from "./auth";
import { pkgLabel } from "./labels";
import { evaluateRequirement } from "./compliance";
import { customerOf, ownerFor, provenanceOf } from "./demo-data";
import { KIND_LABEL, memoryRequiredDocs } from "./memory/readiness";
import { CATEGORY_OF, type BlockerCategory, type MemoryItem, type PreSubmissionCode } from "./memory/types";
import { latestApproved, latestRelease, packageReadiness, pendingRevision, releaseStatus, revisionsOf, type ItemState } from "./release";
import { ON_DEMAND_REQUIREMENTS, PACKAGE_TEMPLATES, REQ_BY_ID, REQUIREMENTS, STAGES, TEMPLATE_BY_ID, stageIndex, type PackageTemplate, type Requirement, type StageId } from "./requirements";
import { getReleases, getReviews, getSite, getSites } from "./store";
import type { EngineeringTask, Fact, FactChange, Revision, ReviewTask, Site } from "./types";

// ---------- shared (client-safe) types ----------
export interface EvidenceFact { label: string; value: string; evidence?: string; page?: number; verified?: boolean; origin?: string }
export interface EvidenceRef {
  key: string;
  projectId: string;
  projectName: string;
  docName: string;
  revisionId?: string;
  revLabel?: string;
  revStatus?: string;
  fileName?: string;
  /** Present only when the original bytes are on record (served by /api/files/:id). */
  fileId?: string;
  mediaType?: string;
  page?: number;
  quote?: string;
  factLabel?: string;
  factValue?: string;
  provenance: string;
  note?: string;
  facts?: EvidenceFact[];
  /** Requirement basis shown when there is no document (e.g. a missing document). */
  basis?: { codeRef: string; mustInclude: string; when: string };
  /** A stored communication (Project Memory). The drawer loads its verbatim text from /api/sites/:id/communications. */
  communication?: { siteId: string; id: string; sender?: string; sentAt?: string; subject?: string; channel?: string; verified?: boolean };
}

export type DocStatus = "missing" | "received" | "pending_review" | "approved" | "rejected" | "outdated" | "not_yet_required";
export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  missing: "Missing", received: "Received", pending_review: "Pending review", approved: "Approved", rejected: "Rejected", outdated: "Outdated", not_yet_required: "Needed later",
};

export interface RegisterRow {
  key: string;
  projectId: string;
  projectName: string;
  requirementId: string;
  docName: string;
  stage: StageId;
  stageLabel: string;
  applicable: boolean;
  inPackage: string[];
  status: DocStatus;
  reason: string;
  revLabel?: string;
  revisionId?: string;
  fileName?: string;
  uploadedAt?: string;
  approvedBy?: string;
  source?: string;
  provenance: string;
  owner: string;
  revisions: { id: string; revLabel: string; status: string; superseded: boolean }[];
  evidence?: EvidenceRef;
  codeRef: string;
}

export type FindingType = "missing_document" | "revision_review" | "engineering_conflict" | "outdated_release" | "outdated_document" | "ahj_requirement";
export type Lifecycle = "detected" | "needs_confirmation" | "action_required" | "resolved" | "dismissed";
export const FINDING_LABEL: Record<FindingType, string> = {
  missing_document: "Missing document", revision_review: "Revision review", engineering_conflict: "Engineering dependency", outdated_release: "Outdated package", outdated_document: "Outdated document", ahj_requirement: "Project Memory",
};
export const LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  detected: "Detected", needs_confirmation: "Needs confirmation", action_required: "Action required", resolved: "Resolved", dismissed: "Dismissed",
};
export interface Finding {
  id: string;
  projectId: string;
  projectName: string;
  type: FindingType;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  lifecycle: Lifecycle;
  backendStatus: string;
  owner: string;
  blocking: string[];
  evidence: EvidenceRef[];
  href: string;
  hrefLabel: string;
  at?: string;
  requirementId?: string;
  /** Project Memory item backing this finding (status suggested/confirmed/resolved/dismissed/merged). */
  memory?: { siteId: string; itemId: string; kind: MemoryItem["kind"]; status: MemoryItem["status"]; blocking: boolean };
}

export interface ReviewItem {
  id: string;
  kind: "revision" | "dependency";
  projectId: string;
  projectName: string;
  requirementId: string;
  docName: string;
  docType: string;
  revLabel: string;
  prevLabel?: string;
  revisionId?: string;
  fileName?: string;
  reason: string;
  priority: "high" | "normal";
  uploadedAt: string;
  reviewer: string;
  status: string;
  open: boolean;
  provenance: string;
  engine?: string;
  model?: string;
  changes: FactChange[];
  materialCount: number;
  aiSummary?: string;
  aiSummarySource?: string;
  raisedTasks: { id: string; dependent: string; status: string }[];
  missingDependents: string[];
  affectedReleases: string[];
  resolvable: { id: string; source: string; sourceApproved: boolean }[];
  selfUpload: boolean;
  warnings: string[];
  evidenceNew?: EvidenceRef;
  evidencePrev?: EvidenceRef;
  // dependency-only
  sourceApproved?: boolean;
  explanation?: string;
  aiImpact?: string;
  changedKeys?: string[];
  dependentName?: string;
  decidedBy?: string;
  decidedAt?: string;
  decisionNote?: string;
}

// ---------- helpers ----------
const docName = (rid: string) => REQ_BY_ID[rid]?.name ?? rid;
const stageLabel = (s: StageId) => STAGES[stageIndex(s)]?.label ?? s;

/** Which packages are the project's *current* submissions (package stage = project stage, or already released). */
export const TEMPLATE_STAGE: Record<string, StageId> = { ahj_permit: "permitting", interconnection: "interconnection", closeout: "commissioning" };
export function relevantTemplates(site: Site) {
  const rels = getReleases(site.id);
  return PACKAGE_TEMPLATES.filter((t) => TEMPLATE_STAGE[t.id] === site.stage || rels.some((r) => r.templateId === t.id));
}

export function revisionProvenance(r: Revision): string {
  if (r.engine && r.engine !== "seed") return "Live upload";
  const base = r.fileId ? "Synthetic demo PDF" : "Synthetic demo record (no source file)";
  return provenanceOf(r.siteId) === "eqore_reference_structure" ? `${base} · structure from EQORE reference plan set` : base;
}
const factOrigin = (f: Fact) => (f.origin === "openai" ? "AI-extracted (OpenAI)" : f.origin === "anthropic" ? "AI-extracted (Anthropic)" : f.origin === "rules" ? "Rule-extracted (deterministic)" : "Seeded value");

export function evidenceForRevision(site: Site, r: Revision, focus?: { key?: string; quote?: string; page?: number; label?: string; value?: string }): EvidenceRef {
  const fact = focus?.key ? r.facts.find((f) => f.key === focus.key) : undefined;
  return {
    key: `${r.id}:${focus?.key ?? ""}`,
    projectId: site.id,
    projectName: site.name,
    docName: docName(r.requirementId),
    revisionId: r.id,
    revLabel: r.revLabel,
    revStatus: r.status,
    fileName: r.fileName,
    fileId: r.fileId,
    mediaType: r.mediaType,
    page: focus?.page ?? fact?.page,
    quote: focus?.quote ?? fact?.evidence,
    factLabel: focus?.label ?? fact?.label,
    factValue: focus?.value ?? (fact ? `${fact.value}${fact.unit ? ` ${fact.unit}` : ""}` : undefined),
    provenance: `${revisionProvenance(r)}${r.status === "approved" && r.approvedBy ? ` · human-approved by ${r.approvedBy}` : ""}`,
    note: r.fileId ? undefined : "No original file is on record for this seeded revision — only its metadata. Upload the real document to inspect it here.",
    facts: r.facts.map((f) => ({ label: f.label, value: `${f.value}${f.unit ? ` ${f.unit}` : ""}`, evidence: f.evidence, page: f.page, verified: f.evidenceVerified, origin: factOrigin(f) })),
  };
}
/** Evidence refs for a Project Memory item: one per source communication, with the verbatim quote. */
export function memoryEvidence(site: Site, m: MemoryItem): EvidenceRef[] {
  return m.sources.map((src, k) => {
    const c = (site.communications ?? []).find((x) => x.id === src.communicationId);
    return {
      key: `mem:${m.id}:${k}`, projectId: site.id, projectName: site.name,
      docName: `${KIND_LABEL[m.kind]} — ${c?.subject ?? src.subject ?? "communication"}`, fileName: `${src.sender} · ${src.sentAt.slice(0, 16).replace("T", " ")}`,
      mediaType: "text/plain", quote: src.evidence,
      provenance: `${m.origin === "openai" ? "AI-extracted (OpenAI)" : m.origin === "rules" ? "Rule-extracted (deterministic)" : "Entered manually"} · ${m.status === "suggested" ? "suggestion — not confirmed" : m.status === "confirmed" ? `confirmed by ${m.confirmedBy}` : m.status}${c?.synthetic ? " · synthetic communication" : ""}`,
      note: src.evidenceVerified ? undefined : "This quote was NOT found verbatim in the stored original — verify before relying on it.",
      communication: { siteId: site.id, id: src.communicationId, sender: src.sender, sentAt: src.sentAt, subject: src.subject, channel: src.channel, verified: src.evidenceVerified },
    };
  });
}

function evidenceForMissing(site: Site, rid: string): EvidenceRef {
  const q = REQ_BY_ID[rid];
  return { key: `missing:${site.id}:${rid}`, projectId: site.id, projectName: site.name, docName: docName(rid), provenance: "Requirement checklist (lib/requirements.ts — illustrative until EQORE confirms)", basis: { codeRef: q.codeRef, mustInclude: q.mustInclude, when: q.when }, note: "No document has been received for this requirement." };
}

/** Documents a package requires for THIS site: its checklist plus documents added by confirmed Project Memory (backend rule). */
export function packageRequires(site: Site, t: PackageTemplate) {
  return [...t.required, ...Array.from(memoryRequiredDocs(site, t.id).keys()).filter((rid) => !t.required.includes(rid))];
}
const ON_DEMAND_IDS = new Set(ON_DEMAND_REQUIREMENTS.map((r) => r.id));
/** Default checklist types + on-demand types (e.g. ventilation plan) that this site needs or has on file. */
export function documentTypesFor(site: Site): Requirement[] {
  const asked = new Set(PACKAGE_TEMPLATES.flatMap((t) => Array.from(memoryRequiredDocs(site, t.id).keys())));
  return [...REQUIREMENTS, ...ON_DEMAND_REQUIREMENTS.filter((r) => asked.has(r.id) || site.documents.some((d) => d.requirementId === r.id))];
}

function applicability(site: Site, rid: string) {
  const req = REQ_BY_ID[rid];
  const si = stageIndex(site.stage), ri = stageIndex(req.stage);
  const inPackage = relevantTemplates(site).filter((t) => packageRequires(site, t).includes(rid)).map((t) => pkgLabel(t.id, t.name));
  const byStage = ON_DEMAND_IDS.has(rid) ? false : req.stage === "decommissioning" ? site.stage === "decommissioning" : ri <= si;
  return { applicable: !req.optional && (byStage || inPackage.length > 0), currentStage: ri === si, inPackage };
}

// ---------- document register ----------
export function documentRegister(siteId?: string): RegisterRow[] {
  const sites = siteId ? [getSite(siteId)!].filter(Boolean) : getSites();
  return sites.flatMap((site) =>
    documentTypesFor(site).map((req): RegisterRow => {
      const revs = revisionsOf(site, req.id);
      const approved = latestApproved(site, req.id);
      const pending = pendingRevision(site, req.id);
      const { applicable, currentStage, inPackage } = applicability(site, req.id);
      const shown = pending ?? approved ?? revs[0];
      let status: DocStatus;
      let reason: string;
      if (pending) { status = "pending_review"; reason = approved ? `Rev ${pending.revLabel} awaiting engineer review · Rev ${approved.revLabel} remains approved` : `Rev ${pending.revLabel} awaiting first engineer approval`; }
      else if (approved) {
        const ev = evaluateRequirement(site, req);
        if (ev.status === "outdated" || ev.status === "overdue") { status = "outdated"; reason = ev.reason; }
        else { status = "approved"; reason = `Rev ${approved.revLabel} approved ${String(approved.approvedAt ?? approved.effectiveDate).slice(0, 10)}${approved.approvedBy ? ` by ${approved.approvedBy}` : ""}`; }
      } else if (revs[0]?.status === "rejected") { status = "rejected"; reason = `Rev ${revs[0].revLabel} rejected${revs[0].rejectedBy ? ` by ${revs[0].rejectedBy}` : ""}`; }
      else if (revs[0]?.status === "uploaded") { status = "received"; reason = "Received, not yet submitted for review"; }
      else if (applicable) { status = "missing"; reason = inPackage.length ? `Required by ${inPackage.join(", ")}` : currentStage ? `Needed to complete ${stageLabel(req.stage)}` : `Required by ${req.codeRef}; no document on file`; }
      else { status = "not_yet_required"; reason = req.optional ? "Optional" : `Needed at ${stageLabel(req.stage)}`; }
      const approvedId = approved?.id;
      return {
        key: `${site.id}:${req.id}`,
        projectId: site.id, projectName: site.name, requirementId: req.id, docName: req.name, stage: req.stage, stageLabel: stageLabel(req.stage),
        applicable, inPackage, status, reason,
        revLabel: shown?.revLabel, revisionId: shown?.id, fileName: shown?.fileName, uploadedAt: shown?.uploadedAt, approvedBy: approved?.approvedBy, source: shown?.source,
        provenance: shown ? revisionProvenance(shown) : "—",
        owner: ownerFor(site.id, req.id).name,
        revisions: revs.map((r) => ({ id: r.id, revLabel: r.revLabel, status: r.status, superseded: r.status === "approved" && r.id !== approvedId })),
        evidence: shown ? evidenceForRevision(site, shown) : status === "missing" ? evidenceForMissing(site, req.id) : undefined,
        codeRef: req.codeRef,
      };
    }),
  );
}

// ---------- review queue ----------
export function reviewQueue(session: Session): ReviewItem[] {
  const items: ReviewItem[] = [];
  const releases = getReleases();
  for (const r of getReviews()) {
    const site = getSite(r.siteId);
    const rev = site?.documents.find((d) => d.id === r.revisionId);
    if (!site || !rev) continue;
    items.push(revisionItem(site, rev, r, session, releases));
  }
  for (const site of getSites()) for (const t of site.engTasks ?? []) if (t.status !== "superseded") items.push(dependencyItem(site, t));
  const rank = (i: ReviewItem) => (i.open ? 0 : 1) * 10 + (i.priority === "high" ? 0 : 1);
  return items.sort((a, b) => rank(a) - rank(b) || (a.uploadedAt < b.uploadedAt ? 1 : -1));
}

function revisionItem(site: Site, rev: Revision, r: ReviewTask, session: Session, releases: ReturnType<typeof getReleases>): ReviewItem {
  const prev = r.previousRevisionId ? site.documents.find((d) => d.id === r.previousRevisionId) : undefined;
  const material = r.materialChangeCount ?? r.changes.filter((c) => c.significance === "material").length;
  const engTasks = site.engTasks ?? [];
  const firstMaterial = r.changes.find((c) => c.significance === "material");
  return {
    id: r.id, kind: "revision", projectId: site.id, projectName: site.name, requirementId: r.requirementId,
    docName: docName(r.requirementId), docType: stageLabel(REQ_BY_ID[r.requirementId]?.stage ?? "design"),
    revLabel: rev.revLabel, prevLabel: prev?.revLabel, revisionId: rev.id, fileName: rev.fileName,
    reason: material ? `${material} material change${material > 1 ? "s" : ""}${firstMaterial ? ` · ${firstMaterial.label} ${firstMaterial.before ?? "—"} → ${firstMaterial.after ?? "—"}` : ""}` : prev ? "New revision — no material change detected" : "First revision — needs engineering approval",
    priority: material > 0 || r.affectedReleaseIds.length > 0 ? "high" : "normal",
    uploadedAt: rev.uploadedAt, reviewer: r.decidedBy ?? r.assignee, status: r.status, open: r.status === "open",
    provenance: revisionProvenance(rev), engine: rev.engine, model: rev.model,
    changes: r.changes, materialCount: material, aiSummary: r.aiSummary, aiSummarySource: r.aiSummarySource,
    raisedTasks: engTasks.filter((t) => t.sourceRevisionId === rev.id).map((t) => ({ id: t.id, dependent: docName(t.dependentRequirementId), status: t.status })),
    missingDependents: (r.potentiallyAffectedMissing ?? []).map(docName),
    affectedReleases: r.affectedReleaseIds.map((id) => { const rel = releases.find((x) => x.id === id); return rel ? `${TEMPLATE_BY_ID[rel.templateId]?.name} R${rel.number}` : id; }),
    resolvable: engTasks.filter((t) => t.status === "open" && t.dependentRequirementId === rev.requirementId).map((t) => ({ id: t.id, source: docName(t.sourceRequirementId), sourceApproved: latestApproved(site, t.sourceRequirementId)?.id === t.sourceRevisionId })),
    selfUpload: !!rev.uploadedById && rev.uploadedById === session.userId,
    warnings: (rev.extractionWarnings ?? []).filter((w) => /embedded instructions|fallback/i.test(w)),
    evidenceNew: evidenceForRevision(site, rev, firstMaterial ? { key: firstMaterial.key, quote: firstMaterial.evidenceAfter, page: firstMaterial.pageAfter, label: firstMaterial.label, value: firstMaterial.after } : undefined),
    evidencePrev: prev ? evidenceForRevision(site, prev, firstMaterial ? { key: firstMaterial.key, quote: firstMaterial.evidenceBefore, page: firstMaterial.pageBefore, label: firstMaterial.label, value: firstMaterial.before } : undefined) : undefined,
    decidedBy: r.decidedBy, decidedAt: r.decidedAt, decisionNote: r.note,
  };
}

function dependencyItem(site: Site, t: EngineeringTask): ReviewItem {
  const src = site.documents.find((d) => d.id === t.sourceRevisionId);
  const dep = t.dependentRevisionId ? site.documents.find((d) => d.id === t.dependentRevisionId) : undefined;
  const sourceApproved = !!src && src.status === "approved" && latestApproved(site, t.sourceRequirementId)?.id === src.id;
  const key = t.changedKeys[0];
  const srcFact = key ? src?.facts.find((f) => f.key === key) : undefined;
  const depFact = key ? dep?.facts.find((f) => f.key === key) : undefined;
  const c0 = t.kind === "consistency" ? t.consistency?.[0] : undefined;
  return {
    id: t.id, kind: "dependency", projectId: site.id, projectName: site.name, requirementId: t.dependentRequirementId,
    docName: docName(t.dependentRequirementId), docType: t.kind === "consistency" ? "Cross-document conflict" : "Dependency review", revLabel: dep?.revLabel ?? "—", revisionId: dep?.id, fileName: dep?.fileName,
    reason: t.kind === "consistency" && t.consistency?.[0]
      ? `${t.consistency[0].quantity}: ${t.consistency[0].b.display} here vs ${t.consistency[0].a.display} in ${docName(t.sourceRequirementId)} Rev ${src?.revLabel ?? "?"}`
      : `${docName(t.sourceRequirementId)} Rev ${src?.revLabel ?? "?"} changed${t.changedKeys.length ? ` (${t.changedKeys.join(", ")})` : ""}`,
    priority: "high", uploadedAt: t.createdAt, reviewer: t.resolvedBy ?? "EQORE engineer", status: t.status, open: t.status === "open",
    provenance: t.kind === "consistency" ? "Raised by the deterministic cross-document check (Project Guardian)" : "Raised deterministically from the dependency graph", changes: [], materialCount: 0,
    raisedTasks: [], missingDependents: [], affectedReleases: [], resolvable: [], selfUpload: false, warnings: [],
    sourceApproved, explanation: t.explanation, aiImpact: t.aiImpact, changedKeys: t.changedKeys, dependentName: docName(t.dependentRequirementId),
    evidenceNew: src ? evidenceForRevision(site, src, c0 ? { quote: c0.a.evidence, page: c0.a.page, label: c0.quantity, value: c0.a.display } : srcFact ? { key } : undefined) : undefined,
    evidencePrev: dep ? evidenceForRevision(site, dep, c0 ? { quote: c0.b.evidence, page: c0.b.page, label: c0.quantity, value: c0.b.display } : depFact ? { key } : undefined) : undefined,
    decidedBy: t.resolvedBy, decidedAt: t.resolvedAt, decisionNote: t.resolutionNote,
  };
}

// ---------- submission readiness ----------
export type ReadinessStatus = "blocked" | "needs_review" | "ready";
export interface ReadinessItemView {
  requirementId: string; name: string; state: ItemState; approved?: { id: string; revLabel: string; fileName: string }; pending?: { id: string; revLabel: string };
  openTasks: { id: string; source: string; explanation: string }[]; owner: string; href: string; action: string; evidence?: EvidenceRef;
}
/** One release-gate issue, exactly as the backend gate (lib/release.ts packageReadiness) reports it. */
export interface GateIssueView {
  code: PreSubmissionCode; category: BlockerCategory; message: string; requirementId?: string; taskId?: string; memoryItemId?: string;
  sourceKind?: string; sourceLabel?: string; evidence?: string; affectedDocument?: string; responsibleParty?: string; nextAction?: string;
  /** True when the issue is not tied to a checklist document (open question, decision, action or document-less requirement). */
  itemless: boolean;
  evidenceRefs: EvidenceRef[];
}
export interface ReadinessView {
  projectId: string; projectName: string; templateId: string; name: string; audience: string; basis: string; current: boolean;
  status: ReadinessStatus; canBuild: boolean; token: string; readyCount: number; items: ReadinessItemView[];
  issues: GateIssueView[]; advisories: { code: string; message: string; memoryItemId: string }[];
  releases: { id: string; number: number; builtAt: string; builtBy: string; state: string; reasons: string[]; note?: string }[];
  nextNumber: number;
}

export function readiness(siteId: string, templateId: string): ReadinessView | undefined {
  const site = getSite(siteId), t = TEMPLATE_BY_ID[templateId];
  if (!site || !t) return undefined;
  const r = packageReadiness(site, t);
  const rels = getReleases(site.id).filter((x) => x.templateId === t.id).sort((a, b) => b.number - a.number);
  const items = r.items.map((i): ReadinessItemView => {
    const reviewHref = (id: string) => `/reviews?project=${site.id}&item=${encodeURIComponent(id)}`;
    const openReview = i.pending ? getReviews(site.id).find((rv) => rv.revisionId === i.pending!.id && rv.status === "open") : undefined;
    const href = i.state === "missing" ? `/inbox?project=${site.id}&expect=${i.requirementId}`
      : (i.state === "in_review" || i.state === "pending_change") && openReview ? reviewHref(openReview.id)
      // needs_eng_review comes from an engineering task OR from a confirmed requirement awaiting explicit resolution (no task).
      : i.state === "needs_eng_review" ? (i.tasks[0] ? reviewHref(i.tasks[0].id) : i.requiredBy[0] ? `/memory?project=${site.id}&type=ahj_requirement&item=${encodeURIComponent(i.requiredBy[0])}` : `/projects/${site.id}?doc=${i.requirementId}`)
      : `/projects/${site.id}?doc=${i.requirementId}`;
    const action = i.state === "missing" ? "Import document" : i.state === "needs_eng_review" ? (i.tasks.length ? "Open dependency review" : "Resolve requirement") : i.state === "ready" ? "View document" : "Open review";
    const shown = i.pending ? site.documents.find((d) => d.id === i.pending!.id) : i.approved;
    return {
      requirementId: i.requirementId, name: i.name, state: i.state,
      approved: i.approved ? { id: i.approved.id, revLabel: i.approved.revLabel, fileName: i.approved.fileName } : undefined,
      pending: i.pending ? { id: i.pending.id, revLabel: i.pending.revLabel } : undefined,
      openTasks: i.tasks.map((x) => ({ id: x.id, source: docName(x.sourceRequirementId), explanation: x.explanation })),
      owner: ownerFor(site.id, i.requirementId).name, href, action,
      evidence: shown ? evidenceForRevision(site, shown) : evidenceForMissing(site, i.requirementId),
    };
  });
  const itemIds = new Set(items.map((i) => i.requirementId));
  const issues: GateIssueView[] = r.issues.map((i) => {
    const mem = i.memoryItemId ? (site.memory ?? []).find((m) => m.id === i.memoryItemId) : undefined;
    const refs: EvidenceRef[] = mem ? memoryEvidence(site, mem) : [];
    const item = i.requirementId ? items.find((x) => x.requirementId === i.requirementId) : undefined;
    if (item?.evidence) refs.push(item.evidence);
    return {
      code: i.code, category: CATEGORY_OF[i.code], message: i.message, requirementId: i.requirementId, taskId: i.taskId, memoryItemId: i.memoryItemId,
      sourceKind: i.source?.kind, sourceLabel: i.source?.label, evidence: i.source?.evidence, affectedDocument: i.affectedDocument, responsibleParty: i.responsibleParty, nextAction: i.nextAction,
      itemless: !i.requirementId || !itemIds.has(i.requirementId), evidenceRefs: refs,
    };
  });
  // Status follows the backend gate: canBuild is authoritative; "blocked" = something is missing / unanswered, "needs_review" = only reviews remain.
  const hard: PreSubmissionCode[] = ["MISSING_DOCUMENT", "NO_APPROVED_VERSION", "OPEN_ACTION", "OPEN_QUESTION", "OPEN_DECISION"];
  const status: ReadinessStatus = r.canBuild ? "ready" : r.issues.some((i) => hard.includes(i.code)) ? "blocked" : "needs_review";
  return {
    projectId: site.id, projectName: site.name, templateId: t.id, name: t.name, audience: t.audience, basis: t.basis,
    current: relevantTemplates(site).some((x) => x.id === t.id),
    status, canBuild: r.canBuild, token: r.token, readyCount: r.readyCount, items, issues, advisories: r.advisories,
    releases: rels.map((x) => { const st = releaseStatus(site, x); return { id: x.id, number: x.number, builtAt: x.builtAt, builtBy: x.builtBy, state: st.state, reasons: st.reasons, note: x.note }; }),
    nextNumber: (rels[0]?.number ?? 0) + 1,
  };
}

// ---------- Project Memory / Action Center ----------
export function findings(session: Session): Finding[] {
  const out: Finding[] = [];
  const queue = reviewQueue(session);
  for (const site of getSites()) {
    const rel = relevantTemplates(site);
    const blockingFor = (rid: string) => rel.filter((t) => packageRequires(site, t).includes(rid)).map((t) => pkgLabel(t.id, t.name));
    // Missing documents (only applicable requirements)
    for (const row of documentRegister(site.id)) {
      if (row.status === "missing") {
        const earlier = stageIndex(row.stage) < stageIndex(site.stage);
        const blocking = blockingFor(row.requirementId);
        out.push({
          id: `MISS-${site.id}-${row.requirementId}`, projectId: site.id, projectName: site.name, type: "missing_document", requirementId: row.requirementId,
          severity: blocking.length || earlier ? "high" : "low", title: `${row.docName} not received`, detail: row.reason,
          lifecycle: "action_required", backendStatus: "no revision on record", owner: row.owner, blocking, evidence: row.evidence ? [row.evidence] : [],
          href: `/inbox?project=${site.id}&expect=${row.requirementId}`, hrefLabel: "Import document",
        });
      }
      if (row.status === "outdated") {
        out.push({
          id: `OUT-${site.id}-${row.requirementId}`, projectId: site.id, projectName: site.name, type: "outdated_document", requirementId: row.requirementId,
          severity: blockingFor(row.requirementId).length ? "high" : "medium", title: `${row.docName} Rev ${row.revLabel} may be outdated`, detail: row.reason,
          lifecycle: "action_required", backendStatus: "approved, flagged", owner: row.owner, blocking: blockingFor(row.requirementId), evidence: row.evidence ? [row.evidence] : [],
          href: `/projects/${site.id}?doc=${row.requirementId}`, hrefLabel: "Open in register",
        });
      }
    }
    // Outdated / pending packages
    for (const t of PACKAGE_TEMPLATES) {
      const last = latestRelease(getReleases(), site.id, t.id);
      if (!last) continue;
      const st = releaseStatus(site, last);
      if (st.state === "current") continue;
      out.push({
        id: `REL-${last.id}`, projectId: site.id, projectName: site.name, type: "outdated_release",
        severity: st.state === "stale" ? "high" : "medium",
        title: st.state === "stale" ? `${t.name} R${last.number} is stale — rebuild required` : `${t.name} R${last.number} has a change pending review`,
        detail: st.reasons.join(" · "), lifecycle: st.state === "stale" ? "action_required" : "detected", backendStatus: st.state,
        owner: ownerFor(site.id, "plan_set").name, blocking: [], evidence: [],
        href: `/submissions?project=${site.id}&package=${t.id}`, hrefLabel: "Check readiness",
      });
    }
  }
  // Reviews + dependency conflicts (open and recently closed, so the lifecycle is visible)
  for (const q of queue) {
    const isDep = q.kind === "dependency";
    const lifecycle: Lifecycle = q.open ? (isDep && !q.sourceApproved ? "detected" : "action_required") : q.status === "superseded" ? "dismissed" : "resolved";
    const site = getSite(q.projectId)!;
    const blocking = relevantTemplates(site).filter((t) => packageRequires(site, t).includes(q.requirementId)).map((t) => pkgLabel(t.id, t.name));
    out.push({
      id: `${isDep ? "DEP" : "REV"}-${q.id}`, projectId: q.projectId, projectName: q.projectName, type: isDep ? "engineering_conflict" : "revision_review", requirementId: q.requirementId,
      severity: q.open ? (q.priority === "high" ? "high" : "medium") : "low",
      title: isDep ? (q.docType === "Cross-document conflict" ? `Conflicting values — ${q.dependentName}: ${q.reason}` : `${q.dependentName} must be checked against ${q.reason}`) : `${q.docName} Rev ${q.revLabel}${q.prevLabel ? ` replaces Rev ${q.prevLabel}` : ""}`,
      detail: isDep ? (q.sourceApproved ? q.explanation ?? "" : `Waiting for the source revision to be approved. ${q.explanation ?? ""}`) : q.reason,
      lifecycle, backendStatus: q.status, owner: q.open ? "EQORE engineer" : q.decidedBy ?? "EQORE engineer",
      blocking: q.open ? blocking : [], evidence: [q.evidenceNew, q.evidencePrev].filter((x): x is EvidenceRef => !!x),
      href: `/reviews?project=${q.projectId}&item=${encodeURIComponent(q.id)}`, hrefLabel: q.open ? "Open review" : "View decision", at: q.decidedAt ?? q.uploadedAt,
    });
  }
  // Project Memory (communications → suggested / confirmed requirements, decisions, actions, questions). Backend: lib/memory.
  // Internal correspondence: only for roles the backend allows to read Project Memory (capability "memory").
  for (const site of can(session, "memory") ? getSites() : []) {
    for (const m of site.memory ?? []) {
      const lifecycle: Lifecycle = m.status === "suggested" ? "needs_confirmation" : m.status === "confirmed" ? (m.blocking ? "action_required" : "detected") : m.status === "resolved" ? "resolved" : "dismissed";
      const tpls = m.templateIds.map((id) => pkgLabel(id, TEMPLATE_BY_ID[id]?.name));
      const src = m.sources[0];
      out.push({
        id: `MEM-${m.id}`, projectId: site.id, projectName: site.name, type: "ahj_requirement", requirementId: m.requirementId,
        severity: m.status === "confirmed" && m.blocking ? "high" : m.status === "suggested" ? "medium" : "low",
        title: `${KIND_LABEL[m.kind]}: ${m.title}`,
        detail: m.status === "suggested" ? `${m.origin === "openai" ? "AI" : "Rules"} suggestion from ${src?.sender ?? "a communication"} — not authoritative until a person confirms it.` : m.status === "confirmed" ? `Confirmed by ${m.confirmedBy}${m.blocking ? ` · blocks ${tpls.join(", ") || "no package"}` : " · not blocking"}${m.requirementId ? ` · needs ${docName(m.requirementId)}` : ""}` : m.status === "resolved" ? `Resolved by ${m.resolvedBy}: ${m.resolutionNote ?? ""}` : m.status === "merged" ? `Merged into ${m.mergedIntoId}` : `Dismissed by ${m.dismissedBy}: ${m.dismissNote ?? ""}`,
        lifecycle, backendStatus: m.status, owner: m.responsibleParty ?? (m.status === "suggested" ? "EQORE project manager" : m.kind === "requirement" ? "EQORE engineer" : "EQORE"),
        blocking: m.status === "confirmed" && m.blocking ? tpls : [], evidence: memoryEvidence(site, m),
        href: `/memory?project=${site.id}&type=ahj_requirement&item=${encodeURIComponent(m.id)}`, hrefLabel: m.status === "suggested" ? "Confirm or dismiss" : m.status === "confirmed" ? "Resolve" : "View",
        at: m.resolvedAt ?? m.confirmedAt ?? src?.sentAt ?? m.createdAt,
        memory: { siteId: site.id, itemId: m.id, kind: m.kind, status: m.status, blocking: m.blocking },
      });
    }
  }
  const sev = { high: 0, medium: 1, low: 2 } as const;
  const lc = { action_required: 0, needs_confirmation: 1, detected: 2, resolved: 3, dismissed: 4 } as const;
  return out.sort((a, b) => lc[a.lifecycle] - lc[b.lifecycle] || sev[a.severity] - sev[b.severity] || a.projectId.localeCompare(b.projectId));
}

// ---------- portfolio + Today ----------
export interface ProjectSummary {
  id: string; name: string; customer?: string; city: string; state: string; stage: StageId; stageLabel: string; stageIndex: number;
  utility: string; ahj: string; powerKw: number; energyKwh: number; vendor: string; provenance: string;
  documents: number; approved: number; pendingReviews: number; openDependencies: number; missing: number; outdated: number;
  /** Requirements of later lifecycle stages (not counted as missing). */
  neededLater: number;
  /** Project Memory suggestions waiting for a person to confirm or dismiss. */
  toConfirm: number;
  packages: { templateId: string; name: string; status: ReadinessStatus; issues: number }[];
}
export function projectSummaries(): ProjectSummary[] {
  return getSites().map((site) => {
    const reg = documentRegister(site.id);
    const pkgs = relevantTemplates(site).map((t) => { const r = readiness(site.id, t.id)!; return { templateId: t.id, name: t.name, status: r.status, issues: packageReadiness(site, t).issues.length }; });
    return {
      id: site.id, name: site.name, customer: customerOf(site.id), city: site.city, state: site.state, stage: site.stage, stageLabel: stageLabel(site.stage), stageIndex: stageIndex(site.stage),
      utility: site.utility, ahj: site.ahj, powerKw: site.powerKw, energyKwh: site.energyKwh, vendor: site.vendor,
      provenance: provenanceOf(site.id) === "eqore_reference_structure" ? "Structure from EQORE reference plan set · synthetic records" : "Fictional demo project",
      documents: site.documents.length, approved: site.documents.filter((d) => d.status === "approved").length,
      pendingReviews: getReviews(site.id).filter((r) => r.status === "open").length,
      openDependencies: (site.engTasks ?? []).filter((t) => t.status === "open").length,
      missing: reg.filter((r) => r.status === "missing").length, outdated: reg.filter((r) => r.status === "outdated").length,
      neededLater: reg.filter((r) => r.status === "not_yet_required").length,
      toConfirm: (site.memory ?? []).filter((m) => m.status === "suggested").length,
      packages: pkgs,
    };
  });
}

export function todayMetrics() {
  const projects = projectSummaries();
  const sites = getSites();
  const docs = sites.flatMap((s) => s.documents);
  const live = docs.filter((d) => d.engine && d.engine !== "seed");
  return {
    projects,
    activeProjects: projects.filter((p) => p.stage !== "decommissioning").length,
    inDevelopment: projects.filter((p) => p.stageIndex < stageIndex("operations")).length,
    documentsReceived: docs.length,
    liveUploads: live.length,
    pendingReviews: getReviews().filter((r) => r.status === "open").length,
    openDependencies: sites.reduce((n, s) => n + (s.engTasks ?? []).filter((t) => t.status === "open").length, 0),
    blockedSubmissions: projects.flatMap((p) => p.packages.filter((k) => k.status !== "ready").map((k) => ({ ...k, projectId: p.id, projectName: p.name }))),
    // Unique (project, document type) pairs — a document needed by several packages is counted once.
    missingNow: projects.reduce((n, p) => n + p.missing, 0),
    outdatedDocs: projects.reduce((n, p) => n + p.outdated, 0),
    neededLater: projects.reduce((n, p) => n + p.neededLater, 0),
    toConfirm: projects.reduce((n, p) => n + p.toConfirm, 0),
    recentDocuments: docs.slice().sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1)).slice(0, 6).map((d) => ({ id: d.id, requirementId: d.requirementId, projectId: d.siteId, projectName: getSite(d.siteId)!.name, docName: docName(d.requirementId), revLabel: d.revLabel, status: d.status, uploadedAt: d.uploadedAt, uploadedBy: d.uploadedBy, provenance: revisionProvenance(d), fileName: d.fileName })),
  };
}
