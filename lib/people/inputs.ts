/**
 * THE PEOPLE-LAYER INPUTS, resolved per shop (Scheduling Phase 1, Task 23). Server-only, service role.
 *
 * `PeopleInputs` is read from the shop's `people_shop_settings` row by the wrappers (lib/team-metrics.ts) and
 * handed to the pure rules as a parameter. No row, `pm_v2 = false`, or 0270 not applied yet → `LEGACY_INPUTS`:
 * every legacy number byte-identical to the golden. Any other read failure throws (a silent "off" would be a
 * wrong number, not a safe one).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTable } from "@/lib/people/facts";
import { LEGACY_INPUTS, type PeopleInputs } from "@/lib/people/inputs-shared";
import { PM_V2_PERSON_FAMILIES, PM_V2_TEAM_FAMILIES, type FactFamily } from "@/lib/people/facts-shared";

const PM_V2_ON: PeopleInputs = Object.freeze({ pmV2: true });

export async function loadPeopleInputs(service: SupabaseClient, locationId: string): Promise<PeopleInputs> {
  const { data, error } = await service.from("people_shop_settings").select("pm_v2").eq("location_id", locationId).maybeSingle();
  if (error) {
    if (isMissingTable(error)) return LEGACY_INPUTS;
    throw new Error(`loadPeopleInputs: ${error.message}`);
  }
  return (data as { pm_v2?: unknown } | null)?.pm_v2 === true ? PM_V2_ON : LEGACY_INPUTS;
}

/** The fact families a load needs for these inputs: the legacy ones, plus PM v2's only while it is on. */
export function familiesFor(legacy: readonly FactFamily[], inputs: PeopleInputs, subject: "team" | "person"): readonly FactFamily[] {
  if (!inputs.pmV2) return legacy;
  return [...legacy, ...(subject === "team" ? PM_V2_TEAM_FAMILIES : PM_V2_PERSON_FAMILIES)];
}
