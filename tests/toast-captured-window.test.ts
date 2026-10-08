import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadCapturedToastWindow } from "@/lib/toast/captured-window";
import { loadCapturedToastDay } from "@/lib/toast/captured-day";
import { getServiceRoleClient } from "@/lib/supabase-server";
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let reads: { table: string; from: number; size: number; ids?: unknown[] }[];
let unstable: boolean;
let pointerReads: number;
let errorTable: string;
const sb = { from(table: string) {
  let lo = 0, hi = 999, single = false, ids: unknown[] | undefined;
  const filters: ((row: Row) => boolean)[] = [];
  const orders: { field: string; ascending: boolean }[] = [];
  const q = {
    select: () => q,
    order: (field: string, opts?: { ascending: boolean }) => { orders.push({ field, ascending: opts?.ascending !== false }); return q; },
    limit: (count: number) => { hi = count - 1; return q; },
    eq: (field: string, value: unknown) => { filters.push((r) => r[field] === value); return q; },
    gte: (field: string, value: string) => { filters.push((r) => String(r[field]) >= value); return q; },
    lt: (field: string, value: string) => { filters.push((r) => String(r[field]) < value); return q; },
    in: (field: string, values: unknown[]) => { ids = values; filters.push((r) => values.includes(r[field])); return q; },
    range: (from: number, to: number) => { lo = from; hi = to; return q; },
    maybeSingle: () => { single = true; return q; },
    then: (resolve: (value: unknown) => unknown) => {
      reads.push({ table, from: lo, size: hi - lo + 1, ids });
      let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r))).sort((a, b) => {
        for (const { field, ascending } of orders) {
          const cmp = String(a[field]).localeCompare(String(b[field]));
          if (cmp) return ascending ? cmp : -cmp;
        }
        return 0;
      }).slice(lo, hi + 1);
      if (table === "toast_order_latest_pointers" && lo === 0 && ++pointerReads % 2 === 0 && unstable) rows = rows.map((r) => ({ ...r, snapshot_id: "new" }));
      return Promise.resolve(resolve({ data: single ? rows[0] ?? null : rows, error: table === errorTable ? { message: "read failed" } : null }));
    },
  };
  return q;
} } as unknown as ReturnType<typeof getServiceRoleClient>;

function seed(count: number, manyDays = true) {
  tables = { toast_capture_runs: [], toast_capture_run_orders: [], toast_order_latest_pointers: [], toast_orders: [], toast_order_checks: [],
    toast_dining_options: [{ location_id: "shop", guid: "dine", name: "Counter" }],
    sales_channel_map: [{ dining_option_label: "Counter", channel: "in_store", reviewed_at: "2026-09-01T00:00:00Z" }] };
  for (let i = 0; i < count; i++) {
    const date = `2026-09-${String(manyDays ? i + 1 : 1).padStart(2, "0")}`;
    const runId = manyDays ? `run${i}` : "run";
    if (manyDays || i === 0) tables.toast_capture_runs!.push({ id: runId, location_id: "shop", business_date: date, orders: manyDays ? 1 : count,
      finished_at: `${date}T23:00:00Z`, status: "completed" });
    const pointer = { location_id: "shop", business_date: date, snapshot_id: `order${i}`, order_guid: `order${i}` };
    tables.toast_order_latest_pointers!.push(pointer);
    tables.toast_capture_run_orders!.push({ ...pointer, run_id: runId });
    tables.toast_orders!.push({ id: pointer.snapshot_id, order_guid: pointer.order_guid, location_id: "shop", business_date: date,
      dining_option_guid: "dine", modified_at: `${date}T22:00:00Z`, deleted: false, voided: false, excess_food: false, selection_units: [] });
    tables.toast_order_checks!.push({ snapshot_id: pointer.snapshot_id, check_guid: `check${i}`, amount_cents: 100, deleted: false, voided: false });
  }
}
beforeEach(() => {
  reads = []; pointerReads = 0; unstable = false; errorTable = ""; seed(30);
  vi.mocked(getServiceRoleClient).mockReturnValue(sb);
});
afterEach(() => vi.unstubAllEnvs());

it("loads a populated 30-day window in nine bounded queries and matches the day reader", async () => {
  const window = await loadCapturedToastWindow(sb, "shop", "2026-09-01", "2026-10-01");
  expect(window.size).toBe(30);
  expect(reads).toHaveLength(9);
  expect(reads.every((read) => read.size <= 250 && (!read.ids || read.ids.length <= 100))).toBe(true);
  for (const [date, day] of window) expect(day).toEqual(await loadCapturedToastDay("shop", date));
});
it("pages membership, pointers, and checks and chunks snapshot identifiers", async () => {
  seed(1101, false);
  tables.toast_order_checks!.push(...Array.from({ length: 1001 }, (_, i) => ({ snapshot_id: "order0", check_guid: `extra${i}`, amount_cents: 1, deleted: false, voided: false })));
  const day = (await loadCapturedToastWindow(sb, "shop", "2026-09-01", "2026-10-01")).get("2026-09-01")!;
  expect(day.orders).toHaveLength(1101);
  expect(day.orders.find((order) => order.snapshotId === "order0")!.checks).toHaveLength(1002);
  expect(reads.some((r) => r.table === "toast_order_checks" && r.from >= 1000)).toBe(true);
  expect(reads.every((r) => !r.ids || r.ids.length <= 100)).toBe(true);
});
it("retains absence/removal policy and empty-day coverage without inventing missing days", async () => {
  seed(1);
  tables.toast_capture_runs![0]!.orders = 0; tables.toast_capture_run_orders = [];
  const day = (await loadCapturedToastWindow(sb, "shop", "2026-09-01", "2026-10-01")).get("2026-09-01")!;
  expect(day.coverage.missingPointerCount).toBe(1);
  expect(day.orders).toHaveLength(1);
  vi.stubEnv("TOAST_CAPTURE_ABSENCE_REMOVAL", "1");
  const window = await loadCapturedToastWindow(sb, "shop", "2026-09-01", "2026-10-01");
  expect(window.size).toBe(1);
  expect(window.get("2026-09-01")!.orders).toHaveLength(0);
  expect(await loadCapturedToastWindow(sb, "other", "2026-09-01", "2026-10-01")).toEqual(new Map());
});
it("chooses the newest completed generation and refuses an unstable publication after one retry", async () => {
  seed(1);
  tables.toast_capture_runs!.push({ ...tables.toast_capture_runs![0], id: "old", orders: 0, finished_at: "2026-09-01T00:00:00Z" });
  expect((await loadCapturedToastWindow(sb, "shop", "2026-09-01", "2026-10-01")).get("2026-09-01")!.coverage.runId).toBe("run0");
  pointerReads = 0; unstable = true;
  await expect(loadCapturedToastWindow(sb, "shop", "2026-09-01", "2026-10-01")).rejects.toThrow("capture_read_changed");
  expect(pointerReads).toBe(4);
});
it.each(["toast_capture_runs", "toast_order_latest_pointers", "toast_capture_run_orders", "toast_orders", "toast_order_checks", "toast_dining_options", "sales_channel_map"])
  ("propagates %s query errors", async (table) => {
    errorTable = table;
    await expect(loadCapturedToastWindow(sb, "shop", "2026-09-01", "2026-10-01")).rejects.toThrow("read failed");
  });
