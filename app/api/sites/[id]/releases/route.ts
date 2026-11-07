import { NextResponse } from "next/server";
import { requireCap } from "@/lib/auth";
import { asString, handle, jsonBody } from "@/lib/http";
import { packageReadiness } from "@/lib/release";
import { PACKAGE_TEMPLATES } from "@/lib/requirements";
import { buildRelease, getSite, StoreError } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Readiness for every package (deterministic gate + optimistic token). */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return handle(() => {
    requireCap(req, "read_private");
    const site = getSite(params.id);
    if (!site) throw new StoreError(404, "site not found");
    return NextResponse.json({
      ok: true,
      packages: PACKAGE_TEMPLATES.map((t) => {
        const r = packageReadiness(site, t);
        return { templateId: t.id, name: t.name, canBuild: r.canBuild, token: r.token, issues: r.issues, items: r.items.map((i) => ({ requirementId: i.requirementId, name: i.name, state: i.state, approved: i.approved?.revLabel ?? null, pending: i.pending?.revLabel ?? null, openTasks: i.tasks.map((t) => t.id) })) };
      }),
    });
  });
}

/** Build a frozen, version-locked release: { templateId, note, readinessToken }. Engineer signoff from session. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const session = requireCap(req, "release");
    const b = await jsonBody(req);
    const release = buildRelease(params.id, asString(b.templateId, 60) ?? "", session, asString(b.note), asString(b.readinessToken, 128));
    const { snapshot, ...rest } = release;
    return NextResponse.json({ ok: true, release: { ...rest, snapshotSha256: snapshot?.sha256 } });
  });
}
