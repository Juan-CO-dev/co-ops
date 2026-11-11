/**
 * THE BASE createDraftFromIntake — lib/portal/draft.ts at 3a5b1ad8 (pre build 2), lines 218–288 VERBATIM
 * (extracted with `git show 3a5b1ad8:lib/portal/draft.ts | sed -n 218,288p`; only the function name is
 * suffixed). tests/portal-draft-parity.test.ts runs it and the live createDraftFromIntake against one
 * recorder and demands identical writes + audit for every no-pipelineId input (review ruling 2026-11-11).
 * Do not edit the body; re-extract if the base ever moves.
 */
import { PortalDraftError, setDraftLines, type DraftIntake } from "@/lib/portal/draft";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createDraftFromIntakeBase(customerId: string, intake: DraftIntake): Promise<{ quoteId: string; pipelineId: string }> {
  if (!UUID_RE.test(intake.locationId)) throw new PortalDraftError(400, "invalid_location", "A valid location is required");
  if (!intake.contactName || intake.contactName.trim().length === 0) throw new PortalDraftError(400, "invalid_payload", "contactName is required");
  if (intake.headcount != null && (!Number.isFinite(Number(intake.headcount)) || Number(intake.headcount) < 0)) {
    throw new PortalDraftError(400, "invalid_headcount", "headcount must be zero or greater");
  }
  const sb = getServiceRoleClient();

  const { data: lead, error: leadErr } = await sb
    .from("catering_pipeline")
    .insert({
      contact_name: intake.contactName.trim(),
      company: intake.company ?? null,
      event_date: intake.eventDate ?? null,
      headcount: intake.headcount ?? null,
      contact_phone: intake.contactPhone ?? null,
      delivery_address: intake.deliveryAddress ?? null,
      time_window: intake.timeWindow ?? null,
      event_type: intake.eventType ?? null,
      dietary_notes: intake.dietaryNotes ?? null,
      event_name: intake.eventName ?? null,
      dropoff_door: intake.dropoffDoor ?? null,
      geo_lat: intake.geoLat ?? null,
      geo_lng: intake.geoLng ?? null,
      fulfillment_routed: intake.fulfillmentRouted ?? false,
      stage: "inquiry",
      lead_source: "portal",
      location_id: intake.locationId,
      customer_id: customerId,
      created_by: null,
    })
    .select("id")
    .single<{ id: string }>();
  if (leadErr) throw new Error(`createDraftFromIntake lead: ${leadErr.message}`);

  const { error: evErr } = await sb.from("catering_pipeline_events").insert({
    pipeline_id: lead.id, from_stage: null, to_stage: "inquiry", note: null, actor_id: null,
  });
  if (evErr) throw new Error(`createDraftFromIntake lead event: ${evErr.message}`);

  const { data: quote, error: qErr } = await sb
    .from("catering_quotes")
    .insert({
      root_id: null, version: 1, pipeline_id: lead.id, customer_id: customerId,
      location_id: intake.locationId, status: "draft", origin: "self_serve",
      event_date: intake.eventDate ?? null, headcount: intake.headcount ?? null,
      is_delivery: intake.isDelivery, created_by: null,
    })
    .select("id")
    .single<{ id: string }>();
  if (qErr) throw new Error(`createDraftFromIntake quote: ${qErr.message}`);

  void audit({
    actorId: null, actorRole: null, action: "catering.draft.create",
    resourceTable: "catering_quotes", resourceId: quote.id,
    metadata: { pipeline_id: lead.id, customer_id: customerId, location_id: intake.locationId }, ipAddress: null, userAgent: null,
  });

  // ⑤ carry-through: pre-seed the cart from the storefront selection. Best-effort — a stale/invalid
  // ref must NEVER fail order creation (customer just starts empty). setDraftLines re-resolves +
  // re-prices every ref against the server-owned menu (D20 price authority) and snapshots the stack.
  if (intake.preselect && intake.preselect.length > 0) {
    try {
      await setDraftLines(customerId, quote.id, intake.preselect, { isDelivery: intake.isDelivery });
    } catch (e) {
      console.error("createDraftFromIntake preselect failed (draft left empty):", e);
    }
  }

  return { quoteId: quote.id, pipelineId: lead.id };
}
