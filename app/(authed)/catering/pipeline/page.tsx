/**
 * /catering/pipeline — the catering pipeline board (Wave 1 slice 1C).
 *
 * Server component: the (authed) layout is the auth boundary; this page gates the
 * catering read floor (>= 5) and loads the board + follow-up queue + the actor's
 * locations server-side via the lib loaders, then hands to the client board.
 */

import { StepUpProvider } from "@/components/admin/StepUpProvider";
import { canTransferCatering } from "@/lib/catering/transfers-shared";
import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { isAllLocationsAccess, lockLocationContext } from "@/lib/locations";
import {
  loadAssignableStaff,
  loadPipelineBoard,
  loadFollowUps,
  searchPipeline,
  PIPELINE_READ_MIN,
  PIPELINE_WRITE_MIN,
  type PipelineSearchResult,
} from "@/lib/catering/pipeline";
import { PipelineClient } from "@/components/catering/pipeline/PipelineClient";
import { DeliveryStatesProvider } from "@/components/catering/pipeline/DeliveryStateChip";
import { loadPipelineDeliveryStates } from "@/lib/delivery/day";
import { BackLink } from "@/components/nav/BackLink";
import { loadNotInToast, type PipelineToastOrder } from "@/lib/catering/not-in-toast";
import { resolveShop } from "@/lib/shop-context";
import { DeliveryMovedList } from "@/components/catering/pipeline/DeliveryMovedList";
import { loadMovedDeliveriesSafe } from "@/lib/delivery/jobs";

export default async function CateringPipelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireSessionFromHeaders("/catering/pipeline");
  const level = getRoleLevel(auth.user.role);
  if (level < PIPELINE_READ_MIN) redirect("/dashboard");
  const lang = auth.user.language;

  const sp = await searchParams;
  const q = typeof sp["q"] === "string" ? sp["q"] : "";
  // A deep link to one lead (`?lead=<id>#lead-<id>`, e.g. a digest email): it is on the board even past the row cap.
  const leadParam = typeof sp["lead"] === "string" ? sp["lead"] : null;

  // Transfer authority spans shops; creation retains its existing membership bind.
  const sb = getServiceRoleClient();
  const locActor = { role: auth.user.role, locations: auth.locations };
  let locations: Array<{ id: string; name: string }> = [];
  if (canTransferCatering(auth.user.role) || isAllLocationsAccess(locActor)) {
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

  const createLocations = locations.filter((location) => lockLocationContext(locActor, location.id));
  // B8 #3 — "Add lead" starts on the working shop (the one shop resolver), not "global".
  const defaultCreateLocationId = (await resolveShop(createLocations))?.id ?? null;

  let leads: Parameters<typeof PipelineClient>[0]["leads"] = [];
  let followUps: Parameters<typeof PipelineClient>[0]["followUps"] = [];
  let results: PipelineSearchResult[] | null = null;
  let notInToast: PipelineToastOrder[] | null = null;
  try { notInToast = await loadNotInToast(auth); } catch { /* Visible unavailable state below. */ }
  // Catering delivery D2: deliveries booked at this AGM's / GM's shop for orders that have since moved away (the jobs
  // only; empty when off, the shop is off, not installed, or for anyone else). A FAILED read is its own result and the
  // list says "couldn't load": it is the pickup shop's only way in, so it never silently disappears.
  const movedDeliveries = await loadMovedDeliveriesSafe(auth);

  if (q.trim()) {
    // SEARCH MODE: skip the board/follow-up loads entirely.
    results = await searchPipeline(auth, { query: q });
  } else {
    // BOARD MODE: existing parallel load.
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    [leads, followUps] = await Promise.all([
      loadPipelineBoard(auth, { ensureLead: leadParam }),
      loadFollowUps(auth, today),
    ]);
  }
  // Catering delivery D3: the cards' delivery chips, ONE batched read for the listed leads, gated like the status read
  // (each lead at its own shop). Off (the switch, a shop that is off, a viewer the gate refuses) = no chip and no query
  // beyond the switch; a failed read is said once above the board, never shown as "to book". It never throws.
  const delivery = await loadPipelineDeliveryStates(auth, leads.map((l) => l.id));
  const deliveryStates = "ok" in delivery && delivery.ok ? delivery.states : null;

  return (
    <main className="mx-auto max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3">
        <BackLink />
      </div>
      <h1 className="text-lg font-bold text-co-text">{serverT(lang, "catering.pipeline.title")}</h1>
      <p className="mt-1 text-sm text-co-text-muted">{serverT(lang, "catering.pipeline.subtitle")}</p>
      {"ok" in delivery && !delivery.ok ? (
        <p role="status" data-delivery-states="failed" className="mt-2 text-sm text-co-text-muted">{serverT(lang, "catering.delivery_state.unknown")}</p>
      ) : null}
      <StepUpProvider unlocked={auth.session.stepUpUnlocked} unlockedAt={auth.session.stepUpUnlockedAt}>
      <DeliveryStatesProvider states={deliveryStates}>
      <PipelineClient
        notInToast={notInToast}
        staff={await loadAssignableStaff(auth)}
        leads={leads}
        followUps={followUps}
        locations={locations}
        createLocations={createLocations}
        defaultCreateLocationId={defaultCreateLocationId}
        actorLevel={level}
        canTransfer={canTransferCatering(auth.user.role)}
        writeMin={PIPELINE_WRITE_MIN}
        searchQuery={q}
        results={results}
      />
      </DeliveryStatesProvider>
      </StepUpProvider>
      <DeliveryMovedList result={movedDeliveries} />
    </main>
  );
}
