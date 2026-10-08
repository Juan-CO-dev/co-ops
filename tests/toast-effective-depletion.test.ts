import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEffectiveSalesCoverage, loadEffectiveSalesRows } from "@/lib/toast/effective-depletion";
import type { getServiceRoleClient } from "@/lib/supabase-server";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let queried: string[];
let onRead: ((table: string) => void) | undefined;
const db = () => ({ from(table: string) {
  queried.push(table);
  let rows = [...(tables[table] ?? [])];
  const query = {
    select: () => query,
    eq: (field: string, value: unknown) => { rows = rows.filter((r) => r[field] === value); return query; },
    is: (field: string, value: unknown) => { rows = rows.filter((r) => (r[field] ?? null) === value); return query; },
    in: (field: string, values: unknown[]) => { rows = rows.filter((r) => values.includes(r[field])); return query; },
    gte: (field: string, value: string) => { rows = rows.filter((r) => String(r[field]) >= value); return query; },
    lt: (field: string, value: string) => { rows = rows.filter((r) => String(r[field]) < value); return query; },
    order: () => query,
    range: (from: number, to: number) => { rows = rows.slice(from, to + 1); return query; },
    returns: async () => { onRead?.(table); return { data: rows, error: null }; },
  };
  return query;
} }) as unknown as ReturnType<typeof getServiceRoleClient>;
const window = { locationId: "shop", fromDate: "2026-10-06", untilDateExclusive: "2026-10-07" };
const day = { location_id: "shop", business_date: "2026-10-06" };
beforeEach(() => {
  vi.stubEnv("DEPLETION_SOURCE", "capture");
  queried = [];
  onRead = undefined;
  tables = {
    toast_capture_runs: [{ ...day, id: "run1", status: "completed", finished_at: "2026-10-07T05:00:00Z" }],
    toast_depletion_day_coverage: [{ ...day, run_id: "run1", status: "success", computed_at: "2026-10-07T05:01:00Z", aggregate_count: 1, attribution_count: 1 }],
    toast_capture_daily_depletion: [{ ...day, sku_id: "sku", direct_oz: 2, flattened_oz: 10 }],
    toast_depletion_item_attribution: [{ ...day, item_id: "parent", item_path: ["parent", "child"], sku_id: "sku", sales_oz: 10 }],
    productions: [],
  };
});
afterEach(() => vi.unstubAllEnvs());

describe("effective capture depletion", () => {
  it("counts direct sales plus prep fallback before production exists", async () => {
    expect(await loadEffectiveSalesRows(db(), window)).toEqual([{ ...day, sku_id: "sku", direct_oz: 12, flattened_oz: 10 }]);
  });

  it.each(["parent", "child"])("production of %s suppresses its entire item/day path after materialization", async (output_item_id) => {
    expect((await loadEffectiveSalesRows(db(), window))[0]?.direct_oz).toBe(12);
    tables.productions!.push({ location_id: "shop", output_item_id, produced_at: "2026-10-07T03:59:00Z" });
    expect((await loadEffectiveSalesRows(db(), window))[0]?.direct_oz).toBe(2);
  });

  it("keeps fallback for production at the other shop or on the next ET date", async () => {
    tables.productions!.push(
      { location_id: "other", output_item_id: "parent", produced_at: "2026-10-06T18:00:00Z" },
      { location_id: "shop", output_item_id: "parent", produced_at: "2026-10-07T04:00:00Z" },
    );
    expect((await loadEffectiveSalesRows(db(), window))[0]?.direct_oz).toBe(12);
  });

  it("revoking or superseding production restores fallback without rebuilding sales", async () => {
    tables.productions!.push(
      { location_id: "shop", output_item_id: "parent", produced_at: "2026-10-06T18:00:00Z", revoked_at: "later" },
      { location_id: "shop", output_item_id: "child", produced_at: "2026-10-06T18:00:00Z", superseded_at: "later" },
    );
    expect((await loadEffectiveSalesRows(db(), window))[0]?.direct_oz).toBe(12);
  });

  it("does not suppress an independent path to the same SKU", async () => {
    tables.toast_depletion_day_coverage![0]!.attribution_count = 2;
    tables.toast_depletion_item_attribution!.push({ ...day, item_id: "other-prep", item_path: ["other-prep"], sku_id: "sku", sales_oz: 7 });
    tables.productions!.push({ location_id: "shop", output_item_id: "child", produced_at: "2026-10-06T18:00:00Z" });
    expect((await loadEffectiveSalesRows(db(), window))[0]?.direct_oz).toBe(9);
  });

  it("recognizes successfully materialized empty days as coverage", async () => {
    tables.toast_depletion_day_coverage![0]!.aggregate_count = 0;
    tables.toast_depletion_day_coverage![0]!.attribution_count = 0;
    tables.toast_capture_daily_depletion = [];
    tables.toast_depletion_item_attribution = [];
    expect(await loadEffectiveSalesRows(db(), window)).toEqual([]);
    expect(await loadEffectiveSalesCoverage(db(), window)).toMatchObject([{ ...day, run_id: "run1", status: "success" }]);
  });

  it("a newer completed capture invalidates the old manifest until replacement succeeds", async () => {
    tables.toast_capture_runs!.push({ ...day, id: "run2", status: "completed", finished_at: "2026-10-07T06:00:00Z" });
    expect(await loadEffectiveSalesCoverage(db(), window)).toEqual([]);
    await expect(loadEffectiveSalesRows(db(), window)).rejects.toThrow("capture_depletion_coverage_gap");
  });

  it("a running or failed retry does not invalidate a completed authoritative snapshot", async () => {
    tables.toast_capture_runs!.push({ ...day, id: "run2", status: "failed", finished_at: "2026-10-07T06:00:00Z" });
    expect(await loadEffectiveSalesCoverage(db(), window)).toHaveLength(1);
  });

  it("malformed quantities fail closed rather than becoming zero consumption", async () => {
    tables.toast_depletion_item_attribution![0]!.sales_oz = "not a quantity";
    await expect(loadEffectiveSalesRows(db(), window)).rejects.toThrow("capture_depletion_invalid_quantity");
  });

  it("a same-run replacement during reads is refused by its manifest timestamp", async () => {
    onRead = (table) => {
      if (table === "toast_capture_daily_depletion") {
        tables.toast_depletion_day_coverage = tables.toast_depletion_day_coverage!.map((row) => ({ ...row, computed_at: "2026-10-07T06:00:00Z" }));
      }
    };
    await expect(loadEffectiveSalesRows(db(), window)).rejects.toThrow("capture_depletion_changed_during_read");
  });

  it("the closed-day range excludes the upper date and rejects a missing lower date", async () => {
    await expect(loadEffectiveSalesRows(db(), { ...window, fromDate: "2026-10-05" })).rejects.toThrow("capture_depletion_coverage_gap");
    expect(await loadEffectiveSalesRows(db(), { ...window, fromDate: "2026-10-05", allowGaps: true })).toHaveLength(1);
    expect(await loadEffectiveSalesCoverage(db(), { ...window, untilDateExclusive: "2026-10-06" })).toEqual([]);
  });

  it("keeps the legacy reader as the default with no capture or production reads", async () => {
    vi.stubEnv("DEPLETION_SOURCE", undefined);
    tables.toast_daily_depletion = [{ ...day, sku_id: "sku", direct_oz: "3", flattened_oz: "10" }];
    expect(await loadEffectiveSalesRows(db(), window)).toEqual([{ ...day, sku_id: "sku", direct_oz: 3, flattened_oz: 10 }]);
    expect(queried).toEqual(["toast_daily_depletion"]);
  });
});
