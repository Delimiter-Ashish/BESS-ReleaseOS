import { redirect } from "next/navigation";

/** Legacy alias of the public first-responder page (one public route: /p/:id). */
export default async function EmergencyAlias({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  redirect(`/p/${encodeURIComponent(params.id)}`);
}
