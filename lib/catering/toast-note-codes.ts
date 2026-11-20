/**
 * Item 21 PR 4 — THE ONE NOTE LOOKUP for both sources (runbook contract #3, Astra r3 #3; review PORTAL4-r1).
 *
 * A code staff type as a SPECIAL_REQUEST note is not in capture (note text is dropped). The ephemeral, version-fenced
 * lookup (`loadKnownToastOrderCodes`) intersects note tokens with KNOWN codes before anything leaves its stack frame.
 * This module calls it ONCE per (shop, day) with ezCater order numbers ∪ the shop's live house ring codes, and hands
 * the result to both sides:
 *   - the ezCater side gets its own numbers back (exactly what pass 2 read before: ring codes never reach its matcher);
 *   - for a shop whose `catering_toast_settings.enabled` is on, `record_catering_toast_note_lookup` (0348) stores, in ONE
 *     transaction, every intersection (codes only) AND the COVERAGE: which captures the lookup examined (their version
 *     matched Toast's). Coverage is what lets a source ADMIT a check: the house reconciler never links a check whose
 *     current capture is unexamined, and at a shop with ring codes neither does ezCater (0348: `evidence_pending`).
 *     So a lookup that failed, timed out or has not run yet leaves both sides WAITING. It never lets one of them
 *     claim a check on half the evidence.
 * A shop that is off has no house side: the lookup is exactly the old one and nothing is recorded.
 * No note text is ever returned, logged or stored here.
 */
import "server-only";
import type { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { loadKnownToastOrderCodes } from "@/lib/ezcater/toast-codes";
import { normalizeOrderCode } from "@/lib/ezcater/pass2-shared";
import type { CapturedToastOrder } from "@/lib/toast/captured-day";
import { etYmdMinusDays } from "@/lib/operational-day";

type Sb = ReturnType<typeof getServiceRoleClient>;
const NOT_INSTALLED = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);
const never = new AbortController().signal;

export interface HouseShopSwitches { ringCodeEnabled: boolean; autoLink: boolean; originAutoLink: boolean }
/** The house side of the lookup: the shops that are on (with their switches), and each one's live ring codes (normalized). */
export interface HouseNoteContext { shops: ReadonlyMap<string, HouseShopSwitches>; ringCodes: ReadonlyMap<string, readonly string[]> }
export const NO_HOUSE_SIDE: HouseNoteContext = { shops: new Map(), ringCodes: new Map() };

/** Not installed (0344 / 0347 missing) = no house side. Any other read failure throws: a lookup that silently
 * forgot the ring codes would let ezCater take a dual-code check. */
export async function loadHouseNoteContext(sb: Sb, signal?: AbortSignal): Promise<HouseNoteContext> {
  const settings = await sb.from("catering_toast_settings")
    .select("location_id,ring_code_enabled,auto_link_enabled,origin_auto_link_enabled").eq("enabled", true)
    .order("location_id").range(0, 999).abortSignal(signal ?? never);
  if (settings.error) {
    if (settings.error.code && NOT_INSTALLED.has(settings.error.code)) return NO_HOUSE_SIDE;
    throw new Error("catering_toast_read_failed");
  }
  type Row = { location_id: string; ring_code_enabled: boolean; auto_link_enabled: boolean; origin_auto_link_enabled: boolean };
  const shops = new Map(((settings.data ?? []) as Row[]).map((r) => [r.location_id,
    { ringCodeEnabled: r.ring_code_enabled === true, autoLink: r.auto_link_enabled === true, originAutoLink: r.origin_auto_link_enabled === true }]));
  if (shops.size === 0) return NO_HOUSE_SIDE;
  const ringCodes = new Map<string, string[]>();
  let installed = true;
  const rows = await selectAllRows<{ location_id: string; code_norm: string }>(async (from, to) => {
    const res = await sb.from("catering_live_ring_codes").select("lead_id,location_id,code_norm")
      .in("location_id", [...shops.keys()]).order("lead_id").range(from, to).abortSignal(signal ?? never);
    if (res.error) {
      if (res.error.code && NOT_INSTALLED.has(res.error.code)) { installed = false; return { data: [] }; }
      throw new Error("catering_toast_read_failed");
    }
    return res;
  });
  if (installed) for (const row of rows) ringCodes.set(row.location_id, [...(ringCodes.get(row.location_id) ?? []), row.code_norm]);
  return { shops, ringCodes };
}

type Captured = Pick<CapturedToastOrder, "orderGuid" | "snapshotId" | "modifiedAt">;
export interface DayNoteLookup {
  locationId: string; restaurantGuid: string; date: string;
  /** ezCater order numbers of this shop (any spelling; normalized here). */
  ezcaterCodes: readonly string[];
  /** The captured, live, catering-channel orders of the day: the scope and version fence of the lookup. */
  captured: readonly Captured[];
  deadlineAt?: number; signal?: AbortSignal;
  /** Counts the captures this call RECORDED as examined (item 21 PR 5: the backfill's measure of progress). */
  stats?: { examined: number };
}

/**
 * THE one lookup. Returns the ezCater intersections only, in pass 2's shape (key = toastCodeSelectionKey).
 * For an enabled shop it records the intersections AND the examined captures BEFORE it returns, so a publication that
 * follows is judged on them. A failed record throws (fail closed); 0348 not applied = nothing to record.
 * With no known code at all nothing can intersect: every capture counts as examined and Toast is not called.
 *
 * NOTHING IS REMEMBERED HERE BETWEEN CALLS (review PORTAL4-r2): the only memory of a lookup is the coverage it
 * recorded. A capture Toast did not hand back this time (so it was not examined and not recorded) is asked for again by
 * the very next call, and `catering_toast_uncovered_orders` stops listing a capture only once it IS recorded. A cache
 * of results would turn one incomplete answer into a check that waits for the life of the process.
 */
export async function lookupDayNoteCodes(sb: Sb, house: HouseNoteContext, args: DayNoteLookup): Promise<Map<string, string[]>> {
  const ez = new Set(args.ezcaterCodes.map(normalizeOrderCode).filter(Boolean));
  const houseOn = house.shops.has(args.locationId);
  const ring = houseOn ? (house.ringCodes.get(args.locationId) ?? []) : [];
  const known = [...new Set([...ez, ...ring])].sort();
  const out = new Map<string, string[]>();
  if (args.captured.length === 0 || (known.length === 0 && !houseOn)) return out;
  const versions = new Map(args.captured.map((r) => [r.orderGuid, r.modifiedAt]));
  const examined = new Set<string>();
  let found = new Map<string, string[]>();
  if (known.length === 0) {
    for (const r of args.captured) examined.add(r.orderGuid);
  } else {
    found = await loadKnownToastOrderCodes(args.restaurantGuid, args.date, known,
      { deadlineAt: args.deadlineAt, signal: args.signal, expectedVersions: versions, examined });
  }
  const recorded = houseOn ? await recordNoteLookup(sb, args, examined, found) : 0;
  if (args.stats) args.stats.examined += recorded;
  for (const [selection, codes] of found) {
    const kept = codes.filter((code) => ez.has(code));
    if (kept.length) out.set(selection, kept);
  }
  return out;
}

/** Returns how many captures it recorded as examined (0 when there was nothing to record, or 0348 is not applied). */
async function recordNoteLookup(sb: Sb, args: DayNoteLookup, examined: ReadonlySet<string>, found: Map<string, string[]>): Promise<number> {
  const snapshot = new Map(args.captured.map((r) => [r.orderGuid, r.snapshotId]));
  const covered = [...examined].flatMap((orderGuid) => {
    const snapshotId = snapshot.get(orderGuid);
    return snapshotId ? [{ location_id: args.locationId, order_guid: orderGuid, toast_snapshot_id: snapshotId }] : [];
  });
  const codes: Array<{ location_id: string; order_guid: string; check_guid: string; toast_snapshot_id: string; code: string }> = [];
  for (const [selection, list] of found) {
    const [orderGuid, checkGuid] = JSON.parse(selection) as [string, string, string];
    const snapshotId = snapshot.get(orderGuid);
    // A code is evidence only on a capture this very lookup examined.
    if (!snapshotId || !examined.has(orderGuid)) continue;
    for (const code of list) codes.push({ location_id: args.locationId, order_guid: orderGuid, check_guid: checkGuid, toast_snapshot_id: snapshotId, code });
  }
  if (covered.length === 0) return 0;
  const { error } = await sb.rpc("record_catering_toast_note_lookup", { p_examined: covered, p_codes: codes }).abortSignal(args.signal ?? never);
  if (!error) return covered.length;
  // 0348 not applied yet: no reader of these rows exists either. Anything else is a failure of the house side.
  if (error.code && NOT_INSTALLED.has(error.code)) return 0;
  throw new Error("catering_toast_note_lookup_failed");
}

const live = (r: CapturedToastOrder) => r.salesChannel?.toLowerCase() === "catering" && !r.voided && !r.deleted && !r.excessFood;
/** The scope pass 2 always used: the day's live catering-channel orders (0348's `catering_toast_note_scope` in SQL). */
export const cateringCaptured = (orders: readonly CapturedToastOrder[]): CapturedToastOrder[] => orders.filter(live);

/** `examined` = captures recorded as examined: zero means a call made no progress (what is left cannot be read now). */
export interface CoverResult { lookups: number; examined: number; failed: number; skipped?: "not_installed" }

/**
 * Examine the captures nobody has examined yet (`catering_toast_uncovered_orders`, 0348: live orders in the lookup's
 * scope whose current capture has no coverage), for every enabled shop that can use the answer (a ring code exists, or
 * an automatic switch is on). Newest days first, at most `maxDays` days per shop and call. Same function, same union.
 * Every read and the Toast calls carry `signal`. A shop that fails is counted and the next one still runs; whatever
 * stays unexamined simply keeps both sources waiting. `onlyLocationId` narrows it to one shop (the backfill).
 */
export async function coverUncoveredNotes(sb: Sb, args: { from: string; to: string; maxDays: number; deadlineAt: number; signal?: AbortSignal; onlyLocationId?: string }): Promise<CoverResult> {
  const signal = args.signal ?? never;
  const house = await loadHouseNoteContext(sb, signal);
  const out: CoverResult = { lookups: 0, examined: 0, failed: 0 };
  const stats = { examined: 0 };
  for (const [locationId, switches] of house.shops) {
    if (args.onlyLocationId && locationId !== args.onlyLocationId) continue;
    if (!(house.ringCodes.get(locationId)?.length) && !switches.autoLink && !switches.originAutoLink) continue;
    if (Date.now() >= args.deadlineAt || signal.aborted) break;
    try {
      const uncovered = await sb.rpc("catering_toast_uncovered_orders", { p_location_id: locationId, p_from: args.from, p_to: args.to }).abortSignal(signal);
      if (uncovered.error) {
        if (uncovered.error.code && NOT_INSTALLED.has(uncovered.error.code)) return { lookups: 0, examined: 0, failed: 0, skipped: "not_installed" };
        throw new Error("catering_toast_read_failed");
      }
      type Row = { order_guid: string; toast_snapshot_id: string; business_date: string; modified_at: string | null };
      const byDay = new Map<string, Captured[]>();
      for (const row of (uncovered.data ?? []) as Row[]) {
        byDay.set(row.business_date, [...(byDay.get(row.business_date) ?? []), { orderGuid: row.order_guid, snapshotId: row.toast_snapshot_id, modifiedAt: row.modified_at }]);
      }
      if (byDay.size === 0) continue;
      const shop = await sb.from("locations").select("toast_restaurant_guid").eq("id", locationId).abortSignal(signal).maybeSingle<{ toast_restaurant_guid: string | null }>();
      if (shop.error) throw new Error("catering_toast_read_failed");
      const restaurantGuid = shop.data?.toast_restaurant_guid;
      if (!restaurantGuid) continue;
      const numbers = await selectAllRows<{ order_number: string | null }>(async (from, to) => {
        const res = await sb.from("ezcater_orders").select("id,order_number").not("order_number", "is", null)
          .gte("event_date", etYmdMinusDays(args.from, 8)).lte("event_date", etYmdMinusDays(args.to, -8)).order("id").range(from, to).abortSignal(signal);
        if (res.error) throw new Error("catering_toast_read_failed");
        return res;
      });
      const ezcaterCodes = numbers.flatMap((n) => n.order_number ? [n.order_number] : []);
      for (const date of [...byDay.keys()].sort().reverse().slice(0, args.maxDays)) {
        if (Date.now() >= args.deadlineAt || signal.aborted) break;
        await lookupDayNoteCodes(sb, house, { locationId, restaurantGuid, date, ezcaterCodes, captured: byDay.get(date)!, deadlineAt: args.deadlineAt, signal: args.signal, stats });
        out.lookups += 1;
      }
    } catch { out.failed += 1; }
  }
  out.examined = stats.examined;
  return out;
}
