/**
 * POST /api/operations/receiving/scan/forget — this code is on the wrong item (V3-B §5, §7).
 *
 * The receiver's escape hatch from a mistaught code: the line's "…" menu → "Forget this
 * code". A SOFT delete (`forgotten_at`), so the history stays and 0206's live unique key
 * frees the code to be taught again cleanly.
 *
 * Audited as DESTRUCTIVE (`sku.barcode.forgotten`, lib/destructive-actions.ts) — unlike its
 * `taught` sibling it removes a live code from every future lookup, so the next receiver
 * scanning that case meets the unknown-code sheet instead of the line.
 *
 * The `code` posted here is the stored key the client got back from lookup or teach, not a
 * raw label; the lib matches it verbatim for that reason.
 */
import { type NextRequest } from "next/server";

import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { BarcodeError, forgetBarcode, SCAN_MIN, type Level } from "@/lib/barcodes";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEVELS: readonly string[] = ["case", "inner"];
const MIN_CODE = 6;
const MAX_CODE = 128;

export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/operations/receiving/scan/forget");
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

  try {
    await forgetBarcode(ctx, {
      vendorId: b.vendorId,
      locationId: b.locationId,
      code: b.code,
      skuId: b.skuId,
      level: b.level as Level,
    });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof BarcodeError) return jsonError(e.status, e.code, { message: e.message, ...(e.extra ?? {}) });
    throw e;
  }
}
