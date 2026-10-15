/**
 * POST /api/operations/receiving/pack-change — "This case looks different" (catalog Phase 2b, 0261).
 * A REPORT, not an edit: KH+ at their shop (the lib binds), same-origin, no step-up.
 * Body: { skuId: uuid, locationId: uuid, deliveryId?: uuid | null, note?: string | null,
 *         proposal?: { innerCount, eachWeight, eachUnit } | null, photoId?: uuid | null }
 * 201 = filed; 200 = joined the shop's open report for this item (the door says "already reported").
 */
import { type NextRequest } from "next/server";

import { requireSession } from "@/lib/session";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { filePackChangeRequest, PackChangeRequestError } from "@/lib/pack-change-requests";
import { PACK_REQUEST_FILE_MIN, PACK_REQUEST_NOTE_MAX, parsePackChangeProposal } from "@/lib/pack-change-requests-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optUuid = (v: unknown): string | null | undefined =>
  v === null || v === undefined ? null : typeof v === "string" && UUID_RE.test(v) ? v : undefined;

export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/operations/receiving/pack-change");
  if (ctx instanceof Response) return ctx;
  if (ctx.level < PACK_REQUEST_FILE_MIN) return jsonError(403, "forbidden");

  const b = (parsed ?? {}) as Record<string, unknown>;
  if (typeof b.skuId !== "string" || !UUID_RE.test(b.skuId)) return jsonError(400, "invalid_payload", { field: "skuId" });
  if (typeof b.locationId !== "string" || !UUID_RE.test(b.locationId)) return jsonError(400, "invalid_payload", { field: "locationId" });
  const deliveryId = optUuid(b.deliveryId);
  if (deliveryId === undefined) return jsonError(400, "invalid_payload", { field: "deliveryId" });
  const photoId = optUuid(b.photoId);
  if (photoId === undefined) return jsonError(400, "invalid_payload", { field: "photoId" });
  if (b.note !== undefined && b.note !== null && (typeof b.note !== "string" || b.note.length > PACK_REQUEST_NOTE_MAX)) {
    return jsonError(400, "invalid_payload", { field: "note" });
  }
  const proposal = parsePackChangeProposal(b.proposal);
  if (proposal === "invalid") return jsonError(400, "invalid_payload", { field: "proposal" });

  try {
    const r = await filePackChangeRequest(ctx, {
      skuId: b.skuId, locationId: b.locationId, deliveryId, photoId, proposal,
      note: typeof b.note === "string" ? b.note : null,
    });
    return jsonOk({ id: r.id, already: r.already }, r.already ? 200 : 201);
  } catch (e) {
    if (e instanceof PackChangeRequestError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
