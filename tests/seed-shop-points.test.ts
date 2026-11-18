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

describe("main: audit failure is never 'Applied.'", () => {
  it("a node insert followed by a failed audit insert exits 1, names the node, and a rerun repairs the audit", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    const NODE = "00000000-0000-4000-8000-0000000000n1";
    const audits: unknown[] = [];
    let failAudit = true;
    let nodes: Record<string, unknown>[] = [];
    const client = {
      from(t: string) {
        if (t === "locations") return { select: async () => ({ data: [{ id: CAP, name: "Capitol Hill", active: true }, { id: PST, name: "P Street", active: true }], error: null }) };
        if (t === "catering_fulfillment_nodes") return {
          select: async () => ({ data: nodes, error: null }),
          insert: (row: Record<string, unknown>) => ({ select: () => ({ single: async () => { nodes = [...nodes, { id: `${NODE}-${nodes.length}`, location_id: row.location_id, lat: row.lat, lng: row.lng, active: true }]; return { data: { id: `${NODE}-${nodes.length - 1}` }, error: null }; } }) }),
        };
        return {
          insert: async (row: unknown) => failAudit ? { error: { message: "boom" } } : (audits.push(row), { error: null }),
          select: () => { let id = ""; const q: any = { eq: (c: string, v: string) => { if (c === "resource_id") id = v; return q; }, limit: async () => ({ data: (audits as any[]).some((a) => a.resource_id === id) ? [{ id: 1 }] : [], error: null }) }; return q; },
        };
      },
    };
    vi.doMock("@supabase/supabase-js", () => ({ createClient: () => client }));
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://x"; process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
    const logs: string[] = [], errs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m) => { logs.push(String(m)); });
    vi.spyOn(console, "error").mockImplementation((m) => { errs.push(String(m)); });
    const mod = await import("../scripts/seed-shop-points");
    expect(await mod.main(["--apply"])).toBe(1);
    expect(logs.join("\n")).not.toContain("Applied.");
    expect(errs.join("\n")).toContain(`${NODE}-0`);
    expect(nodes).toHaveLength(2);
    failAudit = false; logs.length = 0; errs.length = 0;
    expect(await mod.main(["--apply"])).toBe(0);
    expect(audits).toHaveLength(2);
    expect(logs.join("\n")).toContain("Applied.");
    vi.restoreAllMocks(); vi.doUnmock("@supabase/supabase-js");
  });
});
