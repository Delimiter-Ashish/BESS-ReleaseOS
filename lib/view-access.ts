// Role-aware projections for server-rendered pages (shared by the workspace screens). The APIs enforce the same rules.
import type { Session } from "./auth";
import { audiencesOf, ruleFor } from "./studio/access";
import type { Site } from "./types";
import type { RegisterRow } from "./workspace";

/** EQORE users see internal assurance data (communications, reviews, decision notes, findings). */
export const isInternal = (s: Pick<Session, "role">) => s.role === "eqore";

/**
 * Document register for a non-EQORE role: only document types the site's access policy lets the role view, and no
 * correspondence-derived evidence or reasons (those come from internal project memory).
 */
export function registerFor(s: Pick<Session, "role" | "engineer">, site: Site, rows: RegisterRow[]): RegisterRow[] {
  if (isInternal(s)) return rows;
  const aud = audiencesOf(s);
  return rows
    .filter((r) => ruleFor(site, r.requirementId).view.some((a) => aud.includes(a)))
    .map((r) => (r.status === "missing" ? { ...r, evidence: undefined, reason: "Required — not yet on file" } : r));
}
