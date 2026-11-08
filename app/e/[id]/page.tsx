import { redirect } from "next/navigation";

/** Legacy alias of the public first-responder page (one public route: /p/:id). */
export default function EmergencyAlias({ params }: { params: { id: string } }) {
  redirect(`/p/${encodeURIComponent(params.id)}`);
}
