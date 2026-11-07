import Link from "next/link";
import UserMenu from "@/components/UserMenu";
import { DEMO_USERS, getSession } from "@/lib/auth";
import { selectedProvider } from "@/lib/extract";

export function AppHeader() {
  const s = getSession();
  const provider = selectedProvider();
  const keyed = provider === "openai" ? !!process.env.OPENAI_API_KEY : provider === "anthropic" ? !!process.env.ANTHROPIC_API_KEY : true;
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-900 text-sm font-bold text-white">⚡</span>
          <span className="font-semibold tracking-tight">BESS ReleaseOS</span>
          <span className="hidden text-xs text-slate-500 lg:inline">· engineering document intelligence & version-locked releases</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm text-slate-600">
          <Link href="/" className="hidden hover:text-slate-900 sm:inline">Portfolio</Link>
          <Link href="/sites/S-1001" className="hidden hover:text-slate-900 sm:inline">Demo site</Link>
          <Link href="/p/S-1002" className="hidden hover:text-slate-900 md:inline">QR view</Link>
          <span className={`hidden pill md:inline-flex ${provider === "rules" || !keyed ? "bg-orange-50 text-orange-800 ring-orange-200" : "bg-emerald-50 text-emerald-800 ring-emerald-200"}`} title="Server-side AI provider (AI_PROVIDER)">
            AI: {provider === "rules" ? "rules only" : `${provider}${keyed ? "" : " (no key → rules)"}`}
          </span>
          <UserMenu current={{ userId: s.userId, name: s.name, engineer: s.engineer, role: s.role }} users={DEMO_USERS.map(({ id, name, title, engineer, passcode }) => ({ id, name, title, engineer, passcode }))} />
        </nav>
      </div>
    </header>
  );
}
