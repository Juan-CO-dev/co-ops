import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import type { RoleCode } from "@/lib/roles";
import type { ExportRow } from "@/lib/vendor-import-shared/model";
import { vendorImportScopeAllowed } from "@/lib/vendor-import-shared/levels";

const state = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]>, staged: null as null | Record<string, unknown>, rpc: vi.fn(), reads: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/vendor-import-shared/adapters", () => ({ detectAdapter: () => ({ id: "test", vendor: "pfg", parse: (text: string) => JSON.parse(text) }) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({
  from(table: string) {
    state.reads.push(table);
    const filters: Array<(r: Record<string, unknown>) => boolean> = [];
    const result = () => (state.tables[table] ?? []).filter(r => filters.every(f => f(r as Record<string, unknown>)));
    const q = {
      select: () => q, order: () => q, range: () => q, or: () => q,
      eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; },
      is: (k: string, v: unknown) => { filters.push(r => (r[k] ?? null) === v); return q; },
      in: (k: string, v: unknown[]) => { filters.push(r => v.includes(r[k])); return q; },
      maybeSingle: async () => ({ data: result()[0] ?? null, error: null }),
      then: (resolve: (x: unknown) => unknown) => Promise.resolve({ data: result(), error: null }).then(resolve),
    }; return q;
  },
  rpc: (...args: unknown[]) => state.rpc(...args),
}) }));
import { audit } from "@/lib/audit";
import { stageVendorImport, loadImportBatch, applyVendorImport } from "@/lib/vendor-import";
const vendor = "11111111-1111-4111-8111-111111111111";
const shop = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const batch = "44444444-4444-4444-8444-444444444444";
const actor = (role: RoleCode = "gm") => ({ user: { id: vendor, role }, locations: [shop] }) as AuthContext;
const row = (packSize = 1): ExportRow => ({ vendor: "v", source_file: "x", source_line: 1, account_id: "", list_name: "", category: "", item_no: "1", description: "Beans", brand: "", pack: "", pack_qty: 1, pack_size: packSize, pack_unit: "LB", uom: "CS", price_cents: 500, price_per_lb_cents: null, last_purchase_qty: null, last_purchase_uom: null, last_purchase_date: null, exported_at: "2026-11-06" });
const stage = (r = row()) => stageVendorImport(actor(), vendor, { name: "prices.csv", text: JSON.stringify([r]) }, shop);

beforeEach(() => {
  state.staged = null; state.reads = []; state.rpc.mockReset(); vi.mocked(audit).mockClear();
  state.tables = {
    locations: [{ id: shop, active: true }],
    vendors: [{ id: vendor, name: "PFG", active: true, source_kind: "vendor" }],
    vendor_items: [null, other].map((location_id, i) => ({ id: `sku${i}`, location_id, vendor_id: vendor, active: true, name: "Beans", item_number: "1", price_basis: "per_case" })),
    sku_pack_levels: [{ sku_id: "sku0", id: "root", label: "case", contains_qty: 16, contains_level_id: null, contains_measure_unit: "oz", display_ordinal: 0, active: true, location_id: null }],
    measure_units: [{ label: "oz", dimension: "weight", to_base_factor: 1, active: true }],
    vendor_price_history: [{ id: "global-price", vendor_item_id: "sku0", unit_price: 1, effective_date: "2026-11-01", recorded_at: null, location_id: null }],
  };
  state.rpc.mockImplementation(async (name: string, args: { p_batch: Record<string, unknown>; p_observations: Array<Record<string, unknown>> }) => {
    expect(name).toBe("stage_vendor_import"); state.staged = args.p_batch;
    state.tables.vendor_import_batches = [{ ...args.p_batch, id: batch, status: "staged" }];
    state.tables.vendor_import_observations = args.p_observations.map(o => ({ ...o, batch_id: batch, payload: o.row, ...(o.match as object), match_rule: (o.match as { rule: string }).rule }));
    return { data: { batch_id: batch, created: true }, error: null };
  });
});
describe("vendor import scope authorization", () => {
  it.each(["stage", "apply"] as const)("GM %s is own-shop only", mode => {
    const who = { role: "gm" as const, locations: [shop] };
    expect(vendorImportScopeAllowed(who, shop, mode)).toBe(true);
    expect(vendorImportScopeAllowed(who, other, mode)).toBe(false);
    expect(vendorImportScopeAllowed(who, null, mode)).toBe(false);
  });
  it.each(["agm", "social_media_mgr"] as const)("%s neither stages nor applies", role => {
    for (const mode of ["stage", "apply"] as const) expect(vendorImportScopeAllowed({ role, locations: [shop] }, shop, mode)).toBe(false);
  });
  it("MoO stages globally and applies any shop, but global apply remains 9", () => {
    const who = { role: "moo" as const, locations: [] };
    expect(vendorImportScopeAllowed(who, null)).toBe(true);
    expect(vendorImportScopeAllowed(who, other, "apply")).toBe(true);
    expect(vendorImportScopeAllowed(who, null, "apply")).toBe(false);
    expect(vendorImportScopeAllowed({ ...who, role: "owner" }, null, "apply")).toBe(true);
  });
  it("library refuses out-of-scope staging before I/O", async () => {
    for (const location of [other, null]) await expect(stageVendorImport(actor(), vendor, { name: "x", text: "x" }, location)).rejects.toMatchObject({ status: 403 });
    expect(state.reads).toEqual([]);
  });
  it("library refuses an inactive shop", async () => {
    state.tables.locations = [{ id: shop, active: false }];
    await expect(stage()).rejects.toMatchObject({ status: 403 });
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("library refuses loading another shop's batch", async () => {
    state.tables.vendor_import_batches = [{ id: batch, vendor_id: vendor, location_id: other }];
    await expect(loadImportBatch(actor(), vendor, batch)).rejects.toMatchObject({ status: 403 });
  });
});
describe("shop staging snapshots", () => {
  it("excludes another shop's same-number SKU and explicitly snapshots global fallback", async () => {
    const view = await stage();
    expect(view.ops).toHaveLength(1);
    expect(view.ops[0]).toMatchObject({ sku_id: "sku0", before: { id: "global-price", based_on: "global", price_lane_id: null, pack_location_id: null } });
    expect(state.staged).toMatchObject({ location_id: shop });
  });
  it("uses the live shop lane even when a global price is newer", async () => {
    state.tables.sku_price_lanes = [{ id: "live-lane", sku_id: "sku0", location_id: shop, active: true }];
    state.tables.vendor_price_history!.push({ id: "shop-price", vendor_item_id: "sku0", unit_price: 2, effective_date: "2026-10-31", recorded_at: null, location_id: shop, price_lane_id: "live-lane" });
    expect((await stage()).ops[0]).toMatchObject({ before: { id: "shop-price", unit_price: 2, based_on: "shop", price_lane_id: "live-lane" } });
  });
  it("refuses an empty live lane instead of inventing a snapshot", async () => {
    state.tables.sku_price_lanes = [{ id: "empty-lane", sku_id: "sku0", location_id: shop, active: true }];
    await expect(stage()).rejects.toMatchObject({ code: "invalid_catalog_price" });
  });
  it("includes this shop's shop-only SKU", async () => {
    (state.tables.vendor_items![0] as Record<string, unknown>).location_id = shop;
    expect((await stage()).ops[0]?.sku_id).toBe("sku0");
  });
  it("shop pack resolution supplies the price conversion and snapshot", async () => {
    state.tables.sku_pack_levels!.push({ sku_id: "sku0", id: "shop-root", label: "case", contains_qty: 32, contains_level_id: null, contains_measure_unit: "oz", display_ordinal: 0, active: true, location_id: shop });
    const view = await stage(row(2));
    expect(view.ops[0]).toMatchObject({ before: { pack_location_id: shop, pack_levels: [{ id: "shop-root" }] }, after: { unit_price: 5 } });
  });
  it("applies a stored shop scope through the shop RPC", async () => {
    const view = await stage();
    state.rpc.mockImplementation(async (name: string) => {
      expect(name).toBe("apply_vendor_import_shop");
      return { data: { batch_id: batch, plan_digest: view.expectedDigest, ops: [], non_atomic: [], _audit: true }, error: null };
    });
    await applyVendorImport(actor(), vendor, batch, view.decisions, view.expectedDigest);
    expect(vi.mocked(audit).mock.calls.map(([entry]) => [entry.action, entry.metadata?.location_id])).toEqual([
      ["vendor.import_staged", shop], ["sku.price_supersede", shop], ["vendor.import_applied", shop],
    ]);
  });
  it("a direct library apply cannot bypass GM membership or global floor", async () => {
    const view = await stage();
    for (const location_id of [other, null]) {
      (state.tables.vendor_import_batches![0] as Record<string, unknown>).location_id = location_id;
      await expect(applyVendorImport(actor(), vendor, batch, view.decisions, view.expectedDigest)).rejects.toMatchObject({ status: 403 });
    }
    expect(state.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([12, 24])("proves each-size hierarchy even when total ounces agree (source count %i)", async count => {
    state.tables.sku_pack_levels = [
      { sku_id: "sku0", id: "case", label: "case", contains_qty: 12, contains_level_id: "bottle", contains_measure_unit: null, display_ordinal: 0, active: true, location_id: null },
      { sku_id: "sku0", id: "bottle", label: "bottle", contains_qty: 32, contains_level_id: null, contains_measure_unit: "oz", display_ordinal: 1, active: true, location_id: null },
    ];
    (state.tables.vendor_items![0] as Record<string, unknown>).price_basis = "per_each";
    const view = await stage({ ...row(), pack_qty: count, pack_size: 384 / count, pack_unit: "OZ", price_cents: 6000 });
    if (count === 12) expect(view.ops[0]).toMatchObject({ after: { unit_price: 5 } });
    else {
      expect(view.ops).toEqual([]);
      expect(view.observations[0]).toMatchObject({ kind: "needs_person", reason: "pack_hierarchy_review" });
      expect(view.batch.report.needs_person[0]?.href).toContain(`location=${shop}&job=pack`);
    }
  });
  it("holds an unproven hierarchy rather than guessing a price", async () => {
    const view = await stage({ ...row(), pack_unparsed: true });
    expect(view.ops).toEqual([]);
    expect(view.observations[0]?.reason).toBe("pack_hierarchy_review");
  });
  it("holds a single-level pack change and links to the shop pack job", async () => {
    const view = await stage(row(2));
    expect(view.ops).toEqual([]);
    expect(view.observations[0]).toMatchObject({ kind: "needs_person", reason: "pack_hierarchy_review" });
    expect(view.batch.report.needs_person[0]?.href).toContain(`location=${shop}`);
    expect(view.batch.report.needs_person[0]?.href).toContain("job=pack");
  });
});
