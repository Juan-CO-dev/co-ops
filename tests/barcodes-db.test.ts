/**
 * tests/barcodes-db.test.ts — the barcode DB layer (V3-B §5, Task 3).
 *
 * The pure laws are pinned next door in `barcodes-shared.test.ts`. What THIS file pins is
 * the handful of decisions `lib/barcodes.ts` owns and nothing else can make for it:
 *
 *   1. THE DOOR IS LOCATION-BOUND, FIRST. Every one of the three entry points refuses an
 *      out-of-location actor with 404 `not_found` BEFORE any database work — the same shape
 *      and the same code `lib/receiving.ts` uses, because a scan route that leaked a
 *      neighbouring store's catalog would be the BC-asymmetry class all over again.
 *   2. FORGOTTEN ROWS ARE INVISIBLE. `forget` is a soft delete, so every read must carry
 *      `.is("forgotten_at", null)`. Asserted on the fake's recorded calls, not inferred from
 *      a happy-path result that would pass just as well without the filter.
 *   3. TEACHING NEVER SILENTLY REWRITES. Same level → a no-op with NO audit row; another
 *      level → 409 `level_differs` carrying the stored level, and only an explicit confirm
 *      ADDS the second level (spec §11 finding 6).
 *
 * The Supabase client is a recording fake in the `daily-catchup.test.ts` shape: `from()`
 * returns one chainable object, every filter is recorded, and each terminal call shifts the
 * next canned response off a queue. Nothing here supplies Supabase env, so a missed mock
 * would fail loudly rather than reach a database (vitest.config.ts's header).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BarcodeError, forgetBarcode, lookupScan, SCAN_MIN, teachBarcode } from "@/lib/barcodes";
import { audit } from "@/lib/audit";
import { lockLocationContext } from "@/lib/locations";
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { AuthContext } from "@/lib/session";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/locations", () => ({ lockLocationContext: vi.fn(() => true) }));

const VENDOR = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const OTHER_VENDOR = "dddddddd-1111-4111-8111-dddddddddddd";
const LOCATION = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb";
const SKU_TURKEY = "cccccccc-1111-4111-8111-cccccccccccc";
const SKU_HAM = "eeeeeeee-1111-4111-8111-eeeeeeeeeeee";
const TWIN_TURKEY = "ffffffff-1111-4111-8111-ffffffffffff";
const PRODUCT_TURKEY = "99999999-1111-4111-8111-999999999999";
const BARCODE_ROW = "11111111-1111-4111-8111-111111111111";

/** A real UPC-A (check digit holds) so `normalizeCode` keeps it verbatim. */
const UPC = "012345678905";

const actor: AuthContext = {
  user: { id: "user-1", name: "Marcus Webb", role: "key_holder" },
  session: {},
  role: "key_holder",
  level: 4,
  locations: [LOCATION],
} as unknown as AuthContext;

type Call = { table: string; op: string; args: unknown[] };
let calls: Call[] = [];
let queue: Array<Record<string, unknown>> = [];

/** Every recorded call for one table+op, in order. */
const argsFor = (table: string, op: string) => calls.filter((c) => c.table === table && c.op === op).map((c) => c.args);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lockLocationContext).mockReturnValue(true);
  calls = [];
  queue = [];
  const from = (table: string) => {
    const q: Record<string, unknown> = {};
    const chain = (op: string) => (...args: unknown[]) => { calls.push({ table, op, args }); return q; };
    const settle = (op: string) => (...args: unknown[]) => {
      calls.push({ table, op, args });
      return Promise.resolve(queue.shift() ?? { data: null, error: null, count: 0 });
    };
    for (const op of ["select", "insert", "update", "eq", "is", "order"]) q[op] = chain(op);
    for (const op of ["returns", "single", "maybeSingle"]) q[op] = settle(op);
    // `update(..., { count: "exact" }).eq(…)` is awaited directly — the house idiom
    // (lib/order-guides.ts:155), so the chain itself has to be thenable.
    q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(queue.shift() ?? { data: null, error: null, count: 0 }).then(res, rej);
    return q;
  };
  vi.mocked(getServiceRoleClient).mockReturnValue({ from } as unknown as ReturnType<typeof getServiceRoleClient>);
});

/** The `sku_barcodes` + embedded `vendor_items` row shape `lookupScan` reads. */
const taughtRow = (over: Partial<{ code: string; sku_id: string; level: string; vendor_id: string | null; product_id: string | null }> = {}) => ({
  code: over.code ?? UPC,
  sku_id: over.sku_id ?? SKU_TURKEY,
  level: over.level ?? "case",
  vendor_items: { vendor_id: over.vendor_id ?? VENDOR, product_id: over.product_id ?? null },
});

describe("lookupScan — normalise, then resolve, and never read a forgotten row", () => {
  it("normalises the scanned label before querying and returns the match plus the normalised code", async () => {
    queue.push({ data: [taughtRow()], error: null });
    queue.push({ data: [{ id: SKU_TURKEY, product_id: PRODUCT_TURKEY }, { id: SKU_HAM, product_id: null }], error: null });

    // Spaces are what a wedge or a human puts on the wire; the stored key never has them.
    const res = await lookupScan(actor, { vendorId: VENDOR, locationId: LOCATION, code: " 0 12345 67890 5 ", lineSkuIds: [SKU_TURKEY] });

    expect(res).toMatchObject({ kind: "line", skuId: SKU_TURKEY, level: "case", levels: ["case"], ambiguous: false });
    expect(res.normalized).toEqual({ code: UPC, symbology: "upc_a", checkDigitOk: true });
    expect(argsFor("sku_barcodes", "eq")).toEqual([["code", UPC]]);
  });

  it("filters the barcode read to LIVE rows — the soft delete is the whole point of forget", async () => {
    queue.push({ data: [], error: null });
    queue.push({ data: [], error: null });
    await lookupScan(actor, { vendorId: VENDOR, locationId: LOCATION, code: UPC, lineSkuIds: [] });
    expect(argsFor("sku_barcodes", "is")).toEqual([["forgotten_at", null]]);
  });

  it("reads this vendor's ACTIVE SKUs for the twin lane", async () => {
    queue.push({ data: [taughtRow({ sku_id: TWIN_TURKEY, vendor_id: OTHER_VENDOR, product_id: PRODUCT_TURKEY })], error: null });
    queue.push({ data: [{ id: SKU_TURKEY, product_id: PRODUCT_TURKEY }], error: null });

    const res = await lookupScan(actor, { vendorId: VENDOR, locationId: LOCATION, code: UPC, lineSkuIds: [] });

    expect(res).toMatchObject({ kind: "twin", skuId: SKU_TURKEY, viaSkuId: TWIN_TURKEY });
    expect(argsFor("vendor_items", "eq")).toEqual([["vendor_id", VENDOR], ["active", true]]);
  });

  it("a code nobody has taught is `unknown` — not an error", async () => {
    queue.push({ data: [], error: null });
    queue.push({ data: [{ id: SKU_TURKEY, product_id: null }], error: null });
    const res = await lookupScan(actor, { vendorId: VENDOR, locationId: LOCATION, code: UPC, lineSkuIds: [] });
    expect(res.kind).toBe("unknown");
    expect(res.normalized.code).toBe(UPC);
  });

  it("refuses a code too short to be a barcode with 400 invalid_code, before any query", async () => {
    await expect(lookupScan(actor, { vendorId: VENDOR, locationId: LOCATION, code: "12345", lineSkuIds: [] }))
      .rejects.toMatchObject({ status: 400, code: "invalid_code" });
    expect(getServiceRoleClient).not.toHaveBeenCalled();
  });

  it("refuses an out-of-location actor with 404 not_found before any database work", async () => {
    vi.mocked(lockLocationContext).mockReturnValue(false);
    await expect(lookupScan(actor, { vendorId: VENDOR, locationId: LOCATION, code: UPC, lineSkuIds: [] }))
      .rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(getServiceRoleClient).not.toHaveBeenCalled();
  });
});

describe("teachBarcode — idempotent, never a silent rewrite", () => {
  /** SKU lookup + the live-rows read every teach performs, in call order. */
  const primeTeach = (live: Array<{ id: string; level: string }>, sku: Record<string, unknown> | null = { id: SKU_TURKEY, vendor_id: VENDOR, active: true }) => {
    queue.push({ data: sku, error: null });
    queue.push({ data: live, error: null });
  };

  it("is a no-op with NO audit row when the same code is already taught at the same level", async () => {
    primeTeach([{ id: BARCODE_ROW, level: "case" }]);
    await expect(teachBarcode(actor, { vendorId: VENDOR, locationId: LOCATION, code: UPC, skuId: SKU_TURKEY, level: "case" }))
      .resolves.toEqual({ created: false });
    expect(audit).not.toHaveBeenCalled();
    expect(argsFor("sku_barcodes", "insert")).toEqual([]);
  });

  it("refuses a level change with 409 level_differs carrying the stored level", async () => {
    primeTeach([{ id: BARCODE_ROW, level: "case" }]);
    const err = await teachBarcode(actor, { vendorId: VENDOR, locationId: LOCATION, code: UPC, skuId: SKU_TURKEY, level: "inner" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BarcodeError);
    expect(err).toMatchObject({ status: 409, code: "level_differs", extra: { storedLevel: "case" } });
    expect(audit).not.toHaveBeenCalled();
  });

  it("ADDS the second level on confirm — both meanings stand, and the audit row is complete", async () => {
    primeTeach([{ id: BARCODE_ROW, level: "case" }]);
    queue.push({ data: { id: "22222222-1111-4111-8111-222222222222" }, error: null });

    await expect(teachBarcode(actor, {
      vendorId: VENDOR, locationId: LOCATION, code: UPC, skuId: SKU_TURKEY,
      level: "inner", invoiceNumber: "INV-88", confirmLevelChange: true,
    })).resolves.toEqual({ created: true });

    expect(argsFor("sku_barcodes", "insert")).toEqual([[{
      sku_id: SKU_TURKEY, code: UPC, symbology: "upc_a", level: "inner", taught_by: "user-1",
    }]]);
    expect(audit).toHaveBeenCalledExactlyOnceWith({
      actorId: "user-1", actorRole: "key_holder", action: "sku.barcode.taught",
      resourceTable: "sku_barcodes", resourceId: "22222222-1111-4111-8111-222222222222",
      metadata: {
        code: UPC, sku_id: SKU_TURKEY, level: "inner", symbology: "upc_a",
        vendor_id: VENDOR, location_id: LOCATION, invoice_number: "INV-88", check_digit_ok: true,
      },
      ipAddress: null, userAgent: null,
    });
  });

  it("teaches a brand-new code with no invoice typed yet — invoice_number is null, not absent", async () => {
    primeTeach([]);
    queue.push({ data: { id: BARCODE_ROW }, error: null });
    await expect(teachBarcode(actor, { vendorId: VENDOR, locationId: LOCATION, code: UPC, skuId: SKU_TURKEY, level: "case" }))
      .resolves.toEqual({ created: true });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ invoice_number: null, check_digit_ok: true }),
    }));
  });

  it("honours a caller-supplied symbology over the one the normaliser guessed", async () => {
    primeTeach([]);
    queue.push({ data: { id: BARCODE_ROW }, error: null });
    await teachBarcode(actor, { vendorId: VENDOR, locationId: LOCATION, code: UPC, skuId: SKU_TURKEY, level: "case", symbology: "gs1_128" });
    expect(argsFor("sku_barcodes", "insert")[0]).toEqual([expect.objectContaining({ symbology: "gs1_128" })]);
  });

  it("refuses a SKU belonging to another vendor with 400 vendor_mismatch", async () => {
    primeTeach([], { id: SKU_TURKEY, vendor_id: OTHER_VENDOR, active: true });
    await expect(teachBarcode(actor, { vendorId: VENDOR, locationId: LOCATION, code: UPC, skuId: SKU_TURKEY, level: "case" }))
      .rejects.toMatchObject({ status: 400, code: "vendor_mismatch" });
    expect(audit).not.toHaveBeenCalled();
  });

  it("refuses an unknown or deactivated SKU with 404 sku_not_found", async () => {
    primeTeach([], null);
    await expect(teachBarcode(actor, { vendorId: VENDOR, locationId: LOCATION, code: UPC, skuId: SKU_TURKEY, level: "case" }))
      .rejects.toMatchObject({ status: 404, code: "sku_not_found" });

    vi.clearAllMocks();
    calls = []; queue = [];
    primeTeach([], { id: SKU_TURKEY, vendor_id: VENDOR, active: false });
    await expect(teachBarcode(actor, { vendorId: VENDOR, locationId: LOCATION, code: UPC, skuId: SKU_TURKEY, level: "case" }))
      .rejects.toMatchObject({ status: 404, code: "sku_not_found" });
  });

  it("refuses an out-of-location actor with 404 not_found before any database work", async () => {
    vi.mocked(lockLocationContext).mockReturnValue(false);
    await expect(teachBarcode(actor, { vendorId: VENDOR, locationId: LOCATION, code: UPC, skuId: SKU_TURKEY, level: "case" }))
      .rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(getServiceRoleClient).not.toHaveBeenCalled();
  });
});

describe("forgetBarcode — soft delete, audited, and it must actually have hit a row", () => {
  it("stamps forgotten_at on the live row with an exact count and audits the removal", async () => {
    queue.push({ data: null, error: null, count: 1 });

    await expect(forgetBarcode(actor, { vendorId: VENDOR, locationId: LOCATION, code: UPC, skuId: SKU_TURKEY, level: "case" })).resolves.toBeUndefined();

    const update = argsFor("sku_barcodes", "update")[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(typeof update[0].forgotten_at).toBe("string");
    expect(update[1]).toEqual({ count: "exact" });
    expect(argsFor("sku_barcodes", "eq")).toEqual([["code", UPC], ["sku_id", SKU_TURKEY], ["level", "case"]]);
    expect(argsFor("sku_barcodes", "is")).toEqual([["forgotten_at", null]]);
    expect(audit).toHaveBeenCalledExactlyOnceWith({
      actorId: "user-1", actorRole: "key_holder", action: "sku.barcode.forgotten",
      resourceTable: "sku_barcodes", resourceId: null,
      metadata: { code: UPC, sku_id: SKU_TURKEY, level: "case", vendor_id: VENDOR, location_id: LOCATION },
      ipAddress: null, userAgent: null,
    });
  });

  it("answers 404 not_taught when the update matched nothing — and writes no audit row", async () => {
    queue.push({ data: null, error: null, count: 0 });
    await expect(forgetBarcode(actor, { vendorId: VENDOR, locationId: LOCATION, code: UPC, skuId: SKU_TURKEY, level: "case" }))
      .rejects.toMatchObject({ status: 404, code: "not_taught" });
    expect(audit).not.toHaveBeenCalled();
  });

  it("refuses an out-of-location actor with 404 not_found before any database work", async () => {
    vi.mocked(lockLocationContext).mockReturnValue(false);
    await expect(forgetBarcode(actor, { vendorId: VENDOR, locationId: LOCATION, code: UPC, skuId: SKU_TURKEY, level: "case" }))
      .rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(getServiceRoleClient).not.toHaveBeenCalled();
  });
});

it("SCAN_MIN is the receiving floor — a scan is not a new privilege", () => {
  expect(SCAN_MIN).toBe(4);
});
