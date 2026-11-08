// Presentational primitives for the Project Assurance screens (server- and client-safe).
import Link from "next/link";
import { GLOSSARY } from "@/lib/labels";
import type { DocStatus, Lifecycle, ReadinessStatus } from "@/lib/workspace";

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
        <h1 className="text-[1.7rem] font-semibold leading-tight tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export const Page = ({ children }: { children: React.ReactNode }) => <main className="mx-auto max-w-[1400px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">{children}</main>;

export const DOC_STATUS_STYLE: Record<DocStatus, string> = {
  missing: "bg-red-50 text-red-700 ring-red-200",
  received: "bg-sky-50 text-sky-700 ring-sky-200",
  pending_review: "bg-violet-50 text-violet-700 ring-violet-200",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  rejected: "bg-rose-50 text-rose-700 ring-rose-200",
  outdated: "bg-orange-50 text-orange-700 ring-orange-200",
  not_yet_required: "bg-slate-100 text-slate-500 ring-slate-200",
};
const DOC_LABEL: Record<DocStatus, string> = { missing: "Missing now", received: "Received", pending_review: "Pending engineer review", approved: "Approved", rejected: "Rejected", outdated: "Outdated revision", not_yet_required: "Needed later" };
export const DocStatusPill = ({ s }: { s: DocStatus }) => <span className={`pill whitespace-nowrap ${DOC_STATUS_STYLE[s]}`}>{DOC_LABEL[s]}</span>;

const LC_STYLE: Record<Lifecycle, string> = {
  detected: "bg-sky-50 text-sky-700 ring-sky-200",
  needs_confirmation: "bg-amber-50 text-amber-800 ring-amber-200",
  action_required: "bg-red-50 text-red-700 ring-red-200",
  resolved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  dismissed: "bg-slate-100 text-slate-500 ring-slate-200",
};
const LC_LABEL: Record<Lifecycle, string> = { detected: "Detected", needs_confirmation: "Needs confirmation", action_required: "Action required", resolved: "Resolved", dismissed: "Dismissed" };
export const LifecyclePill = ({ l }: { l: Lifecycle }) => <span className={`pill whitespace-nowrap ${LC_STYLE[l]}`}>{LC_LABEL[l]}</span>;

export function SeverityDot({ s }: { s: "high" | "medium" | "low" }) {
  return <span title={`${s} severity`} className={`inline-block h-2 w-2 shrink-0 rounded-full ${s === "high" ? "bg-red-500" : s === "medium" ? "bg-amber-500" : "bg-slate-300"}`} />;
}

export const READY_META: Record<ReadinessStatus, { label: string; cls: string; dot: string }> = {
  blocked: { label: "Blocked", cls: "bg-red-50 text-red-700 ring-red-200", dot: "bg-red-500" },
  needs_review: { label: "Needs review", cls: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500" },
  ready: { label: "Ready", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500" },
};
export const ReadinessPill = ({ s }: { s: ReadinessStatus }) => <span className={`pill whitespace-nowrap ${READY_META[s].cls}`}><span className={`h-1.5 w-1.5 rounded-full ${READY_META[s].dot}`} />{READY_META[s].label}</span>;

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center">
      <div className="text-sm font-medium text-slate-700">{title}</div>
      {children && <div className="mx-auto mt-1 max-w-md text-xs text-slate-500">{children}</div>}
      {action && <Link href={action.href} className="btn-ghost mt-3 !text-xs">{action.label}</Link>}
    </div>
  );
}

export function SyntheticNote({ children }: { children?: React.ReactNode }) {
  return <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-500">{children ?? "All projects are fictional or synthetic demo records. Century Tywood follows the structure of the EQORE sample plan set; its ratings and approvals are synthetic. Checklists are illustrative until EQORE confirms."}</div>;
}

export const fmtDate = (iso?: string) => (iso ? iso.slice(0, 10) : "—");
export function ago(iso?: string) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

// ---------- Premium primitives ----------

/** Plain-language tooltip for a technical term (keyboard-focusable, no JS). */
export function Term({ t, children }: { t: keyof typeof GLOSSARY | string; children?: React.ReactNode }) {
  const def = GLOSSARY[t];
  if (!def) return <>{children ?? t}</>;
  return (
    <span tabIndex={0} className="term group relative inline-block outline-none">
      {children ?? t}
      <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-60 -translate-x-1/2 rounded-lg border border-slate-200 bg-night-700 px-3 py-2 text-left text-[11px] font-normal normal-case leading-snug tracking-normal text-ink-soft opacity-0 shadow-xl transition group-hover:opacity-100 group-focus:opacity-100">
        <b className="text-ink">{t}</b> — {def}
      </span>
    </span>
  );
}

/** Info "i" with an explanation of how a number is calculated. */
export function HowCalculated({ children }: { children: React.ReactNode }) {
  return (
    <span tabIndex={0} aria-label="How is this calculated?" className="group relative inline-grid h-4 w-4 cursor-help place-items-center rounded-full border border-slate-300 text-[9px] font-bold text-slate-500 outline-none">
      i
      <span role="tooltip" className="pointer-events-none absolute right-0 top-full z-30 mt-2 w-64 rounded-lg border border-slate-200 bg-night-700 px-3 py-2 text-left text-[11px] font-normal leading-snug text-ink-soft opacity-0 shadow-xl transition group-hover:opacity-100 group-focus:opacity-100">{children}</span>
    </span>
  );
}

export function MetricTile({ label, value, sub, href, tone = "neutral", how }: { label: string; value: number | string; sub?: string; href: string; tone?: "neutral" | "red" | "amber" | "violet" | "cyan" | "green"; how: React.ReactNode }) {
  const toneCls = { neutral: "text-slate-900", red: "text-red-600", amber: "text-amber-600", violet: "text-violet-600", cyan: "text-cyan-600", green: "text-emerald-600" }[tone];
  return (
    <div className="card group relative p-4 transition hover:border-slate-300 hover:shadow-glow">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium text-slate-500">{label}</div>
        <HowCalculated>{how}</HowCalculated>
      </div>
      <Link href={href} className="block after:absolute after:inset-0 after:content-['']">
        <div className={`mt-1 text-3xl font-semibold tabular-nums tracking-tight ${toneCls}`}>{value}</div>
        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500"><span className="line-clamp-2">{sub}</span><span className="text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-cyan-600">→</span></div>
      </Link>
    </div>
  );
}

export function SectionTitle({ eyebrow, title, children, actions }: { eyebrow?: string; title: React.ReactNode; children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h2>
        {children && <p className="mt-0.5 max-w-3xl text-sm text-slate-500">{children}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
