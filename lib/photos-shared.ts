/**
 * Photo uploader — PURE validators + path builder (client-safe, zero I/O, no
 * server imports; fully unit-testable). The `*-shared.ts` pattern (AGENTS.md):
 * the photos server lib (lib/photos.ts) and its vitest suite both import from
 * here; the POST /api/photos route validates the upload against these before it
 * ever touches Storage.
 *
 * The seam accepts the four image types a phone camera realistically produces
 * (jpeg/png/webp/heic). Object paths are namespaced
 * photos/{locationId}/{yyyy-mm}/{uuid}.{ext} so a location's photos cluster and
 * month-partitioning keeps listings sane.
 *
 * TWO SIZE CAPS, and they are not the same thing (audit W10 / B065):
 *   - MAX_PHOTO_BYTES (8 MB) is what the SERVER and the bucket accept — it matches
 *     the bucket's file_size_limit (migration 0164) so the app-layer rejection and
 *     the Storage-layer rejection agree.
 *   - MAX_UPLOAD_BYTES (4 MiB) is what the BROWSER may send through POST
 *     /api/photos. The request passes through a Vercel Function, whose request
 *     body is limited to 4.5 MB; anything larger is refused by the platform with
 *     a non-JSON 413 before the route runs. So the browser shrinks a photo first
 *     (lib/photos-client.ts) and never sends more than MAX_UPLOAD_BYTES.
 */

/** The allowed upload content types. jpeg/png/webp/heic — a phone camera's realistic set. */
export const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

/** Max STORED size in bytes (8 MB): the server-side check. Mirrors the bucket file_size_limit (0164). */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/**
 * Max bytes the BROWSER sends in one photo upload (4 MiB = 4,194,304 bytes).
 *
 * Platform rule, verified 2026-11-15 against https://vercel.com/docs/functions/limitations
 * ("Request body size", page last updated 2026-08-24): "The maximum payload size for the request
 * body or the response body of a Vercel Function is 4.5 MB. ... If a Vercel Function receives a
 * payload in excess of the limit it will return an error 413: FUNCTION_PAYLOAD_TOO_LARGE."
 * 4 MiB is under 4.5 MB whether that means 10^6 or 2^20 bytes, with room for the multipart
 * envelope and the locationId field.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Longest edge, in pixels, of a photo the browser shrinks before upload (owner decision 2026-11-15: option A). */
export const UPLOAD_MAX_EDGE_PX = 2560;

/** JPEG qualities tried in order when re-encoding; the first result inside MAX_UPLOAD_BYTES is sent. */
export const UPLOAD_JPEG_QUALITIES = [0.85, 0.75, 0.65] as const;

/** Content-type → file extension (for the object path). */
const EXT_BY_CONTENT_TYPE: Record<AllowedContentType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

/** True iff `ct` is one of the allowed image content types. Case-insensitive on
 *  the type token; tolerant of a trailing `; charset=…` parameter some clients add. */
export function isAllowedContentType(ct: string | null | undefined): ct is AllowedContentType {
  if (!ct) return false;
  const base = ct.split(";")[0]?.trim().toLowerCase() ?? "";
  return (ALLOWED_CONTENT_TYPES as readonly string[]).includes(base);
}

/** File extension for an allowed content type; null for anything not allowed. */
export function extForContentType(ct: string | null | undefined): string | null {
  if (!isAllowedContentType(ct)) return null;
  const base = ct.split(";")[0]!.trim().toLowerCase() as AllowedContentType;
  return EXT_BY_CONTENT_TYPE[base];
}

/** True iff a positive byte count is within the 8 MB cap. Zero/negative/NaN → false. */
export function isWithinSizeCap(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes > 0 && bytes <= MAX_PHOTO_BYTES;
}

/** True iff a positive byte count may be SENT by the browser (MAX_UPLOAD_BYTES). Zero/negative/NaN → false. */
export function isWithinUploadCap(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes > 0 && bytes <= MAX_UPLOAD_BYTES;
}

/**
 * The size an image is drawn at so its longest edge is at most `maxEdge`: scales DOWN only, keeps
 * the aspect ratio, whole pixels, never below 1. An image already inside the box is unchanged.
 */
export function fitWithin(w: number, h: number, maxEdge: number): { w: number; h: number } {
  const whole = (n: number) => (Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1);
  const W = whole(w);
  const H = whole(h);
  const longest = Math.max(W, H);
  if (!Number.isFinite(maxEdge) || maxEdge < 1 || longest <= maxEdge) return { w: W, h: H };
  const scale = maxEdge / longest;
  return { w: Math.max(1, Math.round(W * scale)), h: Math.max(1, Math.round(H * scale)) };
}

/**
 * Build the Storage object path for a photo:
 *   photos/{locationId}/{yyyy-mm}/{uuid}.{ext}
 * `when` defaults to now (injected for deterministic tests). Throws on an
 * unsupported content type — callers must have validated it first (isAllowedContentType).
 * The month segment uses UTC so the partition is stable regardless of server TZ.
 */
export function buildPhotoPath(
  locationId: string,
  photoId: string,
  contentType: string,
  when: Date = new Date(),
): string {
  const ext = extForContentType(contentType);
  if (ext === null) {
    throw new Error(`buildPhotoPath: unsupported content type ${contentType}`);
  }
  const yyyy = when.getUTCFullYear();
  const mm = String(when.getUTCMonth() + 1).padStart(2, "0");
  return `photos/${locationId}/${yyyy}-${mm}/${photoId}.${ext}`;
}
