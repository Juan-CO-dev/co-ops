import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import type { ExportRow } from "@/lib/vendor-import-shared/model";

/**
 * Audit W04 fix round 1 (B008/B042). A batch staged BEFORE the root-price / hierarchy fixes keeps
 * its persisted proposals ($4.37 at a 9-bag box root, an unproven global hierarchy). Applying it
 * later would write the old semantics, and re-uploading the same file returned that same batch
 * because the adapter version never moved. The version is bumped; an older staged batch is
 * superseded on apply (never written), and the same file restages under the new semantics.
 */
const state = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]>, staged: null as null | Record<string, unknown>, rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/vendor-import-shared/adapters", () => ({ detectAdapter: () => ({ id: "test", vendor: "pfg", parse: (text: string) => JSON.parse(text) }) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({
  from(table: string) {
    const filters: Array<(r: Record<string, unknown>) => boolean> = [];
    const result = () => (state.tables[table] ?? []).filter(r => filters.every(f => f(r as Record<string, unknown>)));
    let update: Record<string, unknown> | undefined;
    const q = {
      update: (values: Record<string, unknown>) => { update = values; return q; },
      select: () => q, order: () => q, range: () => q, or: () => q,
      eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; },
      is: (k: string, v: unknown) => { filters.push(r => (r[k] ?? null) === v); return q; },
      in: (k: string, v: unknown[]) => { filters.push(r => v.includes(r[k])); return q; },
      maybeSingle: async () => ({ data: result()[0] ?? null, error: null }),
      then: (resolve: (x: unknown) => unknown) => {
        const rows = result();
        if (update) for (const row of rows) Object.assign(row as object, update);
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    }; return q;
  },
  rpc: (...args: unknown[]) => state.rpc(...args),
}) }));
import { applyVendorImport, stageVendorImport, VENDOR_IMPORT_ADAPTER_VERSION } from "@/lib/vendor-import";

const vendor = "11111111-1111-4111-8111-111111111111";
const batch = "44444444-4444-4444-8444-444444444444";
const OLD_VERSION = "v3c2-v1"; // the version every pre-fix staged batch carries
const owner = { user: { id: vendor, role: "owner" }, locations: [] } as unknown as AuthContext;
const row: ExportRow = { vendor: "v", source_file: "x", source_line: 1, account_id: "", list_name: "", category: "", item_no: "1", description: "Beans", brand: "", pack: "", pack_qty: 1, pack_size: 1, pack_unit: "LB", uom: "CS", price_cents: 500, price_per_lb_cents: null, last_purchase_qty: null, last_purchase_uom: null, last_purchase_date: null, exported_at: "2026-11-06" };
const file = { name: "prices.csv", text: JSON.stringify([row]) };
const sha = createHash("sha256").update(file.text, "utf8").digest("hex");

beforeEach(() => {
  state.staged = null; state.rpc.mockReset();
  state.tables = {
    vendors: [{ id: vendor, name: "PFG", active: true, source_kind: "vendor" }],
    vendor_items: [{ id: "sku0", location_id: null, vendor_id: vendor, active: true, name: "Beans", item_number: "1", price_basis: "per_case" }],
    sku_pack_levels: [{ sku_id: "sku0", id: "root", label: "case", contains_qty: 16, contains_level_id: null, contains_measure_unit: "oz", display_ordinal: 0, active: true, location_id: null }],
    measure_units: [{ label: "oz", dimension: "weight", to_base_factor: 1, active: true }],
    vendor_price_history: [{ id: "global-price", vendor_item_id: "sku0", unit_price: 1, effective_date: "2026-11-01", recorded_at: null, location_id: null }],
  };
  state.rpc.mockImplementation(async (name: string, args: { p_batch: Record<string, unknown>; p_observations: Array<Record<string, unknown>> }) => {
    if (name !== "stage_vendor_import") return { data: { batch_id: batch, plan_digest: "x", ops: [], non_atomic: [] }, error: null };
    state.staged = args.p_batch;
    state.tables.vendor_import_batches = [...(state.tables.vendor_import_batches ?? []), { ...args.p_batch, id: batch, status: "staged" }];
    state.tables.vendor_import_observations = args.p_observations.map(o => ({ ...o, batch_id: batch, payload: o.row, ...(o.match as object), match_rule: (o.match as { rule: string }).rule }));
    return { data: { batch_id: batch, created: true }, error: null };
  });
});

describe("W04 r1: import batches staged under older semantics never apply", () => {
  it("the adapter version moved past every pre-fix batch", () => {
    expect(VENDOR_IMPORT_ADAPTER_VERSION).not.toBe(OLD_VERSION);
  });

  it("re-uploading the same file restages instead of returning the old staged batch", async () => {
    state.tables.vendor_import_batches = [{ id: "old-batch", vendor_id: vendor, location_id: null, source_sha256: sha, adapter_version: OLD_VERSION, status: "staged",
      report: { counts: {}, reasons: {}, needs_person: [], before_state: {}, ignored_rows: 0 } }];
    await stageVendorImport(owner, vendor, file, null);
    expect(state.rpc).toHaveBeenCalledWith("stage_vendor_import", expect.anything());
    expect(state.staged).toMatchObject({ adapter_version: VENDOR_IMPORT_ADAPTER_VERSION });
  });

  it("applying an older staged batch supersedes it and writes nothing", async () => {
    const view = await stageVendorImport(owner, vendor, file, null);
    expect(view.ops.length).toBeGreaterThan(0);
    // Simulate a batch staged before this change: same stored proposals, older version.
    (state.tables.vendor_import_batches![0] as Record<string, unknown>).adapter_version = OLD_VERSION;
    state.rpc.mockClear();
    await expect(applyVendorImport(owner, vendor, batch, view.decisions, view.expectedDigest))
      .rejects.toMatchObject({ status: 409, code: "stale_before_state" });
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.tables.vendor_import_batches![0]).toMatchObject({ status: "superseded" });
  });

  it("a current-version batch still applies", async () => {
    const view = await stageVendorImport(owner, vendor, file, null);
    state.rpc.mockImplementation(async () => ({ data: { batch_id: batch, plan_digest: view.expectedDigest, ops: [], non_atomic: [] }, error: null }));
    await expect(applyVendorImport(owner, vendor, batch, view.decisions, view.expectedDigest)).resolves.toMatchObject({ batch_id: batch });
    expect(state.rpc).toHaveBeenCalledWith("apply_vendor_import", expect.anything());
  });
});
