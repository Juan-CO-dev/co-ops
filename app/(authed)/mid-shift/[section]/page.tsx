/**
 * /mid-shift/<section> — one section's own live page (Mid-shift Pulse v2, behind PULSE_V2).
 * The depth view: the same card in detail mode (tables, timeline, heatmap, authoring), same 60 s
 * clock. Access is decided by the SAME matrix as the home and the API (sectionAccess): 404 while
 * the flag is off, AccessDeniedBanner below the section's floor, and the shop must pass the bind.
 * A drill link never widens scope — a crew member following /mid-shift/people lands on the banner.
 */
import { notFound } from "next/navigation";
import { BackLink } from "@/components/nav/BackLink";
import { AccessDeniedBanner } from "@/components/ui/AccessDeniedBanner";
import { PulseSectionDetailClient } from "@/components/pulse/PulseClient";
import { serverT } from "@/lib/i18n/server";
import { operationalNow } from "@/lib/midshift-shared";
import { pulseV2Enabled } from "@/lib/pulse/flag";
import { loadAccessibleLocations } from "@/lib/pulse/page";
import { resolveRequestedLocation } from "@/lib/pulse/page-shared";
import { isPulseSection, sectionAccess } from "@/lib/pulse/scope-shared";
import { defaultPulseDeps, loadPulseSections } from "@/lib/pulse/sections";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

const shell = "mx-auto flex max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl flex-col gap-4 px-4 pb-32 pt-4 sm:px-6";

export default async function PulseSectionPage({ params, searchParams }: {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ location?: string }>;
}) {
  const { section } = await params;
  if (!pulseV2Enabled() || !isPulseSection(section)) notFound();
  const auth = await requireSessionFromHeaders(`/mid-shift/${section}`);
  const language = auth.user.language;
  if (sectionAccess({ flagOn: true, level: auth.level, section }) !== "ok") {
    return <main className={shell}><AccessDeniedBanner language={language} /></main>;
  }
  const { location } = await searchParams;
  const service = getServiceRoleClient();
  const accessible = await loadAccessibleLocations(service, auth);
  const locationId = resolveRequestedLocation({ requested: location, accessible, actor: { role: auth.role, locations: auth.locations } });
  if (!locationId) {
    return (
      <main className={shell}>
        <BackLink />
        <p className="mt-2 text-sm text-co-text-muted">{serverT(language, "pulse.page.no_location")}</p>
      </main>
    );
  }
  const now = new Date();
  const { date } = operationalNow(now);
  const states = await loadPulseSections(defaultPulseDeps(service), { auth, locationId, date, now }, [section]);
  const shop = accessible.find((l) => l.id === locationId);
  return (
    <main className={shell}>
      <BackLink search={`?location=${encodeURIComponent(locationId)}`} />
      {shop && accessible.length > 1 && <p className="text-xs font-semibold text-co-text-muted">{shop.code} &middot; {shop.name}</p>}
      <PulseSectionDetailClient section={section} locationId={locationId} initial={states[section]} date={date} viewerLevel={auth.level} />
    </main>
  );
}
