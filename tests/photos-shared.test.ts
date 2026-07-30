/**
 * Unit spine — lib/photos-shared.ts (pure; photo uploader seam, 0164).
 * Pins: allowed-type gate (incl. charset param + case), size cap boundaries,
 * ext mapping, and the object-path shape (namespace + UTC month + ext).
 */
import { describe, it, expect } from "vitest";
import {
  ALLOWED_CONTENT_TYPES,
  MAX_PHOTO_BYTES,
  isAllowedContentType,
  extForContentType,
  isWithinSizeCap,
  buildPhotoPath,
} from "@/lib/photos-shared";

describe("isAllowedContentType", () => {
  it("accepts each of the four allowed image types", () => {
    for (const ct of ALLOWED_CONTENT_TYPES) {
      expect(isAllowedContentType(ct)).toBe(true);
    }
  });

  it("is case-insensitive and tolerates a charset parameter", () => {
    expect(isAllowedContentType("IMAGE/JPEG")).toBe(true);
    expect(isAllowedContentType("image/png; charset=binary")).toBe(true);
    expect(isAllowedContentType("  image/webp  ")).toBe(true);
  });

  it("rejects non-image and unsupported image types, null, empty", () => {
    expect(isAllowedContentType("image/gif")).toBe(false);
    expect(isAllowedContentType("application/pdf")).toBe(false);
    expect(isAllowedContentType("text/plain")).toBe(false);
    expect(isAllowedContentType(null)).toBe(false);
    expect(isAllowedContentType(undefined)).toBe(false);
    expect(isAllowedContentType("")).toBe(false);
  });
});

describe("extForContentType", () => {
  it("maps allowed types to extensions", () => {
    expect(extForContentType("image/jpeg")).toBe("jpg");
    expect(extForContentType("image/png")).toBe("png");
    expect(extForContentType("image/webp")).toBe("webp");
    expect(extForContentType("image/heic")).toBe("heic");
    expect(extForContentType("image/jpeg; charset=binary")).toBe("jpg");
  });

  it("returns null for disallowed types", () => {
    expect(extForContentType("image/gif")).toBeNull();
    expect(extForContentType(null)).toBeNull();
  });
});

describe("isWithinSizeCap", () => {
  it("accepts positive sizes up to and including the cap", () => {
    expect(isWithinSizeCap(1)).toBe(true);
    expect(isWithinSizeCap(MAX_PHOTO_BYTES)).toBe(true);
    expect(isWithinSizeCap(MAX_PHOTO_BYTES - 1)).toBe(true);
  });

  it("rejects the cap+1, zero, negative, and NaN", () => {
    expect(isWithinSizeCap(MAX_PHOTO_BYTES + 1)).toBe(false);
    expect(isWithinSizeCap(0)).toBe(false);
    expect(isWithinSizeCap(-5)).toBe(false);
    expect(isWithinSizeCap(Number.NaN)).toBe(false);
  });
});

describe("buildPhotoPath", () => {
  const LOC = "11111111-1111-1111-1111-111111111111";
  const PID = "22222222-2222-2222-2222-222222222222";

  it("builds photos/{loc}/{yyyy-mm}/{uuid}.{ext} with UTC month, zero-padded", () => {
    const when = new Date(Date.UTC(2026, 6, 9, 12, 0, 0)); // July (month index 6)
    expect(buildPhotoPath(LOC, PID, "image/jpeg", when)).toBe(
      `photos/${LOC}/2026-07/${PID}.jpg`,
    );
  });

  it("zero-pads single-digit months and honors the content-type ext", () => {
    const jan = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    expect(buildPhotoPath(LOC, PID, "image/webp", jan)).toBe(
      `photos/${LOC}/2026-01/${PID}.webp`,
    );
  });

  it("throws on an unsupported content type", () => {
    expect(() => buildPhotoPath(LOC, PID, "image/gif")).toThrow();
  });
});
