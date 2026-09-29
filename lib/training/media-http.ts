import { coScenesEtag } from "./co-scenes-shared";

export type MediaRange = { status: 200; length: number } | { status: 206; start: number; end: number; length: number } | { status: 416 };

/** Single GET ranges only. Malformed/multipart ranges intentionally serve 200 full. */
export function resolveMediaRange(header: string | null, ifRange: string | null, etag: string, size: number): MediaRange {
  const full: MediaRange = { status: 200, length: size };
  if (!header || (ifRange !== null && ifRange !== etag)) return full;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return full;
  const total = BigInt(size);
  let start: bigint;
  let end: bigint;
  if (!match[1]) {
    const suffix = BigInt(match[2]!);
    if (suffix === BigInt(0) || total === BigInt(0)) return { status: 416 };
    start = suffix >= total ? BigInt(0) : total - suffix;
    end = total - BigInt(1);
  } else {
    start = BigInt(match[1]);
    end = match[2] ? BigInt(match[2]) : total - BigInt(1);
    if (match[2] && end < start) return full;
    if (start >= total) return { status: 416 };
    if (end >= total) end = total - BigInt(1);
  }
  return { status: 206, start: Number(start), end: Number(end), length: Number(end - start + BigInt(1)) };
}

export function mediaHeaders(asset: { contentType: string; sha256: string; bytes: number }, range: MediaRange): Headers {
  const h = new Headers({
    "Content-Type": asset.contentType, "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-cache",
    ETag: coScenesEtag(asset.sha256), "Accept-Ranges": asset.contentType === "video/mp4" ? "bytes" : "none",
  });
  if (range.status === 416) h.set("Content-Range", `bytes */${asset.bytes}`);
  else {
    h.set("Content-Length", String(range.length));
    if (range.status === 206) h.set("Content-Range", `bytes ${range.start}-${range.end}/${asset.bytes}`);
  }
  return h;
}

/** No upstream headers escape; metadata must describe exactly the requested representation. */
export function validMediaResponse(response: Response, asset: { contentType: string; bytes: number }, range: Exclude<MediaRange, { status: 416 }>): boolean {
  return response.status === range.status && !!response.body &&
    response.headers.get("content-type")?.split(";")[0]?.trim() === asset.contentType &&
    response.headers.get("content-length") === String(range.length) &&
    (!response.headers.get("content-encoding") || response.headers.get("content-encoding") === "identity") &&
    (range.status === 206
      ? response.headers.get("content-range") === `bytes ${range.start}-${range.end}/${asset.bytes}`
      : !response.headers.has("content-range"));
}
