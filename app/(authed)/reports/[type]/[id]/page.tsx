/**
 * /reports/[type]/[id] — Reports Hub detail page (Task 3).
 *
 * Auth → validate type → location guard → list-visibility check →
 * loadReportDetail → render the matching detail component.
 *
 * Security:
 *   - cash detail blocked below L4 (same gate as list; defence-in-depth)
 *   - note redaction is enforced in the loader (loadChecklistDetail), not here
 *
 * Task 4 adds CashReportDetail + PmReportDetail branches to the switch.
 */

import { redirect } from "next/navigation";

import { serverT } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/types";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import {
  REPORTS_HUB_CASH_LEVEL,
  loadReportDetail,
  type CashReportDetail,
  type ChecklistReportDetail,
  type OpeningReportDetail,
  type PmReportDetail,
  type ReportDetail,
  type ReportTypeKey,
  type Viewer,
} from "@/lib/reports-hub";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

import { DashboardBackLink } from "@/components/DashboardBackLink";
import { CashReportDetailView } from "@/components/reports-hub/CashReportDetail";
import { ChecklistReportDetailView } from "@/components/reports-hub/ChecklistReportDetail";
import { OpeningReportDetailView } from "@/components/reports-hub/OpeningReportDetail";
import { PmReportDetailView } from "@/components/reports-hub/PmReportDetail";

const VALID_TYPES: ReportTypeKey[] = ["opening", "closing", "am_prep", "mid_day", "cash", "pm"];

function isReportTypeKey(v: string): v is ReportTypeKey {
  return (VALID_TYPES as string[]).includes(v);
}

interface PageProps {
  params: Promise<{ type: string; id: string }>;
  searchParams: Promise<{ location?: string }>;
}

export default async function ReportDetailPage({ params, searchParams }: PageProps) {
  const auth = await requireSessionFromHeaders("/reports");
  const { type: typeParam, id } = await params;
  const { location: locationParam } = await searchParams;

  // Validate type
  if (!isReportTypeKey(typeParam)) redirect("/reports");

  const type: ReportTypeKey = typeParam;

  // Location guard
  if (!locationParam) redirect("/dashboard");
  const locActor: LocationActor = { role: auth.role, locations: auth.locations };
  if (!lockLocationContext(locActor, locationParam)) redirect("/dashboard");

  const lang = auth.user.language;
  const level = auth.level;
  const viewer: Viewer = { userId: auth.user.id, level };

  const t = (key: TranslationKey) => serverT(lang, key);

  const backHref = `/reports?location=${locationParam}`;

  // List-visibility gate at detail (defence-in-depth)
  if (type === "cash" && level < REPORTS_HUB_CASH_LEVEL) {
    return (
      <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
        <a href={backHref} className="mb-4 block text-sm text-co-text-muted hover:underline">
          {t("reports.detail.back")}
        </a>
        <p className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-3 text-sm font-semibold text-co-text">
          {t("reports.not_available")}
        </p>
      </main>
    );
  }

  const sb = getServiceRoleClient();
  const detail: ReportDetail | null = await loadReportDetail(sb, { viewer, type, id, locationId: locationParam });

  if (!detail) {
    return (
      <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
        <a href={backHref} className="mb-4 block text-sm text-co-text-muted hover:underline">
          {t("reports.detail.back")}
        </a>
        <p className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-3 text-sm font-semibold text-co-text">
          {t("reports.not_available")}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3">
        <DashboardBackLink />
      </div>
      <a href={backHref} className="mb-4 block text-sm text-co-text-muted hover:underline">
        {t("reports.detail.back")}
      </a>

      {/* Opening detail view — surfaces recount numbers + NULL-sentinel indicator */}
      {detail.kind === "opening" ? (
        <OpeningReportDetailView detail={detail as OpeningReportDetail} language={lang} />
      ) : null}

      {/* Task 3: checklist detail view (closing / am_prep / mid_day) */}
      {detail.kind === "checklist" ? (
        <ChecklistReportDetailView detail={detail as ChecklistReportDetail} language={lang} />
      ) : null}

      {/* Task 4: cash detail view */}
      {detail.kind === "cash" ? (
        <CashReportDetailView detail={detail as CashReportDetail} language={lang} />
      ) : null}

      {/* Task 4: PM detail view */}
      {detail.kind === "pm" ? (
        <PmReportDetailView detail={detail as PmReportDetail} language={lang} />
      ) : null}
    </main>
  );
}
