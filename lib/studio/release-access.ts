// Server-side authorization for frozen releases and stored files (Submission Studio access policy).
import type { Session } from "../auth";
import { getSites, studioOf } from "../store";
import type { Release } from "../types";
import { canViewRevision, recipientOf } from "./access";

/**
 * EQORE users may download any release. An external party may download a release only if it was a Submission
 * Studio package addressed to them AND every document in it was authorized for that recipient at build time.
 * Releases without frozen access decisions (e.g. seeded history) are EQORE-only.
 */
export function canDownloadRelease(s: Session, rel: Release) {
  if (s.role === "eqore") return true;
  const st = studioOf(rel);
  if (!st) return false;
  return recipientOf(s).includes(st.recipient) && st.policyDecisions.length > 0 && st.policyDecisions.every((d) => d.authorized);
}

/** Stored file bytes: allowed if the session may view at least one revision that references the file. Others: EQORE only. */
export function canReadFile(s: Session, fileId: string) {
  if (s.role === "eqore") return true;
  for (const site of getSites()) for (const rev of site.documents) if (rev.fileId === fileId && canViewRevision(s, site, rev)) return true;
  return false;
}
