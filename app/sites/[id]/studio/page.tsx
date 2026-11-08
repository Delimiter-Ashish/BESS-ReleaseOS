import { redirect } from "next/navigation";

/** One Submission Studio: /submissions (selection, groups, server checks, real combined PDFs). */
export default function SiteStudioRedirect({ params }: { params: { id: string } }) {
  redirect(`/submissions?project=${encodeURIComponent(params.id)}`);
}
