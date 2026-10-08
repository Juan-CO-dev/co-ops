import Link from "next/link";
import { redirect } from "next/navigation";

import { WrittenReportsClient } from "@/components/written-reports/WrittenReportsClient";
import { PageHeader } from "@/components/ui/PageHeader";
import { ExportLinks } from "@/components/reports-export/ExportLinks";
import { ReportRangeControls } from "@/components/reports-hub/ReportRangeControls";
import { serverT } from "@/lib/i18n/server";
import { canReadReportLocation, type LocationActor } from "@/lib/locations";
import { operationalNow } from "@/lib/midshift-shared";
import { parseReportRange, reportRangeParams } from "@/lib/report-range";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { listWrittenReports, WRITTEN_REPORT_WRITE_MIN_LEVEL } from "@/lib/written-reports";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;

function scalarParams(params: Params): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
}

export default async function ReportsWrittenPage({ searchParams }: { searchParams: Promise<Params> }) {
  const auth = await requireSessionFromHeaders("/reports/written");
  if (auth.level < 2) redirect("/dashboard");
  const raw = scalarParams(await searchParams);
  const range = parseReportRange(raw, operationalNow(new Date()).date);
  const actor: LocationActor = { role: auth.role, locations: auth.locations };
  if (raw.location && !/^[a-zA-Z0-9_-]+$/.test(raw.location)) redirect("/reports/written");
  if (raw.location === "all" && auth.level < 8) redirect("/reports/written");
  if (raw.location && raw.location !== "all" && !canReadReportLocation(actor, raw.location)) redirect("/reports/written");
  const selectedLocation = raw.location && raw.location !== "all" ? raw.location : null;
  const viewerLocations = selectedLocation
    ? [selectedLocation]
    : auth.level >= 8 ? "all" as const : auth.locations;

  const page = await listWrittenReports(getServiceRoleClient(), {
    viewer: { userId: auth.user.id, level: auth.level, locations: viewerLocations },
    from: range.from,
    to: range.to,
    locationId: selectedLocation ?? undefined,
    cursor: raw.cursor,
  });

  const contextParams = reportRangeParams(range);
  if (selectedLocation) contextParams.set("location", selectedLocation);
  else if (auth.level >= 8) contextParams.set("location", "all");
  const nextParams = new URLSearchParams(contextParams);
  if (page.nextCursor) nextParams.set("cursor", page.nextCursor);

  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6 md:max-w-3xl lg:max-w-5xl xl:max-w-6xl">
      <Link href={`/reports?${contextParams.toString()}`} className="mb-3 inline-flex min-h-[44px] items-center text-sm font-bold text-co-text-muted">
        ← {serverT(auth.user.language, "nav.reports_hub")}
      </Link>
      <PageHeader
        title={serverT(auth.user.language, "written_reports.page.title")}
        subtitle={serverT(auth.user.language, "written_reports.page.subtitle")}
        className="mb-4"
      />
      <ReportRangeControls range={range} locationId={selectedLocation ?? (auth.level >= 8 ? "all" : "")} language={auth.user.language} action="/reports/written" />
      {/* Exports are one shop at a time (the route refuses "all"). */}
      {selectedLocation ? <ExportLinks className="mb-4" family="written" language={auth.user.language}
        query={{ location: selectedLocation, range: range.range, from: range.from, to: range.to }} /> : null}
      <WrittenReportsClient
        reports={page.reports}
        canWrite={auth.level >= WRITTEN_REPORT_WRITE_MIN_LEVEL}
        viewerLevel={auth.level}
        nextHref={page.nextCursor ? `/reports/written?${nextParams.toString()}` : null}
      />
    </main>
  );
}
