"use client";
// Renders the ORIGINAL stored bytes (GET /api/files/:id, session-authorized) with pdf.js in the browser.
// The evidence quote is located in the page's text layer; when found, its real coordinates are highlighted.
// Nothing is sent to any external service.
import { PDF_SAFE_OPTIONS } from "@/lib/pdf-options";
import { useCallback, useEffect, useRef, useState } from "react";

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy: () => void };
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number; transform: number[]; scale: number };
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
  getTextContent: () => Promise<{ items: { str: string; transform: number[]; width: number; height: number }[] }>;
};
type PdfJs = { getDocument: (o: { data: Uint8Array; isEvalSupported: false }) => { promise: Promise<PdfDoc> }; GlobalWorkerOptions: { workerSrc: string }; Util: { transform: (a: number[], b: number[]) => number[] } };

let pdfjsPromise: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import("pdfjs-dist/build/pdf.mjs").then((m) => {
    const lib = ((m as unknown as { default?: PdfJs }).default ?? m) as unknown as PdfJs;
    lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    return lib;
  });
  return pdfjsPromise;
}

const squash = (s: string) => s.toLowerCase().replace(/[‘’“”"'`]/g, "").replace(/\s+/g, " ").trim();

/** Text items that make up the quote (exact line match first, then partial overlap). */
function matchItems(items: { str: string }[], quote: string) {
  const q = squash(quote);
  if (q.length < 3) return [];
  const idx: number[] = [];
  items.forEach((it, i) => {
    const s = squash(it.str);
    if (s.length >= 3 && (q.includes(s) || s.includes(q))) idx.push(i);
  });
  return idx;
}

export default function PdfViewer({ fileId, page: initialPage, quote }: { fileId: string; page?: number; quote?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<{ lib: PdfJs; doc: PdfDoc } | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(initialPage ?? 1);
  const [zoom, setZoom] = useState(1);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [err, setErr] = useState("");
  const [boxes, setBoxes] = useState<{ left: number; top: number; width: number; height: number }[]>([]);
  const [located, setLocated] = useState<"found" | "elsewhere" | "not_found" | "none">("none");
  const [width, setWidth] = useState(520);

  // Load the document once per file
  useEffect(() => {
    let cancelled = false;
    setState("loading"); setErr(""); setNumPages(0);
    (async () => {
      try {
        const [lib, res] = await Promise.all([loadPdfJs(), fetch(`/api/files/${encodeURIComponent(fileId)}`, { credentials: "same-origin" })]);
        if (!res.ok) throw new Error(res.status === 401 ? "Sign in to view original documents" : `Could not load file (${res.status})`);
        const data = new Uint8Array(await res.arrayBuffer());
        const doc = await lib.getDocument({ data, ...PDF_SAFE_OPTIONS }).promise;
        if (cancelled) return doc.destroy();
        docRef.current?.doc.destroy();
        docRef.current = { lib, doc };
        setNumPages(doc.numPages);
        // If no page was cited, or the quote is not on the cited page, find the page that contains it.
        let target = Math.min(Math.max(initialPage ?? 1, 1), doc.numPages);
        if (quote) {
          const onCited = matchItems((await (await doc.getPage(target)).getTextContent()).items, quote).length > 0;
          if (!onCited) {
            for (let p = 1; p <= doc.numPages; p++) {
              if (matchItems((await (await doc.getPage(p)).getTextContent()).items, quote).length) { target = p; setLocated("elsewhere"); break; }
            }
          }
        }
        setPage(target);
        setState("ready");
      } catch (e) {
        if (!cancelled) { setState("error"); setErr((e as Error).message); }
      }
    })();
    return () => { cancelled = true; };
  }, [fileId, initialPage, quote]);

  useEffect(() => () => docRef.current?.doc.destroy(), []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(260, el.clientWidth - 2)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const render = useCallback(async () => {
    const ctx = docRef.current;
    const canvas = canvasRef.current;
    if (!ctx || !canvas || state !== "ready") return;
    const p = await ctx.doc.getPage(page);
    const base = p.getViewport({ scale: 1 });
    const scale = (width / base.width) * zoom;
    const vp = p.getViewport({ scale });
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(vp.width * dpr);
    canvas.height = Math.floor(vp.height * dpr);
    canvas.style.width = `${vp.width}px`;
    canvas.style.height = `${vp.height}px`;
    const c2d = canvas.getContext("2d")!;
    c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    await p.render({ canvasContext: c2d, viewport: vp }).promise;
    if (!quote) { setBoxes([]); setLocated("none"); return; }
    const { items } = await p.getTextContent();
    const hits = matchItems(items, quote);
    setBoxes(hits.map((i) => {
      const it = items[i];
      const tx = ctx.lib.Util.transform(vp.transform, it.transform);
      const h = Math.hypot(tx[2], tx[3]);
      return { left: tx[4] - 3, top: tx[5] - h - 2, width: it.width * scale + 6, height: h * 1.35 + 4 };
    }));
    setLocated((prev) => (hits.length ? (prev === "elsewhere" ? "elsewhere" : "found") : "not_found"));
  }, [page, zoom, width, quote, state]);

  useEffect(() => { void render(); }, [render]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs">
        <div className="flex items-center gap-1">
          <button className="btn-ghost !px-2 !py-1" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">‹</button>
          <span className="tabular-nums text-slate-600">Page {page} / {numPages || "…"}</span>
          <button className="btn-ghost !px-2 !py-1" disabled={!numPages || page >= numPages} onClick={() => setPage(page + 1)} aria-label="Next page">›</button>
        </div>
        <div className="flex items-center gap-1">
          <button className="btn-ghost !px-2 !py-1" onClick={() => setZoom(Math.max(0.5, zoom - 0.25))} aria-label="Zoom out">−</button>
          <span className="w-10 text-center tabular-nums text-slate-600">{Math.round(zoom * 100)}%</span>
          <button className="btn-ghost !px-2 !py-1" onClick={() => setZoom(Math.min(3, zoom + 0.25))} aria-label="Zoom in">+</button>
          <a className="btn-ghost !px-2 !py-1" href={`/api/files/${encodeURIComponent(fileId)}`} title="Download original">⤓</a>
        </div>
      </div>
      {quote && state === "ready" && (
        <div className={`px-3 py-1.5 text-[11px] ${located === "found" ? "bg-amber-50 text-amber-900" : located === "elsewhere" ? "bg-sky-50 text-sky-900" : "bg-slate-100 text-slate-600"}`}>
          {located === "found" && "Quoted text located in the PDF and highlighted on this page."}
          {located === "elsewhere" && "Quoted text was found on this page (the cited page did not contain it) and is highlighted."}
          {located === "not_found" && "Quoted text could not be located in this page's text layer — compare the quotation beside the page."}
        </div>
      )}
      <div ref={wrapRef} className="min-h-0 flex-1 overflow-auto bg-slate-200/60 p-2">
        {state === "loading" && <div className="grid h-64 place-items-center text-sm text-slate-500"><span className="flex items-center gap-2"><span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-500 border-t-transparent" />Loading original PDF…</span></div>}
        {state === "error" && <div className="m-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</div>}
        <div className={`relative mx-auto w-fit bg-[#ffffff] shadow-2xl ${state === "ready" ? "" : "hidden"}`}>
          <canvas ref={canvasRef} />
          {boxes.map((b, i) => (
            <div key={i} className="pointer-events-none absolute rounded-sm bg-[rgba(251,191,36,0.35)] ring-2 ring-[#f59e0b]" style={{ left: b.left, top: b.top, width: b.width, height: b.height }} />
          ))}
        </div>
      </div>
    </div>
  );
}
