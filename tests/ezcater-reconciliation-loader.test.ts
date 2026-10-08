import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import { loadEzcaterReconciliation } from "@/lib/catering/ezcater-reconciliation";

const { from, canRead, queues, filters } = vi.hoisted(() => ({
  from: vi.fn(), canRead: vi.fn(), queues: {} as Record<string, unknown[]>, filters: vi.fn(),
}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({ from }) }));
vi.mock("@/lib/catering/ezcater-detail", () => ({ canReadCateringLead: canRead }));
const actor = { user: { id: "actor" } } as AuthContext;
beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(queues)) delete queues[key];
  canRead.mockResolvedValue(true);
  from.mockImplementation((table: string) => {
    const result = queues[table]?.shift();
    if (!result) throw new Error(`Unexpected ${table}`);
    const q = {
      select: () => q, eq: (...args: unknown[]) => { filters(table, "eq", ...args); return q; },
      contains: (...args: unknown[]) => { filters(table, "contains", ...args); return q; },
      is: () => q, order: () => q, limit: () => q,
      maybeSingle: async () => result, returns: async () => result,
      then: (resolve: (x: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    return q;
  });
  queues.catering_pipeline = [{ data: { location_id: "shop" }, error: null }];
});
describe("reconciliation diagnostics authorization and disclosure", () => {
  it("shows the intentional manual shop choice as information, including during shadow outage", async () => {
    queues.ezcater_orders = [{ data: { id: "order", snapshot_id: "snapshot", location_conflict: false, location_manual_override: true, caterer_uuid: "provider" }, error: null }];
    queues.locations = [{ data: { name: "Provider shop" }, error: null }, { data: { name: "Manual shop" }, error: null }];
    queues.ezcater_review_queue = [{ data: null, error: { code: "42P01" } }];
    expect(await loadEzcaterReconciliation(actor, "lead")).toMatchObject({ available: false, locationConflict: false, manualLocation: { provider: "Provider shop", kept: "Manual shop" } });
  });
  it("does not read diagnostics for a reader whose fresh authorization fails", async () => {
    canRead.mockResolvedValue(false);
    await expect(loadEzcaterReconciliation(actor, "lead")).rejects.toMatchObject({ status: 403 });
    expect(from).toHaveBeenCalledTimes(1);
  });
  it("returns source/code/count only and pins counts to the order snapshot", async () => {
    queues.ezcater_orders = [{ data: { id: "order", snapshot_id: "snapshot" }, error: null }];
    queues.ezcater_review_queue = [{ data: [{ id: "issue", source: "ezcater", code: "item_unmapped", candidates: ["private-id"] }], error: null }];
    queues.ezcater_toast_links = [{ count: 2, error: null }];
    queues.ezcater_shadow_depletion = [{ count: 3, error: null }];
    const result = await loadEzcaterReconciliation(actor, "lead");
    expect(result).toMatchObject({ available: true, linkCount: 2, shadowRows: 3,
      reviews: [{ id: "issue", source: "ezcater", code: "item_unmapped", candidateCount: 1 }] });
    expect(JSON.stringify(result)).not.toContain("private-id");
    expect(filters).toHaveBeenCalledWith("ezcater_shadow_depletion", "eq", "snapshot_id", "snapshot");
  });
  it("finds a house lead only through its own duplicate candidate identity", async () => {
    queues.ezcater_orders = [{ data: null, error: null }];
    queues.ezcater_review_queue = [{ data: [], error: null }];
    expect(await loadEzcaterReconciliation(actor, "house-lead")).toMatchObject({ available: true });
    expect(filters).toHaveBeenCalledWith("ezcater_review_queue", "contains", "candidates", ["house-lead"]);
  });
  it("discloses schema or query failure instead of displaying zero issues as success", async () => {
    queues.ezcater_orders = [{ data: null, error: { code: "42P01" } }];
    expect(await loadEzcaterReconciliation(actor, "lead")).toMatchObject({ available: false });
  });
  it("keeps a location conflict visible even when the comparison tables are unavailable", async () => {
    queues.ezcater_orders = [{ data: { id: "order", snapshot_id: "snapshot", location_conflict: true }, error: null }];
    queues.ezcater_review_queue = [{ data: null, error: { code: "42P01" } }];
    expect(await loadEzcaterReconciliation(actor, "lead")).toMatchObject({ available: false, locationConflict: true });
  });
});
