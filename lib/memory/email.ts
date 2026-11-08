// Deterministic header parsing for pasted / imported (.eml, .txt) emails. Pure, safe on server and client.
// Only the leading header block is read; the full original text is always stored unchanged.
export interface ParsedHeaders { from?: string; to?: string[]; date?: string; subject?: string }

export function parseEmailHeaders(raw: string): ParsedHeaders {
  const out: ParsedHeaders = {};
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const line = lines[i];
    if (!line.trim()) { if (Object.keys(out).length) break; continue; }
    const m = line.match(/^(From|To|Date|Sent|Subject):\s*(.+)$/i);
    if (!m) { if (Object.keys(out).length) break; continue; }
    const [k, v] = [m[1].toLowerCase(), m[2].trim()];
    if (k === "from") out.from = v.slice(0, 200);
    else if (k === "to") out.to = v.split(/[;,]/).map((x) => x.trim()).filter(Boolean).slice(0, 20);
    else if (k === "subject") out.subject = v.slice(0, 300);
    else if (k === "date" || k === "sent") { const t = Date.parse(v); if (Number.isFinite(t)) out.date = new Date(t).toISOString(); }
  }
  return out;
}
