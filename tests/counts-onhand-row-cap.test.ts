/**
 * B9 round 1 (Astra P2-1, P2-2) — every read the Counts render widened or now SHARES must
 * survive PostgREST's 1000-row cap. The in-memory database enforces the cap
 * (tests/fixtures/counts-fake-db.ts MAX_ROWS), so an un-paged read past it loses its tail
 * here exactly as it does live. Each repro below failed on 2cd320e0 and passes now.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildCountsFixture, LOC, NOW } from "./fixtures/counts-onhand-fixture";
import type { AuthContext } from "@/lib/session";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));

const counts = await import("@/lib/counts");
const v0 = await import("./fixtures/counts-v0-oracle");
const actor = { user: { id: "u-owner", role: "owner", language: "en" }, role: "owner", level: 10, locations: [LOC] } as unknown as AuthContext;
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));
type AnyRow = { skuId: string; onHandOz?: number | null; anchorSource?: string; anchorAt: string };
const row = (v: { rows: unknown[] }, skuId: string) => (v.rows as AnyRow[]).find((r) => r.skuId === skuId)!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.unstubAllEnvs();
  vi.stubEnv("DEPLETION_SOURCE", "capture"); // frozen pre-cutover oracle only
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); current = null; });

const days = (from: string, to: string) => {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T12:00:00Z`); t <= Date.parse(`${to}T12:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

describe("the shared capture coverage reads to completion", () => {
  it("finds a covered day after 1000 manifests and an uncovered day after it", async () => {
    const t = buildCountsFixture();
    // Remove unrelated receipt uncertainty so only capture coverage changes the result.
    t.vendor_deliveries = [];
    t.vendor_delivery_items = [];
    const dates = days("2023-01-01", "2026-10-13");
    t.toast_depletion_day_coverage = dates.map((d) => ({ location_id: LOC, business_date: d,
      run_id: `run-${d}`, status: "success", computed_at: `${d}T23:00:00Z`,
      aggregate_count: 0, attribution_count: 0, suspect_check_count: 0, suspect_qty: 0, counted_qty: 0 }));
    t.toast_capture_runs = dates.filter((d) => d !== "2026-10-12").map((d) => ({ id: `run-${d}`,
      location_id: LOC, business_date: d, status: "completed", finished_at: `${d}T23:00:00Z` }));
    t.toast_capture_daily_depletion = [];
    t.toast_depletion_item_attribution = [];
    current = createFakeDb(t);
    const gaps = await counts.loadSalesGapDates(current.client, LOC, "2023-01-01", "2026-10-14");
    expect([...gaps]).toEqual(["2026-10-12"]);
    // Exercise the render's shared snapshot, not just the standalone gap reader.
    const uncovered = await counts.deriveOnHand(LOC, NOW);
    expect(row(uncovered, "s-cheese")).toMatchObject({ anchorSource: "census", onHandOz: null });
    expect(row(uncovered, "s-lettuce")).toMatchObject({ anchorSource: "par_estimate", onHandOz: null });

    // The same successful empty days are known zero once the missing run exists.
    t.toast_capture_runs.push({ id: "run-2026-10-12", location_id: LOC,
      business_date: "2026-10-12", status: "completed", finished_at: "2026-10-12T23:00:00Z" });
    current = createFakeDb(t);
    const covered = await counts.deriveOnHand(LOC, NOW);
    expect(row(covered, "s-cheese").onHandOz).toEqual(expect.any(Number));
    expect(row(covered, "s-lettuce").onHandOz).toEqual(expect.any(Number));
  });
});

describe("P2-2: stored inferred baselines are read to completion", () => {
  /** 1,000 historical baselines (SKUs no longer on the roster) stored AHEAD of an eligible
   *  SKU's baseline. */
  const tables = () => {
    const t = buildCountsFixture();
    const history = Array.from({ length: 1000 }, (_, i) => ({ location_id: LOC, sku_id: `s-gone-${String(i).padStart(4, "0")}`, inferred_oz: 1, computed_at: "2026-08-01T00:00:00+00:00", basis: {} }));
    t.sku_inferred_baselines = [...history, ...t.sku_inferred_baselines!];
    return t;
  };

  it("the eligible SKU keeps its STORED baseline (anchor + value), never a recomputed one", async () => {
    current = createFakeDb(tables());
    const old = plain(await v0.v0OnHandCore(LOC, NOW, { withProducts: true, seedBaselines: false }));
    current = createFakeDb(tables());
    const neu = plain(await counts.loadOnHandDerived(actor, LOC, NOW, { withProducts: true, seedBaselines: false }));
    expect(row(old, "s-onion").anchorAt).toBe("2026-09-25T09:00:00+00:00");
    expect(row(neu, "s-onion")).toEqual(row(old, "s-onion"));
    expect(neu).toEqual(old);
  });

  it("the walk's seeding read writes no second baseline for it (D6: computed once)", async () => {
    const db = createFakeDb(tables());
    current = db;
    await counts.loadOnHandDerived(actor, LOC, NOW);
    const written = db.writes.flatMap((w) => w.rows.map((r) => r.sku_id));
    expect(written).not.toContain("s-onion");
    expect(written).not.toContain("s-mayo");
  });
});

describe("the shared roster is read to completion", () => {
  it("a par-anchored SKU past the 1000th active SKU still gets its row", async () => {
    const t = buildCountsFixture();
    for (let i = 0; i < 1100; i++) t.vendor_items!.push({ id: `s-bulk-${String(i).padStart(4, "0")}`, name: `Bulk ${String(i).padStart(4, "0")}`, pack_format: null, vendor_id: null, product_id: null, active: true });
    t.vendor_items!.push({ id: "s-zz-last", name: "Zz last", pack_format: null, vendor_id: null, product_id: null, active: true });
    t.par_pass_lines!.push({ id: "ppl-zz", event_id: "pe2", sku_id: "s-zz-last", implied_on_hand_oz: 12, created_at: "2026-10-12T10:15:00.25+00:00" });
    current = createFakeDb(t);
    const view = await counts.deriveOnHand(LOC, NOW);
    expect(row(view, "s-zz-last")?.anchorSource).toBe("par_estimate");
  });
});
