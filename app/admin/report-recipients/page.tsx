import { redirect } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadReportRecipientsAdmin } from "@/lib/report-recipients";
import { RECIPIENTS_VIEW_MIN } from "@/lib/report-recipients-shared";
import { serverT } from "@/lib/i18n/server";
import { ReportRecipientsAdmin } from "@/components/admin/report-recipients/ReportRecipientsAdmin";

export default async function ReportRecipientsPage() {
  const auth = await requireSessionFromHeaders("/admin/report-recipients");
  if (auth.level < RECIPIENTS_VIEW_MIN) redirect("/admin");
  const view = await loadReportRecipientsAdmin(getServiceRoleClient(), {
    userId: auth.user.id, role: auth.role, level: auth.level, locations: auth.locations,
  });
  const language = auth.user.language;
  return <div className="space-y-4">
    <h1 className="text-2xl font-bold text-co-text">{serverT(language, "reportRecipients.title")}</h1>
    <p className="text-sm text-co-text-muted">{serverT(language, "reportRecipients.intro")}</p>
    <ReportRecipientsAdmin view={view} />
  </div>;
}
