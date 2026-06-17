/**
 * /my-feedback — Employee's own structured shift feedback.
 *
 * Per-user, all levels (no location gate). Employees see their own
 * structured evals from SUBMITTED PM Reports — date, location code,
 * on-time status, attitude, area-to-improve if present, and an MVP
 * badge if they were selected.
 *
 * Security invariant: NEVER renders a note. The loader (`loadMyFeedback`)
 * never selects the `note` column from pm_employee_evals, and
 * `MyFeedbackItem` has no `note` field. This is the app-layer column
 * boundary described in the PM Report architecture.
 *
 * Server Component. Reads session via requireSessionFromHeaders.
 */

import { serverT } from "@/lib/i18n/server";
import type { Gradient } from "@/lib/pm-report";
import { loadMyFeedback } from "@/lib/pm-report";
import type { TranslationKey } from "@/lib/i18n/types";
import { formatDateLabel } from "@/lib/i18n/format";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

import { DashboardBackLink } from "@/components/DashboardBackLink";

/** Maps each Gradient value to its pm.attitude.* translation key. */
const GRADIENT_KEY: Record<Gradient, TranslationKey> = {
  great: "pm.attitude.great",
  good: "pm.attitude.good",
  needs_work: "pm.attitude.needs_work",
};

export default async function MyFeedbackPage() {
  const auth = await requireSessionFromHeaders("/my-feedback");
  const lang = auth.user.language;
  const service = getServiceRoleClient();

  // Load the employee's own feedback (loader never selects `note`).
  const items = await loadMyFeedback(service, { userId: auth.user.id });

  // Build a location-id → code map for display.
  // Fetch all active locations so we cover locations the employee
  // may no longer be assigned to (historical evals remain visible).
  const { data: locationRows } = await service
    .from("locations")
    .select("id, code")
    .eq("active", true);
  const locationCodes: Record<string, string> = Object.fromEntries(
    ((locationRows ?? []) as { id: string; code: string }[]).map((l) => [
      l.id,
      l.code,
    ]),
  );

  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3">
        <DashboardBackLink />
      </div>

      <h1 className="mb-4 text-lg font-bold text-co-text">
        {serverT(lang, "pm.my_feedback.title")}
      </h1>

      {items.length === 0 ? (
        <p className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-3 text-sm font-semibold text-co-text">
          {serverT(lang, "pm.my_feedback.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => {
            const locationCode = locationCodes[item.locationId] ?? item.locationId;
            const dateLabel = formatDateLabel(item.date, lang);
            return (
              <li
                key={item.id}
                className="rounded-lg border-2 border-co-border bg-co-surface px-4 py-3"
              >
                {/* Date · Location */}
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-co-text-muted">
                  {serverT(lang, "pm.my_feedback.date_at", {
                    date: dateLabel,
                    location: locationCode,
                  })}
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Arrived ready */}
                  <span className="rounded-full border-2 border-co-border bg-co-bg px-3 py-0.5 text-sm font-semibold text-co-text">
                    {serverT(lang, "pm.eval.arrived_ready")}: {serverT(lang, GRADIENT_KEY[item.arrivedReady])}
                  </span>

                  {/* Attitude */}
                  <span className="rounded-full border-2 border-co-border bg-co-bg px-3 py-0.5 text-sm font-semibold text-co-text">
                    {serverT(lang, "pm.eval.attitude")}: {serverT(lang, GRADIENT_KEY[item.attitude])}
                  </span>

                  {/* Production */}
                  <span className="rounded-full border-2 border-co-border bg-co-bg px-3 py-0.5 text-sm font-semibold text-co-text">
                    {serverT(lang, "pm.eval.production")}: {serverT(lang, GRADIENT_KEY[item.production])}
                  </span>

                  {/* Team player */}
                  <span className="rounded-full border-2 border-co-border bg-co-bg px-3 py-0.5 text-sm font-semibold text-co-text">
                    {serverT(lang, "pm.eval.team_player")}: {serverT(lang, GRADIENT_KEY[item.teamPlayer])}
                  </span>

                  {/* MVP badge */}
                  {item.wasMvp ? (
                    <span className="rounded-full border-2 border-co-gold bg-co-gold/10 px-3 py-0.5 text-sm font-semibold text-co-text">
                      {serverT(lang, "pm.my_feedback.mvp")}
                    </span>
                  ) : null}
                </div>

                {/* Area to improve — only if present */}
                {item.areaToImprove ? (
                  <p className="mt-2 text-sm text-co-text-muted">{item.areaToImprove}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
