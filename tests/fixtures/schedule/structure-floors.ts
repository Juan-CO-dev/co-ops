import { structureFromStations } from "@/lib/scheduling/structure-shared";

export const FLOOR_POSITION = "f0e22271-3215-4344-b21c-325acf3bdbda";
export const OTHER_POSITION = "00000000-0000-4000-8000-000000000002";

/** The pre-role-edit seed: all positions are line_other, every crew floor is 1. */
export function seededFloors() {
  const result = structureFromStations(
    [{ id: "station", active: true, roleOnly: false, usuallyClosesAt: null, trims: [] }],
    [FLOOR_POSITION, OTHER_POSITION].map((id) => ({ id, stationId: "station", active: true, usuallyTrimsAt: null })),
    {},
  );
  if (!result.ok) throw new Error(result.key);
  return result.structure;
}
