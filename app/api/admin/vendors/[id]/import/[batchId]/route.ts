import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { loadImportBatch, VendorImportError, VENDOR_IMPORT_STAGE_MIN } from "@/lib/vendor-import";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; batchId: string }> }) {
  // [ASSUMPTION] Browser GETs may omit Origin. Reject explicit cross-site evidence;
  // the report shares the stage role floor and is bound to its vendor in the lib.
  if (req.headers.get("sec-fetch-site") === "cross-site") return jsonError(403, "bad_origin");
  if (req.headers.has("origin")) {
    const origin = assertSameOrigin(req);
    if (origin) return origin;
  }
  const { id, batchId } = await params;
  const ctx = await requireSession(req, `/api/admin/vendors/${id}/import/${batchId}`);
  if (ctx instanceof Response) return ctx;
  if (getRoleLevel(ctx.user.role) < VENDOR_IMPORT_STAGE_MIN) return jsonError(403, "forbidden");
  try {
    return jsonOk({ ...await loadImportBatch(ctx, id, batchId) });
  } catch (e) {
    if (e instanceof VendorImportError) return jsonError(e.status, e.code);
    throw e;
  }
}
