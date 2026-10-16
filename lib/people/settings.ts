/**
 * PEOPLE SHOP SETTINGS — the PM v2 switch and the prep evidence position. Server-only, service role.
 * Scheduling Phase 1, Task 16. GM own shop, MoO+ any (`canEditPeopleSettings`, before any I/O); the 0270
 * RPC `save_people_shop_settings` decides it again and proves the prep position belongs to the shop.
 * Audited `people.shop_settings_update` with before/after.
 *
 * THE PM v2 SWITCH STAYS OFF IN PHASE 1's CHUNK E: nothing reads it until Task 23 wires PM v2 into the
 * people layer, and it may be switched on only after the shop's BOH positions exist (Task 14b) and its
 * criteria are seeded (Task 22). Until then turning it on is refused `pm_v2_unavailable`
 * (`PM_V2_SWITCH_AVAILABLE`, flipped by the chunk that wires it).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "@/lib/audit";
import { canEditPeopleSettings, type PeopleActor } from "@/lib/people/access-shared";
import { isMissingTable } from "@/lib/people/facts";
import { PeopleSkillError, requireUsablePosition, rpcFailure } from "@/lib/people/skills";

export const PM_V2_SWITCH_AVAILABLE = false;

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
