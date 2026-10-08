import { redirect } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { canTransferCatering } from "@/lib/catering/transfers-shared";
import { loadEzcaterMappingReview } from "@/lib/admin/ezcater-review";
import { serverT } from "@/lib/i18n/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { EzcaterReviewClient } from "./review-client";

export default async function EzcaterReviewPage() {
  const actor = await requireSessionFromHeaders("/admin/catering/ezcater-review");
  if (!canTransferCatering(actor.user.role)) redirect("/admin/catering");
  let data: Awaited<ReturnType<typeof loadEzcaterMappingReview>> | null = null;
  try { data = await loadEzcaterMappingReview(actor); } catch { /* Visible unavailable state, never an empty queue. */ }
  return <div>
    <PageHeader title={serverT(actor.user.language, "admin.ezcaterReview.title")} />
    {data ? <EzcaterReviewClient {...data} /> : <p role="alert">{serverT(actor.user.language, "admin.ezcaterReview.unavailable")}</p>}
  </div>;
}
