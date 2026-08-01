/**
 * /mid-shift — Mid-Shift Pulse page.
 *
 * Read-only operational pulse for KH+ managers (level ≥ MIDSHIFT_BASE_LEVEL = 4).
 * Composes already-captured data: reports, fridges, active staff, attention
 * items, live Toast sales. No writes on the render path — the only side-effect
 * is the AFTER-response same-day sales freshness trigger (debounced in the lib).
 *
 * Location tabs (council 2026-07-31 + Juan): the page is per-location; a
 * manager with access to more than one store gets a tab row that swaps the
 * whole pulse via ?location=. This also fixes the all-locations dead page —
 * a level-7+ actor with the empty-locations override previously resolved NO
 * default location and got a broken body with the wrong i18n key.
 */

import { after } from "next/server";
import Link from "next/link";

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
import { formatTime } from "@/lib/i18n/format";
import { isAllLocationsAccess, lockLocationContext } from "@/lib/locations";
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
  const service = getServiceRoleClient();

  // Accessible locations drive BOTH the tab row and the default resolution.
  // All-locations actors (level-7+ empty-assignment override) see every active
  // location; assigned actors see their assignment list. One query serves the
  // tabs, the default, and the header label.
  const actorAll = isAllLocationsAccess({ role: auth.role, locations: auth.locations });
  const { data: locRows } = await service
    .from("locations")
    .select("id, code, name")
    .eq("active", true)
    .order("name", { ascending: true })
    .returns<Array<{ id: string; code: string; name: string }>>();
  const accessible = (locRows ?? []).filter((l) => actorAll || auth.locations.includes(l.id));

  // Authorization: the requested location MUST be one the actor may view —
  // loadMidShiftPulse runs on the service-role client (bypasses RLS), so
  // without this gate a ?location=<other-store> would leak that store's pulse.
  // lockLocationContext honors the all-locations override.
  const requested = location ?? accessible[0]?.id ?? null;
  const locationId =
    requested &&
    lockLocationContext({ role: auth.role, locations: auth.locations }, requested) &&
    accessible.some((l) => l.id === requested)
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
          {serverT(language, "midshift.page.no_location")}
        </p>
      </main>
    );
  }

  const now = new Date();
  const { date } = operationalNow(now);
  const loc = accessible.find((l) => l.id === locationId) ?? null;

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
  // failure is logged + audited, never surfaced). The refreshed numbers appear
  // on the manager's next glance — honest "as of HH:MM", not fake realtime.
  after(() => maybeRefreshTodaySales(locationId, date));

  return (
    <main className="mx-auto flex max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl flex-col gap-5 px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3">
        <DashboardBackLink />
      </div>
      <div>
        <h1 className="flex flex-wrap items-baseline gap-2 text-lg font-bold text-co-text">
          {serverT(language, "midshift.page.title")}
          {loc && accessible.length === 1 && (
            <span className="text-sm font-semibold text-co-text-muted">
              {loc.code} &middot; {loc.name}
            </span>
          )}
          <span className="text-xs font-semibold text-co-text-dim">
            {serverT(language, "midshift.page.updated", { time: formatTime(now.toISOString(), language) })}
          </span>
        </h1>

        {/* Location tabs — only when there's a choice to make. Server-side
            navigation (?location=) keeps the page a pure server component. */}
        {accessible.length > 1 && (
          <nav aria-label={serverT(language, "midshift.page.location_tabs")} className="mt-2 flex flex-wrap gap-2">
            {accessible.map((l) => {
              const active = l.id === locationId;
              return (
                <Link
                  key={l.id}
                  href={`/mid-shift?location=${l.id}`}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex min-h-[36px] items-center rounded-full border-2 px-4 text-sm font-bold transition ${
                    active
                      ? "border-co-gold-deep bg-co-gold/25 text-co-text"
                      : "border-co-border-2 bg-co-surface text-co-text-dim hover:text-co-text"
                  }`}
                >
                  {l.name}
                </Link>
              );
            })}
          </nav>
        )}
      </div>
      <AttentionBanner items={pulse.attention} locationId={locationId} language={language} />
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
