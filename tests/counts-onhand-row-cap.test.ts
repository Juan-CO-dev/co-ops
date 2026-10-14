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
  vi.unstubAllEnvs(); // legacy ledger source
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); current = null; });

const days = (from: string, to: string) => {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T12:00:00Z`); t <= Date.parse(`${to}T12:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

describe("P2-1: the shared legacy gap probe reads to completion", () => {
  /** Census anchor Sep 1, par anchor Oct 10; 1,000+ September selections sit AHEAD of the
   *  Oct 12 events whose depletion never materialized (a real gap). */
  const tables = () => {
    const t = buildCountsFixture();
    t.sku_count_events = [{ id: "e-sep", location_id: LOC, counted_at: "2026-09-01T12:00:00+00:00", active: true }];
    t.sku_count_lines = [{ id: "cl-1", count_event_id: "e-sep", sku_id: "s-turkey", anchor_dimension: "weight", resolved_oz: 100, resolved_units: null,
      is_loose: false, partial_fraction: null, level_label: "x", qty: 1, allocated_from_product_id: null }];
    t.par_pass_events = [{ id: "pe-oct", location_id: LOC, status: "submitted" }];
    t.par_pass_lines = [{ id: "ppl-1", event_id: "pe-oct", sku_id: "s-lettuce", implied_on_hand_oz: 50, created_at: "2026-10-10T12:00:00+00:00" }];
    t.toast_sales_events = [];
    let n = 0;
    for (const d of days("2026-09-01", "2026-09-30")) for (let i = 0; i < 35; i++) t.toast_sales_events.push({ id: `tse-${String(++n).padStart(5, "0")}`, location_id: LOC, business_date: d });
    for (const d of days("2026-10-01", "2026-10-13")) t.toast_sales_events.push({ id: `tse-${String(++n).padStart(5, "0")}`, location_id: LOC, business_date: d });
    t.toast_daily_depletion = [];
    let m = 0;
    for (const d of days("2026-09-01", "2026-10-13")) {
      if (d === "2026-10-12") continue; // the gap
      for (const sku of ["s-turkey", "s-lettuce"]) t.toast_daily_depletion.push({ id: `tdd-${String(++m).padStart(4, "0")}`, location_id: LOC, business_date: d, sku_id: sku, direct_oz: 1, flattened_oz: 0 });
    }
    expect(t.toast_sales_events.length).toBeGreaterThan(1000);
    return t;
  };

  it("a gap the par tier's own (October) probe found is still found — its on-hand stays advisory-null", async () => {
    current = createFakeDb(tables());
    const old = plain(await v0.v0OnHandCore(LOC, NOW, { seedBaselines: false }));
    current = createFakeDb(tables());
    const neu = plain(await counts.deriveOnHand(LOC, NOW));
    expect(row(old, "s-lettuce").onHandOz).toBeNull(); // the pre-B9 per-tier probe saw the gap
    expect(row(neu, "s-lettuce")).toEqual(row(old, "s-lettuce"));
  });

  it("the census tier, whose window also spans the gap, is advisory-null too (the old capped census probe missed it)", async () => {
    current = createFakeDb(tables());
    const neu = plain(await counts.deriveOnHand(LOC, NOW));
    expect(row(neu, "s-turkey").onHandOz).toBeNull();
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
