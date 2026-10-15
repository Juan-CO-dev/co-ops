/**
 * B9 round 1 (Astra) — the counts render reads the ezCater-RECONCILED sales source ONCE over
 * the widest window any consumer needs and slices it (lib/counts-ledger-shared.ts). This runs
 * the REAL lib/ezcater/depletion.ts loadReconciledSalesWindow (only the Toast capture window,
 * the recipe graph and the per-day Toast derivation are stubbed — exactly as
 * tests/ezcater-depletion.test.ts does) over an in-memory database, once wide and once per
 * narrow window, and asserts every narrow read equals the wide read sliced.
 *
 * WHY IT HOLDS (lib/ezcater/depletion.ts at this commit):
 *  - orders and links are selected by event/business date inside [from, end) (:27-35) and
 *    every row is emitted on its own order's event_date or Toast day (:90-98, :162-163);
 *  - transfers are read from (from − 1) 00:00Z (:50-54), but productionLocations
 *    (pass2-shared.ts:51-60) ignores any transfer whose ET date is before eventDate − 1, and
 *    eventDate ≥ from — so a wider read only adds transfers that are ignored. (The one
 *    window-wide effect, :67-69's malformed-transfer refusal, sees the same rows as the old
 *    EARLIEST consumer's read, because B9's window starts at exactly that consumer's date.)
 *  - productions are read from (from − 2) 00:00Z to (end + 1) 00:00Z (:60-62) and used only
 *    for the event date and the day before it (pass2-shared.ts:66-67) or the Toast day itself
 *    (:93) — all inside the narrow read already, so a wider read adds only unused rows;
 *  - the Toast capture window is per business day (toast/captured-window.ts:28-111);
 *  - coverage is enumerated per date and unresolved days degrade their own date (:184-194).
 * The fixtures below put a transfer and a production exactly on those edges.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reconciledToastOrders } from "@/lib/ezcater/depletion-shared";
import type { CapturedToastDay, CapturedToastOrder } from "@/lib/toast/captured-day";
import { buildRecipeGraph } from "@/lib/prep-consumption-graph";
import { itemIdentity } from "@/lib/ezcater/pass2-shared";
import { loadReconciledSalesWindow } from "@/lib/ezcater/depletion";
import { sliceSalesCoverage } from "@/lib/counts-ledger-shared";
import { createFakeDb } from "./fixtures/counts-fake-db";

const mocks = vi.hoisted(() => ({ graph: vi.fn(), derive: vi.fn(), context: vi.fn(), window: vi.fn() }));
vi.mock("@/lib/toast/captured-window", () => ({ loadCapturedToastWindow: mocks.window }));
vi.mock("@/lib/prep-consumption", () => ({
  loadRecipeGraph: mocks.graph,
  // Catalog Phase 2a (D1): no pack boundary inside the window — every date reuses the live graph.
  createDatedGraphs: (opts: { locationId: string | null; liveGraph?: unknown }) => async () =>
    opts.liveGraph ?? mocks.graph({ locationId: opts.locationId }),
}));
vi.mock("@/lib/catering/toast-sales", () => ({ deriveCapturedSalesConsumption: mocks.derive, loadSalesConsumptionContext: mocks.context }));

const SHOP = "shop";
const mapped = { ordinal: 0, provider_item_uuid: "line", menu_item_size_id: "size", pos_item_id: null, name: "Box lunch", quantity: 3, options: [] };
const unmapped = { ...mapped, provider_item_uuid: "mystery", menu_item_size_id: "mystery-size", name: "Mystery" };
const ring = (date: string): CapturedToastOrder => ({
  snapshotId: `snap-${date}`, orderGuid: `toast-${date}`, diningOption: "Ezcater", salesChannel: "catering", deleted: false, voided: false, excessFood: false,
  checks: [{ checkGuid: `check-${date}`, deleted: false, voided: false, amountCents: 100 }],
  selections: [{ check_guid: `check-${date}`, selection_guid: `base-${date}`, quantity: Number(date.slice(-2)) }],
} as unknown as CapturedToastOrder);

function tables() {
  const order = (id: string, lead: string, event_date: string, status = "accepted") => ({ id, snapshot_id: `s-${id}`, lead_id: lead, location_id: SHOP, event_date, status });
  const items = (id: string, item = mapped) => ({ ...item, order_id: id, snapshot_id: `s-${id}`, is_current: true });
  const transfer = (lead: string, occurred_at: string, from: string) => ({
    id: `a-${lead}-${occurred_at}`, resource_table: "catering_pipeline", resource_id: lead, action: "ezcater.location_reassigned", occurred_at,
    metadata: { from_location_id: from, to_location_id: SHOP },
  });
  const prod = (id: string, location_id: string, produced_at: string) => ({ id, location_id, output_item_id: "prep", produced_at, revoked_at: null, superseded_at: null });
  return {
    locations: [{ id: SHOP, active: true, toast_restaurant_guid: "g" }],
    ezcater_orders: [
      order("o0", "L1", "2026-09-28"), order("o1", "L1", "2026-10-02"), order("o2", "L2", "2026-10-04"), order("o3", "L3", "2026-10-06"),
      order("o4", "L1", "2026-10-08"), order("o5", "L4", "2026-10-09", "cancelled"), order("o6", "L2", "2026-10-09"),
    ],
    ezcater_order_items: [items("o0"), items("o1"), items("o2"), items("o3", unmapped), items("o4"), items("o5"), items("o6")],
    catering_pipeline: ["L1", "L2", "L3", "L4"].map((id) => ({ id, location_id: SHOP, stage: "confirmed", lead_source: "ezcater" })),
    ezcater_item_map: [{ location_id: SHOP, identity_key: itemIdentity(mapped), status: "confirmed", evidence: "reviewed_direct", item_id: "prep", menu_item_id: null, package_id: null }],
    toast_menu_map: [],
    ezcater_current_toast_links: [{ location_id: SHOP, business_date: "2026-10-03", toast_snapshot_id: "snap-2026-10-03", toast_order_guid: "toast-2026-10-03", check_guid: "check-2026-10-03" }],
    audit_log: [
      // L1: moved in from "old" at 23:00 ET Oct 1 → its Oct 2 order counts prep made at "old" on Oct 1.
      transfer("L1", "2026-10-02T03:00:00Z", "old"),
      // L2: a move inside a WIDE read (UTC Sep 30) whose ET date (Sep 29) is before the Oct 4
      // order's cutoff (Oct 3) — ignored by both reads; and one on Oct 3 that both honour.
      transfer("L2", "2026-09-30T02:00:00Z", "ancient"),
      transfer("L2", "2026-10-03T14:00:00Z", "other"),
    ],
    productions: [
      prod("p1", "old", "2026-10-01T18:00:00Z"),      // D-1 of o1 at its former shop → suppresses o1
      prod("p2", "ancient", "2026-10-03T18:00:00Z"),  // the ignored transfer's shop → must NOT suppress o2
      prod("p3", "shop", "2026-10-08T03:30:00Z"),     // ET Oct 7 = D-1 of o4 → suppresses o4
      prod("p4", "shop", "2026-10-05T12:00:00Z"),     // a Toast day's own production
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mocks.graph.mockResolvedValue(buildRecipeGraph([{ recipeId: "recipe", batchYield: 1,
    inputs: [{ componentSkuId: "sku", componentItemId: null, quantity: 4, unit: "oz" }],
    outputs: [{ outputItemId: "prep", outputMenuItemId: null, yield: 1, ozPerParUnit: null }],
  }], new Map([["sku", { packFormat: null, eachContainerLabel: null, unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: null }]]),
  new Map([["oz", { dimension: "weight", toBaseFactor: 1 }]])));
  // The real context always carries graphFor (D1); with no pack boundary it answers the live graph.
  mocks.context.mockImplementation(async (locationId: string, graph: unknown) => ({ locationId, graph, graphFor: async () => graph }));
  // The Toast capture window: one day per business date, a capture GAP on Oct 7.
  mocks.window.mockImplementation(async (_sb: unknown, _loc: string, fromDate: string, end: string) => {
    const days = new Map<string, CapturedToastDay>();
    for (let date = fromDate; date < end;) {
      if (date !== "2026-10-07") days.set(date, { coverage: { runId: `run-${date}`, finishedAt: `${date}T23:00:00Z` }, orders: [ring(date)] } as unknown as CapturedToastDay);
      const next = new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1); date = next.toISOString().slice(0, 10);
    }
    return days;
  });
  mocks.derive.mockImplementation(async (_loc: string, date: string, day: CapturedToastDay, links: unknown[]) => {
    const orders = reconciledToastOrders(day.orders, links as never);
    const oz = orders.flatMap((o) => o.selections).reduce((sum, s) => sum + s.quantity, 0);
    return { skuConsumed: [{ skuId: "sku", directOz: oz, flattenedOz: 0 }, { skuId: "sku-b", directOz: 1, flattenedOz: 0 }],
      prepConsumed: [], unmappedToastItems: [], packageIssues: [],
      modifierStats: { portionNeeded: [] }, suspectedCatering: [], captureRunId: `run-${date}`, configDegraded: date === "2026-10-05", missingPointerCount: 0 };
  });
});

const WIDE = { fromDate: "2026-10-01", untilDateExclusive: "2026-10-10" };
const NARROW: Array<[string, string]> = [
  ["2026-10-01", "2026-10-02"], ["2026-10-02", "2026-10-03"], ["2026-10-03", "2026-10-05"], ["2026-10-04", "2026-10-06"],
  ["2026-10-06", "2026-10-09"], ["2026-10-08", "2026-10-10"], ["2026-10-05", "2026-10-10"], ["2026-10-01", "2026-10-10"],
];

describe("the REAL reconciled loader: one wide read, sliced ≡ each narrow read", () => {
  it("is non-vacuous: suppressions at a former shop, an ignored old transfer, a capture gap, degraded days", async () => {
    const db = createFakeDb(tables());
    const wide = await loadReconciledSalesWindow(db.client, { locationId: SHOP, ...WIDE });
    const ez = (date: string) => wide.rows.find((r) => r.business_date === date && r.sku_id === "sku")!;
    expect(ez("2026-10-02").direct_oz).toBe(2);           // o1's 12 oz suppressed by p1 at "old"; Toast ring 2
    expect(ez("2026-10-04").direct_oz).toBe(4 + 12);      // p2 at "ancient" NOT honoured → o2 counts
    expect(ez("2026-10-08").direct_oz).toBe(8);           // o4 suppressed by p3 (D-1, ET)
    expect(ez("2026-10-03").direct_oz).toBe(0);           // the linked Toast check is excluded
    expect(wide.coverage.byLocation[SHOP]!.missingDates).toEqual(["2026-10-07"]);
    expect(wide.coverage.byLocation[SHOP]!.degradedDates).toEqual(expect.arrayContaining(["2026-10-05", "2026-10-06"]));
  });

  it.each(NARROW)("[%s, %s): rows and coverage equal the wide read sliced", async (from, until) => {
    const wide = await loadReconciledSalesWindow(createFakeDb(tables()).client, { locationId: SHOP, ...WIDE });
    const narrow = await loadReconciledSalesWindow(createFakeDb(tables()).client, { locationId: SHOP, fromDate: from, untilDateExclusive: until });
    expect(narrow.rows).toEqual(wide.rows.filter((r) => r.business_date >= from && r.business_date < until));
    expect(narrow.coverage).toEqual(sliceSalesCoverage(wide.coverage, from, until));
  });

  it("a SKU-filtered narrow read (the old per-group sums) equals the wide read filtered", async () => {
    const wide = await loadReconciledSalesWindow(createFakeDb(tables()).client, { locationId: SHOP, ...WIDE });
    const narrow = await loadReconciledSalesWindow(createFakeDb(tables()).client, { locationId: SHOP, fromDate: "2026-10-03", untilDateExclusive: "2026-10-09", skuIds: ["sku"] });
    expect(narrow.rows).toEqual(wide.rows.filter((r) => r.sku_id === "sku" && r.business_date >= "2026-10-03" && r.business_date < "2026-10-09"));
  });
});
