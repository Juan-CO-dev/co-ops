/**
 * POST /api/photos — upload a photo (photo uploader seam, 0164).
 *
 * multipart/form-data body:
 *   file       — the image blob (jpeg/png/webp/heic, ≤ 8 MB)
 *   locationId — the location the photo belongs to (validated against the actor's
 *                locations — a location-bind IDOR guard)
 *
 * Response: { photoId: string }. The caller stores photoId in
 * checklist_completions.photo_id, or the URL /api/photos/{photoId} in a receiving
 * text column. Reads happen via GET /api/photos/[id] (302 → short-lived signed URL).
 *
 * Auth: requireSession (any authenticated staff member). Validation + storage +
 * the registry insert live in lib/photos.ts (service-role); this route only parses
 * the multipart body and maps PhotoError → HTTP.
 */
import { type NextRequest } from "next/server";

import { requireSession } from "@/lib/session";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { uploadPhoto, PhotoError } from "@/lib/photos";

export async function POST(req: NextRequest) {
  const ctx = await requireSession(req, "/api/photos");
  if (ctx instanceof Response) return ctx;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "invalid_form", { message: "Body must be multipart/form-data" });
  }

  const file = form.get("file");
  const locationId = form.get("locationId");
  if (!(file instanceof File)) {
    return jsonError(400, "missing_file", { message: "A `file` field is required" });
  }
  if (typeof locationId !== "string" || locationId === "") {
    return jsonError(400, "missing_location", { message: "A `locationId` field is required" });
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  try {
    const { photoId } = await uploadPhoto(ctx, {
      locationId,
      bytes,
      contentType: file.type,
    });
    return jsonOk({ photoId });
  } catch (err) {
    if (err instanceof PhotoError) return jsonError(err.status, err.code, { message: err.message });
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/photos POST] unexpected error:", msg);
    return jsonError(500, "internal_error", { message: "photo upload failed" });
  }
}
