/**
 * /ordering — The Par-Pass Ordering walk (delivery-intake P3, spec D5/D6).
 *
 * The shelf-walk that IS the ordering system: a key holder (KH+, level ≥
 * PAR_PASS_MIN) walks the shelves with a phone and records, per par'd SKU, the
 * order qty needed to reach par. The system derives draft orders per vendor and
 * soft on-hand anchors. This is the staff-facing centerpiece — phone-first (390px),
 * great design for the user.
 *
 * ── ROUTE PLACEMENT ────────────────────────────────────────────────────────────
 * This route lives OUTSIDE the (authed) group (it was a standalone placeholder at
 * app/ordering/page.tsx and the plan says "keep its route"). Route groups don't
 * change the URL, so the (authed) layout's TranslationProvider + auth boundary do
 * NOT wrap this page — so the page mounts its OWN TranslationProvider (client
 * island needs the i18n context) and runs its OWN KH+ gate (mirrors the operations
 * pages' requireSessionFromHeaders + level redirect + lockLocationContext).
 *
 * Server component: resolves the location (mid-shift multi-location tab pattern — a
 * manager with more than one store gets a tab row that swaps the walk via
 * ?location=), loads the walker payload + recent passes, and hands them to the
 * `ParPassWalker` client island (all interaction: steppers, review sheet, submit).
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { DashboardBackLink } from "@/components/DashboardBackLink";
import { ParPassWalker } from "@/components/ordering/ParPassWalker";
import { loadWalkerData, loadRecentParPasses, PAR_PASS_MIN } from "@/lib/ordering";
import { serverT } from "@/lib/i18n/server";
import { formatDateLabel } from "@/lib/i18n/format";
import { TranslationProvider } from "@/lib/i18n/provider";
import { isAllLocationsAccess, lockLocationContext } from "@/lib/locations";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

export default async function OrderingPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string }>;
}) {
  const auth = await requireSessionFromHeaders("/ordering");
  const language = auth.user.language;
  if (auth.level < PAR_PASS_MIN) redirect("/dashboard");

  const { location } = await searchParams;
  const service = getServiceRoleClient();

  // Accessible locations drive both the tab row and the default resolution (mid-shift
  // pattern). All-locations actors (owner/CGS override) see every active location;
  // assigned actors see their assignment list.
  const actorAll = isAllLocationsAccess({ role: auth.role, locations: auth.locations });
  const { data: locRows } = await service
    .from("locations")
    .select("id, code, name")
    .eq("active", true)
    .order("name", { ascending: true })
    .returns<Array<{ id: string; code: string; name: string }>>();
  const accessible = (locRows ?? []).filter((l) => actorAll || auth.locations.includes(l.id));

  // Authorization: the requested location MUST be one the actor may view — the walker
  // lib runs on the service-role client (bypasses RLS), so without this gate a
  // ?location=<other-store> would leak that store's walk.
  const requested = location ?? accessible[0]?.id ?? null;
  const locationId =
    requested &&
    lockLocationContext({ role: auth.role, locations: auth.locations }, requested) &&
    accessible.some((l) => l.id === requested)
      ? requested
      : null;

  if (!locationId) {
    return (
      <TranslationProvider initialLanguage={language}>
        <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
          <div className="mb-3">
            <DashboardBackLink />
          </div>
          <h1 className="mt-4 text-lg font-bold text-co-text">{serverT(language, "ordering.page.title_bare")}</h1>
          <p className="mt-2 text-sm text-co-text-muted">{serverT(language, "ordering.page.no_location")}</p>
        </main>
      </TranslationProvider>
    );
  }

  const loc = accessible.find((l) => l.id === locationId) ?? null;
  const [walker, recent] = await Promise.all([
    loadWalkerData(auth, locationId),
    loadRecentParPasses(auth, locationId),
  ]);

  // The shop label carried into the mailto body header + the walk header (never a
  // hardcoded location literal — tenant law; code + name from the locations row).
  const shopLabel = loc ? `${loc.code} · ${loc.name}` : "";
  const dateLabel = formatDateLabel(walker.walkDate, language);

  return (
    <TranslationProvider initialLanguage={language}>
      <main className="mx-auto max-w-2xl px-4 pb-40 pt-4 sm:px-6">
        <div className="mb-3">
          <DashboardBackLink />
        </div>

        <div>
          <h1 className="flex flex-wrap items-baseline gap-2 text-lg font-bold text-co-text">
            {serverT(language, "ordering.page.title", { date: dateLabel })}
            {loc && accessible.length === 1 && (
              <span className="text-sm font-semibold text-co-text-muted">{shopLabel}</span>
            )}
            {walker.isWeekendPar && (
              <span className="rounded-full bg-co-gold/25 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-co-gold-deep">
                {serverT(language, "ordering.page.weekend_par")}
              </span>
            )}
          </h1>

          {/* Location tabs — only when there's a choice. Server-side ?location= nav keeps
              the page a pure server component (the walker's client state resets on nav). */}
          {accessible.length > 1 && (
            <nav
              aria-label={serverT(language, "ordering.page.location_tabs")}
              className="mt-2 flex flex-wrap gap-2"
            >
              {accessible.map((l) => {
                const active = l.id === locationId;
                return (
                  <Link
                    key={l.id}
                    href={`/ordering?location=${l.id}`}
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

        <ParPassWalker
          walker={walker}
          recent={recent}
          locationId={locationId}
          shopLabel={shopLabel}
          dateLabel={dateLabel}
        />
      </main>
    </TranslationProvider>
  );
}
