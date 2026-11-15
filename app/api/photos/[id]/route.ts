/**
 * GET /api/photos/[id] — the canonical read seam for a photo (photo uploader
 * seam, 0164). Location-binds the actor against the photo's location, mints a
 * short-lived (60s) signed URL for the private-bucket object, and 302-redirects
 * to it. The client only ever holds this app URL — never a Storage URL.
 *
 * Visible to any authenticated viewer bound to the photo's location (NOT L5-gated
 * — a photo link on a report is visible to anyone who can see the report). A
 * missing photo and an out-of-location photo both return 404 (no IDOR oracle).
 *
 * A malformed id (not a uuid) is the same 404, answered here before any database
 * work (audit W10 / B166): it used to reach the uuid column, come back as
 * PostgREST 22P02 and surface as a 500. Auth still answers first.
 */
import { NextResponse, type NextRequest } from "next/server";

import { requireSession } from "@/lib/session";
import { jsonError } from "@/lib/api-helpers";
import { isUuid } from "@/lib/admin/step-up-shared";
import { getPhotoSignedUrl, PhotoError } from "@/lib/photos";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await requireSession(req, `/api/photos/${id}`);
  if (ctx instanceof Response) return ctx;
  if (!isUuid(id)) return jsonError(404, "not_found", { message: "Photo not found" });

  try {
    const { signedUrl } = await getPhotoSignedUrl(ctx, id);
    return NextResponse.redirect(signedUrl, 302);
  } catch (err) {
    if (err instanceof PhotoError) return jsonError(err.status, err.code, { message: err.message });
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/photos/[id] GET] unexpected error:", msg);
    return jsonError(500, "internal_error", { message: "photo fetch failed" });
  }
}
