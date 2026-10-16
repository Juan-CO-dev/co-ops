import { canDoOperationalTask } from "@/lib/operational-task-access";
/**
 * /pm-report — PM Report fill/submit surface (KH+ only).
 *
 * Auth → location guard → KH+ gate → get-or-create report → load edit state
 * (with notes — KH+ surface) → load active location users → today's presence
 * roster (D-28) → compute timeliness (reusing loadReportStatuses +
 * computeOverdue + operationalNow from midshift) → render <PmReportClient>.
 *
 * Security: lockLocationContext before any service-role read (IDOR lesson).
 * Notes are ONLY passed to the KH+ client, never to any employee surface.
 *
 * PM v2 (Scheduling Phase 1, Task 21): the page chooses by the DAY ROW's `format`. A v1 day renders exactly
 * today's client. A v2 day renders the manager's OWN copy while the day is open (other copies as counts only)
 * and, after submit, the results for those `canReadPmDayResults` allows; anyone else sees a plain line. Every
 * new day is v1 until the PM v2 switch exists and a shop turns it on (lib/pm-report.ts).
 */

import { redirect } from "next/navigation";
import type { ReactNode } from "react";

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
import { loadShiftBoard } from "@/lib/assignments";
import { pmPresenceRoster } from "@/lib/pm-report-shared";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { PmReportError } from "@/lib/pm-report";
import { loadDayResults, loadMyCopy, openMyCopy, pmDayState } from "@/lib/pm-report-v2";
import { peopleActorFromAuth } from "@/lib/people/access-shared";
import { PmCopyForm } from "@/components/pm-report-v2/PmCopyForm";
import { PmDayResults } from "@/components/pm-report-v2/PmDayResults";

import { DashboardBackLink } from "@/components/DashboardBackLink";
import { AccessDeniedBanner } from "@/components/ui/AccessDeniedBanner";
import { PmReportClient } from "./pm-report-client";

interface PageProps {
  searchParams: Promise<{ location?: string }>;
}

export default async function PmReportPage({ searchParams }: PageProps) {
  const auth = await requireSessionFromHeaders("/pm-report");
  const { location: locationParam } = await searchParams;

  if (!locationParam) redirect("/dashboard");

  // Gate: KH+ only
  if (auth.level < PM_REPORT_BASE_LEVEL) {
    return (
      <main className="mx-auto max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6">
        <AccessDeniedBanner language={auth.user.language} />
      </main>
    );
  }

  // Location gate — redirect if not permitted
  const locActor: LocationActor = { role: auth.role, locations: auth.locations };
  if (!lockLocationContext(locActor, locationParam)) redirect("/dashboard");

  if (!(await canDoOperationalTask(auth, locationParam, "pm_report"))) redirect("/dashboard");

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
  const day = await getOrCreatePmReport(sb, {
    locationId,
    date,
    actor: { userId: auth.user.id, role: auth.role, level: auth.level },
  });
  if (day.format === "v2") return renderV2(auth, locationId, date);
  const report = await loadPmReportForEdit(sb, { locationId, date, actor });

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
    .eq("location_id", locationId)
    .eq("active", true);
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

  // D-28: the starting roster is today's presence at this shop (the shift board's people who were
  // here), not "anyone who touched the app". A failed board read falls back to the old activity
  // roster (null) rather than an empty page at close — the add-picker still lists everyone.
  let presenceRoster: { id: string; name: string }[] | null = null;
  try {
    const board = await loadShiftBoard(sb, {
      actor: { userId: auth.user.id, role: auth.role, level: auth.level, locations: auth.locations },
      locationId,
      date,
    });
    // Review #3: only people the PM route will accept a grade for (the add-picker's roster).
    presenceRoster = pmPresenceRoster(board, new Set(locationUsers.map((u) => u.id)));
  } catch (err) {
    console.error("pm report presence roster failed", err);
  }

  const submitted = report?.status === "submitted";

  return (
    <main className="mx-auto max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6">
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
        presenceRoster={presenceRoster}
        language={lang}
        submitted={submitted}
      />
    </main>
  );
}

/** A v2 day: the actor's own copy while the day is open; the results after submit (or a plain line). */
async function renderV2(auth: Awaited<ReturnType<typeof requireSessionFromHeaders>>, locationId: string, date: string) {
  const sb = getServiceRoleClient();
  const lang = auth.user.language;
  const actor = peopleActorFromAuth(auth);
  const state = await pmDayState(sb, locationId, date);
  let body: ReactNode;
  if (state && state.status !== "open") {
    const results = await loadDayResults(sb, { actor, locationId, date }).catch((e: unknown) => {
      if (e instanceof PmReportError && e.code === "forbidden") return null;
      throw e;
    });
    body = results ? <PmDayResults results={results} /> : <p className="co-card p-4 text-sm text-co-text">{serverT(lang, "pmv2.results.noAccess")}</p>;
  } else {
    // The presence roster (D-28), the same source as v1; only people the shop's roster holds.
    let presenceRoster: { id: string; name: string }[] = [];
    let prefillFrom: string | null = null;
    try {
      const { data: locScoped } = await sb.from("user_locations").select("user_id").eq("location_id", locationId).eq("active", true);
      const ids = ((locScoped ?? []) as Array<{ user_id: string }>).map((r) => r.user_id);
      const { data: users } = ids.length ? await sb.from("users").select("id, name").eq("active", true).in("id", ids) : { data: [] };
      const board = await loadShiftBoard(sb, { actor: { userId: auth.user.id, role: auth.role, level: auth.level, locations: auth.locations }, locationId, date });
      presenceRoster = pmPresenceRoster(board, new Set(((users ?? []) as Array<{ id: string }>).map((u) => u.id)));
      prefillFrom = board.people.find((p) => p.id === auth.user.id)?.presence?.since ?? null;
    } catch (err) {
      console.error("pm v2 presence roster failed", err instanceof Error ? err.message : "unknown");
    }
    await openMyCopy(sb, { actor, locationId, date });
    const view = await loadMyCopy(sb, { actor, locationId, date, presenceRoster });
    body = view ? <PmCopyForm view={view} prefillFrom={prefillFrom} /> : <p className="co-card p-4 text-sm text-co-text">{serverT(lang, "pmv2.error.pm_v2_unavailable")}</p>;
  }
  return (
    <main className="mx-auto max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3">
        <DashboardBackLink />
      </div>
      <h1 className="mb-4 text-lg font-bold text-co-text">{serverT(lang, "pm.page.title")}</h1>
      {body}
    </main>
  );
}
