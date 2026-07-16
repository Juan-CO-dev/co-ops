/**
 * /catering/quotes — the catering quote surface (Wave 1 slice 1E, the money surface).
 *
 * Server component: the (authed) layout is the auth boundary; this page gates the catering
 * read floor (>= 5) and loads the quote board + the actor's locations, customers, leads, and
 * per-location pricing context (delivery zones + rates) for the builder, then hands to the
 * client. All money math is recomputed server-side (the preview route); the client never
 * computes totals.
 */

import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { isAllLocationsAccess } from "@/lib/locations";
import { loadQuoteBoard, loadPricingContext, QUOTE_READ_MIN } from "@/lib/catering/quotes";
import { loadCustomers } from "@/lib/catering/customers";
import { loadPipelineBoard } from "@/lib/catering/pipeline";
import { QuotesClient } from "@/components/catering/quotes/QuotesClient";
import { CateringBackLink } from "@/components/catering/CateringBackLink";

export default async function CateringQuotesPage() {
  const auth = await requireSessionFromHeaders("/catering/quotes");
  const level = getRoleLevel(auth.user.role);
  if (level < QUOTE_READ_MIN) redirect("/dashboard");
  const lang = auth.user.language;

  const [quotes, customers, leads] = await Promise.all([
    loadQuoteBoard(auth),
    loadCustomers(auth),
    loadPipelineBoard(auth),
  ]);

  const sb = getServiceRoleClient();
  const locActor = { role: auth.user.role, locations: auth.locations };
  let locations: Array<{ id: string; name: string }> = [];
  if (isAllLocationsAccess(locActor)) {
    const { data } = await sb
      .from("locations")
      .select("id, name")
      .eq("active", true)
      .order("name", { ascending: true })
      .returns<Array<{ id: string; name: string }>>();
    locations = data ?? [];
  } else if (auth.locations.length > 0) {
    const { data } = await sb
      .from("locations")
      .select("id, name")
      .eq("active", true)
      .in("id", auth.locations)
      .order("name", { ascending: true })
      .returns<Array<{ id: string; name: string }>>();
    locations = data ?? [];
  }

  // Per-location pricing context (delivery zones + rates) so the builder can render zones +
  // flag a missing pricing rule without an extra round-trip. The live total still comes from
  // the preview route (the server's authoritative math).
  const pricingEntries = await Promise.all(
    locations.map(async (l) => {
      const ctx = await loadPricingContext(auth, l.id);
      return [l.id, { zones: ctx.zones, rates: ctx.rates, hasPricingRule: ctx.hasPricingRule }] as const;
    }),
  );
  const pricingByLocation = Object.fromEntries(pricingEntries);

  return (
    <main className="mx-auto max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3">
        <CateringBackLink />
      </div>
      <h1 className="text-lg font-bold text-co-text">{serverT(lang, "catering.quotes.title")}</h1>
      <p className="mt-1 text-sm text-co-text-muted">{serverT(lang, "catering.quotes.subtitle")}</p>
      <QuotesClient
        quotes={quotes}
        locations={locations}
        customers={customers.map((c) => ({ id: c.id, name: c.name, company: c.company, email: c.email }))}
        leads={leads.map((l) => ({
          id: l.id,
          contactName: l.contactName,
          company: l.company,
          eventDate: l.eventDate,
          headcount: l.headcount,
          locationId: l.locationId,
        }))}
        pricingByLocation={pricingByLocation}
        actorLevel={level}
      />
    </main>
  );
}
