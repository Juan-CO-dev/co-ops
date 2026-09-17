/**
 * POST /api/operations/receiving/scan/lookup — what does this scanned label mean? (V3-B §5)
 *
 * Read-only and unaudited on purpose: a lookup is a question, not an act. The answer is the
 * lib's own `ScanMatch` plus the normalised code, forwarded verbatim — the door's `ScanField`
 * branches on `kind` and teaches/steps/forgets against `normalized.code`, so any reshaping
 * here would quietly break the client.
 *
 * NO DELIVERY ID: the door has no `vendor_deliveries` row until submit (lines live in the
 * form's client state), so the key is `vendorId` + `locationId`, both known while the form is
 * open. `lineSkuIds` is what turns a `sku` match into a `line` match — the SKUs already on
 * the screen — and it is capped rather than trusted.
 *
 * GATE ORDER IS THE CONTRACT: same-origin, then body, then session, then the receiving floor.
 * `assertSameOrigin` runs FIRST so a cross-site POST never touches the session or the catalog.
 */
import { type NextRequest } from "next/server";

import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { BarcodeError, lookupScan, SCAN_MIN } from "@/lib/barcodes";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A delivery with >200 distinct SKUs on screen is past any real truck — refuse, don't fan out. */
const MAX_LINE_SKUS = 200;
const MIN_CODE = 6;
const MAX_CODE = 128;

export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/operations/receiving/scan/lookup");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < SCAN_MIN) return jsonError(403, "forbidden");

  const b = (parsed ?? {}) as Record<string, unknown>;
  if (typeof b.vendorId !== "string" || !UUID_RE.test(b.vendorId)) return jsonError(400, "invalid_payload", { field: "vendorId" });
  if (typeof b.locationId !== "string" || !UUID_RE.test(b.locationId)) return jsonError(400, "invalid_payload", { field: "locationId" });
  if (typeof b.code !== "string" || b.code.length < MIN_CODE || b.code.length > MAX_CODE) {
    return jsonError(400, "invalid_payload", { field: "code" });
  }
  // Absent is the common case — the receiver may scan before a single line is on screen.
  const raw: unknown = b.lineSkuIds ?? [];
  if (!Array.isArray(raw) || raw.length > MAX_LINE_SKUS || !raw.every((id) => typeof id === "string" && UUID_RE.test(id))) {
    return jsonError(400, "invalid_payload", { field: "lineSkuIds" });
  }

  try {
    const match = await lookupScan(ctx, {
      vendorId: b.vendorId,
      locationId: b.locationId,
      code: b.code,
      lineSkuIds: raw as string[],
    });
    return jsonOk({ ...match });
  } catch (e) {
    if (e instanceof BarcodeError) return jsonError(e.status, e.code, { message: e.message, ...(e.extra ?? {}) });
    throw e;
  }
}
