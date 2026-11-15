/**
 * Photo uploader — SERVER lib (photo uploader seam, 0164). SERVICE-ROLE ONLY.
 *
 * Two operations, both service-role (the `photos` bucket is private + RLS-locked;
 * end users never touch Storage directly):
 *
 *   uploadPhoto(actor, { locationId, bytes, contentType })
 *     Validate (type + size, via the pure lib/photos-shared validators + a
 *     location-bind check against the actor) → upload the binary to the private
 *     `photos` bucket at photos/{locationId}/{yyyy-mm}/{uuid}.{ext} → INSERT the
 *     registry row → return the photo id. The row id is minted client-side (uuid)
 *     so the object path and the row PK match.
 *
 *   getPhotoSignedUrl(actor, photoId)
 *     Load the registry row → check the actor may READ row.location_id's reports →
 *     mint a SHORT-LIVED (60s) signed URL for the object. The GET /api/photos/[id]
 *     route 302-redirects to it; the client only ever holds the app URL
 *     /api/photos/{id}, never a Storage URL.
 *
 * Authorization is APP-LAYER (location-bind IDOR guard) — this is an operational
 * seam consumed by checklists + receiving, not an admin surface. The bucket's
 * deny-all storage policies + the photos-table deny-all RLS triad (0164) mean the
 * service-role client here is the sole authority.
 *
 * TWO BINDS, ON PURPOSE (audit W10 / B064; lib/locations.ts: "Report navigation
 * grant only. Operational writes retain lockLocationContext."):
 *   - UPLOAD is an operational write: lockLocationContext — a member of the shop,
 *     or level 9+.
 *   - READ follows the reports the photo links are shown on: canReadReportLocation
 *     — a member of the shop, or level 8+ (the Manager of Operations opens every
 *     shop's closing / opening / receiving reports, so the photos on them open
 *     too). Below level 8 the read is still membership, role by role unchanged.
 */
import "server-only";

import { randomUUID } from "node:crypto";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { canReadReportLocation, lockLocationContext, type LocationActor } from "@/lib/locations";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import {
  isAllowedContentType,
  isWithinSizeCap,
  buildPhotoPath,
} from "@/lib/photos-shared";

const PHOTO_BUCKET = "photos";
const SIGNED_URL_TTL_SECONDS = 60;

export class PhotoError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "PhotoError";
  }
}

function actorLoc(actor: AuthContext): LocationActor {
  return { role: actor.user.role, locations: actor.locations };
}

export interface UploadPhotoInput {
  locationId: string;
  bytes: Buffer | Uint8Array;
  contentType: string;
}

/**
 * Validate + store an uploaded photo. Returns the registry row id (the caller
 * stores it in checklist_completions.photo_id, or the URL /api/photos/{id} in a
 * receiving text column). Throws PhotoError (4xx) on bad input / location IDOR.
 */
export async function uploadPhoto(
  actor: AuthContext,
  input: UploadPhotoInput,
): Promise<{ photoId: string }> {
  if (!lockLocationContext(actorLoc(actor), input.locationId)) {
    throw new PhotoError(404, "not_found", "Location not found");
  }
  if (!isAllowedContentType(input.contentType)) {
    throw new PhotoError(415, "unsupported_type", "Unsupported image type");
  }
  const byteSize = input.bytes.byteLength;
  if (!isWithinSizeCap(byteSize)) {
    throw new PhotoError(413, "too_large", "Image exceeds the size cap");
  }

  const photoId = randomUUID();
  const storagePath = buildPhotoPath(input.locationId, photoId, input.contentType);
  const sb = getServiceRoleClient();

  const { error: upErr } = await sb.storage
    .from(PHOTO_BUCKET)
    .upload(storagePath, input.bytes, {
      contentType: input.contentType,
      upsert: false,
    });
  if (upErr) throw new Error(`uploadPhoto storage: ${upErr.message}`);

  const { data: inserted, error: insErr } = await sb
    .from("photos")
    .insert({
      id: photoId,
      storage_path: storagePath,
      uploaded_by: actor.user.id,
      location_id: input.locationId,
      byte_size: byteSize,
      content_type: input.contentType,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (insErr) {
    // Best-effort cleanup of the orphaned object so a failed insert doesn't leak a file.
    await sb.storage.from(PHOTO_BUCKET).remove([storagePath]).catch(() => {});
    throw new Error(`uploadPhoto insert: ${insErr.message}`);
  }
  if (!inserted) {
    await sb.storage.from(PHOTO_BUCKET).remove([storagePath]).catch(() => {});
    throw new Error("uploadPhoto insert returned no row");
  }

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "photo.upload",
    resourceTable: "photos",
    resourceId: photoId,
    metadata: { location_id: input.locationId, byte_size: byteSize, content_type: input.contentType },
    ipAddress: null,
    userAgent: null,
  });

  return { photoId };
}

/**
 * Mint a short-lived signed URL for a photo, after the REPORT-READ check against
 * the actor (canReadReportLocation: a member of the photo's shop, or level 8+ —
 * the same grant that opens the report the photo link sits on; B064). Throws
 * PhotoError(404) when the photo doesn't exist OR the actor may not read its
 * shop (indistinguishable to the caller — no IDOR oracle).
 */
export async function getPhotoSignedUrl(
  actor: AuthContext,
  photoId: string,
): Promise<{ signedUrl: string }> {
  const sb = getServiceRoleClient();
  const { data: row, error } = await sb
    .from("photos")
    .select("id, storage_path, location_id")
    .eq("id", photoId)
    .maybeSingle<{ id: string; storage_path: string; location_id: string }>();
  // 22P02 = the id is not a uuid (B166): the same "not found" as an id that matches nothing, never a 500.
  if (error?.code === "22P02") throw new PhotoError(404, "not_found", "Photo not found");
  if (error) throw new Error(`getPhotoSignedUrl load: ${error.message}`);
  if (!row) throw new PhotoError(404, "not_found", "Photo not found");
  if (!canReadReportLocation(actorLoc(actor), row.location_id)) {
    // Same 404 as missing — never confirm existence to an out-of-location actor.
    throw new PhotoError(404, "not_found", "Photo not found");
  }

  const { data: signed, error: signErr } = await sb.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS);
  if (signErr) throw new Error(`getPhotoSignedUrl sign: ${signErr.message}`);
  if (!signed?.signedUrl) throw new Error("getPhotoSignedUrl: no signed url returned");

  return { signedUrl: signed.signedUrl };
}
