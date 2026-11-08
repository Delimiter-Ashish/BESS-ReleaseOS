// Server-only: portfolio view over Ashish's Project Guardian preflight (lib/guardian/preflight.ts).
// Runs the SAME read-only preflight the API route runs (AI off), for each project's current packages.
// Nothing is re-implemented here; counts come straight from the PreflightReport.
import { runPreflight } from "./guardian/preflight";
import type { PreflightReport } from "./guardian/types";
import { getReleases, getSites } from "./store";
import { relevantTemplates } from "./workspace";

export interface GuardianPackageSummary { projectId: string; projectName: string; templateId: string; templateName: string; canBuild: boolean; blockers: number; warnings: number; info: number; topBlockers: { title: string; responsibleRole?: string; nextAction: string }[] }

export async function guardianPortfolio(): Promise<GuardianPackageSummary[]> {
  const out: GuardianPackageSummary[] = [];
  for (const site of getSites()) {
    for (const t of relevantTemplates(site)) {
      const r: PreflightReport = await runPreflight(site, t.id, getReleases(site.id), { ai: false });
      out.push({
        projectId: site.id, projectName: site.name, templateId: t.id, templateName: t.name, canBuild: r.canBuild,
        blockers: r.counts.blocker, warnings: r.counts.warning, info: r.counts.info,
        topBlockers: r.findings.filter((f) => f.blocking).slice(0, 3).map((f) => ({ title: f.title, responsibleRole: f.responsibleRole, nextAction: f.nextAction })),
      });
    }
  }
  return out;
}
