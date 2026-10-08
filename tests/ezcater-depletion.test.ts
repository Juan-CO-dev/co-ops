import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { reconciledToastOrders } from "@/lib/ezcater/depletion-shared";
import type { CapturedToastDay, CapturedToastOrder } from "@/lib/toast/captured-day";
import { buildRecipeGraph } from "@/lib/prep-consumption-graph";
import { itemIdentity } from "@/lib/ezcater/pass2-shared";
import { loadReconciledSalesWindow } from "@/lib/ezcater/depletion";
import { loadEffectiveSalesWindow } from "@/lib/toast/effective-depletion";
import type { getServiceRoleClient } from "@/lib/supabase-server";

const mocks = vi.hoisted(() => ({ day: vi.fn(), graph: vi.fn(), derive: vi.fn() }));
vi.mock("@/lib/toast/captured-day", () => ({ loadCapturedToastDay: mocks.day }));
vi.mock("@/lib/prep-consumption", () => ({ loadRecipeGraph: mocks.graph }));
vi.mock("@/lib/catering/toast-sales", () => ({ deriveCapturedSalesConsumption: mocks.derive }));
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let queries: string[];
const db = () => ({ from(table: string) {
  queries.push(table);
  let rows = [...(tables[table] ?? [])];
  const query = {
    select: () => query,
    eq: (field: string, value: unknown) => { rows = rows.filter((r) => r[field] === value); return query; },
    not: (field: string, _op: string, value: unknown) => { rows = rows.filter((r) => r[field] !== value); return query; },
    is: (field: string, value: unknown) => { rows = rows.filter((r) => (r[field] ?? null) === value); return query; },
    in: (field: string, values: unknown[]) => { rows = rows.filter((r) => values.includes(r[field])); return query; },
    gte: (field: string, value: string) => { rows = rows.filter((r) => String(r[field]) >= value); return query; },
    lt: (field: string, value: string) => { rows = rows.filter((r) => String(r[field]) < value); return query; },
    order: () => query,
    range: (from: number, to: number) => { rows = rows.slice(from, to + 1); return query; },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: rows, error: null })),
  };
  return query;
} }) as unknown as ReturnType<typeof getServiceRoleClient>;
const window = { locationId: "shop", fromDate: "2026-10-06", untilDateExclusive: "2026-10-07" };
const item = { ordinal: 0, provider_item_uuid: "line", menu_item_size_id: "size", pos_item_id: null, name: "Food", quantity: 3, options: [] };
const ring = { snapshotId: "snap", orderGuid: "toast", diningOption: "Ezcater", salesChannel: "catering", deleted: false, voided: false, excessFood: false,
  checks: [{ checkGuid: "check", deleted: false, voided: false, amountCents: 100 }],
  selections: [{ check_guid: "check", selection_guid: "base", quantity: 4 },
    { check_guid: "check", selection_guid: "modifier", parent_selection_guid: "base", quantity: 2 }],
} as CapturedToastOrder;
const link = { location_id: "shop", business_date: "2026-10-06", toast_snapshot_id: "snap", toast_order_guid: "toast", check_guid: "check" };
beforeEach(() => {
  vi.stubEnv("DEPLETION_SOURCE", "capture");
  vi.stubEnv("EZCATER_DEPLETION_ENABLED", "");
  queries = [];
  tables = {
    locations: [{ id: "shop", active: true, toast_restaurant_guid: "restaurant" }],
    ezcater_orders: [{ id: "ez", snapshot_id: "ezsnap", lead_id: "lead", location_id: "shop", event_date: "2026-10-06", status: "accepted" }],
    catering_pipeline: [{ id: "lead", location_id: "shop", stage: "confirmed", lead_source: "ezcater" }],
    ezcater_order_items: [{ ...item, order_id: "ez", snapshot_id: "ezsnap", is_current: true }],
    ezcater_item_map: [{ location_id: "shop", identity_key: itemIdentity(item), status: "confirmed", evidence: "reviewed_direct", item_id: "prep", menu_item_id: null, package_id: null }],
    ezcater_current_toast_links: [link], productions: [], audit_log: [],
  };
  mocks.graph.mockResolvedValue(buildRecipeGraph([{ recipeId: "recipe", batchYield: 1,
    inputs: [{ componentSkuId: "sku", componentItemId: null, quantity: 4, unit: "oz" }],
    outputs: [{ outputItemId: "prep", outputMenuItemId: null, yield: 1, ozPerParUnit: null }],
  }], new Map([["sku", { packFormat: null, eachContainerLabel: null, unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: null }]]), new Map([["oz", { dimension: "weight", toBaseFactor: 1 }]])));
  mocks.day.mockResolvedValue({ coverage: { runId: "run", finishedAt: "2026-10-07T06:00:00Z" }, orders: [ring] });
  mocks.derive.mockImplementation(async (_location, _date, day: CapturedToastDay, links) => {
    const orders = reconciledToastOrders(day.orders, links);
    const oz = orders.filter((o) => o.salesChannel !== "catering").flatMap((o) => o.selections).reduce((sum, s) => sum + s.quantity, 0);
    return { skuConsumed: [{ skuId: "sku", directOz: oz, flattenedOz: 0 }], prepConsumed: [], unmappedToastItems: [], packageIssues: [],
      modifierStats: { portionNeeded: [] }, suspectedCatering: [], captureRunId: "run", configDegraded: false, missingPointerCount: 0 };
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("ezCater authoritative depletion", () => {
  it("excludes the linked whole check including modifiers; keeps other checks and stale snapshots", () => {
    const another = { ...ring.selections[0]!, check_guid: "other", selection_guid: "other" };
    expect(reconciledToastOrders([{ ...ring, selections: [...ring.selections, another] }], [link])[0]!.selections).toEqual([another]);
    expect(reconciledToastOrders([ring], [{ ...link, toast_snapshot_id: "old" }])[0]!.selections).toHaveLength(2);
    expect(ring.selections).toHaveLength(2);
  });
  it("uses reviewed_direct without Toast mapping; linked Toast contributes no additional depletion", async () => {
    const result = await loadReconciledSalesWindow(db(), window);
    expect(result.rows[0]!.direct_oz).toBe(12);
    expect(result.rows[0]!.flattened_oz).toBe(12);
    expect(queries).not.toContain("ezcater_shadow_depletion");
    expect(queries).not.toContain("toast_capture_daily_depletion");
    expect(await loadReconciledSalesWindow(db(), window)).toEqual(result);
  });
  it("counts unlinked Ezcater rings and immediately removes their entire quantity on a late link", async () => {
    tables.ezcater_current_toast_links = [];
    expect((await loadReconciledSalesWindow(db(), window)).rows[0]!.direct_oz).toBe(18);
    tables.ezcater_current_toast_links = [link];
    expect((await loadReconciledSalesWindow(db(), window)).rows[0]!.direct_oz).toBe(12);
  });
  it.each(["Ezcater", "EZ Cater", "ez-cater"])("retains an unlinked %s dining ring regardless of catering channel", (diningOption) => {
    expect(reconciledToastOrders([{ ...ring, diningOption }], [])[0]!.salesChannel).toBeNull();
    expect(reconciledToastOrders([{ ...ring, diningOption }], [])[0]!.selections).toHaveLength(2);
  });
  it("reads live D-1 prep and former-shop evidence; revocation restores fallback without a rebuild", async () => {
    tables.audit_log = [{ resource_table: "catering_pipeline", resource_id: "lead", action: "ezcater.location_reassigned", occurred_at: "2026-10-06T10:00:00Z", metadata: { from_location_id: "old", to_location_id: "shop" } }];
    const production = { location_id: "old", output_item_id: "prep", produced_at: "2026-10-05T20:00:00Z", revoked_at: null };
    tables.productions = [production];
    expect((await loadReconciledSalesWindow(db(), window)).rows[0]!.direct_oz).toBe(0);
    tables.productions = [{ ...production, revoked_at: "2026-10-07T00:00:00Z" }];
    expect((await loadReconciledSalesWindow(db(), window)).rows[0]!.direct_oz).toBe(12);
  });
  it("counts ez orders during a Toast capture gap and discloses the gap", async () => {
    mocks.day.mockResolvedValue(null);
    const result = await loadReconciledSalesWindow(db(), window);
    expect(result.rows[0]!.direct_oz).toBe(12);
    expect(result.coverage.hasGaps).toBe(true);
  });
  it("discloses unresolved ez items as degraded without restoring linked Toast depletion", async () => {
    tables.ezcater_item_map = [];
    const result = await loadReconciledSalesWindow(db(), window);
    expect(result.rows[0]!.direct_oz).toBe(0);
    expect(result.coverage.degraded).toBe(true);
    expect(result.coverage.byLocation.shop!.degradedDates).toEqual(["2026-10-06"]);
  });
  it("routes the enabled flag to live reconciliation and refuses legacy capture absence", async () => {
    vi.stubEnv("EZCATER_DEPLETION_ENABLED", "1");
    expect((await loadEffectiveSalesWindow(db(), window)).rows[0]!.direct_oz).toBe(12);
    vi.stubEnv("DEPLETION_SOURCE", "legacy");
    await expect(loadEffectiveSalesWindow(db(), window)).rejects.toThrow("ezcater_depletion_requires_capture");
  });
  it("permits shadow comparisons with the operational flag OFF", async () => {
    expect((await loadReconciledSalesWindow(db(), window, { includeEzcater: false })).rows[0]!.direct_oz).toBe(0);
  });
});
