/**
 * Photo upload — the BROWSER half (audit W10 / B065). No server imports: safe in a client component.
 *
 * Why it exists. POST /api/photos passes through a Vercel Function, whose request body is limited to
 * 4.5 MB (see MAX_UPLOAD_BYTES in lib/photos-shared.ts for the source). A phone photo between 4.5 MB
 * and the app's own 8 MB cap passed every app check and was then refused by the platform with a
 * non-JSON 413 before the route ran; staff saw "upload failed" and every retry failed the same way.
 *
 * What it does (owner decision 2026-11-15, option A: shrink on the device).
 *   prepareUpload(file)  → what to send. A photo already inside UPLOAD_MAX_EDGE_PX and
 *     MAX_UPLOAD_BYTES is sent AS IS (same bytes). Anything larger is drawn at fitWithin(…) and
 *     re-encoded as JPEG, stepping the quality down until it fits. If the browser cannot decode or
 *     re-encode it (for example HEIC outside Safari), the original is sent only when it fits;
 *     otherwise PhotoTooLargeError — a clear message, never a silent platform 413.
 *     Re-encoding drops EXIF (GPS included); the decode applies the EXIF orientation first.
 *   postPhoto(prepared, locationId) → the POST, under ONE deadline (request + the body read). A
 *     platform 413 (any body) maps to "too_large". It never throws and never hangs.
 *
 * Nothing here logs: not the file, not its name, not its bytes.
 */
import {
  UPLOAD_JPEG_QUALITIES,
  UPLOAD_MAX_EDGE_PX,
  fitWithin,
  isWithinUploadCap,
} from "@/lib/photos-shared";

/** Longest the shrink may take before the original is used instead (when it fits). */
export const PREPARE_TIMEOUT_MS = 30_000;
/** Longest one upload (request + reading its answer) may take. A 4 MiB body on a weak phone signal needs room. */
export const UPLOAD_TIMEOUT_MS = 60_000;

/** The photo cannot be made small enough to send. The UI shows photo.capture.error.too_large. */
export class PhotoTooLargeError extends Error {
  constructor() {
    super("too_large");
    this.name = "PhotoTooLargeError";
  }
}

/** A decoded image: its pixel size with the EXIF orientation applied, and a hook that frees it. */
export interface DecodedImage {
  width: number;
  height: number;
  source: unknown;
  release(): void;
}

/** The two browser operations the shrink needs. Injected so the rules are testable without a DOM. */
export interface PhotoCodec {
  decode(file: Blob): Promise<DecodedImage>;
  encodeJpeg(image: DecodedImage, width: number, height: number, quality: number): Promise<Blob>;
}

export interface PreparedUpload {
  blob: Blob;
  /** The multipart filename; its extension matches blob.type. */
  name: string;
  /** True when the photo was re-encoded (smaller); false when the original bytes are sent. */
  resized: boolean;
}

export type PhotoUploadError = "too_large" | "unsupported_type" | "upload_failed";
export type PhotoUploadOutcome = { ok: true; photoId: string } | { ok: false; error: PhotoUploadError };

/**
 * `run(signal)` under a deadline: rejects at `ms` whatever `run` does, and aborts the signal both at
 * the deadline and once the outcome is decided (so a stalled body is released). Same contract as
 * lib/bounded-fetch.ts `withDeadline` (audit W06, a separate branch); kept local so this wave does
 * not depend on it. Fold the two together once both are on main.
 */
async function withDeadline<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error("deadline_exceeded")); // first, so the race reports the deadline, not the abort it causes
      controller.abort();
    }, ms);
  });
  const work = run(controller.signal);
  work.catch(() => {}); // a rejection after the deadline already decided is not unhandled
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function jpegName(original: string): string {
  const stem = original.replace(/\.[^./\\]*$/, "");
  return `${stem || "photo"}.jpg`;
}

type ShrinkResult = { kind: "as_is" } | { kind: "jpeg"; blob: Blob } | { kind: "failed" };

async function shrink(file: File, codec: PhotoCodec): Promise<ShrinkResult> {
  const image = await codec.decode(file);
  try {
    if (!(image.width >= 1) || !(image.height >= 1)) return { kind: "failed" };
    const target = fitWithin(image.width, image.height, UPLOAD_MAX_EDGE_PX);
    const insideEdge = target.w === Math.floor(image.width) && target.h === Math.floor(image.height);
    if (insideEdge && isWithinUploadCap(file.size)) return { kind: "as_is" };
    for (const quality of UPLOAD_JPEG_QUALITIES) {
      const blob = await codec.encodeJpeg(image, target.w, target.h, quality);
      if (isWithinUploadCap(blob.size)) return { kind: "jpeg", blob };
    }
    return { kind: "failed" };
  } finally {
    image.release();
  }
}

/**
 * Decide what to send for a picked file. Resolves with the original (when it is already small) or a
 * smaller JPEG; rejects with PhotoTooLargeError when neither can be sent. Never rejects otherwise.
 * The caller has already checked the content type.
 */
export async function prepareUpload(
  file: File,
  codec: PhotoCodec = browserCodec,
  timeoutMs: number = PREPARE_TIMEOUT_MS,
): Promise<PreparedUpload> {
  let result: ShrinkResult;
  try {
    result = await withDeadline(timeoutMs, () => shrink(file, codec));
  } catch {
    result = { kind: "failed" }; // cannot decode / re-encode here, or it took too long
  }
  if (result.kind === "jpeg") return { blob: result.blob, name: jpegName(file.name), resized: true };
  // As is — but only ever inside the cap: an undecodable 6 MB photo gets the clear message, not a 413.
  if (!isWithinUploadCap(file.size)) throw new PhotoTooLargeError();
  return { blob: file, name: file.name || "photo", resized: false };
}

/**
 * POST the prepared photo to /api/photos under UPLOAD_TIMEOUT_MS. Never throws; never hangs.
 * A 413 is "too_large" whatever its body (the platform's own 413 is not JSON and never reaches the route).
 */
export async function postPhoto(
  prepared: PreparedUpload,
  locationId: string,
  timeoutMs: number = UPLOAD_TIMEOUT_MS,
): Promise<PhotoUploadOutcome> {
  const fail = (error: PhotoUploadError): PhotoUploadOutcome => ({ ok: false, error });
  const form = new FormData();
  form.append("file", prepared.blob, prepared.name);
  form.append("locationId", locationId);
  try {
    return await withDeadline(timeoutMs, async (signal): Promise<PhotoUploadOutcome> => {
      const res = await fetch("/api/photos", { method: "POST", body: form, redirect: "manual", signal });
      if (res.status === 413) return fail("too_large");
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: unknown };
        if (body?.code === "too_large") return fail("too_large");
        if (body?.code === "unsupported_type") return fail("unsupported_type");
        return fail("upload_failed");
      }
      const data = (await res.json().catch(() => ({}))) as { photoId?: unknown };
      return typeof data?.photoId === "string" && data.photoId !== "" ? { ok: true, photoId: data.photoId } : fail("upload_failed");
    });
  } catch {
    return fail("upload_failed"); // offline, aborted, or no answer by the deadline
  }
}

/** The real codec: createImageBitmap (EXIF orientation applied) with an <img> fallback, and a 2D canvas. */
const browserCodec: PhotoCodec = {
  async decode(file) {
    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        return { width: bitmap.width, height: bitmap.height, source: bitmap, release: () => bitmap.close() };
      } catch {
        // Fall through: an older engine without the options argument, or a format only <img> decodes.
      }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();
      return { width: img.naturalWidth, height: img.naturalHeight, source: img, release: () => URL.revokeObjectURL(url) };
    } catch (err) {
      URL.revokeObjectURL(url);
      throw err;
    }
  },
  encodeJpeg(image, width, height, quality) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return Promise.reject(new Error("no_canvas"));
    // JPEG has no alpha: a transparent PNG (a screenshot of a receipt) lands on white, not black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image.source as CanvasImageSource, 0, 0, width, height);
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        canvas.width = 0; // free the backing store now (phone canvas memory is scarce)
        canvas.height = 0;
        if (blob && blob.type === "image/jpeg" && blob.size > 0) resolve(blob);
        else reject(new Error("encode_failed"));
      }, "image/jpeg", quality);
    });
  },
};
