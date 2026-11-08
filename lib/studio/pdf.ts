// Combined submission PDF builder (pdf-lib). Merges the ACTUAL approved PDF bytes in the selected order behind a
// cover/index page that identifies every source (document type, revision, file name, SHA-256, page range).
// Source files are never modified: pages are copied into a new file; originals stay in the store and the ZIP.
// Non-PDF sources get a labeled slip sheet. The result is re-opened and its page count verified.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { createHash } from "node:crypto";
import type { Revision } from "../types";
import { pdfCharacteristics } from "./check";
import type { CombinedPdfEntry } from "./types";

const W = 612, H = 792, M = 48;
/** Standard PDF fonts are WinAnsi-only: map typographic characters to ASCII so every label renders. */
const ascii = (s: string) => s.replace(/[—–]/g, "-").replace(/[→]/g, "->").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, "...").replace(/[^\x20-\x7E]/g, "?");

export interface CombineInput {
  title: string; // e.g. "AHJ permit submission — Plans and drawings"
  releaseId: string;
  siteLine: string;
  recipientLabel: string;
  builtAt: string;
  builtBy: string;
  groupName: string;
  docs: { rev: Revision; name: string; bytes: Buffer }[];
}

function text(page: PDFPage, s: string, x: number, y: number, size: number, font: PDFFont, color = rgb(0.1, 0.1, 0.15), maxWidth = W - 2 * M) {
  let t = ascii(s);
  while (t.length > 3 && font.widthOfTextAtSize(t, size) > maxWidth) t = `${t.slice(0, -4)}...`;
  page.drawText(t, { x, y, size, font, color });
}

const ROWS_FIRST = 12, ROWS_NEXT = 18;
const coverPageCount = (n: number) => (n <= ROWS_FIRST ? 1 : 1 + Math.ceil((n - ROWS_FIRST) / ROWS_NEXT));

export async function buildCombinedPdf(input: CombineInput) {
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const mono = await out.embedFont(StandardFonts.Courier);
  const when = new Date(input.builtAt);
  out.setTitle(ascii(input.title));
  out.setSubject(ascii(`${input.releaseId} - ${input.groupName}`));
  out.setAuthor(ascii(input.builtBy));
  out.setKeywords([input.releaseId, "BESS ReleaseOS"]);
  out.setProducer("BESS ReleaseOS Submission Studio (pdf-lib)");
  out.setCreator("BESS ReleaseOS");
  out.setCreationDate(when);
  out.setModificationDate(when);

  // Load sources first so the index can state exact page ranges.
  const warnings: string[] = [];
  const loaded: { doc?: PDFDocument; pages: number; rendering: CombinedPdfEntry["rendering"]; traits: string[] }[] = [];
  for (const d of input.docs) {
    const c = pdfCharacteristics(d.bytes);
    if (!c.isPdf || c.encrypted) {
      loaded.push({ pages: 1, rendering: "slip_sheet", traits: c.traits });
      warnings.push(`${d.rev.fileName}: ${c.encrypted ? "encrypted PDF" : "not a PDF"} — represented by a slip sheet; original file retained unchanged.`);
      continue;
    }
    try {
      const doc = await PDFDocument.load(d.bytes, { updateMetadata: false });
      loaded.push({ doc, pages: doc.getPageCount(), rendering: "merged", traits: c.traits });
      if (c.traits.length) warnings.push(`${d.rev.fileName}: contains ${c.traits.join(", ")} — merged copy may not preserve them (signatures will not validate); original retained unchanged.`);
    } catch (e) {
      loaded.push({ pages: 1, rendering: "slip_sheet", traits: c.traits });
      warnings.push(`${d.rev.fileName}: could not be parsed (${(e as Error).message.slice(0, 80)}) — slip sheet used; original retained unchanged.`);
    }
  }
  const cover = coverPageCount(input.docs.length);
  let next = cover + 1;
  const entries: CombinedPdfEntry[] = input.docs.map((d, i) => {
    const e: CombinedPdfEntry = { order: i + 1, revisionId: d.rev.id, requirementId: d.rev.requirementId, name: d.name, revLabel: d.rev.revLabel, fileName: d.rev.fileName, sourceSha256: d.rev.sha256, startPage: next, pageCount: loaded[i].pages, rendering: loaded[i].rendering, characteristics: loaded[i].traits };
    next += loaded[i].pages;
    return e;
  });
  const total = next - 1;

  // ---- Cover / index ----
  let page = out.addPage([W, H]);
  let y = H - M;
  page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 24, color: rgb(0.12, 0.16, 0.3) });
  text(page, "SUBMISSION PACKAGE - COVER AND INDEX", M + 8, y + 1, 11, bold, rgb(1, 1, 1));
  y -= 36;
  text(page, input.title, M, y, 15, bold); y -= 20;
  for (const l of [input.siteLine, `Recipient: ${input.recipientLabel}`, `Release: ${input.releaseId}   Part: ${input.groupName}`, `Signed off: ${input.builtAt} by ${input.builtBy}`, `This file: ${total} pages (${cover} cover/index + ${total - cover} document pages)`]) { text(page, l, M, y, 10, font); y -= 14; }
  y -= 4;
  page.drawRectangle({ x: M, y: y - 40, width: W - 2 * M, height: 46, color: rgb(1, 0.97, 0.88) });
  text(page, "Assembled for submission convenience. Not a certification of code compliance.", M + 6, y - 6, 8.5, bold, rgb(0.45, 0.3, 0));
  text(page, "Pages are copied from the approved originals; digital signatures, stamps' validation data and form fields", M + 6, y - 18, 8, font, rgb(0.45, 0.3, 0));
  text(page, "may not survive merging. Original files (SHA-256 below) are retained unchanged in the release ZIP.", M + 6, y - 29, 8, font, rgb(0.45, 0.3, 0));
  y -= 60;
  const header = (pg: PDFPage, yy: number) => {
    text(pg, "#", M, yy, 8, bold); text(pg, "Document / revision / source file", M + 18, yy, 8, bold); text(pg, "Pages", W - M - 60, yy, 8, bold);
    pg.drawLine({ start: { x: M, y: yy - 4 }, end: { x: W - M, y: yy - 4 }, thickness: 0.5, color: rgb(0.6, 0.6, 0.65) });
    return yy - 16;
  };
  y = header(page, y);
  entries.forEach((e, i) => {
    if (i === ROWS_FIRST || (i > ROWS_FIRST && (i - ROWS_FIRST) % ROWS_NEXT === 0)) { page = out.addPage([W, H]); y = header(page, H - M); }
    text(page, String(e.order), M, y, 9, bold);
    text(page, `${e.name} - Rev ${e.revLabel}${e.rendering === "slip_sheet" ? " (slip sheet)" : ""}`, M + 18, y, 9, bold, undefined, W - 2 * M - 90);
    text(page, `${e.startPage}-${e.startPage + e.pageCount - 1}`, W - M - 60, y, 9, font);
    text(page, e.fileName, M + 18, y - 11, 7.5, font, rgb(0.35, 0.35, 0.4), W - 2 * M - 90);
    text(page, `sha256 ${e.sourceSha256}`, M + 18, y - 21, 6.5, mono, rgb(0.35, 0.35, 0.4));
    y -= 36;
  });

  // ---- Documents ----
  for (let i = 0; i < input.docs.length; i++) {
    const l = loaded[i], e = entries[i];
    if (l.doc) {
      const copied = await out.copyPages(l.doc, l.doc.getPageIndices());
      copied.forEach((p) => out.addPage(p));
    } else {
      const s = out.addPage([W, H]);
      text(s, "SLIP SHEET - SOURCE NOT MERGED", M, H - M - 20, 14, bold);
      let yy = H - M - 50;
      for (const line of [`${e.name} - Rev ${e.revLabel}`, `Source file: ${e.fileName}`, `sha256 ${e.sourceSha256}`, "", "The source file is not a mergeable PDF. It is included unchanged in the release ZIP", "and identified above by its SHA-256 hash."]) { text(s, line, M, yy, 10, line.startsWith("sha256") ? mono : font); yy -= 16; }
    }
  }

  const bytes = Buffer.from(await out.save({ useObjectStreams: false }));
  const verify = await PDFDocument.load(bytes);
  if (verify.getPageCount() !== total) throw new Error(`Combined PDF page count ${verify.getPageCount()} != expected ${total}`);
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex"), pageCount: total, coverPages: cover, entries, warnings };
}
