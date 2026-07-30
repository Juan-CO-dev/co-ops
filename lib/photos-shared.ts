/**
 * Photo uploader — PURE validators + path builder (client-safe, zero I/O, no
 * server imports; fully unit-testable). The `*-shared.ts` pattern (AGENTS.md):
 * the photos server lib (lib/photos.ts) and its vitest suite both import from
 * here; the POST /api/photos route validates the upload against these before it
 * ever touches Storage.
 *
 * The seam accepts the four image types a phone camera realistically produces
 * (jpeg/png/webp/heic). Size cap is 8 MB — matching the bucket's file_size_limit
 * (migration 0164) so the app-layer rejection and the Storage-layer rejection
 * agree. Object paths are namespaced photos/{locationId}/{yyyy-mm}/{uuid}.{ext}
 * so a location's photos cluster and month-partitioning keeps listings sane.
 */

/** The allowed upload content types. jpeg/png/webp/heic — a phone camera's realistic set. */
export const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

/** Max upload size in bytes (8 MB). Mirrors the bucket file_size_limit (0164). */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

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
