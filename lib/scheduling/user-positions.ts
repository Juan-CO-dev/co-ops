/**
 * `loadUserPositionPickers` — the admin user screen's primary / secondary picker data, per shop (Juan 2026-10-20).
 * Server-only, service role, read-only. The CALLER gates: the user screen is level 8+ (MoO+), every one of whom may write
 * schedule person settings at any shop (access-shared: MoO+; the social media manager never reaches level 8).
 *
 * Per shop: the LIVE positions (the structure's, with their labels; roles only once the structure is saved), every
 * person's latest settings row, and the Toast suggestions for the shop's members with no primary. A shop whose
 * scheduling tables are not installed yet (0274 / 0224 not applied) is `null` — the screen says so and offers no picker;
 * any other error throws.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTable } from "@/lib/people/facts";
import type { RoleCode } from "@/lib/roles";
import { loadPositionLabelRows } from "./board";
import { ScheduleError } from "./errors-shared";
import { loadLiveStructure, loadPersonSettingsWithIds } from "./inputs";
import { loadToastJobHours, toastSuggestions } from "./position-suggest";
import { effectiveScheduleRole } from "./works-as-shared";
import type { PickerPosition, ShopPositionPicker } from "./user-positions-shared";

const notInstalled = (e: unknown) =>
  (e instanceof ScheduleError && e.code === "inputs_unavailable") || (e instanceof Error && isMissingTable({ message: e.message }));

export async function loadUserPositionPickers(service: SupabaseClient, args: {
  locationIds: readonly string[];
  people: ReadonlyArray<{ userId: string; role: RoleCode; locationIds: readonly string[] }>;
  today: string;
}): Promise<Record<string, ShopPositionPicker | null>> {
  const out: Record<string, ShopPositionPicker | null> = {};
  for (const locationId of [...args.locationIds].sort()) {
    try {
      const live = await loadLiveStructure(service, locationId);
      const rolesKnown = live.source === "saved";
      const labels = new Map((await loadPositionLabelRows(service, locationId)).map((r) => [r.id, r]));
      const positions: PickerPosition[] = Object.keys(live.structure.positions).filter((id) => labels.has(id)).map((id) => {
        const l = labels.get(id)!;
        return { id, name: l.name, nameEs: l.name_es, role: rolesKnown ? live.structure.positions[id]!.role : null, allowedRoles: live.structure.positions[id]!.allowedRoles };
      }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));
      // The values and their row ids from ONE read (the picks send the id back as their expected head).
      const snapshot = await loadPersonSettingsWithIds(service, locationId);
      const settings = Object.fromEntries(snapshot.map((x) => [x.row.userId, x.row]));
      const settingsIds = Object.fromEntries(snapshot.map((x) => [x.row.userId, x.id]));
      const members = args.people.filter((p) => p.locationIds.includes(locationId)).map((p) => ({ userId: p.userId, role: effectiveScheduleRole(p.role, settings[p.userId]?.worksAs), coverPositions: settings[p.userId]?.coverPositions ?? [] }));
      const suggestions = members.some((m) => m.coverPositions.length === 0)
        ? toastSuggestions(await loadToastJobHours(service, locationId, args.today), members, positions)
        : {};
      out[locationId] = { locationId, positions, rolesKnown, settings, settingsIds, suggestions };
    } catch (e) {
      // The scheduling tables are not installed at this shop's database yet: the screen shows "not available", no picker.
      if (notInstalled(e)) { out[locationId] = null; continue; }
      throw e;
    }
  }
  return out;
}
