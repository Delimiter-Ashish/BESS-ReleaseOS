import { redirect } from "next/navigation";

/** Lifecycle lives in the workspace shell at /lifecycle?project=:id. */
export default function SiteLifecycleRedirect({ params }: { params: { id: string } }) {
  redirect(`/lifecycle?project=${encodeURIComponent(params.id)}`);
}
