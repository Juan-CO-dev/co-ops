/**
 * lib/photos-client.ts — the browser half of a photo upload (audit W10 / B065).
 *
 * The rules, with a fake codec (no DOM, no canvas): what is sent as is, what is shrunk and to what
 * size, what happens when the browser cannot shrink it, and that the POST maps the hosting
 * platform's 413 and never hangs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PhotoTooLargeError, postPhoto, prepareUpload, type DecodedImage, type PhotoCodec, type PreparedUpload,
} from "@/lib/photos-client";
import { MAX_UPLOAD_BYTES } from "@/lib/photos-shared";

const MB = 1_000_000;
const file = (bytes: number, name = "IMG_0042.JPG", type = "image/jpeg") => new File([new Uint8Array(bytes)], name, { type });

interface CodecLog { decoded: number; released: number; encodes: Array<{ w: number; h: number; q: number }> }
/** A codec that "decodes" to the given pixel size and "encodes" to `sizeAt(quality)` bytes. */
function codec(width: number, height: number, sizeAt: (q: number) => number = () => 1 * MB): PhotoCodec & { log: CodecLog } {
  const log: CodecLog = { decoded: 0, released: 0, encodes: [] };
  return {
    log,
    async decode(): Promise<DecodedImage> { log.decoded += 1; return { width, height, source: null, release: () => { log.released += 1; } }; },
    async encodeJpeg(_image, w, h, q) { log.encodes.push({ w, h, q }); return new Blob([new Uint8Array(sizeAt(q))], { type: "image/jpeg" }); },
  };
}
const undecodable: PhotoCodec = {
  decode: async () => { throw new Error("cannot decode"); },
  encodeJpeg: async () => { throw new Error("never reached"); },
};

describe("prepareUpload", () => {
  it("a 6 MB, 48 MP phone photo is shrunk to 2560 px on the long side and sent as a JPEG inside the cap", async () => {
    const original = file(6 * MB);
    const c = codec(8000, 6000);
    const out = await prepareUpload(original, c);
    expect(out.resized).toBe(true);
    expect(out.blob).not.toBe(original);
    expect(out.blob.type).toBe("image/jpeg");
    expect(out.blob.size).toBeLessThanOrEqual(MAX_UPLOAD_BYTES);
    expect(out.name).toBe("IMG_0042.jpg");
    expect(c.log.encodes).toEqual([{ w: 2560, h: 1920, q: 0.85 }]);
    expect(c.log.released).toBe(1);
  });

  it("a portrait photo keeps its aspect ratio", async () => {
    const c = codec(3024, 4032);
    await prepareUpload(file(5 * MB), c);
    expect(c.log.encodes[0]).toMatchObject({ w: 1920, h: 2560 });
  });

  it("a photo already small in bytes AND pixels is sent as is: the same File, never re-encoded", async () => {
    const original = file(900_000, "receipt.jpg");
    const c = codec(1600, 1200);
    const out = await prepareUpload(original, c);
    expect(out).toEqual({ blob: original, name: "receipt.jpg", resized: false });
    expect(out.blob).toBe(original);
    expect(c.log.encodes).toEqual([]);
    expect(c.log.released).toBe(1);
  });

  it("a photo small in bytes but over 2560 px is shrunk too (one stored size for every photo)", async () => {
    const c = codec(4032, 3024);
    const out = await prepareUpload(file(2 * MB), c);
    expect(out.resized).toBe(true);
    expect(c.log.encodes).toEqual([{ w: 2560, h: 1920, q: 0.85 }]);
  });

  it("a photo inside 2560 px but over the byte cap is re-encoded at its own size (never scaled up)", async () => {
    const c = codec(2000, 1500);
    const out = await prepareUpload(file(5 * MB, "scan.png", "image/png"), c);
    expect(out.resized).toBe(true);
    expect(out.name).toBe("scan.jpg");
    expect(c.log.encodes).toEqual([{ w: 2000, h: 1500, q: 0.85 }]);
  });

  it("steps the quality down until the result fits the cap", async () => {
    const c = codec(8000, 6000, (q) => (q > 0.7 ? 5 * MB : 3 * MB));
    const out = await prepareUpload(file(7 * MB), c);
    expect(c.log.encodes.map((e) => e.q)).toEqual([0.85, 0.75, 0.65]);
    expect(out.blob.size).toBe(3 * MB);
  });

  it("when no quality fits: the original goes only if IT fits; otherwise PhotoTooLargeError (never an over-cap body)", async () => {
    const never = () => 5 * MB;
    const small = file(2 * MB);
    await expect(prepareUpload(small, codec(4032, 3024, never))).resolves.toMatchObject({ blob: small, resized: false });
    await expect(prepareUpload(file(6 * MB), codec(8000, 6000, never))).rejects.toBeInstanceOf(PhotoTooLargeError);
  });

  it("a photo the browser cannot decode (HEIC outside Safari): sent as is when it fits, the clear too-large error when it does not", async () => {
    const heic = file(3 * MB, "IMG_1.HEIC", "image/heic");
    await expect(prepareUpload(heic, undecodable)).resolves.toEqual({ blob: heic, name: "IMG_1.HEIC", resized: false });
    await expect(prepareUpload(file(6 * MB, "IMG_2.HEIC", "image/heic"), undecodable)).rejects.toBeInstanceOf(PhotoTooLargeError);
  });

  it("an encoder that fails falls back the same way, and the decoded image is still released", async () => {
    const c = codec(8000, 6000);
    c.encodeJpeg = async () => { throw new Error("encode failed"); };
    const small = file(1 * MB);
    await expect(prepareUpload(small, c)).resolves.toMatchObject({ blob: small, resized: false });
    await expect(prepareUpload(file(6 * MB), c)).rejects.toBeInstanceOf(PhotoTooLargeError);
    expect(c.log.released).toBe(2);
  });

  it("a decode that reports no pixels is a failure, not a 1×1 upload", async () => {
    await expect(prepareUpload(file(6 * MB), codec(0, 0))).rejects.toBeInstanceOf(PhotoTooLargeError);
  });

  it("a shrink that never finishes does not hold the button: after the deadline the original is used if it fits", async () => {
    const stuck: PhotoCodec = { decode: () => new Promise<DecodedImage>(() => {}), encodeJpeg: async () => new Blob() };
    const small = file(1 * MB);
    await expect(prepareUpload(small, stuck, 20)).resolves.toMatchObject({ blob: small, resized: false });
    await expect(prepareUpload(file(6 * MB), stuck, 20)).rejects.toBeInstanceOf(PhotoTooLargeError);
  });

  it("the result is never over the cap, whatever the codec does", async () => {
    for (const bytes of [1, 4 * MB, MAX_UPLOAD_BYTES, MAX_UPLOAD_BYTES + 1, 6 * MB, 8 * 1024 * 1024]) {
      for (const c of [codec(8000, 6000), codec(1000, 800), codec(8000, 6000, () => 9 * MB), undecodable]) {
        const out = await prepareUpload(file(bytes), c).catch((e: unknown) => e);
        if (out instanceof PhotoTooLargeError) continue;
        expect((out as PreparedUpload).blob.size).toBeLessThanOrEqual(MAX_UPLOAD_BYTES);
      }
    }
  });
});

describe("postPhoto", () => {
  const fetcher = vi.fn();
  const prepared: PreparedUpload = { blob: new Blob([new Uint8Array(1000)], { type: "image/jpeg" }), name: "IMG_0042.jpg", resized: true };
  beforeEach(() => { vi.stubGlobal("fetch", fetcher); });
  afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

  it("posts the prepared blob and the shop as multipart, same-origin, with an abort signal", async () => {
    fetcher.mockResolvedValueOnce(Response.json({ photoId: "7a2e3d4f-0000-4000-8000-000000000001" }));
    expect(await postPhoto(prepared, "shop-1")).toEqual({ ok: true, photoId: "7a2e3d4f-0000-4000-8000-000000000001" });
    const [url, init] = fetcher.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("/api/photos");
    expect(init).toMatchObject({ method: "POST", redirect: "manual" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const form = init.body as FormData;
    const sent = form.get("file") as File;
    expect(sent.size).toBe(1000);
    expect(sent.type).toBe("image/jpeg");
    expect(sent.name).toBe("IMG_0042.jpg");
    expect(form.get("locationId")).toBe("shop-1");
  });

  it("the hosting platform's 413 (not JSON, the route never ran) is too_large", async () => {
    fetcher.mockResolvedValueOnce(new Response("Request Entity Too Large\n\nFUNCTION_PAYLOAD_TOO_LARGE", { status: 413 }));
    expect(await postPhoto(prepared, "shop-1")).toEqual({ ok: false, error: "too_large" });
  });

  it("the route's own refusals keep their meaning; anything else is upload_failed", async () => {
    fetcher.mockResolvedValueOnce(Response.json({ code: "too_large" }, { status: 413 }));
    expect(await postPhoto(prepared, "shop-1")).toEqual({ ok: false, error: "too_large" });
    fetcher.mockResolvedValueOnce(Response.json({ code: "unsupported_type" }, { status: 415 }));
    expect(await postPhoto(prepared, "shop-1")).toEqual({ ok: false, error: "unsupported_type" });
    fetcher.mockResolvedValueOnce(Response.json({ code: "not_found" }, { status: 404 }));
    expect(await postPhoto(prepared, "shop-1")).toEqual({ ok: false, error: "upload_failed" });
    fetcher.mockResolvedValueOnce(new Response("<html>bad gateway</html>", { status: 502 }));
    expect(await postPhoto(prepared, "shop-1")).toEqual({ ok: false, error: "upload_failed" });
    fetcher.mockResolvedValueOnce(Response.json({ nothing: true }));
    expect(await postPhoto(prepared, "shop-1")).toEqual({ ok: false, error: "upload_failed" });
    fetcher.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await postPhoto(prepared, "shop-1")).toEqual({ ok: false, error: "upload_failed" });
  });

  it("a request that never answers ends at the deadline as upload_failed, and the request is aborted", async () => {
    let signal: AbortSignal | undefined;
    fetcher.mockImplementationOnce((_url: string, init: RequestInit) => { signal = init.signal ?? undefined; return new Promise(() => {}); });
    expect(await postPhoto(prepared, "shop-1", 25)).toEqual({ ok: false, error: "upload_failed" });
    expect(signal?.aborted).toBe(true);
  });

  it("a response whose body never arrives ends at the deadline too", async () => {
    fetcher.mockResolvedValueOnce({ status: 200, ok: true, json: () => new Promise(() => {}) });
    expect(await postPhoto(prepared, "shop-1", 25)).toEqual({ ok: false, error: "upload_failed" });
  });
});
