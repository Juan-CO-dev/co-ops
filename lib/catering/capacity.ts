/**
 * Catering capacity — Wave 1 slice 1B (Mode-A).
 *
 * SERVER-ONLY. Service-role reads (the KB config tables are deny-all RLS, so all
 * reads go through the service-role client, consistent with the admin lib layer).
 *
 * Mode-A = deterministic COUNTING against the KB caps. Given (location, date,
 * requestedCovers) it answers "is there room?" from:
 *   - catering_capacity_policy   — the active per-location caps (max covers/events
 *                                  per day, min lead time). No active row = UNCONFIGURED
 *                                  → advisory-only (never blocks; the gate is degraded
 *                                  until Pete/Cristian seed caps, per the Owner-Input
 *                                  schedule).
 *   - catering_blackout_dates    — an active blackout on the date = UNAVAILABLE.
 *   - confirmed bookings on the date — see consumption model below.
 *
 * The return contract (CateringCapacityResult) is shaped for Mode-B: the
 * `makeableCovers` / `shortfall` fields are null in Mode-A and get populated when
 * the inventory-derived upgrade lands (on-hand → recipe graph → makeable − par
 * reserve, at the spine-authoring day). Consumers read `signal` + `remaining*`
 * and do not care which mode produced them.
 *
 * NOT built here (Wave 2, with holds): the atomic `catering_date_capacity` counter
 * + `SELECT FOR UPDATE` reservation RPC. That is the WRITE/reserve path that stops
 * CONCURRENT overbooking; its caller is a deposit-hold (D26). Wave-1 bookings are
 * single-operator manual entries, so the advisory read below is the Mode-A gate.
 * The reservation RPC follows the documented submit_*_atomic pattern when it ships.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";

export type CapacitySignal =
  | "available"      // room for the requested covers
  | "limited"        // room, but within the limited-threshold of the cap (surface a soft warning)
  | "unavailable"    // requested covers exceed remaining, or the event cap is met
  | "blackout"       // the date is an active blackout
  | "below_lead_time" // the date is inside the minimum lead-time window
  | "unconfigured";  // no active capacity policy for the location (gate degraded to advisory)

export interface CateringCapacityResult {
  signal: CapacitySignal;
  /** Which derivation produced this. Mode-B (inventory-derived) swaps in later. */
  mode: "A";
  /** Active caps (null = uncapped for that axis). */
  capCovers: number | null;
  capEvents: number | null;
  /** Confirmed consumption already on the date (see consumption model). */
  consumedCovers: number;
  consumedEvents: number;
  /** Remaining headroom (null when the corresponding cap is null/uncapped). */
  remainingCovers: number | null;
  remainingEvents: number | null;
  requestedCovers: number;
  isBlackout: boolean;
  meetsLeadTime: boolean;
  /** Mode-B fields — null in Mode-A, populated at the spine-authoring-day upgrade. */
  makeableCovers: number | null;
  shortfall: null;
}

/** Within this fraction of the covers cap → "limited" (a soft warning, still bookable). */
const LIMITED_THRESHOLD = 0.15;

interface PolicyRow {
  max_covers_per_day: number | null;
  max_events_per_day: number | null;
  min_lead_time_hours: number | null;
}

/** Hours from `now` until the START of the event date (local midnight, operational TZ). */
function hoursUntilDate(eventDate: string, now: Date): number {
  // Event date start in the operational TZ (America/New_York — both CO locations are in DC).
  // Compare against now; a same-day or future date yields >= 0-ish, past dates negative.
  const eventStart = new Date(`${eventDate}T00:00:00-05:00`).getTime();
  return (eventStart - now.getTime()) / 3_600_000;
}

/**
 * Mode-A capacity check for a location + date + requested covers.
 *
 * Consumption model (dedup-safe): a confirmed booking is counted once.
 *   - catering_pipeline rows with stage in ('confirmed','completed') on the
 *     event_date are the authoritative booked commitments.
 *   - catering_orders with a NULL pipeline_id (direct / backfilled orders that
 *     never went through the pipeline) are added on the order_date.
 *   Orders WITH a pipeline_id are NOT counted separately — their booking is
 *   already counted via the confirmed pipeline row they came from (avoids the
 *   double-count of one event appearing as both a confirmed lead and its order).
 *   When Wave-2 holds land, active holds add to consumption here too.
 *
 * `excludePipelineId` / `excludeOrderId` let a re-check for an existing booking
 * omit itself (so editing a confirmed 200-cover event does not count against itself).
 */
export async function checkCateringCapacity(args: {
  locationId: string;
  eventDate: string; // YYYY-MM-DD
  requestedCovers: number;
  now?: Date;
  excludePipelineId?: string | null;
  excludeOrderId?: string | null;
}): Promise<CateringCapacityResult> {
  const sb = getServiceRoleClient();
  const now = args.now ?? new Date();
  const requestedCovers = Math.max(0, Math.floor(args.requestedCovers));

  // 1. Active capacity policy for the location.
  const { data: policy, error: pErr } = await sb
    .from("catering_capacity_policy")
    .select("max_covers_per_day, max_events_per_day, min_lead_time_hours")
    .eq("location_id", args.locationId)
    .eq("active", true)
    .maybeSingle<PolicyRow>();
  if (pErr) throw new Error(`checkCateringCapacity policy: ${pErr.message}`);

  // 2. Blackout on the date?
  const { data: blackout, error: bErr } = await sb
    .from("catering_blackout_dates")
    .select("id")
    .eq("location_id", args.locationId)
    .eq("blackout_date", args.eventDate)
    .eq("active", true)
    .maybeSingle<{ id: string }>();
  if (bErr) throw new Error(`checkCateringCapacity blackout: ${bErr.message}`);
  const isBlackout = blackout != null;

  // 3. Confirmed consumption on the date (dedup-safe — see the doc comment).
  const { data: pipeRows, error: plErr } = await sb
    .from("catering_pipeline")
    .select("id, headcount")
    .eq("location_id", args.locationId)
    .eq("event_date", args.eventDate)
    .in("stage", ["confirmed", "completed"])
    .returns<Array<{ id: string; headcount: number | null }>>();
  if (plErr) throw new Error(`checkCateringCapacity pipeline: ${plErr.message}`);

  const { data: orderRows, error: oErr } = await sb
    .from("catering_orders")
    .select("id, headcount")
    .eq("location_id", args.locationId)
    .eq("order_date", args.eventDate)
    .is("pipeline_id", null)
    .returns<Array<{ id: string; headcount: number | null }>>();
  if (oErr) throw new Error(`checkCateringCapacity orders: ${oErr.message}`);

  let consumedCovers = 0;
  let consumedEvents = 0;
  for (const r of pipeRows ?? []) {
    if (args.excludePipelineId && r.id === args.excludePipelineId) continue;
    consumedCovers += r.headcount ?? 0;
    consumedEvents += 1;
  }
  for (const r of orderRows ?? []) {
    if (args.excludeOrderId && r.id === args.excludeOrderId) continue;
    consumedCovers += r.headcount ?? 0;
    consumedEvents += 1;
  }

  const capCovers = policy?.max_covers_per_day ?? null;
  const capEvents = policy?.max_events_per_day ?? null;
  const remainingCovers = capCovers == null ? null : capCovers - consumedCovers;
  const remainingEvents = capEvents == null ? null : capEvents - consumedEvents;

  const meetsLeadTime =
    policy?.min_lead_time_hours == null
      ? true
      : hoursUntilDate(args.eventDate, now) >= policy.min_lead_time_hours;

  const base = {
    mode: "A" as const,
    capCovers,
    capEvents,
    consumedCovers,
    consumedEvents,
    remainingCovers,
    remainingEvents,
    requestedCovers,
    isBlackout,
    meetsLeadTime,
    makeableCovers: null,
    shortfall: null,
  };

  // 4. Signal. Precedence: unconfigured (degrade) → blackout → lead-time →
  //    covers/events capacity → limited → available.
  let signal: CapacitySignal;
  if (policy == null) {
    // No caps seeded yet — the gate is advisory-only (never blocks a booking).
    signal = "unconfigured";
  } else if (isBlackout) {
    signal = "blackout";
  } else if (!meetsLeadTime) {
    signal = "below_lead_time";
  } else if (
    (remainingCovers != null && requestedCovers > remainingCovers) ||
    (remainingEvents != null && remainingEvents <= 0)
  ) {
    signal = "unavailable";
  } else if (
    capCovers != null &&
    capCovers > 0 &&
    remainingCovers != null &&
    remainingCovers - requestedCovers <= capCovers * LIMITED_THRESHOLD
  ) {
    signal = "limited";
  } else {
    signal = "available";
  }

  return { signal, ...base };
}
