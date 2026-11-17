import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import { buildXlsx, SMARTSHOP_HEADER } from "./helpers/xlsx-fixture";
import { USFOODS_INVOICE_HEADER } from "@/lib/vendor-import-shared/adapters/usfoods-invoice";

const state = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]>, staged: null as null | Record<string, unknown>,
  observations: [] as Array<Record<string, unknown>>, rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({
  from(table: string) {
    const filters: Array<(r: Record<string, unknown>) => boolean> = [];
    const result = () => (state.tables[table] ?? []).filter(r => filters.every(f => f(r as Record<string, unknown>)));
    const q = {
      update: () => q, select: () => q, order: () => q, range: () => q, or: () => q,
      eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; },
      is: (k: string, v: unknown) => { filters.push(r => (r[k] ?? null) === v); return q; },
      in: (k: string, v: unknown[]) => { filters.push(r => v.includes(r[k])); return q; },
      maybeSingle: async () => ({ data: result()[0] ?? null, error: null }),
      then: (resolve: (x: unknown) => unknown) => Promise.resolve({ data: result(), error: null }).then(resolve),
    }; return q;
  },
  rpc: (...args: unknown[]) => state.rpc(...args),
}) }));
import { stageVendorImport, VendorImportError } from "@/lib/vendor-import";

const vendor = "11111111-1111-4111-8111-111111111111";
const shop = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const batch = "44444444-4444-4444-8444-444444444444";
const actor = { user: { id: vendor, role: "moo" }, locations: [shop, other] } as AuthContext;

const columns = USFOODS_INVOICE_HEADER.split(",");
function invoiceLine(doc: string, customer: string, item: string, price: string, type = "FWC_INV"): string {
  const cells = columns.map(() => "");
  const put = (name: string, value: string) => { cells[columns.indexOf(name)] = value; };
  put("DocumentNumber", doc); put("DocumentType", type); put("DocumentDate", "11/16/2026"); put("CustomerNumber", customer);
  put("ProductNumber", item); put("ProductDescription", "TEST ITEM"); put("Product Label", "TESTBRAND"); put("PackingSize", "6/5 LB");
  put("Weight", "0.00"); put("QtyOrder", "1"); put("QtyShip", "1"); put("QtyAdjust", "0"); put("PricingUnit", "CS");
  put("UnitPrice", price); put("ExtendedPrice", price);
  return cells.join(",");
}
const invoice = (...lines: string[]) => [USFOODS_INVOICE_HEADER, ...lines].join("\n") + "\n";
const smartshop = () => buildXlsx([[...SMARTSHOP_HEADER], ["t1", "Test Greens", "3 LB", 2, 18]]);
const xlsxName = "smartshop_export_2026-01-01_2026-11-15.xlsx";

async function code(promise: Promise<unknown>): Promise<string> {
  try { await promise; return "ok"; } catch (e) { return e instanceof VendorImportError ? e.code : String(e); }
}
function vendorNamed(name: string) {
  state.tables.vendors = [{ id: vendor, name, active: true, source_kind: "vendor", account_number: null }];
}

beforeEach(() => {
  state.staged = null; state.observations = []; state.rpc.mockReset();
  state.tables = {
    locations: [{ id: shop, active: true }, { id: other, active: true }],
    vendor_items: [], sku_pack_levels: [], measure_units: [], vendor_price_history: [], vendor_location_accounts: [],
  };
  vendorNamed("US Foods");
  state.rpc.mockImplementation(async (name: string, args: { p_batch: Record<string, unknown>; p_observations: Array<Record<string, unknown>> }) => {
    expect(name).toBe("stage_vendor_import");
    state.staged = args.p_batch; state.observations = args.p_observations;
    state.tables.vendor_import_batches = [{ ...args.p_batch, id: batch, status: "staged" }];
    state.tables.vendor_import_observations = args.p_observations.map(o => ({ ...o, batch_id: batch, payload: o.row, ...(o.match as object), match_rule: (o.match as { rule: string }).rule }));
    return { data: { batch_id: batch, created: true }, error: null };
  });
});

describe("staging a Baldor SmartShop xlsx", () => {
  it("parses the binary upload, hashes the BYTES and stages for review (never applies)", async () => {
    vendorNamed("Baldor Specialty Foods");
    const bytes = smartshop();
    await stageVendorImport(actor, vendor, { name: xlsxName, bytes }, shop);
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.staged).toMatchObject({ adapter: "baldor-smartshop-xlsx", source_name: xlsxName, exported_at: "2026-11-15", row_count: 1,
      source_sha256: createHash("sha256").update(bytes).digest("hex"), location_id: shop });
    expect(state.observations[0]).toMatchObject({ kind: "needs_person", reason: "no_match" });
  });

  it("refuses an xlsx for a vendor of another family, a broken workbook and an oversized upload", async () => {
    expect(await code(stageVendorImport(actor, vendor, { name: xlsxName, bytes: smartshop() }, shop))).toBe("adapter_vendor_mismatch");
    vendorNamed("Baldor");
    const broken = smartshop().slice(0, 60);
    expect(await code(stageVendorImport(actor, vendor, { name: xlsxName, bytes: broken }, shop))).toBe("invalid_payload");
    expect(await code(stageVendorImport(actor, vendor, { name: xlsxName, bytes: new Uint8Array(3 * 1024 * 1024) }, shop))).toBe("too_large");
    expect(await code(stageVendorImport(actor, vendor, { name: "export.xlsx", bytes: new TextEncoder().encode("ID,Title") }, shop))).toBe("unknown_adapter");
    expect(state.rpc).not.toHaveBeenCalled();
  });
});

describe("staging a US Foods invoice CSV", () => {
  it("keeps only the chosen shop's account when the vendor's accounts are mapped to shops", async () => {
    state.tables.vendor_location_accounts = [
      { vendor_id: vendor, location_id: shop, account_number: "90000001", active: true },
      { vendor_id: vendor, location_id: other, account_number: "90000002", active: true },
    ];
    const text = invoice(invoiceLine("1", "90000001", "1000001", "10.0000"), invoiceLine("2", "90000002", "1000002", "11.0000"),
      invoiceLine("3", "90000001", "1000003", "12.0000", "FWC_CM"));
    const view = await stageVendorImport(actor, vendor, { name: "InvoiceDetails.csv", text }, shop);
    expect(state.staged).toMatchObject({ adapter: "usfoods-invoice-csv", account_id: "90000001", row_count: 1 });
    expect(state.observations.map(o => (o.row as { item_no: string }).item_no)).toEqual(["1000001"]);
    expect(view.batch.report.ignored_rows).toBe(2);
  });

  it("refuses a file whose only account belongs to another shop", async () => {
    state.tables.vendor_location_accounts = [{ vendor_id: vendor, location_id: other, account_number: "90000002", active: true }];
    const text = invoice(invoiceLine("2", "90000002", "1000002", "11.0000"));
    expect(await code(stageVendorImport(actor, vendor, { name: "InvoiceDetails.csv", text }, shop))).toBe("account_shop_mismatch");
  });

  it("still refuses two accounts at the global default, and two unmapped accounts at a shop", async () => {
    const text = invoice(invoiceLine("1", "90000001", "1000001", "10.0000"), invoiceLine("2", "90000002", "1000002", "11.0000"));
    expect(await code(stageVendorImport(actor, vendor, { name: "InvoiceDetails.csv", text }, null))).toBe("multiple_accounts");
    expect(await code(stageVendorImport(actor, vendor, { name: "InvoiceDetails.csv", text }, shop))).toBe("multiple_accounts");
  });

  it("keeps the file's own account (never the vendor's configured one) and names a credit-memo-only file", async () => {
    state.tables.vendors = [{ id: vendor, name: "US Foods", active: true, source_kind: "vendor", account_number: "71600000" }];
    await stageVendorImport(actor, vendor, { name: "InvoiceDetails.csv", text: invoice(invoiceLine("1", "90000001", "1000001", "10.0000")) }, shop);
    expect(state.staged).toMatchObject({ account_id: "90000001" });
    const credits = invoice(invoiceLine("1", "90000001", "1000001", "10.0000", "FWC_CM"));
    expect(await code(stageVendorImport(actor, vendor, { name: "InvoiceDetails.csv", text: credits }, shop))).toBe("no_price_rows");
  });
});
