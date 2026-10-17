/**
 * CC chunk H9 fix 4 (2026-10-17) — the Closing Manager is a ROLE, not a head (spec §6.2: "Closing Manager is a ROLE carried by one
 * of the closers … not an extra head"). On prod and the sim the station list carries a "Closing Manager" station (a section of
 * the closing checklist, synced into `stations` with one auto position), and the seeded structure STAFFED it 9:30 AM–3:30 PM as
 * an unmapped `line_other` position. The seed must never make a headcount position of it; the role stays the validator's
 * closing rule (the flagged eligible closer). The station is recognised by its ENGLISH system key (AGENTS: match keys on the
 * English original, like the Walk-Out Verification gate), in the loader — `structureFromStations` itself matches no name.
 * The other checklist-only stations (Shut Down Back Line, Clean front of house, Walk-Out Verification, Prep Fridge) are left
 * as they are for Juan's structure review.
 */
import { describe, expect, it } from "vitest";
import { CLOSING_MANAGER_STATION } from "@/lib/checklist-constants";
import { loadLiveStructure, loadStationSeedRows } from "@/lib/scheduling/inputs";
import { structureFromStations } from "@/lib/scheduling/structure-shared";
import { A, ST, P_REG, P_WALK, scheduleStore, shopTables, uid } from "./fixtures/schedule/lib-store";

const ST_CM = uid(40);
const P_CM = uid(41);
const ST_WALKOUT = uid(42);
const P_WALKOUT = uid(43);

function tablesWithClosingSections() {
  const t = shopTables();
  t.stations!.push(
    { id: ST_CM, location_id: A, name: "Closing Manager", name_es: "Gerente de cierre", sort: 9, active: true, usually_closes_at: null, trims: null },
    { id: ST_WALKOUT, location_id: A, name: "Walk-Out Verification", name_es: "Verificación de salida", sort: 10, active: true, usually_closes_at: null, trims: null },
  );
  t.station_positions!.push(
    { id: P_CM, station_id: ST_CM, location_id: A, name: "Closing Manager", name_es: null, sort: 1, active: true, usually_trims_at: null },
    { id: P_WALKOUT, station_id: ST_WALKOUT, location_id: A, name: "Walk-Out Verification", name_es: null, sort: 1, active: true, usually_trims_at: null },
  );
  return t;
}

describe("H9 fix 4: the Closing Manager station is never a staffed headcount position", () => {
  it("the system key is the English station name", () => {
    expect(CLOSING_MANAGER_STATION).toBe("Closing Manager");
  });

  it("structureFromStations skips every position of a ROLE-ONLY station (by flag, never by name)", () => {
    const stations = [
      { id: ST, active: true, usuallyClosesAt: null, trims: null },
      { id: ST_CM, active: true, usuallyClosesAt: null, trims: null, roleOnly: true },
    ];
    const positions = [
      { id: P_REG, stationId: ST, active: true, usuallyTrimsAt: null },
      { id: P_CM, stationId: ST_CM, active: true, usuallyTrimsAt: null },
    ];
    const r = structureFromStations(stations, positions, {});
    if (!r.ok) throw new Error(r.key);
    expect(Object.keys(r.structure.positions)).toEqual([P_REG]);
    expect(r.seededFrom[P_CM]).toBeUndefined();
  });

  it("the loader flags the Closing Manager station role-only (and only it); the seeded live structure has no Closing Manager head", async () => {
    const { client } = scheduleStore(tablesWithClosingSections());
    const rows = await loadStationSeedRows(client, A);
    expect(rows.stations.filter((s) => s.roleOnly).map((s) => s.id)).toEqual([ST_CM]);
    const live = await loadLiveStructure(client, A);
    expect(live.source).toBe("defaults");
    expect(Object.keys(live.structure.positions).sort()).toEqual([P_REG, P_WALK, P_WALKOUT].sort());
    expect(live.structure.positions[P_CM]).toBeUndefined();
    // Walk-Out Verification is a checklist-only section left for Juan's review: still seeded, as an unmapped line_other.
    expect(live.structure.positions[P_WALKOUT]).toMatchObject({ role: "line_other", openQ: 38, trimQ: 62, closeQ: 62 });
  });
});
