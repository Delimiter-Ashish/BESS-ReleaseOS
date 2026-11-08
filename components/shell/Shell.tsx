"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

export interface ShellUser { id: string; name: string; title: string; engineer: boolean; passcode: string }
export interface ShellProps {
  session: { userId: string; name: string; engineer: boolean; role: string };
  users: ShellUser[];
  ai: { provider: string; keyed: boolean };
  badges: { reviews: number; actions: number; blocked: number; confirm: number; dependencies: number };
  /** Public deployment: show the synthetic-demonstration banner and hide reset (RELEASEOS_PUBLIC_DEMO / RELEASEOS_DISABLE_RESET). */
  deployment?: { publicDemo: boolean; resetDisabled: boolean };
  children: React.ReactNode;
}
type BadgeKey = keyof ShellProps["badges"];
interface NavItem { href: string; label: string; sub?: string; icon: string; badge?: BadgeKey; tone?: "violet" | "red" | "amber" | "cyan" }

const I = {
  today: "M3 12l9-9 9 9M5 10v10h14V10",
  inbox: "M4 4h16v12H4zM4 16l4-4h8l4 4M12 7v5m-2-2 2 2 2-2",
  projects: "M3 7h18M3 12h18M3 17h18",
  guardian: "M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z",
  actions: "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9",
  studio: "M12 3l8 4-8 4-8-4 8-4zM4 12l8 4 8-4M4 17l8 4 8-4",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  qr: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2",
  reviews: "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9",
  deps: "M6 3v12M18 9v12M6 15a6 6 0 0 0 6 6h6M18 9a6 6 0 0 0-6-6H6",
  compare: "M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3M12 2v20",
  graph: "M5 6a2 2 0 1 0 0 .1M19 6a2 2 0 1 0 0 .1M12 18a2 2 0 1 0 0 .1M6.5 7.5 11 16.5M17.5 7.5 13 16.5M7 6h10",
  signoff: "M12 15l-3 6 3-1.5L15 21l-3-6zM12 3a6 6 0 1 0 0 12 6 6 0 0 0 0-12z",
  lifecycle: "M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
};

/** Navigation per role. Authorization is enforced by the server on every API call — this only shapes the experience. */
function navFor(s: ShellProps["session"]): { title?: string; items: NavItem[] }[] {
  if (s.role === "eqore" && s.engineer)
    return [
      { items: [{ href: "/", label: "Today", icon: I.today }] },
      { title: "Engineering", items: [
        { href: "/reviews", label: "Assigned Reviews", icon: I.reviews, badge: "reviews", tone: "violet" },
        { href: "/reviews?kind=dependency", label: "Dependency Impacts", icon: I.deps, badge: "dependencies", tone: "amber" },
        { href: "/reviews?kind=revision&status=all", label: "Revision Comparisons", icon: I.compare },
        { href: "/guardian?tab=graph", label: "Engineering Evidence", sub: "Guardian evidence graph", icon: I.graph },
        { href: "/projects", label: "Relevant Projects", icon: I.projects },
        { href: "/submissions?view=signoff", label: "Release Signoff", icon: I.signoff, badge: "blocked", tone: "red" },
        { href: "/lifecycle", label: "Lifecycle Reviews", sub: "Site changes · maintenance evidence", icon: I.lifecycle },
      ] },
      { title: "Records", items: [{ href: "/activity", label: "Activity History", icon: I.activity }, { href: "/qr", label: "Site QR Access", icon: I.qr }] },
    ];
  if (s.role === "eqore")
    return [
      { items: [{ href: "/", label: "Today", icon: I.today }, { href: "/inbox", label: "Project Inbox", icon: I.inbox }, { href: "/projects", label: "Projects", icon: I.projects }] },
      { title: "Assurance", items: [
        { href: "/guardian", label: "Project Guardian", sub: "Scan · evidence graph · time machine", icon: I.guardian, badge: "actions", tone: "amber" },
        { href: "/memory", label: "Action Center", sub: "Findings & Project Memory", icon: I.actions, badge: "confirm", tone: "cyan" },
        { href: "/submissions", label: "Submission Studio", icon: I.studio, badge: "blocked", tone: "red" },
        { href: "/lifecycle", label: "Lifecycle", sub: "Obligations · deadlines · site changes", icon: I.lifecycle },
      ] },
      { title: "Records", items: [{ href: "/activity", label: "Activity History", icon: I.activity }, { href: "/qr", label: "Site QR Access", icon: I.qr }] },
    ];
  if (s.role === "supplier") return [{ items: [{ href: "/", label: "Today", icon: I.today }, { href: "/inbox", label: "Upload documents", icon: I.inbox }, { href: "/projects", label: "Projects", icon: I.projects }] }];
  if (s.role === "facility") return [{ items: [{ href: "/", label: "Today", icon: I.today }, { href: "/projects", label: "Projects", icon: I.projects }, { href: "/lifecycle", label: "Obligations & records", icon: I.lifecycle }, { href: "/qr", label: "Site QR Access", icon: I.qr }] }];
  if (s.role === "ahj") return [{ items: [{ href: "/", label: "Today", icon: I.today }, { href: "/projects", label: "Projects", icon: I.projects }, { href: "/qr", label: "Site QR Access", icon: I.qr }] }];
  return [{ items: [{ href: "/", label: "Today", icon: I.today }, { href: "/qr", label: "Site QR Access", icon: I.qr }] }];
}

const TONE = { violet: "bg-violet-500 text-night-950", red: "bg-red-400 text-night-950", amber: "bg-amber-400 text-night-950", cyan: "bg-cyan-400 text-night-950" } as const;

function NavList({ groups, badges, onNavigate }: { groups: ReturnType<typeof navFor>; badges: ShellProps["badges"]; onNavigate: () => void }) {
  const path = usePathname();
  const sp = useSearchParams();
  const all = groups.flatMap((g) => g.items);
  // Most specific match wins (path + every query param of the item).
  const score = (href: string) => {
    const [p, q] = href.split("?");
    const pathOk = p === "/" ? path === "/" : path === p || path.startsWith(`${p}/`) || (p === "/projects" && path.startsWith("/sites"));
    if (!pathOk) return -1;
    const params = new URLSearchParams(q ?? "");
    let n = 1;
    for (const [k, v] of Array.from(params.entries())) { if (sp.get(k) !== v) return -1; n++; }
    return n;
  };
  const best = all.reduce((b, i) => (score(i.href) > score(b.href) ? i : b), all[0]);
  const activeHref = score(best.href) > 0 ? best.href : "";
  return (
    <div className="space-y-4 px-2">
      {groups.map((g, gi) => (
        <div key={gi}>
          {g.title && <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-muted/70">{g.title}</div>}
          <ul className="space-y-0.5">
            {g.items.map((n) => {
              const b = n.badge ? badges[n.badge] : 0;
              const on = n.href === activeHref;
              return (
                <li key={n.href}>
                  <Link href={n.href} onClick={onNavigate} aria-current={on ? "page" : undefined}
                    className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${on ? "bg-[rgba(34,211,238,0.10)] font-medium text-ink" : "text-ink-soft hover:bg-[rgba(255,255,255,0.04)] hover:text-ink"}`}>
                    {on && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent-cyan" />}
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={on ? "text-accent-cyan" : "text-ink-muted group-hover:text-ink-soft"}><path d={n.icon} /></svg>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{n.label}</span>
                      {n.sub && <span className="block truncate text-[10px] font-normal text-ink-muted">{n.sub}</span>}
                    </span>
                    {b > 0 && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${TONE[n.tone ?? "cyan"]}`}>{b}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default function Shell({ session, users, ai, badges, deployment, children }: ShellProps) {
  const path = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Public first-responder QR view stays unbranded and outside the workspace.
  if (path.startsWith("/p/") || path === "/intro") return <>{children}</>;
  const groups = navFor(session);
  const roleLabel = session.role === "eqore" ? (session.engineer ? "Engineer workspace" : "Project manager workspace") : session.role === "public" ? "Public" : `${session.role.toUpperCase()} view`;
  const nav = (
    <nav className="flex h-full flex-col border-r border-[rgba(148,163,184,0.10)] bg-night-900/95 backdrop-blur-xl">
      <Link href="/" className="flex items-center gap-2.5 px-4 py-4">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-cyan-400 to-teal-600 text-night-950 shadow-glow">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>
        </span>
        <span>
          <span className="block text-sm font-semibold tracking-tight text-ink">ReleaseOS</span>
          <span className="block text-[10px] text-ink-muted">{roleLabel}</span>
        </span>
      </Link>
      <div className="mt-1 min-h-0 flex-1 overflow-y-auto">
        <Suspense fallback={null}><NavList groups={groups} badges={badges} onNavigate={() => setMobileOpen(false)} /></Suspense>
      </div>
      <div className="space-y-3 p-3">
        <div className={`rounded-lg px-3 py-2 text-[11px] ring-1 ring-inset ${ai.provider === "rules" || !ai.keyed ? "bg-[rgba(251,191,36,0.08)] text-[#fde68a] ring-[rgba(251,191,36,0.2)]" : "bg-[rgba(45,212,191,0.08)] text-[#99f6e4] ring-[rgba(45,212,191,0.2)]"}`} title="Server-side extraction provider (AI_PROVIDER / OPENAI_API_KEY). Determined on the server; keys are never sent to the browser.">
          <div className="font-semibold">Extraction: {ai.provider === "rules" ? "deterministic rules" : ai.keyed ? `${ai.provider === "openai" ? "OpenAI" : ai.provider} (live)` : `${ai.provider} — no key, rules fallback`}</div>
          <div className="text-ink-muted">AI proposes · people confirm · engineers approve.</div>
        </div>
        <Identity session={session} users={users} resetDisabled={deployment?.resetDisabled} />
      </div>
    </nav>
  );
  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{nav}</aside>
      <div className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-night-900/90 px-4 py-2 backdrop-blur lg:hidden">
        <button onClick={() => setMobileOpen(true)} className="btn-ghost !px-2 !py-1" aria-label="Open navigation">☰</button>
        <span className="text-sm font-semibold text-ink">ReleaseOS</span>
        <span className="w-8" />
      </div>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-night-950/70" onClick={() => setMobileOpen(false)} />
          <aside className="relative h-full w-64">{nav}</aside>
        </div>
      )}
      <div className="min-w-0">
        {deployment?.publicDemo && <div className="border-b border-[rgba(241,181,106,0.25)] bg-[rgba(241,181,106,0.08)] px-4 py-1.5 text-center text-[11px] text-[#fde68a]" role="note" data-testid="public-demo-banner">Synthetic demonstration for the MIT Energy &amp; Climate Hackathon — fictional projects and documents. Not a production regulatory compliance service; nothing here certifies code compliance.</div>}
        {children}
      </div>
    </div>
  );
}

function Identity({ session, users, resetDisabled }: { session: ShellProps["session"]; users: ShellUser[]; resetDisabled?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const signedIn = session.userId !== "public";
  async function signIn(u: ShellUser) {
    setBusy(u.id); setMsg("");
    const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: u.id, passcode: u.passcode }) });
    setBusy("");
    if (!r.ok) return setMsg("Sign-in failed");
    setOpen(false);
    router.push(u.engineer ? "/reviews" : "/");
    router.refresh();
  }
  async function signOut() {
    await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ logout: true }) });
    setOpen(false);
    router.push("/");
    router.refresh();
  }
  async function reset() {
    if (!confirm("Reset ALL demo data to the synthetic seed? Uploads, communications, reviews and releases made in this session will be discarded.")) return;
    setBusy("reset");
    const r = await fetch("/api/reset", { method: "POST" });
    setBusy("");
    setMsg(r.ok ? "Demo data reset" : (await r.json().catch(() => ({}))).error ?? "Reset failed");
    router.refresh();
  }
  const initials = signedIn ? session.name.split(/[ ,.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("") : "?";
  return (
    <div className="relative">
      {open && (
        <div className="absolute bottom-full left-0 z-40 mb-2 w-72 rounded-xl border border-slate-200 bg-night-800 p-2 shadow-2xl">
          <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Switch demo identity · not production auth</div>
          <ul className="max-h-80 space-y-0.5 overflow-auto">
            {users.map((u) => (
              <li key={u.id}>
                <button disabled={!!busy} onClick={() => signIn(u)} className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-100 ${session.userId === u.id ? "bg-slate-100" : ""}`}>
                  <span><span className="font-medium text-slate-900">{u.name}</span><span className="block text-[11px] text-slate-500">{u.title}</span></span>
                  <span className="flex flex-col items-end">
                    {u.engineer && <span className="pill bg-emerald-50 text-emerald-700 ring-emerald-200">Engineer</span>}
                    <span className="font-mono text-[10px] text-slate-400">{busy === u.id ? "…" : u.passcode}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-1 flex gap-1 border-t border-slate-200 pt-1">
            {signedIn && <button onClick={signOut} className="flex-1 rounded-lg px-2 py-1.5 text-left text-xs text-slate-600 hover:bg-slate-100">Sign out</button>}
            {!resetDisabled && <button onClick={reset} disabled={!!busy || session.role !== "eqore"} title={session.role !== "eqore" ? "EQORE roles only" : ""} className="flex-1 rounded-lg px-2 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 disabled:opacity-40">{busy === "reset" ? "Resetting…" : "Reset demo data"}</button>}
          </div>
          <p className="px-2 pt-1 text-[10px] leading-snug text-slate-500">Identity lives in a server-signed httpOnly cookie. State is persisted on the server (RELEASEOS_DATA_DIR); reset restores the seed.</p>
        </div>
      )}
      {msg && <div className="mb-1 text-[11px] text-ink-soft">{msg}</div>}
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 rounded-lg bg-[rgba(255,255,255,0.04)] px-2.5 py-2 text-left text-sm text-ink ring-1 ring-inset ring-[rgba(148,163,184,0.12)] hover:bg-[rgba(255,255,255,0.07)]">
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold text-night-950 ${session.engineer ? "bg-emerald-400" : signedIn ? "bg-cyan-400" : "bg-indigo-400"}`}>{initials}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{signedIn ? session.name : "Sign in"}</span>
          <span className="block text-[10px] text-ink-muted">{session.engineer ? "Authorized engineer" : signedIn ? (session.role === "eqore" ? "Project manager" : session.role.toUpperCase()) : "Choose a demo identity"}</span>
        </span>
        <span className="text-ink-muted">⌃</span>
      </button>
    </div>
  );
}
