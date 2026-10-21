import { structureFromStations, type PositionRole } from "@/lib/scheduling/structure-shared";

// Synthetic ids, in the confirmed P Street mapping order: Register & Delivery, Expeditor,
// Walk-ins / Online, Walk-ins, Prep, Prep/Dishwasher, Crunchy Boi, 3rd Party.
export const PSTREET_ROLES: Record<string, PositionRole> = Object.fromEntries(
  (["register", "expo", "walk_online", "walk", "prep", "prep_dish", "line_other", "line_other"] as const)
    .map((role, i) => [`00000000-0000-4000-8000-00000000000${i + 1}`, role]),
);
export function pStreetSeed(roles: Record<string, PositionRole> = {}) {
  const result = structureFromStations(
    [{ id: "station", active: true, staffed: true, usuallyClosesAt: null, trims: [] }],
    Object.keys(PSTREET_ROLES).map((id) => ({ id, stationId: "station", active: true, usuallyTrimsAt: null })), roles,
  );
  if (!result.ok) throw new Error(result.key);
  return result.structure;
}

export const FLOOR_POSITION = "f0e22271-3215-4344-b21c-325acf3bdbda";
export const OTHER_POSITION = "00000000-0000-4000-8000-000000000002";

/** The pre-role-edit seed: all positions are line_other, every crew floor is 1. */
export function seededFloors() {
  const result = structureFromStations(
    [{ id: "station", active: true, staffed: true, roleOnly: false, usuallyClosesAt: null, trims: [] }],
    [FLOOR_POSITION, OTHER_POSITION].map((id) => ({ id, stationId: "station", active: true, usuallyTrimsAt: null })),
    {},
  );
  if (!result.ok) throw new Error(result.key);
  return result.structure;
}
