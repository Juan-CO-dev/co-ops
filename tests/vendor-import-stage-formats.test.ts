import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import { buildXlsx, SMARTSHOP_HEADER } from "./helpers/xlsx-fixture";
import { USFOODS_INVOICE_HEADER } from "@/lib/vendor-import-shared/adapters/usfoods-invoice";

const state = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]>, staged: null as null | Record<string, unknown>,
  observations: [] as Array<Record<string, unknown>>, rpc: vi.fn(),
  updates: [] as Array<{ table: string; patch: Record<string, unknown>; filters: Array<(r: Record<string, unknown>) => boolean> }> }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({
  from(table: string) {
    const filters: Array<(r: Record<string, unknown>) => boolean> = [];
    const result = () => (state.tables[table] ?? []).filter(r => filters.every(f => f(r as Record<string, unknown>)));
    const q = {
      update: (patch: Record<string, unknown>) => { state.updates.push({ table, patch, filters }); return q; }, select: () => q, order: () => q, range: () => q, or: () => q,
      eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; },
      is: (k: string, v: unknown) => { filters.push(r => (r[k] ?? null) === v); return q; },
      in: (k: string, v: unknown[]) => { filters.push(r => v.includes(r[k])); return q; },
      maybeSingle: async () => ({ data: result()[0] ?? null, error: null }),
      then: (resolve: (x: unknown) => unknown) => {
        const update = state.updates.at(-1);
        // An awaited update applies its patch to the rows its filters matched (the stale batch's retirement).
        if (update && update.filters === filters && !(update as { done?: boolean }).done) {
          (update as { done?: boolean }).done = true;
          for (const r of result()) Object.assign(r as Record<string, unknown>, update.patch);
          return Promise.resolve({ data: null, error: null }).then(resolve);
        }
        return Promise.resolve({ data: result(), error: null }).then(resolve);
      },
    }; return q;
  },
  rpc: (...args: unknown[]) => state.rpc(...args),
}) }));
import { applyVendorImport, stageVendorImport, VendorImportError } from "@/lib/vendor-import";

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
  state.staged = null; state.observations = []; state.updates = []; state.rpc.mockReset();
  state.tables = {
    locations: [{ id: shop, active: true }, { id: other, active: true }],
    vendor_items: [], sku_pack_levels: [], measure_units: [], vendor_price_history: [], vendor_location_accounts: [],
  };
  vendorNamed("US Foods");
  state.rpc.mockImplementation(async (name: string, args: { p_batch: Record<string, unknown>; p_observations: Array<Record<string, unknown>> }) => {
    expect(name).toBe("stage_vendor_import");
    state.staged = args.p_batch; state.observations = args.p_observations;
    const id = (state.tables.vendor_import_batches ?? []).length === 0 ? batch : `44444444-4444-4444-8444-44444444444${(state.tables.vendor_import_batches ?? []).length}`;
    state.tables.vendor_import_batches = [...(state.tables.vendor_import_batches ?? []), { ...args.p_batch, id, status: "staged" }];
    state.tables.vendor_import_observations = args.p_observations.map(o => ({ ...o, batch_id: id, payload: o.row, ...(o.match as object), match_rule: (o.match as { rule: string }).rule }));
    return { data: { batch_id: id, created: true }, error: null };
  });
});

describe("staging a Baldor SmartShop xlsx", () => {
  it("parses the binary upload, hashes the BYTES and stages for review (never applies)", async () => {
    vendorNamed("Baldor Specialty Foods");
    const bytes = smartshop();
    await stageVendorImport(actor, vendor, { name: xlsxName, bytes }, shop);
    expect(state.rpc).toHaveBeenCalledTimes(1);
    // The batch identity is the bytes AND the range the file name dates them by (fix round 1); the bytes' own hash is kept.
    const fileSha = createHash("sha256").update(bytes).digest("hex");
    expect(state.staged).toMatchObject({ adapter: "baldor-smartshop-xlsx", source_name: xlsxName, exported_at: "2026-11-15", row_count: 1,
      source_sha256: createHash("sha256").update(`${fileSha}\nbaldor-smartshop-xlsx\n2026-01-01_2026-11-15`, "utf8").digest("hex"), location_id: shop });
    expect((state.staged!.report as { file_sha256?: string }).file_sha256).toBe(fileSha);
    expect(state.observations[0]).toMatchObject({ kind: "needs_person", reason: "no_match" });
  });

  it("the same bytes under a corrected range end are a NEW batch dated by the new name, never the stale one (fix round 1, P2-2)", async () => {
    vendorNamed("Baldor Specialty Foods");
    const bytes = smartshop();
    const fileSha = createHash("sha256").update(bytes).digest("hex");
    await stageVendorImport(actor, vendor, { name: xlsxName, bytes }, shop);
    const first = state.staged!;
    const corrected = "smartshop_export_2026-01-01_2026-11-16.xlsx";
    const view = await stageVendorImport(actor, vendor, { name: corrected, bytes }, shop);
    expect(state.rpc).toHaveBeenCalledTimes(2);
    expect(state.staged).toMatchObject({ source_name: corrected, exported_at: "2026-11-16" });
    expect(state.staged!.source_sha256).not.toBe(first.source_sha256);
    expect(view.batch.exported_at).toBe("2026-11-16");
    // The uploaded file's own hash is kept on both batches.
    expect((first.report as { file_sha256?: string }).file_sha256).toBe(fileSha);
    expect((state.staged!.report as { file_sha256?: string }).file_sha256).toBe(fileSha);
    expect((state.observations[0] as { row: { exported_at: string } }).row.exported_at).toBe("2026-11-16");
  });

  it("a range START change is a new batch too; a browser's ' (1)' copy of the same range reuses it", async () => {
    vendorNamed("Baldor Specialty Foods");
    const bytes = smartshop();
    await stageVendorImport(actor, vendor, { name: xlsxName, bytes }, shop);
    await stageVendorImport(actor, vendor, { name: "smartshop_export_2026-01-01_2026-11-15 (1).xlsx", bytes }, shop);
    expect(state.rpc).toHaveBeenCalledTimes(1);
    await stageVendorImport(actor, vendor, { name: "smartshop_export_2026-02-01_2026-11-15.xlsx", bytes }, shop);
    expect(state.rpc).toHaveBeenCalledTimes(2);
  });

  it("a text export's identity is still its own hash", async () => {
    const text = invoice(invoiceLine("1", "90000001", "1000001", "10.0000"));
    await stageVendorImport(actor, vendor, { name: "InvoiceDetails.csv", text }, shop);
    expect(state.staged).toMatchObject({ source_sha256: createHash("sha256").update(text, "utf8").digest("hex") });
    expect(state.staged!.report).not.toHaveProperty("file_sha256");
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

describe("a staged invoice batch is bound to the account mappings it was filtered by (fix round 2, P2)", () => {
  const twoAccounts = () => invoice(invoiceLine("1", "90000001", "1000001", "10.0000"), invoiceLine("2", "90000002", "1000002", "11.0000"));
  const mapped = (a: string, b: string) => [
    { vendor_id: vendor, location_id: a, account_number: "90000001", active: true },
    { vendor_id: vendor, location_id: b, account_number: "90000002", active: true },
  ];
  const items = () => state.observations.map(o => (o.row as { item_no: string }).item_no);

  it("records every account the file holds and the shop each was on file for", async () => {
    state.tables.vendor_location_accounts = mapped(shop, other);
    await stageVendorImport(actor, vendor, { name: "InvoiceDetails.csv", text: twoAccounts() }, shop);
    expect((state.staged!.report as { account_binding?: unknown }).account_binding).toEqual({ "90000001": shop, "90000002": other });
  });

  it("re-staging the same file after the mappings were corrected retires the stale batch and stages the CURRENT shop's lines", async () => {
    state.tables.vendor_location_accounts = mapped(shop, other);
    await stageVendorImport(actor, vendor, { name: "InvoiceDetails.csv", text: twoAccounts() }, shop);
    expect(items()).toEqual(["1000001"]);
    // Corrected: A is the other shop's account, B is this shop's.
    state.tables.vendor_location_accounts = mapped(other, shop);
    const view = await stageVendorImport(actor, vendor, { name: "InvoiceDetails.csv", text: twoAccounts() }, shop);
    expect(state.rpc).toHaveBeenCalledTimes(2);
    expect(items()).toEqual(["1000002"]);
    expect(view.batch.account_id).toBe("90000002");
    expect(view.observations.map(o => o.row.item_no)).toEqual(["1000002"]);
    const batches = state.tables.vendor_import_batches as Array<{ id: string; status: string }>;
    expect(batches.find(b => b.id === batch)!.status).toBe("superseded");
  });

  it("an unchanged mapping still reuses the staged batch", async () => {
    state.tables.vendor_location_accounts = mapped(shop, other);
    await stageVendorImport(actor, vendor, { name: "InvoiceDetails.csv", text: twoAccounts() }, shop);
    await stageVendorImport(actor, vendor, { name: "InvoiceDetails.csv", text: twoAccounts() }, shop);
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.updates).toEqual([]);
  });

  it("apply refuses (and retires) a batch whose account mappings changed after staging", async () => {
    state.tables.vendor_location_accounts = mapped(shop, other);
    const view = await stageVendorImport(actor, vendor, { name: "InvoiceDetails.csv", text: twoAccounts() }, shop);
    state.tables.vendor_location_accounts = mapped(other, shop);
    expect(await code(applyVendorImport(actor, vendor, view.batch.id, view.decisions, view.expectedDigest))).toBe("stale_before_state");
    expect(state.rpc).toHaveBeenCalledTimes(1);
    const batches = state.tables.vendor_import_batches as Array<{ id: string; status: string }>;
    expect(batches.find(b => b.id === batch)!.status).toBe("superseded");
  });

  it("apply refuses a shop invoice batch staged without a recorded binding", async () => {
    state.tables.vendor_location_accounts = mapped(shop, other);
    const view = await stageVendorImport(actor, vendor, { name: "InvoiceDetails.csv", text: twoAccounts() }, shop);
    delete (state.tables.vendor_import_batches as Array<{ report: Record<string, unknown> }>)[0]!.report.account_binding;
    expect(await code(applyVendorImport(actor, vendor, view.batch.id, view.decisions, view.expectedDigest))).toBe("stale_before_state");
  });
});

describe("account -> shop rules belong to the US Foods invoice only (CC decisions 2 + 3)", () => {
  const pfgFile = (account: string) => ["Performance Foodservice", "Test List", `(TEST SHOP - ${account})`,
    "Category Name,Custom Product Description,Product Description,Brand,StateOfOrigin,Domestic,Custom Product Number,Product Number,Pack Size,UOM,Price,Last Purchase (qty & date)",
    "Produce,,TEST ITEM,TESTBRAND,,,,1000001,6/5 LB,CS,$10.00,", "Generated: 11/16/2026 08:00 AM", ""].join("\n");

  it("PFG keeps its exact earlier behaviour: an account mapped to another shop is neither dropped nor refused, and the report gains nothing", async () => {
    vendorNamed("PFG");
    state.tables.vendor_location_accounts = [{ vendor_id: vendor, location_id: other, account_number: "90000002", active: true }];
    const view = await stageVendorImport(actor, vendor, { name: "pfg.csv", text: pfgFile("90000002") }, shop);
    expect(state.staged).toMatchObject({ adapter: "pfg-customerfirst-v1", account_id: "90000002", row_count: 1, location_id: shop });
    expect(view.batch.report.ignored_rows).toBe(0);
    expect(view.batch.report).not.toHaveProperty("account");
  });

  it("the MOXe list keeps taking the vendor's configured account, unfiltered, with no account note", async () => {
    state.tables.vendors = [{ id: vendor, name: "US Foods", active: true, source_kind: "vendor", account_number: "90000002" }];
    state.tables.vendor_location_accounts = [{ vendor_id: vendor, location_id: other, account_number: "90000002", active: true }];
    const list = "Product Number,Product Description,Product Brand,Product Package Size,Customer Product Number,USF Class Description,Storage Description\n1000001,TEST ITEM,TESTBRAND,6/5 LB,,PRODUCE,COOLER\n";
    const view = await stageVendorImport(actor, vendor, { name: "recently-purchased-2026-11-16.csv", text: list }, shop);
    expect(state.staged).toMatchObject({ adapter: "usfoods-moxe-list", account_id: "90000002", row_count: 1 });
    expect(view.batch.report).not.toHaveProperty("account");
  });

  it("with no mapping at all, a single-account invoice file stages at the chosen shop and the report shows the account to confirm", async () => {
    const text = invoice(invoiceLine("1", "71628390", "1000001", "10.0000"), invoiceLine("2", "71628390", "1000002", "11.0000"));
    const view = await stageVendorImport(actor, vendor, { name: "InvoiceDetails.csv", text }, shop);
    expect(state.staged).toMatchObject({ adapter: "usfoods-invoice-csv", account_id: "71628390", row_count: 2, location_id: shop });
    expect(view.batch.report.account).toEqual({ number: "71628390", location_id: null });
  });

  it("names the mapped shop when the account is on file for the chosen shop", async () => {
    state.tables.vendor_location_accounts = [{ vendor_id: vendor, location_id: shop, account_number: "71628390", active: true }];
    const view = await stageVendorImport(actor, vendor, { name: "InvoiceDetails.csv", text: invoice(invoiceLine("1", "71628390", "1000001", "10.0000")) }, shop);
    expect(view.batch.report.account).toEqual({ number: "71628390", location_id: shop });
  });

  it("refuses two accounts only when no mapping decides between them", async () => {
    const text = invoice(invoiceLine("1", "90000001", "1000001", "10.0000"), invoiceLine("2", "90000002", "1000002", "11.0000"));
    // One mapped to THIS shop, the other unknown: still two accounts nobody has placed.
    state.tables.vendor_location_accounts = [{ vendor_id: vendor, location_id: shop, account_number: "90000001", active: true }];
    expect(await code(stageVendorImport(actor, vendor, { name: "InvoiceDetails.csv", text }, shop))).toBe("multiple_accounts");
    // The other account mapped to the other shop: the mapping decides.
    state.tables.vendor_location_accounts = [{ vendor_id: vendor, location_id: other, account_number: "90000002", active: true }];
    await stageVendorImport(actor, vendor, { name: "InvoiceDetails.csv", text }, shop);
    expect(state.staged).toMatchObject({ account_id: "90000001", row_count: 1 });
  });

  it("stores the not-shipped flag on the staged row and leaves its price unselected", async () => {
    state.tables.vendor_items = [{ id: "55555555-5555-4555-8555-555555555555", vendor_id: vendor, name: "TEST ITEM", item_number: "1000001", active: true, price_basis: "per_case", location_id: null }];
    const shipped = invoiceLine("1", "71628390", "1000001", "10.0000").split(",");
    shipped[columns.indexOf("QtyShip")] = "0";
    const view = await stageVendorImport(actor, vendor, { name: "InvoiceDetails.csv", text: invoice(shipped.join(",")) }, shop);
    const row = state.observations.find(o => (o.row as { item_no: string }).item_no === "1000001")!;
    expect((row.row as { flags?: string[] }).flags).toEqual(["not_shipped"]);
    for (const o of view.observations) expect(view.decisions[`${o.source_row}:${o.kind}`]).toBe("skip");
  });
});
