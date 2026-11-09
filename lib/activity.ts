import type { DecisionRecord } from "./types";

export function decisionLabel(d: DecisionRecord, document?: string) {
  switch (d.kind) {
    case "revision_review": return `${d.decision === "approved" ? "Approved" : "Rejected"} ${document ?? "a revision"}`;
    case "dependency_resolution": return `Resolved a dependency review${document ? ` for ${document}` : ""}`;
    case "lifecycle_review": return `Verified lifecycle evidence or resolved a site-change review${document ? ` for ${document}` : ""}`;
    case "emergency_publication": return `Approved public emergency information${document ? `: ${document}` : ""}`;
    case "release_signoff": return "Signed off a release";
  }
}
