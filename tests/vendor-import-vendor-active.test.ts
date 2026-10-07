import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";

const calls = vi.hoisted(() => ({ filters: [] as Array<[string, unknown]> }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({
  from: (table: string) => {
    let activeOnly = false;
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { calls.filters.push([key, value]); if (key === "active" && value === true) activeOnly = true; return query; },
      order: () => query,
      range: () => query,
      maybeSingle: async () => ({ data: table === "vendors"
        ? activeOnly ? null : { id: VENDOR, name: "Supplier", active: false, account_number: null, portal_url: null }
        : { id: BATCH, vendor_id: VENDOR, report: { before_state: {} } }, error: null }),
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return query;
  },
}) }));

import { applyVendorImport, loadImportBatch, stageVendorImport } from "@/lib/vendor-import";

const VENDOR = "11111111-1111-4111-8111-111111111111";
const BATCH = "22222222-2222-4222-8222-222222222222";
const actor = { user: { id: VENDOR, role: "gm" }, locations: [] } as unknown as AuthContext;

describe("vendor import inactive supplier boundary", () => {
  it("requires an active vendor when staging", async () => {
    calls.filters = [];
    await expect(stageVendorImport(actor, VENDOR, { name: "x.csv", text: "x" }))
      .rejects.toMatchObject({ status: 404, code: "vendor_not_found" });
    expect(calls.filters).toContainEqual(["active", true]);
  });
  it("loads an existing batch without an active-vendor filter", async () => {
    calls.filters = [];
    await loadImportBatch(actor, VENDOR, BATCH);
    expect(calls.filters).not.toContainEqual(["active", true]);
  });
  it("refuses to apply an existing batch after its vendor deactivates", async () => {
    calls.filters = [];
    await expect(applyVendorImport({ ...actor, user: { ...actor.user, role: "owner" } }, VENDOR, BATCH, {}, "0".repeat(64)))
      .rejects.toMatchObject({ status: 404, code: "vendor_not_found" });
    expect(calls.filters).toContainEqual(["active", true]);
  });
});
