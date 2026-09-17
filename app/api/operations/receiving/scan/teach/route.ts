/**
 * POST /api/operations/receiving/scan/teach — remember this label for next time (V3-B §5).
 *
 * 201 when a code was learned, 200 when it was already known: the client shows "Remembered
 * for next time" on the first and stays silent on the second, and a status that lied about
 * which happened would make the door chatter on every repeat scan.
 *
 * NOTHING IS EVER SILENTLY REWRITTEN (spec §11 finding 6). A code already taught for this
 * SKU at ANOTHER level comes back 409 `level_differs` carrying `storedLevel`; the client asks
 * one sentence and re-posts with `confirmLevelChange: true`, which ADDS the second level. The
 * same UPC really is printed on the case and on the inner pack.
 *
 * `invoiceNumber` is whatever the receiver has typed so far — often nothing — and rides into
 * the audit row so "codes taught on the truck that brought invoice 4471" stays answerable
 * without a delivery id, which does not exist yet at the door.
 */
import { type NextRequest } from "next/server";

import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { BarcodeError, SCAN_MIN, SYMBOLOGIES, teachBarcode, type Level, type Symbology } from "@/lib/barcodes";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEVELS: readonly string[] = ["case", "inner"];
const MIN_CODE = 6;
const MAX_CODE = 128;
const MAX_INVOICE = 64;

export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/operations/receiving/scan/teach");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < SCAN_MIN) return jsonError(403, "forbidden");

  const b = (parsed ?? {}) as Record<string, unknown>;
  if (typeof b.vendorId !== "string" || !UUID_RE.test(b.vendorId)) return jsonError(400, "invalid_payload", { field: "vendorId" });
  if (typeof b.locationId !== "string" || !UUID_RE.test(b.locationId)) return jsonError(400, "invalid_payload", { field: "locationId" });
  if (typeof b.skuId !== "string" || !UUID_RE.test(b.skuId)) return jsonError(400, "invalid_payload", { field: "skuId" });
  if (typeof b.code !== "string" || b.code.length < MIN_CODE || b.code.length > MAX_CODE) {
    return jsonError(400, "invalid_payload", { field: "code" });
  }
  if (typeof b.level !== "string" || !LEVELS.includes(b.level)) return jsonError(400, "invalid_payload", { field: "level" });
  if (b.symbology !== undefined && (typeof b.symbology !== "string" || !(SYMBOLOGIES as readonly string[]).includes(b.symbology))) {
    return jsonError(400, "invalid_payload", { field: "symbology" });
  }
  if (b.invoiceNumber != null && (typeof b.invoiceNumber !== "string" || b.invoiceNumber.length > MAX_INVOICE)) {
    return jsonError(400, "invalid_payload", { field: "invoiceNumber" });
  }
  if (b.confirmLevelChange !== undefined && typeof b.confirmLevelChange !== "boolean") {
    return jsonError(400, "invalid_payload", { field: "confirmLevelChange" });
  }

  try {
    const { created } = await teachBarcode(ctx, {
      vendorId: b.vendorId,
      locationId: b.locationId,
      code: b.code,
      skuId: b.skuId,
      level: b.level as Level,
      symbology: b.symbology as Symbology | undefined,
      invoiceNumber: (b.invoiceNumber as string | undefined) ?? null,
      confirmLevelChange: b.confirmLevelChange === true,
    });
    return jsonOk({ created }, created ? 201 : 200);
  } catch (e) {
    if (e instanceof BarcodeError) return jsonError(e.status, e.code, { message: e.message, ...(e.extra ?? {}) });
    throw e;
  }
}
