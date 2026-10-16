/**
 * PEOPLE SHOP SETTINGS — the PM v2 switch and the prep evidence position. Server-only, service role.
 * Scheduling Phase 1, Task 16. GM own shop, MoO+ any (`canEditPeopleSettings`, before any I/O); the 0270
 * RPC `save_people_shop_settings` decides it again and proves the prep position belongs to the shop.
 * Audited `people.shop_settings_update` with before/after.
 *
 * THE PM v2 SWITCH (Task 23 wired it): per shop, OFF by default (no row = off). Turning it ON for a shop is
 * gated by that shop's DATA, checked here before the RPC (`pmV2Readiness`): the BOH positions "Prep" and
 * "Prep/Dishwasher" exist there (Task 14b, through the station admin) and the confirmed criteria are seeded
 * there (Task 22, at least one ACTIVE shared criterion). Not ready → 409 `pm_v2_not_ready`, nothing written.
 * Turning it OFF is never gated. While it is on, new PM days at the shop are v2 (lib/pm-report.ts) and its PM v2
 * grades and notes feed the legacy numbers (lib/people/inputs.ts); while it is off, nothing moves.
 * `PM_V2_SWITCH_AVAILABLE` is the code-level kill switch: false refuses every ON with `pm_v2_unavailable` and
 * stamps every new day v1, whatever a settings row says.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "@/lib/audit";
import { canEditPeopleSettings, type PeopleActor } from "@/lib/people/access-shared";
import { isMissingTable } from "@/lib/people/facts";
import { PeopleSkillError, requireUsablePosition, rpcFailure } from "@/lib/people/skills";
import { bohPositionsReport, type BohPositionRow, type BohStationRow } from "@/lib/people/boh-positions-shared";
import { selectAllRows } from "@/lib/supabase-paginate";

export const PM_V2_SWITCH_AVAILABLE = true;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PeopleShopSettings { pmV2: boolean; prepPositionId: string | null }
export const DEFAULT_PEOPLE_SHOP_SETTINGS: PeopleShopSettings = Object.freeze({ pmV2: false, prepPositionId: null });

/** The shop's settings, or the defaults (no row, or 0270 not applied yet). */
export async function loadPeopleShopSettings(service: SupabaseClient, locationId: string): Promise<PeopleShopSettings> {
  const { data, error } = await service.from("people_shop_settings").select("pm_v2, prep_position_id").eq("location_id", locationId).maybeSingle();
  if (error) {
    if (isMissingTable(error)) return DEFAULT_PEOPLE_SHOP_SETTINGS;
    throw new Error(`loadPeopleShopSettings: ${error.message}`);
  }
  const row = data as { pm_v2: boolean; prep_position_id: string | null } | null;
  return row ? { pmV2: row.pm_v2 === true, prepPositionId: row.prep_position_id } : DEFAULT_PEOPLE_SHOP_SETTINGS;
}

export async function savePeopleShopSettings(
  service: SupabaseClient, args: { actor: PeopleActor; locationId: string; pmV2: unknown; prepPositionId: unknown },
): Promise<PeopleShopSettings> {
  if (!canEditPeopleSettings(args.actor, args.locationId)) throw new PeopleSkillError(403, "forbidden");
  if (!UUID.test(args.locationId) || typeof args.pmV2 !== "boolean"
      || (args.prepPositionId !== null && (typeof args.prepPositionId !== "string" || !UUID.test(args.prepPositionId)))) {
    throw new PeopleSkillError(400, "invalid_payload");
  }
  if (args.pmV2 && !PM_V2_SWITCH_AVAILABLE) throw new PeopleSkillError(409, "pm_v2_unavailable");
  if (args.pmV2 && !(await pmV2Readiness(service, args.locationId)).ready) throw new PeopleSkillError(409, "pm_v2_not_ready");
  if (typeof args.prepPositionId === "string") await requireUsablePosition(service, args.locationId, args.prepPositionId);
  const { data, error } = await service.rpc("save_people_shop_settings", {
    p_actor: args.actor.userId, p_location: args.locationId, p_pm_v2: args.pmV2, p_prep_position: args.prepPositionId,
  });
  if (error) rpcFailure(error);
  const r = data as { before: unknown; after: { pm_v2: boolean; prep_position_id: string | null } };
  await audit({
    actorId: args.actor.userId, actorRole: args.actor.role, action: "people.shop_settings_update", resourceTable: "people_shop_settings",
    resourceId: args.locationId, metadata: { location_id: args.locationId, before: r.before, after: r.after }, ipAddress: null, userAgent: null,
  });
  return { pmV2: r.after.pm_v2, prepPositionId: r.after.prep_position_id };
}

/**
 * Is this shop's DATA ready for PM v2? Both BOH positions exactly once, active, on an active station (the 14b
 * report's rule), AND at least one active SHARED criterion (the seed). Read-only. Before 0271 there is no
 * criteria table: not ready.
 */
export async function pmV2Readiness(service: SupabaseClient, locationId: string): Promise<{ ready: boolean; boh: boolean; criteria: number }> {
  const stations = await selectAllRows<BohStationRow>((from, to) => service.from("stations")
    .select("id, location_id, name, active").eq("location_id", locationId).order("id", { ascending: true }).range(from, to));
  const positions = await selectAllRows<BohPositionRow>((from, to) => service.from("station_positions")
    .select("id, station_id, location_id, name, name_es, active").eq("location_id", locationId).order("id", { ascending: true }).range(from, to));
  const boh = bohPositionsReport([{ id: locationId, name: "", active: true }], stations, positions).ready;
  let criteria = 0;
  try {
    criteria = (await selectAllRows<{ id: string }>((from, to) => service.from("pm_criteria").select("id")
      .eq("location_id", locationId).is("position_id", null).eq("active", true).order("id", { ascending: true }).range(from, to))).length;
  } catch (e) {
    if (!isMissingTable({ message: e instanceof Error ? e.message : String(e) })) throw e;
  }
  return { ready: boh && criteria > 0, boh, criteria };
}
