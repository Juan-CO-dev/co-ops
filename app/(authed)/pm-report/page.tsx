/**
 * /pm-report — PM Report fill/submit surface (KH+ only).
 *
 * Auth → location guard → KH+ gate → get-or-create report → load edit state
 * (with notes — KH+ surface) → load active location users → compute timeliness
 * (reusing loadReportStatuses + computeOverdue + operationalNow from midshift)
 * → render <PmReportClient>.
 *
 * Security: lockLocationContext before any service-role read (IDOR lesson).
 * Notes are ONLY passed to the KH+ client, never to any employee surface.
 */

import { redirect } from "next/navigation";

import { serverT } from "@/lib/i18n/server";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import {
  computeOverdue,
  loadReportStatuses,
  operationalNow,
  type MidShiftActor,
  type ReportStatusRow,
} from "@/lib/midshift";
import {
  PM_REPORT_BASE_LEVEL,
  getOrCreatePmReport,
  loadPmReportForEdit,
} from "@/lib/pm-report";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

import { DashboardBackLink } from "@/components/DashboardBackLink";
import { PmReportClient } from "./pm-report-client";

const OPERATIONAL_TZ = "America/New_York";

function nyDateString(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATIONAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

interface PageProps {
  searchParams: Promise<{ location?: string }>;
}

export default async function PmReportPage({ searchParams }: PageProps) {
  const auth = await requireSessionFromHeaders("/pm-report");
  const { location: locationParam } = await searchParams;

  if (!locationParam) redirect("/dashboard");

  // Gate: KH+ only
  if (auth.level < PM_REPORT_BASE_LEVEL) {
    const lang = auth.user.language;
    return (
      <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
        <div className="mb-3">
          <DashboardBackLink />
        </div>
        <p className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-3 text-sm font-semibold text-co-text">
          {serverT(lang, "pm.page.title")}
        </p>
      </main>
    );
  }

  // Location gate — redirect if not permitted
  const locActor: LocationActor = { role: auth.role, locations: auth.locations };
  if (!lockLocationContext(locActor, locationParam)) redirect("/dashboard");

  const now = new Date();
  const { date, minutesOfDay } = operationalNow(now);

  const sb = getServiceRoleClient();
  const lang = auth.user.language;
  const locationId = locationParam;

  const actor: MidShiftActor = {
    userId: auth.user.id,
    role: auth.role,
    level: auth.level,
  };

  // Ensure report exists (upsert) then load its full edit state (with notes — KH+).
  await getOrCreatePmReport(sb, {
    locationId,
    date,
    actor: { userId: auth.user.id, role: auth.role, level: auth.level },
  });
  const report = await loadPmReportForEdit(sb, { locationId, date });

  // Compute timeliness by reusing loadReportStatuses + computeOverdue from midshift.
  // Same composition as loadMidShiftPulse does — reuse the exports, don't re-implement.
  const { rows, closingDone, midDayDoneCount } = await loadReportStatuses(sb, {
    locationId,
    date,
    actor,
  });
  const timeliness: ReportStatusRow[] = rows.map((r) => ({
    ...r,
    overdue: computeOverdue({
      key: r.key,
      done: r.progress === "done",
      minutesOfDay,
      closingDone,
      midDayDoneCount,
    }),
  }));

  // Load all active users at this location for the add-employee picker.
  // Two-step to avoid the PostgREST embedded-select + RLS footgun (AGENTS.md Phase 2 Session 4).
  let locationUsers: { id: string; name: string }[] = [];
  const { data: locScoped } = await sb
    .from("user_locations")
    .select("user_id")
    .eq("location_id", locationId);
  const locIds = ((locScoped ?? []) as Array<{ user_id: string }>).map((r) => r.user_id);
  if (locIds.length > 0) {
    const { data: candidates } = await sb
      .from("users")
      .select("id, name")
      .eq("active", true)
      .in("id", locIds)
      .order("name", { ascending: true });
    locationUsers = (candidates ?? []) as { id: string; name: string }[];
  }

  const submitted = report?.status === "submitted";

  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3">
        <DashboardBackLink />
      </div>
      <h1 className="mb-4 text-lg font-bold text-co-text">
        {serverT(lang, "pm.page.title")}
      </h1>

      <PmReportClient
        locationId={locationId}
        report={report}
        timeliness={timeliness}
        locationUsers={locationUsers}
        language={lang}
        submitted={submitted}
      />
    </main>
  );
}
