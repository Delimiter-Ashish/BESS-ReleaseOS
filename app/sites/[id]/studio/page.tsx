import { redirect } from "next/navigation";

/** One Submission Studio: /submissions (selection, groups, server checks, real combined PDFs). */
export default async function SiteStudioRedirect({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  redirect(`/submissions?project=${encodeURIComponent(params.id)}`);
}
