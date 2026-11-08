import { checksum } from "@releaseos/release-core";
import type { Session } from "./auth";

/** A retry is the same signed request, including its original check token, author and note. */
export function signoffFingerprint(mode: "legacy" | "studio", siteId: string, selection: unknown, session: Session, note: string | undefined, token: string | undefined) {
  return checksum({ mode, siteId, selection: JSON.parse(JSON.stringify(selection ?? null)), userId: session.userId, note: (note ?? "").trim().slice(0, 1000), token: token ?? null });
}
