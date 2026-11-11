import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { VendorMailError } from "@/lib/vendor-mail";
import { actOnVendorMail } from "@/lib/vendor-mail-actions";
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const ctx = await requireSession(req, "/api/operations/vendor-mail");
  if (ctx instanceof Response) return ctx;
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "invalid_payload");
    const { expected_revision, request_id, ...payload } = body;
    void expected_revision; void request_id; void payload;
    return jsonOk({ result: await actOnVendorMail(ctx, (await params).id, "assign", body, payload) });
  } catch (error) {
    if (error instanceof VendorMailError) return jsonError(error.status, error.code);
    throw error;
  }
}
