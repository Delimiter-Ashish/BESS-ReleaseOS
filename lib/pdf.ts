// Untrusted-file handling: type sniffing, limits, and PDF text-layer extraction.
export const LIMITS = {
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 15) * 1024 * 1024,
  maxPdfPages: Number(process.env.MAX_PDF_PAGES || 40),
  maxTextChars: 60_000,
};

export type AllowedMedia = "application/pdf" | "image/png" | "image/jpeg" | "image/webp" | "text/plain";

/** Determine the media type from the actual bytes (never trust the browser-supplied type). */
export function sniffMedia(bytes: Buffer, fileName: string): AllowedMedia | null {
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (/\.(txt|md|csv)$/i.test(fileName)) {
    // Text must be valid UTF-8 without NULs.
    const s = bytes.toString("utf8");
    if (!s.includes("\u0000") && !s.includes("�")) return "text/plain";
  }
  return null;
}

export interface TextLayer {
  pages: string[]; // one entry per page ('' for image-only pages)
  pageCount: number;
  joined: string; // with \f[page N] markers
  hasText: boolean;
}

export async function readTextLayer(media: AllowedMedia, bytes: Buffer): Promise<TextLayer> {
  if (media === "text/plain") {
    const t = bytes.toString("utf8").slice(0, LIMITS.maxTextChars);
    return { pages: [t], pageCount: 1, joined: t, hasText: !!t.trim() };
  }
  if (media !== "application/pdf") return { pages: [], pageCount: 1, joined: "", hasText: false };
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  if (pdf.numPages > LIMITS.maxPdfPages) throw new UploadError(413, `PDF has ${pdf.numPages} pages; the limit is ${LIMITS.maxPdfPages}.`);
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = (text as string[]).map((t) => t ?? "");
  const joined = pages.map((t, i) => `\f[page ${i + 1}]\n${t}`).join("\n").slice(0, LIMITS.maxTextChars);
  return { pages, pageCount: pdf.numPages, joined, hasText: pages.some((p) => p.trim().length > 20) };
}

export class UploadError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const squash = (s: string) => s.toLowerCase().replace(/[‘’“”"'`]/g, "").replace(/\s+/g, " ").trim();

/** Find which text-layer page contains the quote (whitespace/quote-insensitive). Returns 1-based page or null. */
export function findQuotePage(layer: TextLayer, quote: string | undefined | null): number | null {
  if (!quote || !layer.hasText) return null;
  const q = squash(quote);
  if (q.length < 3) return null;
  for (let i = 0; i < layer.pages.length; i++) if (squash(layer.pages[i]).includes(q)) return i + 1;
  return null;
}
