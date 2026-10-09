/**
 * Mid-shift Pulse v2 home (server component, behind PULSE_V2). Resolves the shop(s), runs every
 * visible section through loadPulseSections (each settles on its own, so the first paint already
 * shows a failing section in its own error state) and hands the result to the client shell, which
 * takes over the 60 s refresh. The same-day Toast freshness trigger from v1 stays (after the
 * response, debounced in the lib).
 */
import Link from "next/link";
import { after } from "next/server";
import { DashboardBackLink } from "@/components/DashboardBackLink";
import { AccessDeniedBanner } from "@/components/ui/AccessDeniedBanner";
import { PulseClient, type PulsePanel } from "@/components/pulse/PulseClient";
import { maybeRefreshTodaySales } from "@/lib/catering/toast-sales";
import { formatTime } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import { operationalNow } from "@/lib/midshift-shared";
import { loadAccessibleLocations } from "@/lib/pulse/page";
import { BOTH, resolvePulsePanels } from "@/lib/pulse/page-shared";
import { BOTH_SHOPS_LEVEL, pulsePageAccess, visibleSections } from "@/lib/pulse/scope-shared";
import { defaultPulseDeps, loadPulseSections } from "@/lib/pulse/sections";
import type { AuthContext } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

const shell = "mx-auto flex max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-7xl flex-col gap-4 px-4 pb-32 pt-4 sm:px-6";
const tab = (active: boolean) => `inline-flex min-h-[44px] items-center rounded-full border-2 px-4 text-sm font-bold transition ${active ? "border-co-gold-deep bg-co-gold/25 text-co-text" : "border-co-border-2 bg-co-surface text-co-text-dim hover:text-co-text"}`;

export async function PulseHome({ auth, requested }: { auth: AuthContext; requested: string | undefined }) {
  const language = auth.user.language;
  const mode = pulsePageAccess({ flagOn: true, level: auth.level });
  if (mode === "denied") return <main className={shell}><AccessDeniedBanner language={language} /></main>;

  const service = getServiceRoleClient();
  const accessible = await loadAccessibleLocations(service, auth);
  const actor = { role: auth.role, locations: auth.locations, level: auth.level };
  const shops = resolvePulsePanels({ requested, accessible, actor });
  if (!shops || shops.length === 0) {
    return (
      <main className={shell}>
        <div className="mb-3"><DashboardBackLink /></div>
        <h1 className="mt-4 text-lg font-bold text-co-text">{serverT(language, "pulse.page.title")}</h1>
        <p className="mt-2 text-sm text-co-text-muted">{serverT(language, "pulse.page.no_location")}</p>
      </main>
    );
  }

  const now = new Date();
  const { date } = operationalNow(now);
  const sections = visibleSections(auth.level);
  const deps = defaultPulseDeps(service);
  const panels: PulsePanel[] = await Promise.all(shops.map(async (shop) => ({
    locationId: shop.id,
    locationName: shop.name,
    sections,
    initial: await loadPulseSections(deps, { auth, locationId: shop.id, date, now }, sections),
  })));
  for (const shop of shops) after(() => maybeRefreshTodaySales(shop.id, date));

  const both = shops.length > 1;
  const showTabs = accessible.length > 1;
  return (
    <main className={shell}>
      <div className="mb-1"><DashboardBackLink /></div>
      <div>
        <h1 className="flex flex-wrap items-baseline gap-2 text-lg font-bold text-co-text">
          {serverT(language, "pulse.page.title")}
          {!both && accessible.length === 1 && <span className="text-sm font-semibold text-co-text-muted">{shops[0]!.code} &middot; {shops[0]!.name}</span>}
          <span className="text-xs font-semibold text-co-text-dim">{serverT(language, "pulse.page.updated", { time: formatTime(now.toISOString(), language) })}</span>
        </h1>
        {showTabs && (
          <nav aria-label={serverT(language, "pulse.page.location_tabs")} className="mt-2 flex flex-wrap gap-2">
            {auth.level >= BOTH_SHOPS_LEVEL && (
              <Link href={`/mid-shift?location=${BOTH}`} aria-current={both ? "page" : undefined} className={tab(both)}>{serverT(language, "pulse.page.both_shops")}</Link>
            )}
            {accessible.map((l) => {
              const active = !both && shops[0]!.id === l.id;
              return <Link key={l.id} href={`/mid-shift?location=${l.id}`} aria-current={active ? "page" : undefined} className={tab(active)}>{l.name}</Link>;
            })}
          </nav>
        )}
      </div>
      <PulseClient panels={panels} date={date} viewerLevel={auth.level} />
    </main>
  );
}
