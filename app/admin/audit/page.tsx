import { redirect } from "next/navigation";

import { PlannedPage } from "@/components/PlannedPage";
import { requireSessionFromHeaders } from "@/lib/session";

/** The audit log viewer is read-only, owner level (nav spec r5 §7.2); the hub card's minLevel is the same 9. */
const AUDIT_MIN_LEVEL = 9;

// Held for a planned feature that is not built yet. Not in any menu or search; the admin hub shows a muted
// "Planned" card to level 9+. The level gate runs before anything else, so the page is owner level already.
export default async function AdminAuditPage() {
  const auth = await requireSessionFromHeaders("/admin/audit");
  if (auth.level < AUDIT_MIN_LEVEL) redirect("/dashboard");
  // The admin shell already draws the registry back link.
  return <PlannedPage lang={auth.user.language} titleKey="admin.section.audit" backLink={false} />;
}
