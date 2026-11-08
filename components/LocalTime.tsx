"use client";
// Viewer-local time. The server renders in its own time zone (UTC on Railway) and the browser in the viewer's, so the
// text legitimately differs between SSR and hydration; suppressHydrationWarning is scoped to this one text node.
export default function LocalTime({ iso, mode = "datetime", opts }: { iso?: string; mode?: "datetime" | "date" | "time"; opts?: Intl.DateTimeFormatOptions }) {
  if (!iso) return <>—</>;
  const d = new Date(iso);
  const text = mode === "date" ? d.toLocaleDateString([], opts) : mode === "time" ? d.toLocaleTimeString([], opts) : d.toLocaleString([], opts);
  return <time dateTime={iso} suppressHydrationWarning>{text}</time>;
}
