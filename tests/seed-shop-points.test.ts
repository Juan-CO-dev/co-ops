/**
 * scripts/seed-shop-points.ts: the PLAN is pure and tested; the script only reads, prints, and on --apply inserts
 * the planned rows. A shop already having a node is never touched (catering owns that row); a seeded node offers
 * neither delivery nor pickup, so the customer order funnel is unchanged.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SEED_FILE, nodeInsert, parseSeedArgs, planShopPoints, readSeed } from "../scripts/seed-shop-points";

const CAP = "00000000-0000-4000-8000-0000000000c1", PST = "00000000-0000-4000-8000-0000000000c2", OLD = "00000000-0000-4000-8000-0000000000c3";
const seed = readSeed();

describe("the seed file", () => {
  it("holds the two Census results with finite DC coordinates", () => {
    expect(seed.shops).toHaveLength(2);
    for (const s of seed.shops) {
      expect(s.lat).toBeGreaterThan(38.79); expect(s.lat).toBeLessThan(39.0);
      expect(s.lon).toBeGreaterThan(-77.12); expect(s.lon).toBeLessThan(-76.9);
      expect(s.match.matches).toBe(1);
    }
    expect(JSON.parse(readFileSync(SEED_FILE, "utf8")).placeholderRadiusMeters).toBeGreaterThan(0);
  });
});

describe("planShopPoints", () => {
  const locations = [{ id: CAP, name: "Capitol Hill", active: true }, { id: PST, name: "P Street", active: true }, { id: OLD, name: "P St", active: false }];
  it("matches an ACTIVE location by name (case-insensitive) and plans an insert", () => {
    const plan = planShopPoints(seed, [{ id: CAP, name: "capitol hill", active: true }, { id: PST, name: "P STREET", active: true }], []);
    expect(plan.map((p) => [p.action, "locationId" in p ? p.locationId : null])).toEqual([["insert", CAP], ["insert", PST]]);
  });
  it("an inactive same-name location is ignored", () => {
    expect(planShopPoints(seed, locations, []).every((p) => p.action === "insert")).toBe(true);
  });
  it("no match / several matches are refused by name", () => {
    const none = planShopPoints(seed, [{ id: PST, name: "P Street", active: true }], []);
    expect(none[0]).toMatchObject({ action: "refuse", reason: "location_not_found" });
    const two = planShopPoints(seed, [{ id: CAP, name: "Capitol Hill", active: true }, { id: OLD, name: "Cap Hill", active: true }, { id: PST, name: "P Street", active: true }], []);
    expect(two[0]).toMatchObject({ action: "refuse", reason: "location_ambiguous" });
  });
  it("a shop that already has a node (active or not) is never touched", () => {
    const plan = planShopPoints(seed, locations, [{ location_id: CAP, lat: 38.8, lng: -77, active: false }]);
    expect(plan[0]).toMatchObject({ action: "exists", locationId: CAP });
    expect(plan[1]).toMatchObject({ action: "insert", locationId: PST });
  });
  it("the insert is delivery- and pickup-neutral, active, with the placeholder radius", () => {
    const plan = planShopPoints(seed, locations, []);
    const p = plan[0]!;
    if (p.action !== "insert") throw new Error("expected insert");
    expect(nodeInsert(p, 1609)).toEqual({ location_id: CAP, lat: seed.shops[0]!.lat, lng: seed.shops[0]!.lon, delivery_radius_meters: 1609,
      offers_delivery: false, offers_pickup: false, active: true });
  });
  it("arguments", () => {
    expect(parseSeedArgs([])).toEqual({ apply: false });
    expect(parseSeedArgs(["--apply"])).toEqual({ apply: true });
    expect(parseSeedArgs(["--force"])).toEqual({ error: "unknown argument --force" });
  });
});
