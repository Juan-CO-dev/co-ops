import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { applyVendorImport, VendorImportError, VENDOR_IMPORT_APPLY_MIN } from "@/lib/vendor-import";
import type { Decision } from "@/lib/vendor-import-shared/model";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; batchId: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  const { id, batchId } = await params;
  const ctx = await requireSession(req, `/api/admin/vendors/${id}/import/${batchId}/apply`);
  if (ctx instanceof Response) return ctx;
  if (getRoleLevel(ctx.user.role) < VENDOR_IMPORT_APPLY_MIN) return jsonError(403, "forbidden");
  const stepUp = assertStepUp(ctx, "A");
  if (!stepUp.ok) return jsonError(403, stepUp.code);
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "invalid_payload");
  const { decisions, expectedDigest } = body as Record<string, unknown>;
  if (!decisions || typeof decisions !== "object" || Array.isArray(decisions)
    || Object.values(decisions).some(d => d !== "accept" && d !== "skip")
    || typeof expectedDigest !== "string" || !/^[a-f0-9]{64}$/.test(expectedDigest)) {
    return jsonError(400, "invalid_payload");
  }
  try {
    return jsonOk({ ...await applyVendorImport(ctx, id, batchId, decisions as Record<string, Decision>, expectedDigest) });
  } catch (e) {
    if (e instanceof VendorImportError) return jsonError(e.status, e.code);
    throw e;
  }
}
