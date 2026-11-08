import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import { EvidenceProvider } from "@/components/evidence/EvidenceProvider";
import Shell from "@/components/shell/Shell";
import { DEMO_USERS, getSession } from "@/lib/auth";
import { selectedProvider } from "@/lib/extract";
import { findings, todayMetrics } from "@/lib/workspace";
import "./globals.css";

const geistSans = localFont({ src: "./fonts/GeistVF.woff", variable: "--font-geist-sans", weight: "100 900" });
const geistMono = localFont({ src: "./fonts/GeistMonoVF.woff", variable: "--font-geist-mono", weight: "100 900" });

export const metadata: Metadata = {
  title: "ReleaseOS — Project assurance",
  description: "Project intelligence and submission assurance for C&I battery storage projects",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Public first-responder pages: no workspace shell, no session, user directory or portfolio metrics in the payload.
  if ((headers().get("x-ros-path") ?? "").startsWith("/p/")) {
    return (
      <html lang="en">
        <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body>
      </html>
    );
  }
  const s = getSession();
  const provider = selectedProvider();
  const keyed = provider === "openai" ? !!process.env.OPENAI_API_KEY : provider === "anthropic" ? !!process.env.ANTHROPIC_API_KEY : true;
  const m = todayMetrics();
  const badges = {
    reviews: m.pendingReviews + m.openDependencies,
    dependencies: m.openDependencies,
    actions: findings(s).filter((f) => f.lifecycle === "action_required" && f.severity === "high").length,
    blocked: m.blockedSubmissions.length,
    confirm: m.toConfirm,
  };
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <EvidenceProvider>
          <Shell
            session={{ userId: s.userId, name: s.name, engineer: s.engineer, role: s.role }}
            users={DEMO_USERS.map(({ id, name, title, engineer, passcode }) => ({ id, name, title, engineer, passcode }))}
            ai={{ provider, keyed }}
            badges={badges}
          >
            {children}
          </Shell>
        </EvidenceProvider>
      </body>
    </html>
  );
}
