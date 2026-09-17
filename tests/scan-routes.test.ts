/**
 * tests/scan-routes.test.ts — the three scan routes' FRONT DOOR (V3-B §5, Task 4).
 *
 * The lookup law is pinned in `barcodes-shared.test.ts` and the DB layer in
 * `barcodes-db.test.ts`. What THIS file pins is the four decisions the routes own:
 *
 *   1. THE GATE, AND ITS ORDER. `assertSameOrigin` runs FIRST, so a cross-site POST never
 *      reaches the session or the database — asserted as "requireSession not called", not
 *      merely as a 403. Then the role floor: SCAN_MIN is RECEIVE_MIN (4), so an employee (3)
 *      is refused before any lib call. Scanning is a faster hand on the receiving door, never
 *      a wider one.
 *   2. THE PAYLOAD IS UNTRUSTED. vendorId / locationId / skuId are UUIDs, `code` is 6–128
 *      chars, `level` is case|inner, `symbology` comes from 0206's vocabulary, and
 *      `lineSkuIds` is capped at 200 — one case each, because a validator that exists but is
 *      spelled for only two of the three routes is exactly the asymmetry class the house
 *      bug-catalog names.
 *   3. THE RESULT PASSES THROUGH UNCHANGED. A `lookup` answer is the lib's own object; the
 *      client branches on `kind`, so a route that reshaped it would silently break the door.
 *   4. THE ERROR CONTRACT. BarcodeError(status, code, message, extra) → jsonError with the
 *      extra spread in, which is how 409 `level_differs` carries `storedLevel` to the
 *      one-line confirm. `BarcodeError` is the REAL class (`importActual`) — a stubbed error
 *      would make the `instanceof` mapping pass here and fail in production.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { POST as lookupPOST } from "@/app/api/operations/receiving/scan/lookup/route";
import { POST as teachPOST } from "@/app/api/operations/receiving/scan/teach/route";
import { POST as forgetPOST } from "@/app/api/operations/receiving/scan/forget/route";
import { requireSession } from "@/lib/session";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { BarcodeError, forgetBarcode, lookupScan, teachBarcode } from "@/lib/barcodes";
import type { RoleCode } from "@/lib/roles";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/portal/csrf", () => ({ assertSameOrigin: vi.fn(() => null) }));
vi.mock("@/lib/barcodes", async () => {
  // The real error class and the real floor — the routes map one by `instanceof` and gate on
  // the other, so stubbing either would test the stub rather than the route.
  const actual = await vi.importActual<typeof import("@/lib/barcodes")>("@/lib/barcodes");
  return {
    BarcodeError: actual.BarcodeError,
    SCAN_MIN: actual.SCAN_MIN,
    SYMBOLOGIES: actual.SYMBOLOGIES,
    lookupScan: vi.fn(),
    teachBarcode: vi.fn(),
    forgetBarcode: vi.fn(),
  };
});

const VENDOR = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const LOCATION = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb";
const SKU = "cccccccc-1111-4111-8111-cccccccccccc";
const UPC = "012345678905";

const lookupBody = { vendorId: VENDOR, locationId: LOCATION, code: UPC, lineSkuIds: [SKU] };
const teachBody = { vendorId: VENDOR, locationId: LOCATION, code: UPC, skuId: SKU, level: "case" };
const forgetBody = { ...teachBody };

const req = (path: string, body: unknown) =>
  new NextRequest(`https://example.com/api/operations/receiving/scan/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.com" },
    body: JSON.stringify(body),
  });

function actor(role: RoleCode) {
  return { user: { id: "user-1", name: "Marcus Webb", role }, session: {}, role, level: 0, locations: [LOCATION] };
}
const asActor = (role: RoleCode) =>
  vi.mocked(requireSession).mockResolvedValue(actor(role) as unknown as Awaited<ReturnType<typeof requireSession>>);

const match = { kind: "line" as const, skuId: SKU, level: "case" as const, levels: ["case" as const], ambiguous: false };
const normalized = { code: UPC, symbology: "upc_a" as const, checkDigitOk: true };

/** The three routes, with a valid body and the lib double each one calls. */
const ROUTES = [
  { name: "lookup", post: lookupPOST, body: lookupBody, lib: lookupScan },
  { name: "teach", post: teachPOST, body: teachBody, lib: teachBarcode },
  { name: "forget", post: forgetPOST, body: forgetBody, lib: forgetBarcode },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertSameOrigin).mockReturnValue(null);
  vi.mocked(lookupScan).mockResolvedValue({ ...match, normalized });
  vi.mocked(teachBarcode).mockResolvedValue({ created: true });
  vi.mocked(forgetBarcode).mockResolvedValue(undefined);
  asActor("key_holder");
});

describe("the gate — same-origin first, then the receiving floor", () => {
  it.each(ROUTES)("$name refuses a cross-origin POST before the session or the lib", async ({ post, body, lib }) => {
    vi.mocked(assertSameOrigin).mockReturnValue(
      new Response(JSON.stringify({ error: "bad_origin" }), { status: 403 }) as unknown as ReturnType<typeof assertSameOrigin>,
    );
    const res = await post(req("x", body));
    expect(res.status).toBe(403);
    expect(requireSession).not.toHaveBeenCalled();
    expect(lib).not.toHaveBeenCalled();
  });

  it.each(ROUTES)("$name refuses an employee (3) before any lib call — SCAN_MIN is the receiving floor", async ({ post, body, lib }) => {
    asActor("employee");
    const res = await post(req("x", body));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "forbidden" });
    expect(lib).not.toHaveBeenCalled();
  });
});

describe("payload validation — one case per field, on every route that declares it", () => {
  const cases: Array<[string, typeof lookupPOST, unknown, string]> = [
    ["vendorId that is not a UUID", lookupPOST, { ...lookupBody, vendorId: "pfg" }, "vendorId"],
    ["locationId that is not a UUID", lookupPOST, { ...lookupBody, locationId: "here" }, "locationId"],
    ["code shorter than 6 characters", lookupPOST, { ...lookupBody, code: "12345" }, "code"],
    ["code longer than 128 characters", lookupPOST, { ...lookupBody, code: "0".repeat(129) }, "code"],
    ["lineSkuIds holding a non-UUID", lookupPOST, { ...lookupBody, lineSkuIds: ["turkey"] }, "lineSkuIds"],
    ["more than 200 lineSkuIds", lookupPOST, { ...lookupBody, lineSkuIds: Array.from({ length: 201 }, () => SKU) }, "lineSkuIds"],
    ["skuId that is not a UUID", teachPOST, { ...teachBody, skuId: "turkey" }, "skuId"],
    ["level outside case|inner", teachPOST, { ...teachBody, level: "pallet" }, "level"],
    ["symbology outside 0206's vocabulary", teachPOST, { ...teachBody, symbology: "aztec" }, "symbology"],
    ["invoiceNumber longer than 64 characters", teachPOST, { ...teachBody, invoiceNumber: "I".repeat(65) }, "invoiceNumber"],
    ["confirmLevelChange that is not a boolean", teachPOST, { ...teachBody, confirmLevelChange: "yes" }, "confirmLevelChange"],
    ["level outside case|inner (forget)", forgetPOST, { ...forgetBody, level: "" }, "level"],
  ];

  it.each(cases)("rejects %s as 400 invalid_payload on the %#th case", async (_label, post, body, field) => {
    const res = await post(req("x", body));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_payload", field });
    expect(lookupScan).not.toHaveBeenCalled();
    expect(teachBarcode).not.toHaveBeenCalled();
    expect(forgetBarcode).not.toHaveBeenCalled();
  });

  it("defaults an absent lineSkuIds to an empty list rather than refusing the scan", async () => {
    const res = await lookupPOST(req("lookup", { vendorId: VENDOR, locationId: LOCATION, code: UPC }));
    expect(res.status).toBe(200);
    expect(lookupScan).toHaveBeenCalledWith(expect.anything(), { vendorId: VENDOR, locationId: LOCATION, code: UPC, lineSkuIds: [] });
  });
});

describe("lookup — the lib's answer travels through untouched", () => {
  it("passes the match and the normalised code straight to the client", async () => {
    const res = await lookupPOST(req("lookup", lookupBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...match, normalized });
    expect(lookupScan).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ id: "user-1" }) }),
      { vendorId: VENDOR, locationId: LOCATION, code: UPC, lineSkuIds: [SKU] },
    );
  });

  it("maps an unteachable code to 400 invalid_code", async () => {
    vi.mocked(lookupScan).mockRejectedValue(new BarcodeError(400, "invalid_code", "That is too short to be a barcode"));
    const res = await lookupPOST(req("lookup", lookupBody));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_code" });
  });

  it("maps an out-of-location actor to 404 not_found, the receiving shape", async () => {
    vi.mocked(lookupScan).mockRejectedValue(new BarcodeError(404, "not_found", "Location not found"));
    expect((await lookupPOST(req("lookup", lookupBody))).status).toBe(404);
  });

  it("lets a non-BarcodeError escape rather than dressing it as a scan refusal", async () => {
    vi.mocked(lookupScan).mockRejectedValue(new Error("connection reset"));
    await expect(lookupPOST(req("lookup", lookupBody))).rejects.toThrow("connection reset");
  });
});

describe("teach — 201 when a code is learned, 200 when it was already known", () => {
  it("answers 201 on a fresh teach and forwards every optional field", async () => {
    const res = await teachPOST(req("teach", { ...teachBody, symbology: "gs1_128", invoiceNumber: "INV-88", confirmLevelChange: true }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ created: true });
    expect(teachBarcode).toHaveBeenCalledWith(expect.anything(), {
      vendorId: VENDOR, locationId: LOCATION, code: UPC, skuId: SKU, level: "case",
      symbology: "gs1_128", invoiceNumber: "INV-88", confirmLevelChange: true,
    });
  });

  it("answers 200 — not 201 — when the code was already taught at this level", async () => {
    vi.mocked(teachBarcode).mockResolvedValue({ created: false });
    const res = await teachPOST(req("teach", teachBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ created: false });
  });

  it("normalises the absent optionals to undefined/null rather than inventing values", async () => {
    await teachPOST(req("teach", teachBody));
    expect(teachBarcode).toHaveBeenCalledWith(expect.anything(), {
      vendorId: VENDOR, locationId: LOCATION, code: UPC, skuId: SKU, level: "case",
      symbology: undefined, invoiceNumber: null, confirmLevelChange: false,
    });
  });

  it("carries storedLevel on 409 level_differs — the field the confirm sentence reads", async () => {
    vi.mocked(teachBarcode).mockRejectedValue(
      new BarcodeError(409, "level_differs", "This code is already taught at another level", { storedLevel: "case" }),
    );
    const res = await teachPOST(req("teach", { ...teachBody, level: "inner" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "level_differs", storedLevel: "case" });
  });

  it("maps a cross-vendor SKU to 400 vendor_mismatch", async () => {
    vi.mocked(teachBarcode).mockRejectedValue(new BarcodeError(400, "vendor_mismatch", "That item belongs to a different vendor"));
    const res = await teachPOST(req("teach", teachBody));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "vendor_mismatch" });
  });
});

describe("forget — 200 and nothing else to say", () => {
  it("answers { ok: true } once the soft delete landed", async () => {
    const res = await forgetPOST(req("forget", forgetBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(forgetBarcode).toHaveBeenCalledWith(expect.anything(), {
      vendorId: VENDOR, locationId: LOCATION, code: UPC, skuId: SKU, level: "case",
    });
  });

  it("maps an untaught code to 404 not_taught", async () => {
    vi.mocked(forgetBarcode).mockRejectedValue(new BarcodeError(404, "not_taught", "That code is not taught on this item"));
    const res = await forgetPOST(req("forget", forgetBody));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "not_taught" });
  });
});
