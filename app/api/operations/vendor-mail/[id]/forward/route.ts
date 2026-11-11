import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { VendorMailError } from "@/lib/vendor-mail";
import { forwardVendorMail } from "@/lib/vendor-mail-forward";
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const ctx = await requireSession(req, "/api/operations/vendor-mail");
  if (ctx instanceof Response) return ctx;
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "invalid_payload");
    if (Object.keys(body).some(key => !["expected_revision", "request_id", "recipient", "staff_id", "note"].includes(key))) return jsonError(400, "invalid_payload");
    return jsonOk({ result: await forwardVendorMail(ctx, (await params).id, body) });
  } catch (error) {
    if (error instanceof VendorMailError) return jsonError(error.status, error.code);
    throw error;
  }
}
