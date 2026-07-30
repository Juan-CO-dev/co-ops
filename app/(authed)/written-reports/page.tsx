/**
 * /written-reports — the Written Reports surface.
 *
 * Free-text staff posts ("shift happened, something went wrong, write it down").
 * The list is visibility-gated server-side (listWrittenReports reproduces the
 * live RLS predicates); L3+ may author. Moved into the (authed) route group
 * (mirrors the reports hub migration) so it sits behind the authed layout while
 * keeping the /written-reports URL.
 */

import { serverT } from "@/lib/i18n/server";
import { accessibleLocations, type LocationActor } from "@/lib/locations";
import { requireSessionFromHeaders } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { listWrittenReports, WRITTEN_REPORT_WRITE_MIN_LEVEL } from "@/lib/written-reports";

import { DashboardBackLink } from "@/components/DashboardBackLink";
import { PageHeader } from "@/components/ui/PageHeader";
import { WrittenReportsClient } from "@/components/written-reports/WrittenReportsClient";

export const dynamic = "force-dynamic";

export default async function WrittenReportsPage() {
  const auth = await requireSessionFromHeaders("/written-reports");
  const lang = auth.user.language;
  const sb = getServiceRoleClient();

  const actor: LocationActor = { role: auth.role, locations: auth.locations };
  const reports = await listWrittenReports(sb, {
    viewer: {
      userId: auth.user.id,
      level: auth.level,
      locations: accessibleLocations(actor),
    },
  });

  const canWrite = auth.level >= WRITTEN_REPORT_WRITE_MIN_LEVEL;

  return (
    <main className="mx-auto max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3">
        <DashboardBackLink />
      </div>
      <PageHeader
        title={serverT(lang, "written_reports.page.title")}
        subtitle={serverT(lang, "written_reports.page.subtitle")}
        className="mb-4"
      />
      <WrittenReportsClient reports={reports} canWrite={canWrite} viewerLevel={getRoleLevel(auth.user.role)} />
    </main>
  );
}
