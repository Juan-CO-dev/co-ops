import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadCapturedToastDay } from "@/lib/toast/captured-day";
import { getServiceRoleClient } from "@/lib/supabase-server";
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let reads: { table: string; from: number; ids?: unknown[] }[];
let pointerReads: number;
let unstable: boolean;
const order = (id: string): Row => ({ id, order_guid: id, modified_at: "2026-10-06T20:00:00Z",
  location_id: "shop", business_date: "2026-10-06", dining_option_guid: "dine", deleted: false, voided: false,
  excess_food: false, selection_units: [] });
beforeEach(() => {
  vi.clearAllMocks(); reads = []; pointerReads = 0; unstable = false;
  tables = {
    toast_capture_runs: [{ id: "run", status: "completed", location_id: "shop", business_date: "2026-10-06", orders: 1, finished_at: "2026-10-07T09:00:00Z" }],
    toast_capture_run_orders: [{ run_id: "run", location_id: "shop", business_date: "2026-10-06", order_guid: "o", snapshot_id: "o" }],
    toast_order_latest_pointers: [{ location_id: "shop", business_date: "2026-10-06", order_guid: "o", snapshot_id: "o" }],
    toast_orders: [order("o")], toast_order_checks: [],
    toast_dining_options: [{ location_id: "shop", guid: "dine", name: "EZ Cater", updated_at: new Date().toISOString() }],
    sales_channel_map: [{ dining_option_label: "EZ Cater", channel: "catering", reviewed_at: "2026-10-07T00:00:00Z" }],
  };
  const from = (table: string) => {
    let lo = 0, hi = 999, single = false; let ids: unknown[] | undefined;
    const filters: ((r: Row) => boolean)[] = [];
    const q = {
      select: () => q, order: () => q, limit: () => q,
      eq: (key: string, value: unknown) => { filters.push((r) => r[key] === value); return q; },
      in: (key: string, values: unknown[]) => { ids = values; filters.push((r) => values.includes(r[key])); return q; },
      range: (a: number, b: number) => { lo = a; hi = b; return q; },
      maybeSingle: () => { single = true; return q; },
      then: (resolve: (r: unknown) => unknown) => {
        reads.push({ table, from: lo, ids });
        let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r))).slice(lo, hi + 1);
        if (table === "toast_order_latest_pointers" && lo === 0) {
          pointerReads++;
          if (unstable && pointerReads % 2 === 0) rows = rows.map((r) => ({ ...r, snapshot_id: "changed" }));
        }
        return Promise.resolve(resolve({ data: single ? rows[0] ?? null : rows, error: null }));
      },
    };
    return q;
  };
  vi.mocked(getServiceRoleClient).mockReturnValue({ from } as unknown as ReturnType<typeof getServiceRoleClient>);
});
afterEach(() => vi.unstubAllEnvs());

it("resolves GUID through the exact reviewed label join", async () => {
  expect((await loadCapturedToastDay("shop", "2026-10-06"))?.orders[0])
    .toMatchObject({ diningOption: "EZ Cater", salesChannel: "catering" });
});
it("measures absence but preserves pointers until the removal flag is approved", async () => {
  tables.toast_capture_run_orders = [];
  tables.toast_capture_runs![0]!.orders = 0;
  const retained = await loadCapturedToastDay("shop", "2026-10-06");
  expect(retained?.coverage).toMatchObject({ missingPointerCount: 1, absenceRemovalApplied: false });
  expect(retained?.orders).toHaveLength(1);
  vi.stubEnv("TOAST_CAPTURE_ABSENCE_REMOVAL", "1");
  const removed = await loadCapturedToastDay("shop", "2026-10-06");
  expect(removed?.orders).toEqual([]);
  expect(removed?.coverage.missingPointerCount).toBe(1);
});
it("uses the latest source-version pointer even when the full-day run saw an older version", async () => {
  tables.toast_capture_run_orders![0]!.snapshot_id = "older";
  expect((await loadCapturedToastDay("shop", "2026-10-06"))?.orders[0]?.snapshotId).toBe("o");
});
it("pages more than 1000 checks for a single order", async () => {
  tables.toast_order_checks = Array.from({ length: 1101 }, (_, i) => ({ snapshot_id: "o", check_guid: `c${i}`, amount_cents: 1, voided: false, deleted: false }));
  expect((await loadCapturedToastDay("shop", "2026-10-06"))?.orders[0]?.checks).toHaveLength(1101);
  expect(reads).toContainEqual(expect.objectContaining({ table: "toast_order_checks", from: 1000 }));
});
it("pages large day membership and bounds snapshot ID request lines", async () => {
  const count = 1101;
  tables.toast_capture_runs![0]!.orders = count;
  tables.toast_capture_run_orders = Array.from({ length: count }, (_, i) => ({ run_id: "run", location_id: "shop", business_date: "2026-10-06", order_guid: `o${i}`, snapshot_id: `o${i}` }));
  tables.toast_order_latest_pointers = tables.toast_capture_run_orders.map((r) => ({ ...r }));
  tables.toast_orders = Array.from({ length: count }, (_, i) => order(`o${i}`));
  expect((await loadCapturedToastDay("shop", "2026-10-06"))?.orders).toHaveLength(count);
  expect(reads.filter((r) => r.ids).every((r) => r.ids!.length <= 100)).toBe(true);
});
it("retries once then refuses an unstable publication", async () => {
  unstable = true;
  await expect(loadCapturedToastDay("shop", "2026-10-06")).rejects.toThrow("capture_read_changed");
  expect(pointerReads).toBe(4);
});
it("distinguishes missing coverage, successful zero and stale config", async () => {
  expect(await loadCapturedToastDay("other", "2026-10-06")).toBeNull();
  tables.toast_dining_options![0]!.updated_at = "2020-01-01T00:00:00Z";
  expect((await loadCapturedToastDay("shop", "2026-10-06"))?.coverage.configDegraded).toBe(true);
  tables.toast_capture_runs![0]!.orders = 0; tables.toast_capture_run_orders = [];
  tables.toast_order_latest_pointers = [];
  expect(await loadCapturedToastDay("shop", "2026-10-06")).toMatchObject({ orders: [], coverage: { orderCount: 0 } });
});
