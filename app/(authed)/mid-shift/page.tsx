/**
 * /mid-shift — Mid-Shift Pulse page (Task 6).
 *
 * Read-only operational pulse for KH+ managers (level ≥ MIDSHIFT_BASE_LEVEL = 4).
 * Composes already-captured data: reports, fridges, active staff, attention items.
 * No writes anywhere — this module is read-only.
 */

import { after } from "next/server";

import { DashboardBackLink } from "@/components/DashboardBackLink";
import { AccessDeniedBanner } from "@/components/ui/AccessDeniedBanner";
import { AttentionBanner } from "@/components/midshift/AttentionBanner";
import { ReportStatusList } from "@/components/midshift/ReportStatusList";
import { FridgeStrip } from "@/components/midshift/FridgeStrip";
import { ActiveToday } from "@/components/midshift/ActiveToday";
import { SalesPanel } from "@/components/midshift/SalesPanel";
import { MIDSHIFT_BASE_LEVEL, loadMidShiftPulse, operationalNow } from "@/lib/midshift";
import { loadSalesPulse } from "@/lib/midshift-sales";
import { maybeRefreshTodaySales } from "@/lib/catering/toast-sales";
import { serverT } from "@/lib/i18n/server";
import { lockLocationContext } from "@/lib/locations";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

export default async function MidShiftPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string }>;
}) {
  const auth = await requireSessionFromHeaders("/mid-shift");
  const language = auth.user.language;

  if (auth.level < MIDSHIFT_BASE_LEVEL) {
    return (
      <main className="mx-auto max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6">
        <AccessDeniedBanner language={language} />
      </main>
    );
  }

  const { location } = await searchParams;
  // Nav-link friendly: default to the actor's first location when none specified.
  // Authorization: the requested location MUST be one the actor may view —
  // loadMidShiftPulse runs on the service-role client (bypasses RLS), so without
  // this gate a ?location=<other-store> would leak that store's pulse. Mirrors
  // the cash/maintenance pages. lockLocationContext honors the level-7+
  // all-locations override (empty auth.locations).
  const requested = location ?? auth.locations[0] ?? null;
  const locationId =
    requested &&
    lockLocationContext({ role: auth.role, locations: auth.locations }, requested)
      ? requested
      : null;
  if (!locationId) {
    return (
      <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
        <div className="mb-3">
          <DashboardBackLink />
        </div>
        <h1 className="mt-4 text-lg font-bold text-co-text">
          {serverT(language, "midshift.page.title")}
        </h1>
        <p className="mt-2 text-sm text-co-text-muted">
          {serverT(language, "midshift.active.none")}
        </p>
      </main>
    );
  }

  const now = new Date();
  const { date } = operationalNow(now);
  const service = getServiceRoleClient();

  // Which store's pulse is this? A multi-location manager can't tell without a
  // label (sonnet finding 8) — resolve the code + name for a muted header chip.
  const { data: locRow } = await service
    .from("locations")
    .select("code, name")
    .eq("id", locationId)
    .maybeSingle();
  const loc = locRow as { code: string; name: string } | null;

  const [pulse, salesPulse] = await Promise.all([
    loadMidShiftPulse(service, {
      locationId,
      date,
      now,
      actor: { userId: auth.user.id, role: auth.role, level: auth.level },
    }),
    loadSalesPulse(service, { locationId, todayYmd: date }),
  ]);

  // Same-day freshness trigger (council 2026-07-31): AFTER the response, pull
  // today's Toast events if the last pull is stale (debounced in the lib; a
  // failure is logged, never surfaced). The refreshed numbers appear on the
  // manager's next glance — honest "as of HH:MM" freshness, not fake realtime.
  after(() => maybeRefreshTodaySales(locationId, date));

  return (
    <main className="mx-auto flex max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl flex-col gap-5 px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3">
        <DashboardBackLink />
      </div>
      <h1 className="flex flex-wrap items-baseline gap-2 text-lg font-bold text-co-text">
        {serverT(language, "midshift.page.title")}
        {loc && (
          <span className="text-sm font-semibold text-co-text-muted">
            {loc.code} &middot; {loc.name}
          </span>
        )}
      </h1>
      <AttentionBanner items={pulse.attention} language={language} />
      <ReportStatusList reports={pulse.reports} language={language} />
      <FridgeStrip
        fridges={pulse.fridges}
        flagCount={pulse.fridgeFlagCount}
        locationId={locationId}
        language={language}
      />
      <ActiveToday staff={pulse.activeToday} language={language} />
      {/* Live Toast sales (council 2026-07-31) — replaces the pre-Toast
          placeholder; open by default now that it carries real content. */}
      <SalesPanel pulse={salesPulse} language={language} />
    </main>
  );
}
