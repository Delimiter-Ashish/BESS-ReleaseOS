import { redirect } from "next/navigation";

/** Lifecycle lives in the workspace shell at /lifecycle?project=:id. */
export default async function SiteLifecycleRedirect({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  redirect(`/lifecycle?project=${encodeURIComponent(params.id)}`);
}
