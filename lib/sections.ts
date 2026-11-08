// Section/context detection for engineering document text layers (pure).
// Revision-history / revision-block / change-log entries describe PAST changes ("B 01/11/2026 Change inverters to
// 2 x MPS125") and must never be read as the document's current engineering facts. Used by the rules extractor,
// AI grounding, and Project Guardian observations so all three agree on what is "current" text.

/** A revision table row: "<label> <date> <description>", optionally prefixed by "Rev". */
export const REV_ENTRY = /^(rev(ision)?\.?\s+)?[A-Z0-9]{1,3}\s+(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/i;
/** Headings that open a revision-history section. */
export const REV_HEADING = /^(#\s*)?(revision (history|block|log|table|record)|revisions|record of revisions|change (log|history|record)|document history|issue (history|record))\s*:?\s*$/i;

export interface ClassifiedLine { text: string; revisionHistory: boolean }

/** Classify each line of ONE page. Inside a revision section, rows (and their wrapped continuations) are history. */
export function classifyLines(pageText: string): ClassifiedLine[] {
  const out: ClassifiedLine[] = [];
  let inRev = false;
  for (const raw of pageText.split("\n")) {
    const text = raw.replace(/\s+/g, " ").trim();
    if (!text) { out.push({ text, revisionHistory: inRev }); continue; }
    if (REV_HEADING.test(text)) { inRev = true; out.push({ text, revisionHistory: true }); continue; }
    if (REV_ENTRY.test(text)) { out.push({ text, revisionHistory: true }); continue; }
    // A short lowercase-initial line right after a row is a wrapped continuation of that row.
    if (inRev && /^[a-z(]/.test(text) && text.length < 80) { out.push({ text, revisionHistory: true }); continue; }
    inRev = false;
    out.push({ text, revisionHistory: false });
  }
  return out;
}

/** Page text with revision-history lines removed (line structure otherwise preserved). */
export const currentText = (pageText: string) => classifyLines(pageText).filter((l) => !l.revisionHistory).map((l) => l.text).join("\n");

const squash = (s: string) => s.toLowerCase().replace(/[‘’“”"'`]/g, "").replace(/\s+/g, " ").trim();

/**
 * True when the quote appears ONLY in revision-history lines of the document (not in any current line).
 * Quotes that span lines are checked against the joined text of each class.
 */
export function quoteOnlyInRevisionHistory(pages: string[], quote: string | undefined | null) {
  if (!quote) return false;
  const q = squash(quote);
  if (q.length < 3) return false;
  let inHistory = false;
  for (const p of pages) {
    const lines = classifyLines(p);
    if (squash(lines.filter((l) => !l.revisionHistory).map((l) => l.text).join(" ")).includes(q)) return false;
    if (squash(lines.filter((l) => l.revisionHistory).map((l) => l.text).join(" ")).includes(q)) inHistory = true;
  }
  return inHistory;
}
