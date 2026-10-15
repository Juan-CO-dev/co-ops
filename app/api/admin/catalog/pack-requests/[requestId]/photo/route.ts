/**
 * GET /api/admin/catalog/pack-requests/[requestId]/photo — a door report's photo, REPORT-BOUND (catalog Phase 2b,
 * Astra 2b r2). The lib authorizes the viewer as a reviewer of the REPORT's shop (social media manager
 * refused; MoO+ any shop), signs ONLY the photo stored on that report, and this 302s to the
 * short-lived signed URL. Every miss is 404 (no oracle). A read: no step-up.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { jsonError } from "@/lib/api-helpers";
import { PackChangeRequestError, signPackRequestPhoto } from "@/lib/pack-change-requests";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  if (!UUID_RE.test(requestId)) return jsonError(404, "not_found");
  const ctx = await requireSession(req, `/api/admin/catalog/pack-requests/${requestId}/photo`);
  if (ctx instanceof Response) return ctx;
  try {
    const { signedUrl } = await signPackRequestPhoto(ctx, { requestId, additionId: null });
    return NextResponse.redirect(signedUrl, 302);
  } catch (e) {
    if (e instanceof PackChangeRequestError) return jsonError(e.status, e.code);
    throw e;
  }
}
