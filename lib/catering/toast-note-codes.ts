/**
 * Item 21 PR 4 — THE ONE NOTE LOOKUP for both sources (runbook contract #3, Astra r3 #3).
 *
 * A code staff type as a SPECIAL_REQUEST note is not in capture (note text is dropped). The ephemeral, version-fenced
 * lookup (`loadKnownToastOrderCodes`) intersects note tokens with KNOWN codes before anything leaves its stack frame.
 * This module calls it ONCE per (shop, day) with ezCater order numbers ∪ the shop's live house ring codes, and hands
 * the intersections to both sides:
 *   - the ezCater side gets its own numbers back (exactly what pass 2 read before: ring codes never reach its matcher);
 *   - the house side gets every intersection RECORDED, codes only, through `record_catering_toast_note_codes` (0348),
 *     fenced to the capture it was read on. The publisher guard, both planners and the house reconciler read that
 *     table, so a publication that follows sees the same evidence.
 * A shop whose `catering_toast_settings.enabled` is not on has no house side: the lookup is exactly the old one and
 * nothing is recorded. No note text is ever returned, logged or stored here.
 */
import "server-only";
import type { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { loadKnownToastOrderCodes } from "@/lib/ezcater/toast-codes";
import { normalizeOrderCode } from "@/lib/ezcater/pass2-shared";
import { loadCapturedToastDay, type CapturedToastOrder } from "@/lib/toast/captured-day";
import { etYmdMinusDays } from "@/lib/operational-day";

type Sb = ReturnType<typeof getServiceRoleClient>;
const NOT_INSTALLED = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);

/** The house side of the lookup: the shops that are on, and each one's live ring codes (normalized). */
export interface HouseNoteContext { enabled: ReadonlySet<string>; ringCodes: ReadonlyMap<string, readonly string[]> }
export const NO_HOUSE_SIDE: HouseNoteContext = { enabled: new Set(), ringCodes: new Map() };

/** Not installed (0344 / 0347 missing) = no house side. Any other read failure throws: a lookup that silently
 * forgot the ring codes would let ezCater take a dual-code check. */
export async function loadHouseNoteContext(sb: Sb, signal?: AbortSignal): Promise<HouseNoteContext> {
  const settings = await sb.from("catering_toast_settings").select("location_id").eq("enabled", true)
    .order("location_id").range(0, 999).abortSignal(signal ?? new AbortController().signal);
  if (settings.error) {
    if (settings.error.code && NOT_INSTALLED.has(settings.error.code)) return NO_HOUSE_SIDE;
    throw new Error("catering_toast_read_failed");
  }
  const enabled = new Set(((settings.data ?? []) as Array<{ location_id: string }>).map((r) => r.location_id));
  if (enabled.size === 0) return NO_HOUSE_SIDE;
  const ringCodes = new Map<string, string[]>();
  let installed = true;
  const rows = await selectAllRows<{ location_id: string; code_norm: string }>(async (from, to) => {
    const res = await sb.from("catering_live_ring_codes").select("lead_id,location_id,code_norm")
      .in("location_id", [...enabled]).order("lead_id").range(from, to).abortSignal(signal ?? new AbortController().signal);
    if (res.error) {
      if (res.error.code && NOT_INSTALLED.has(res.error.code)) { installed = false; return { data: [] }; }
      throw new Error("catering_toast_read_failed");
    }
    return res;
  });
  if (installed) for (const row of rows) ringCodes.set(row.location_id, [...(ringCodes.get(row.location_id) ?? []), row.code_norm]);
  return { enabled, ringCodes };
}

type Captured = Pick<CapturedToastOrder, "orderGuid" | "snapshotId" | "modifiedAt">;
export interface DayNoteLookup {
  locationId: string; restaurantGuid: string; date: string;
  /** ezCater order numbers of this shop (any spelling; normalized here). */
  ezcaterCodes: readonly string[];
  /** The captured, live, catering-channel orders of the day: the scope and version fence of the lookup. */
  captured: readonly Captured[];
  deadlineAt?: number; signal?: AbortSignal;
}

/** One lookup result per (shop, day, known codes, captured versions) for the life of the process: the nightly run
 * asks twice (pass 2, then the house pass) and the answer for the same versions and codes is the same. */
const memo = new Map<string, Map<string, string[]>>();
export function resetNoteLookupMemo() { memo.clear(); }

/**
 * THE one lookup. Returns the ezCater intersections only, in pass 2's shape (key = toastCodeSelectionKey).
 * Records every intersection for an enabled shop BEFORE it returns, so a publication that follows is judged on it.
 * A failed record throws (fail closed); 0348 not applied = nothing to record.
 */
export async function lookupDayNoteCodes(sb: Sb, house: HouseNoteContext, args: DayNoteLookup): Promise<Map<string, string[]>> {
  const ez = new Set(args.ezcaterCodes.map(normalizeOrderCode).filter(Boolean));
  const houseOn = house.enabled.has(args.locationId);
  const ring = houseOn ? (house.ringCodes.get(args.locationId) ?? []) : [];
  const known = [...new Set([...ez, ...ring])].sort();
  const out = new Map<string, string[]>();
  if (known.length === 0 || args.captured.length === 0) return out;
  const versions = new Map(args.captured.map((r) => [r.orderGuid, r.modifiedAt]));
  const key = JSON.stringify([args.locationId, args.date, known, [...versions].sort((a, b) => a[0].localeCompare(b[0]))]);
  let found = memo.get(key);
  if (!found) {
    found = await loadKnownToastOrderCodes(args.restaurantGuid, args.date, known,
      { deadlineAt: args.deadlineAt, signal: args.signal, expectedVersions: versions });
    if (houseOn && found.size > 0) await recordNoteCodes(sb, args, found);
    if (memo.size > 200) memo.clear();
    memo.set(key, found);
  }
  for (const [selection, codes] of found) {
    const kept = codes.filter((code) => ez.has(code));
    if (kept.length) out.set(selection, kept);
  }
  return out;
}

async function recordNoteCodes(sb: Sb, args: DayNoteLookup, found: Map<string, string[]>): Promise<void> {
  const snapshot = new Map(args.captured.map((r) => [r.orderGuid, r.snapshotId]));
  const rows: Array<{ location_id: string; order_guid: string; check_guid: string; toast_snapshot_id: string; code: string }> = [];
  for (const [selection, codes] of found) {
    const [orderGuid, checkGuid] = JSON.parse(selection) as [string, string, string];
    const snapshotId = snapshot.get(orderGuid);
    if (!snapshotId) continue;
    for (const code of codes) rows.push({ location_id: args.locationId, order_guid: orderGuid, check_guid: checkGuid, toast_snapshot_id: snapshotId, code });
  }
  if (rows.length === 0) return;
  const call = sb.rpc("record_catering_toast_note_codes", { p_rows: rows });
  const { error } = await (args.signal ? call.abortSignal(args.signal) : call);
  if (!error) return;
  // 0348 not applied yet: no reader of these rows exists either. Anything else is a failure of the house side.
  if (error.code && NOT_INSTALLED.has(error.code)) return;
  throw new Error("catering_toast_note_codes_failed");
}

const live = (r: CapturedToastOrder) => r.salesChannel?.toLowerCase() === "catering" && !r.voided && !r.deleted && !r.excessFood;
/** The scope pass 2 always used: the day's live catering-channel orders. */
export const cateringCaptured = (orders: readonly CapturedToastOrder[]): CapturedToastOrder[] => orders.filter(live);

export const HOUSE_LOOKUP_MAX_DAYS = 12;

/**
 * The house-only half: a shop with ring codes but no ezCater order near a day still needs its note-typed codes found.
 * For each enabled shop with a live ring code: the days its unlinked ring-code leads could be rung on (event day - 1
 * to + 7, not after today), newest first, at most HOUSE_LOOKUP_MAX_DAYS per shop and run. Same function, same union.
 */
export async function lookupHouseNoteCodes(sb: Sb, args: { from: string; to: string; today: string; deadlineAt: number; signal?: AbortSignal }):
  Promise<{ lookups: number; failed: number }> {
  const house = await loadHouseNoteContext(sb, args.signal);
  let lookups = 0, failed = 0;
  for (const locationId of house.enabled) {
    if (!(house.ringCodes.get(locationId)?.length)) continue;
    if (Date.now() >= args.deadlineAt || args.signal?.aborted) break;
    try {
      const leads = await selectAllRows<{ event_date: string }>(async (from, to) => {
        const res = await sb.from("catering_reconciliation_status").select("lead_id,event_date")
          .eq("location_id", locationId).eq("status", "not_rung_in_toast").not("ring_code", "is", null)
          .gte("event_date", args.from).lte("event_date", args.to).order("lead_id").range(from, to);
        if (res.error) throw new Error("catering_toast_read_failed");
        return res;
      });
      const days = new Set<string>();
      for (const lead of leads) for (let d = -1; d <= 7; d++) {
        const day = etYmdMinusDays(lead.event_date, -d);
        if (day <= args.today) days.add(day);
      }
      if (days.size === 0) continue;
      const shop = await sb.from("locations").select("toast_restaurant_guid").eq("id", locationId).maybeSingle<{ toast_restaurant_guid: string | null }>();
      if (shop.error) throw new Error("catering_toast_read_failed");
      const restaurantGuid = shop.data?.toast_restaurant_guid;
      if (!restaurantGuid) continue;
      const numbers = await selectAllRows<{ order_number: string | null }>(async (from, to) => {
        const res = await sb.from("ezcater_orders").select("id,order_number").not("order_number", "is", null)
          .gte("event_date", etYmdMinusDays(args.from, 8)).lte("event_date", etYmdMinusDays(args.to, -8)).order("id").range(from, to);
        if (res.error) throw new Error("catering_toast_read_failed");
        return res;
      });
      const ezcaterCodes = numbers.flatMap((n) => n.order_number ? [n.order_number] : []);
      for (const date of [...days].sort().reverse().slice(0, HOUSE_LOOKUP_MAX_DAYS)) {
        if (Date.now() >= args.deadlineAt || args.signal?.aborted) break;
        const day = await loadCapturedToastDay(locationId, date);
        const captured = day ? cateringCaptured(day.orders) : [];
        if (captured.length === 0) continue;
        await lookupDayNoteCodes(sb, house, { locationId, restaurantGuid, date, ezcaterCodes, captured, deadlineAt: args.deadlineAt, signal: args.signal });
        lookups += 1;
      }
    } catch { failed += 1; }
  }
  return { lookups, failed };
}
