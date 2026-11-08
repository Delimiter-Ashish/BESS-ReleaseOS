// ==== SUBMISSION STUDIO — SHARED CONTRACT (Ashish → Kaushik) ====
// Select documents → verify (release gate + selection + recipient authorization + Guardian) → engineer signoff →
// sealed release with one or more combined PDFs. API routes documented in README ("Submission Studio").
import type { PreSubmissionIssue } from "../memory/types";
import type { Audience, Recipient } from "./access";

export type PurposeId = "ahj" | "planning" | "interconnection" | "custom";
export interface Purpose { id: PurposeId; name: string; templateId: string; recipient: Recipient; description: string }

export interface SelectionGroup { id: string; name: string; revisionIds: string[] }
export interface StudioSelection { purpose: PurposeId; templateId?: string; recipient?: Recipient; groups: SelectionGroup[] }

export interface StudioDocument {
  revisionId: string;
  requirementId: string;
  name: string;
  revLabel: string;
  status: "uploaded" | "in_review" | "approved" | "rejected";
  current: boolean; // latest approved revision of its type
  source: string;
  uploadedBy: string;
  approvedBy?: string;
  sha256: string;
  fileName: string;
  isPdf: boolean;
  pageCount?: number;
  requiredByPackage: boolean; // on the purpose's checklist (template or confirmed requirement)
  policy: { view: Audience[]; releaseTo: Recipient[]; isDefault: boolean; setBy?: string };
  authorizedForRecipient: boolean;
  pdfCharacteristics: string[]; // e.g. "digital signature", "interactive form fields"
}

export type StudioCode =
  | PreSubmissionIssue["code"]
  | "REQUIRED_NOT_SELECTED" | "SELECTED_NOT_APPROVED" | "SELECTED_OUTDATED_VERSION" | "NOT_AUTHORIZED_FOR_RECIPIENT"
  | "DUPLICATE_SELECTION" | "DUPLICATE_DOCUMENT_TYPE" | "UNKNOWN_DOCUMENT" | "EMPTY_GROUP" | "ENCRYPTED_SOURCE" | "EMPTY_SELECTION"
  // warnings
  | "NON_PDF_SOURCE" | "PDF_FEATURES_MAY_CHANGE" | "UNCONFIRMED_SUGGESTION" | "GUARDIAN_FINDING";

export interface StudioIssue {
  code: StudioCode;
  severity: "blocker" | "warning";
  message: string;
  requirementId?: string;
  revisionId?: string;
  groupId?: string;
  evidence?: string;
  source?: PreSubmissionIssue["source"];
  responsibleParty?: string;
  fix: string;
}

export interface StudioCheck {
  siteId: string;
  purpose: Purpose;
  canGenerate: boolean;
  /** Pass back to POST /studio/release; a changed selection, policy or document state invalidates it. */
  token: string;
  readinessToken: string;
  blockers: StudioIssue[];
  warnings: StudioIssue[];
  groups: (SelectionGroup & { documents: StudioDocument[] })[];
  nextReleaseId: string;
  checkedAt: string;
}

export interface CombinedPdfEntry {
  order: number;
  revisionId: string;
  requirementId: string;
  name: string;
  revLabel: string;
  fileName: string;
  sourceSha256: string;
  startPage: number; // 1-based page in the combined PDF
  pageCount: number;
  rendering: "merged" | "slip_sheet"; // slip_sheet = source is not a mergeable PDF; original kept in the ZIP
  characteristics: string[];
}
export interface CombinedPdfOutput {
  groupId: string;
  name: string;
  fileName: string;
  fileId: string;
  sha256: string;
  pageCount: number;
  coverPages: number;
  entries: CombinedPdfEntry[];
  warnings: string[];
}
