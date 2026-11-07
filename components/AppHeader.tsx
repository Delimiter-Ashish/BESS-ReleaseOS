import Link from "next/link";

export function AppHeader() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-900 text-sm font-bold text-white">⚡</span>
          <span className="font-semibold tracking-tight">ReleaseOS</span>
          <span className="hidden text-xs text-slate-500 sm:inline">· version-locked compliance documentation for BESS projects</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm text-slate-600">
          <Link href="/" className="hover:text-slate-900">Portfolio</Link>
          <Link href="/sites/S-1001" className="hover:text-slate-900">Demo site</Link>
          <Link href="/p/S-1002" className="hover:text-slate-900">QR view</Link>
        </nav>
      </div>
    </header>
  );
}
