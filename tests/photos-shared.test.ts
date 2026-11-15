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
  MAX_UPLOAD_BYTES,
  UPLOAD_JPEG_QUALITIES,
  UPLOAD_MAX_EDGE_PX,
  fitWithin,
  isWithinUploadCap,
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

// Audit W10 / B065. The request to POST /api/photos passes through a Vercel Function, whose request
// body is limited to 4.5 MB (https://vercel.com/docs/functions/limitations, verified 2026-11-15). The
// 8 MB cap is what the SERVER accepts; the browser must never send more than the upload cap.
describe("upload cap (the hosting request-body limit)", () => {
  it("MAX_UPLOAD_BYTES is under the 4.5 MB function body limit, with room for the multipart envelope", () => {
    expect(MAX_UPLOAD_BYTES).toBeLessThan(4_500_000);
    expect(4_500_000 - MAX_UPLOAD_BYTES).toBeGreaterThan(64 * 1024);
    expect(MAX_UPLOAD_BYTES).toBeLessThan(MAX_PHOTO_BYTES);
  });

  it("a 6 MB photo passes the server cap but is NOT uploadable as-is (the gap the bug lived in)", () => {
    expect(isWithinSizeCap(6_000_000)).toBe(true);
    expect(isWithinUploadCap(6_000_000)).toBe(false);
    expect(isWithinUploadCap(4_600_000)).toBe(false);
  });

  it("isWithinUploadCap boundaries: the cap is inclusive; zero, negative and NaN are refused", () => {
    expect(isWithinUploadCap(1)).toBe(true);
    expect(isWithinUploadCap(MAX_UPLOAD_BYTES)).toBe(true);
    expect(isWithinUploadCap(MAX_UPLOAD_BYTES + 1)).toBe(false);
    expect(isWithinUploadCap(0)).toBe(false);
    expect(isWithinUploadCap(-5)).toBe(false);
    expect(isWithinUploadCap(Number.NaN)).toBe(false);
    expect(isWithinUploadCap(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("the shrink settings: 2560 px longest edge, qualities tried from best to smallest", () => {
    expect(UPLOAD_MAX_EDGE_PX).toBe(2560);
    expect([...UPLOAD_JPEG_QUALITIES]).toEqual([0.85, 0.75, 0.65]);
  });
});

describe("fitWithin", () => {
  it("scales a landscape and a portrait phone photo down to the longest edge, keeping the aspect ratio", () => {
    expect(fitWithin(8000, 6000, 2560)).toEqual({ w: 2560, h: 1920 });
    expect(fitWithin(6000, 8000, 2560)).toEqual({ w: 1920, h: 2560 });
    expect(fitWithin(4032, 3024, 2560)).toEqual({ w: 2560, h: 1920 });
    expect(fitWithin(3024, 4032, 2560)).toEqual({ w: 1920, h: 2560 });
  });

  it("never scales up: an image already inside the box is unchanged", () => {
    expect(fitWithin(1600, 1200, 2560)).toEqual({ w: 1600, h: 1200 });
    expect(fitWithin(2560, 1440, 2560)).toEqual({ w: 2560, h: 1440 });
    expect(fitWithin(1, 1, 2560)).toEqual({ w: 1, h: 1 });
  });

  it("returns whole pixels of at least 1, even for an extreme strip or junk input", () => {
    expect(fitWithin(10000, 1, 2560)).toEqual({ w: 2560, h: 1 });
    expect(fitWithin(1, 10000, 2560)).toEqual({ w: 1, h: 2560 });
    expect(fitWithin(0, 0, 2560)).toEqual({ w: 1, h: 1 });
    expect(fitWithin(Number.NaN, -3, 2560)).toEqual({ w: 1, h: 1 });
    const odd = fitWithin(4001, 2999, 2560);
    expect(Number.isInteger(odd.w) && Number.isInteger(odd.h)).toBe(true);
    expect(Math.max(odd.w, odd.h)).toBe(2560);
  });
});
