import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { correctEzcaterShops } from "../scripts/ezcater-reassign-shops";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { syncEzcaterOrder } from "@/lib/ezcater/sync";
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/ezcater/sync", () => ({ syncEzcaterOrder: vi.fn() }));
let provider: string;
let leads: Array<{ id: string; external_ref: string; location_id: string; stage: string }>;
const mutation = vi.fn();
const filters = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  provider = "19f4e7a6-0000-4000-8000-000000000001";
  leads = [{ id: "lead", external_ref: provider, location_id: "old", stage: "completed" }];
  const from = (table: string) => {
    let single = false;
    const result = () => ({ error: null, data: table === "ezcater_events" ? [{ entity_id: provider, parent_id: "new-caterer" }]
      : table === "locations" ? [{ id: "new", ezcater_caterer_uuid: "new-caterer" }]
      : table === "ezcater_orders" ? { order_number: "19F4E7A6" }
      : single ? { location_id: "new" } : leads });
    const query = {
      select: () => query, eq: (...args: unknown[]) => { filters(...args); return query; }, order: () => query,
      range: () => query, single: () => { single = true; return query; }, maybeSingle: () => query,
      insert: mutation, update: mutation, delete: mutation,
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  };
  vi.mocked(getServiceRoleClient).mockReturnValue({ from, rpc: mutation } as unknown as ReturnType<typeof getServiceRoleClient>);
  vi.mocked(syncEzcaterOrder).mockResolvedValue({ lead_id: "lead", result: "refreshed" });
});
afterEach(() => vi.restoreAllMocks());
it("dry-run never calls provider or writes", async () => {
  await correctEzcaterShops([]);
  expect(syncEzcaterOrder).not.toHaveBeenCalled();
  expect(mutation).not.toHaveBeenCalled();
});
it("refuses count drift before any provider call", async () => {
  leads.push({ ...leads[0]!, id: "second" });
  await expect(correctEzcaterShops(["--execute", "--expect", "1"])).rejects.toThrow("reviewed_manifest_changed");
  expect(syncEzcaterOrder).not.toHaveBeenCalled();
});
it("requires explicit expected manifest count", async () => {
  await expect(correctEzcaterShops(["--execute"])).rejects.toThrow("expected_count_required");
  expect(syncEzcaterOrder).not.toHaveBeenCalled();
});
it("refreshes the one reviewed completed lead without a terminal-stage filter", async () => {
  await correctEzcaterShops(["--execute", "--expect", "1"]);
  expect(syncEzcaterOrder).toHaveBeenCalledExactlyOnceWith(provider, "new-caterer");
  expect(filters.mock.calls.some((call) => call[0] === "stage")).toBe(false);
});
it("allows exact normalized order number when provider UUID differs", async () => {
  provider = "00000000-0000-4000-8000-000000000001";
  leads[0]!.external_ref = provider;
  await correctEzcaterShops(["--execute", "--expect", "1"]);
  expect(syncEzcaterOrder).toHaveBeenCalledExactlyOnceWith(provider, "new-caterer");
});
