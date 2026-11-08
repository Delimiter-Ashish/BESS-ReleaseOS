import { NextResponse } from "next/server";
import { requireCap } from "@/lib/auth";
import { handle } from "@/lib/http";
import { resetStore, StoreError } from "@/lib/store";

export const runtime = "nodejs";

/** Reset the in-memory demo store to the seed (EQORE roles only). */
export async function POST(req: Request) {
  return handle(() => {
    requireCap(req, "reset");
    // Public deployments set RELEASEOS_DISABLE_RESET=1: demo passcodes are public, so nobody may wipe the shared demo.
    if (process.env.RELEASEOS_DISABLE_RESET === "1") throw new StoreError(403, "Reset is disabled on this public demonstration");
    resetStore();
    return NextResponse.json({ ok: true });
  });
}
