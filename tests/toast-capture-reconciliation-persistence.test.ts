import { beforeEach, expect, it, vi } from "vitest";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { recordCaptureReconciliation } from "@/lib/toast/capture-reconciliation";
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));

let failRead: boolean;
let failWrite: boolean;
let pages: number[];
let saved: Record<string, unknown>[];
let filters: unknown[][];
beforeEach(() => {
  failRead = false; failWrite = false; pages = []; saved = []; filters = [];
  const from = (table: string) => {
    let offset = 0;
    const query = {
      select: () => query, order: () => query,
      eq: (field: string, value: unknown) => { filters.push([field, value]); return query; },
      range: (start: number) => { offset = start; pages.push(start); return query; },
      insert: (row: Record<string, unknown>) => { saved.push(row); return query; },
      abortSignal: async () => table === "toast_sales_events" ? {
        error: failRead && offset === 1000 ? { message: "PRIVATE DB MESSAGE" } : null,
        data: Array.from({ length: offset === 0 ? 1000 : 1 }, (_, i) => ({ check_guid: "check", selection_guid: `s${offset + i}`,
          toast_item_guid: "item", item_name: "item", quantity: 1, snapshot_version: 1, voided: false, parent_selection_guid: null })),
      } : { error: failWrite ? { message: "PRIVATE DB MESSAGE" } : null },
    };
    return query;
  };
  vi.mocked(getServiceRoleClient).mockReturnValue({ from } as unknown as ReturnType<typeof getServiceRoleClient>);
});
const run = () => recordCaptureReconciliation("shop", "2026-10-06", "run", [], new AbortController().signal);
it("reads every page scoped to shop/date and appends one run-bound result", async () => {
  expect(await run()).toEqual({ status: "mismatch", error: "capture_reconciliation_mismatch" });
  expect(pages).toEqual([0, 1000]);
  expect(filters).toEqual([["location_id", "shop"], ["business_date", "2026-10-06"], ["location_id", "shop"], ["business_date", "2026-10-06"]]);
  expect(saved).toMatchObject([{ location_id: "shop", business_date: "2026-10-06", run_id: "run", status: "mismatch", old_units: 1001, new_units: 0 }]);
});
it("a later-page failure stores skipped, never partial totals or provider errors", async () => {
  failRead = true;
  expect(await run()).toEqual({ status: "skipped", error: "capture_reconciliation_read_failed" });
  expect(saved).toMatchObject([{ status: "skipped", old_units: null, new_units: null, mismatched_items: [] }]);
  expect(JSON.stringify(saved)).not.toContain("PRIVATE");
});
it("a denied insert cannot report successful reconciliation", async () => {
  failWrite = true;
  await expect(run()).rejects.toThrow("capture_reconciliation_write_failed");
});
