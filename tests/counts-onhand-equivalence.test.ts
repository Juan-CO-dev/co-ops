/**
 * B9 PROOF — the Counts page (and the ordering walk's shared core) got FAST WITHOUT
 * CHANGING ANY NUMBER.
 *
 * OLD = tests/fixtures/counts-v0-oracle.ts, a frozen verbatim copy of the read path on
 * origin/main b2770c0d. NEW = the live lib/counts.ts. Both run over identical copies of one
 * in-memory database (tests/fixtures/counts-fake-db.ts) under all three sales sources —
 * the legacy materialized ledger, the raw Toast capture, and the ezCater-reconciled
 * capture (production's path) — and every output must be deep-equal: the catalog, the
 * on-hand panel (census weight + count rows, par estimates, inferred baselines, products,
 * prep waste, coverage disclosure, watermark), the read-only digest read, and the walk's
 * seeding read INCLUDING the baseline rows it writes.
 *
 * Then the budget: one page render (catalog + on-hand, shared refs) stays inside a fixed
 * round-trip budget, loads the effective sales window ONCE, and extra anchor GROUPS (par
 * walks, count sessions, inferred instants) cost ZERO extra round trips.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildCountsFixture, buildReconciledModel, LOC, NOW, type FixtureScale } from "./fixtures/counts-onhand-fixture";
import { loadSalesCoverageDisclosure, type EffectiveSalesWindow } from "@/lib/toast/effective-depletion";
import type { getServiceRoleClient } from "@/lib/supabase-server";
import type { AuthContext } from "@/lib/session";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));

const reconciledCalls: Array<{ fromDate: string; untilDateExclusive?: string | null; skuIds?: string[] }> = [];
const model = buildReconciledModel();
vi.mock("@/lib/ezcater/depletion", () => ({
  loadReconciledSalesWindow: vi.fn(async (sb: ReturnType<typeof getServiceRoleClient>, window: { locationId?: string; fromDate: string; untilDateExclusive?: string | null; skuIds?: string[] }): Promise<EffectiveSalesWindow> => {
    reconciledCalls.push({ fromDate: window.fromDate, untilDateExclusive: window.untilDateExclusive, skuIds: window.skuIds });
    // Mirrors lib/ezcater/depletion.ts's own post-processing: per-day rows + manifests,
    // the disclosure over the manifests, then unresolved days degrade their date.
    const end = window.untilDateExclusive ?? new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const rows: EffectiveSalesWindow["rows"] = [];
    const manifests: Array<Record<string, unknown>> = [];
    for (const [date, day] of [...model.days].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (date < window.fromDate || date >= end) continue;
      for (const r of day.rows) {
        if (window.skuIds && !window.skuIds.includes(r.sku_id)) continue;
        rows.push({ location_id: LOC, business_date: date, ...r });
      }
      manifests.push({ location_id: LOC, business_date: date, run_id: `r-${date}`, status: day.status, computed_at: `${date}T23:00:00Z`,
        aggregate_count: 0, attribution_count: 0, suspect_check_count: 0, suspect_qty: 0, counted_qty: 0 });
    }
    const coverage = await loadSalesCoverageDisclosure(sb, { ...window, untilDateExclusive: end },
      manifests as unknown as Parameters<typeof loadSalesCoverageDisclosure>[2], true);
    for (const date of model.unresolved) {
      if (date < window.fromDate || date >= end) continue;
      const disclosure = coverage.byLocation[LOC];
      if (disclosure) { disclosure.degraded = true; if (!disclosure.degradedDates.includes(date)) disclosure.degradedDates.push(date); }
      coverage.degraded = true;
    }
    return { rows, coverage };
  }),
}));

const counts = await import("@/lib/counts");
const v0 = await import("./fixtures/counts-v0-oracle");

const actor = {
  user: { id: "u-owner", role: "owner", language: "en", name: "Owner", email: "o@x", active: true },
  role: "owner", level: 10, locations: [LOC],
} as unknown as AuthContext;

type Mode = "legacy" | "capture" | "reconciled";
function setMode(mode: Mode) {
  vi.unstubAllEnvs();
  if (mode !== "legacy") vi.stubEnv("DEPLETION_SOURCE", "capture");
  if (mode === "reconciled") vi.stubEnv("EZCATER_DEPLETION_ENABLED", "1");
}
function install(scale: FixtureScale = {}) {
  current = createFakeDb(buildCountsFixture(scale));
  reconciledCalls.length = 0;
  return current;
}
/** Run `fn` against a fresh copy of the fixture; return its output, the writes, and the trip count. */
async function measure<T>(scale: FixtureScale, fn: () => Promise<T>) {
  const db = install(scale);
  const out = await fn();
  return { out, writes: db.writes, trips: db.log.length, log: db.log, reconciled: reconciledCalls.length };
}
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v, (_k, val) => (val instanceof Map ? [...val] : val instanceof Set ? [...val] : val)));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  current = null;
});

const MODES: Mode[] = ["legacy", "capture", "reconciled"];
const SCALES: Array<[string, FixtureScale]> = [["base", {}], ["scaled", { parWalks: 4, countSessions: 5, baselineInstants: 3 }]];

describe.each(MODES)("OLD ≡ NEW over the same database — %s sales source", (mode) => {
  beforeEach(() => setMode(mode));

  it.each(SCALES)("the counts panel (loadOnHand: products + prep waste) is identical — %s", async (_label, scale) => {
    const old = await measure(scale, async () => {
      const view = await v0.v0OnHandCore(LOC, NOW, { withProducts: true, seedBaselines: false });
      return { ...view, prepWaste: await v0.v0LoadPrepWasteRows(current!.client, LOC) };
    });
    const neu = await measure(scale, () => counts.loadOnHand(actor, LOC, NOW));
    expect(plain(neu.out)).toEqual(plain(old.out));
    expect(neu.writes).toEqual([]);
    expect(old.writes).toEqual([]);
    // Non-vacuous: every tier and both dimensions are present and carry real numbers.
    const sources = new Set(neu.out.rows.map((r) => `${r.dimension === "count" ? "census" : r.anchorSource}:${r.dimension}`));
    expect([...sources].sort()).toEqual(["census:count", "census:weight", "inferred:weight", "par_estimate:weight"]);
    expect(neu.out.rows.some((r) => r.dimension === "weight" && r.varianceOz != null)).toBe(true);
    expect(neu.out.rows.some((r) => r.dimension === "count" && r.usedOrLostUnits != null)).toBe(true);
    expect(neu.out.rows.some((r) => r.anchorStale)).toBe(true);
    expect(neu.out.products.length).toBeGreaterThan(0);
  });

  it.each(SCALES)("the catalog (count sheet SKUs + product rows) is identical — %s", async (_label, scale) => {
    const old = await measure(scale, () => v0.v0LoadCountCatalog(LOC));
    const neu = await measure(scale, () => counts.loadCountReferenceData(actor, LOC));
    expect(plain(neu.out)).toEqual(plain(old.out));
    expect(neu.out.products.length).toBeGreaterThan(0);
  });

  it.each(SCALES)("the walk's seeding read is identical, including the baselines it writes — %s", async (_label, scale) => {
    const old = await measure(scale, () => v0.v0OnHandCore(LOC, NOW, {}));
    const neu = await measure(scale, () => counts.loadOnHandDerived(actor, LOC, NOW));
    expect(plain(neu.out)).toEqual(plain(old.out));
    // The upsert is a SET (ON CONFLICT DO NOTHING per row): compare it as one. Its row order
    // followed an unordered roster read before B9 and the sheet's name-ordered one after.
    const asSet = (w: typeof old.writes) => w.map((x) => ({ table: x.table, rows: [...x.rows].sort((a, b) => String(a.sku_id).localeCompare(String(b.sku_id))) }));
    expect(asSet(neu.writes)).toEqual(asSet(old.writes));
    expect(old.writes.length).toBe(1); // a real upsert happened, so the comparison is not vacuous
    expect(old.writes[0]!.rows.length).toBeGreaterThanOrEqual(3);
  });

  it("the actor-less digest read is identical — and the read-only path writes nothing", async () => {
    const old = await measure({}, () => v0.v0OnHandCore(LOC, NOW, { withProducts: false, seedBaselines: false }));
    const neu = await measure({}, () => counts.deriveOnHand(LOC, NOW));
    expect(plain(neu.out)).toEqual(plain(old.out));
    expect(neu.writes).toEqual([]);
  });

  it.each([
    ["never counted (cold start)", (t: ReturnType<typeof buildCountsFixture>) => { t.sku_count_events = t.sku_count_events!.filter((e) => e.location_id !== LOC); }],
    ["counted, but no line resolves to an anchor", (t: ReturnType<typeof buildCountsFixture>) => { t.sku_count_lines = []; }],
    ["no sales ledger, no deliveries, no production", (t: ReturnType<typeof buildCountsFixture>) => {
      for (const k of ["toast_daily_depletion", "toast_capture_daily_depletion", "toast_sales_events", "toast_capture_runs", "toast_depletion_day_coverage", "vendor_deliveries", "vendor_delivery_items", "productions", "production_inputs"]) t[k] = [];
    }],
  ])("an edge shop — %s — is identical", async (_label, edit) => {
    const tables = () => { const t = buildCountsFixture(); edit(t); return t; };
    current = createFakeDb(tables());
    const oldView = await v0.v0OnHandCore(LOC, NOW, { withProducts: true, seedBaselines: false });
    const old = plain({ ...oldView, prepWaste: await v0.v0LoadPrepWasteRows(current.client, LOC) });
    current = createFakeDb(tables());
    const neu = plain(await counts.loadOnHand(actor, LOC, NOW));
    expect(neu).toEqual(old);
  });
});

// ── The budget ──────────────────────────────────────────────────────────────────────
const tally = (log: Array<{ table: string }>, table: string) => log.filter((q) => q.table === table).length;
const v0Panel = async () => {
  const view = await v0.v0OnHandCore(LOC, NOW, { withProducts: true, seedBaselines: false });
  return { ...view, prepWaste: await v0.v0LoadPrepWasteRows(current!.client, LOC) };
};

describe("B9 step 1 — ONE effective-sales read per render", () => {
  it("the ezCater-reconciled source (production's path) is derived once, not once per consumer", async () => {
    setMode("reconciled");
    const old = await measure({}, v0Panel);
    const neu = await measure({}, () => counts.loadOnHand(actor, LOC, NOW));
    expect(old.reconciled).toBeGreaterThanOrEqual(5); // watermark, disclosure, three gap reads, the 28-day lane
    expect(neu.reconciled).toBe(1);
    const scaled = await measure({ parWalks: 6, countSessions: 6, baselineInstants: 6 }, () => counts.loadOnHand(actor, LOC, NOW));
    expect(scaled.reconciled).toBe(1);
  });

  it("the raw capture source reads its depletion aggregates once", async () => {
    setMode("capture");
    const neu = await measure({ parWalks: 3, countSessions: 3 }, () => counts.loadOnHand(actor, LOC, NOW));
    expect(tally(neu.log, "toast_capture_daily_depletion")).toBe(1);
    expect(tally(neu.log, "toast_depletion_item_attribution")).toBe(1);
  });

  it("the legacy ledger is read once for amounts, once for the gap probe, once for the watermark", async () => {
    setMode("legacy");
    const old = await measure({ parWalks: 3, countSessions: 3 }, v0Panel);
    const neu = await measure({ parWalks: 3, countSessions: 3 }, () => counts.loadOnHand(actor, LOC, NOW));
    expect(tally(old.log, "toast_daily_depletion")).toBeGreaterThan(10);
    expect(tally(neu.log, "toast_daily_depletion")).toBe(3);
    expect(tally(neu.log, "toast_sales_events")).toBe(1);
  });
});

describe("B9 step 2 — each ledger read once, whatever the number of anchor groups", () => {
  it.each(MODES)("deliveries, receipt lines, production inputs cost the same at 1 group or 17 — %s", async (mode) => {
    setMode(mode);
    const base = await measure({}, () => counts.loadOnHand(actor, LOC, NOW));
    const scaled = await measure({ parWalks: 8, baselineInstants: 8 }, () => counts.loadOnHand(actor, LOC, NOW));
    const old = await measure({ parWalks: 8, baselineInstants: 8 }, v0Panel);
    expect(tally(base.log, "production_inputs")).toBe(1);
    expect(tally(scaled.log, "production_inputs")).toBe(1);
    for (const table of ["vendor_deliveries", "vendor_delivery_items", "productions"]) {
      expect(tally(scaled.log, table)).toBe(tally(base.log, table));
    }
    expect(tally(old.log, "vendor_deliveries")).toBeGreaterThan(20); // the per-group re-reads this replaced
  });
});

describe("B9 step 3 — the count-dimension N+1 is one read", () => {
  it.each(MODES)("count-anchored (packaging) SKUs add no queries: one receipt-line read serves them all — %s", async (mode) => {
    setMode(mode);
    const base = await measure({}, () => counts.loadOnHand(actor, LOC, NOW));
    const scaled = await measure({ countSessions: 12, parWalks: 4, baselineInstants: 4 }, () => counts.loadOnHand(actor, LOC, NOW));
    const old = await measure({ countSessions: 12 }, v0Panel);
    expect(scaled.out.rows.filter((r) => r.dimension === "count").length).toBeGreaterThanOrEqual(8);
    expect(tally(base.log, "vendor_deliveries")).toBe(1);
    expect(tally(scaled.log, "vendor_deliveries")).toBe(1);
    expect(scaled.trips).toBe(base.trips);
    expect(tally(old.log, "vendor_delivery_items")).toBeGreaterThan(tally(scaled.log, "vendor_delivery_items") + 10);
  });
});

const pageRender = async () => {
  const refs = counts.createCountsReadRefs();
  return Promise.all([counts.loadCountReferenceData(actor, LOC, refs), counts.loadOnHand(actor, LOC, NOW, refs)]);
};
const v0PageRender = () => Promise.all([v0.v0LoadCountCatalog(LOC), v0Panel()]);
const byTable = (log: Array<{ table: string }>) => log.reduce<Record<string, number>>((m, q) => ((m[q.table] = (m[q.table] ?? 0) + 1), m), {});

describe("B9 step 4 — reference data read once per page render (sheet + panel share it)", () => {
  it.each(MODES)("one roster, one vendor list, one measure registry, one chain read, ONE product index — %s", async (mode) => {
    setMode(mode);
    await measure({}, pageRender); // warm the module-level 0180 probe (it caches only `true`)
    const neu = await measure({}, pageRender);
    const old = await measure({}, v0PageRender);
    const t = byTable(neu.log);
    expect(t.measure_units).toBe(1);
    expect(t.sku_pack_levels).toBe(1);
    expect(t.vendors).toBe(1);
    expect(t.products).toBe(1); // the product index: read once, resolved once (product-identity law)
    expect(t.product_primaries).toBe(1);
    expect(t.vendor_items).toBe(3); // roster + the index's member read + one off-roster census label read
    expect(t.vendor_delivery_items).toBe(3); // the receipt-line ledger, the index's receipt history, ONE lots read
    expect(byTable(old.log).products).toBe(2);
    expect(neu.trips).toBeLessThan(old.trips);
  });
});

describe("B9 step 5 — independent reads run together", () => {
  it.each(MODES)("a page render waits through ≤ 6 sequential round-trip waves (it was 25–45) — %s", async (mode) => {
    setMode(mode);
    await measure({}, pageRender); // warm the module-level 0180 probe
    for (const scale of [{}, { parWalks: 6, countSessions: 6, baselineInstants: 6 }] as FixtureScale[]) {
      const neu = createFakeDb(buildCountsFixture(scale), 1);
      current = neu;
      await pageRender();
      const old = createFakeDb(buildCountsFixture(scale), 1);
      current = old;
      await v0PageRender();
      expect(neu.stats.depth).toBeLessThanOrEqual(6);
      expect(old.stats.depth).toBeGreaterThanOrEqual(25);
    }
  });

  it.each(MODES)("THE BUDGET: one page render ≤ 25 round trips on the ledger and reconciled sources (≤ 30 on raw capture), constant as anchor groups grow — %s", async (mode) => {
    setMode(mode);
    await measure({}, pageRender);
    const base = await measure({}, pageRender);
    const scaled = await measure({ parWalks: 10, countSessions: 10, baselineInstants: 10 }, pageRender);
    expect(base.trips).toBeLessThanOrEqual(mode === "capture" ? 30 : 25);
    expect(scaled.trips).toBe(base.trips);
    expect(scaled.reconciled).toBe(mode === "reconciled" ? 1 : 0);
  });
});
