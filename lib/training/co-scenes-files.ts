/**
 * co-scenes-files — the server side of the vendored <crunchy-build> bundle.
 *
 * `server-only`: this reads the filesystem. Code + data live in
 * vendor/co-scenes/dist/ (committed). The real food photos are never committed:
 * in a deploy they come from the private `training-assets` bucket (the route
 * 302s PNGs to a 60 s signed URL, but streams MP4/JPEG server-side);
 * vendor/co-scenes/photos/ (git-ignored) is only a LOCAL dev store the vendor
 * script fills, read first when present. Nothing is under public/: the only way
 * in is app/api/training/co-scenes/[...path]/route.ts, which runs full session
 * validation first.
 *
 * NO USER-CONTROLLED PATH IS EVER JOINED. A request path is served only if the
 * vendored manifest names it (`files` or `photos`). PHOTOS ARE HASH-CHECKED ON
 * READ: the photo store is outside git, so a stale or swapped file is refused
 * (null → 404) rather than served under a manifest name it does not match.
 *
 * LITERAL BASE PATHS, for Vercel's static file tracing (see lib/guides/content.ts);
 * next.config.ts names dist/ in outputFileTracingIncludes (never photos/).
 */

import "server-only";

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { open } from "node:fs/promises";
import { Readable } from "node:stream";

import { coScenesAsset, isPhotoName, isMediaName, isSafeDistPath, type CoScenesAssetRef } from "./co-scenes-shared";
import type { MediaRange } from "./media-http";

export interface CoScenesFile {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
}

const cache = new Map<string, CoScenesFile>();

/**
 * The ONLY filesystem join. Re-checks the SAME shape coScenesAsset enforces
 * (defence in depth, since this is exported): photos must be exactly one
 * `<id>-<sha256>.png|mp4|jpg` segment; dist paths must be safe segments
 * (isSafeDistPath). Then refuses any result that resolves outside its store.
 */
export function storePath(store: "dist" | "photos", rel: string, root = process.cwd()): string | null {
  if (store === "photos" ? !(isPhotoName(rel) || isMediaName(rel)) : !isSafeDistPath(rel)) return null;
  // turbopackIgnore: these reads are declared in next.config.ts
  // outputFileTracingIncludes (dist/ only). Without the hint, Turbopack sees a
  // dynamic path.resolve and traces the WHOLE project into the route ("Encountered
  // unexpected file in NFT list" in the Vercel build log).
  const base = path.resolve(/*turbopackIgnore: true*/ root, "vendor", "co-scenes", store);
  const full = path.resolve(/*turbopackIgnore: true*/ base, ...rel.split("/"));
  return full.startsWith(base + path.sep) ? full : null;
}

export function readCoScenesFile(rel: string): CoScenesFile | null {
  const asset = coScenesAsset(rel);
  if (!asset) return null;
  const key = `${asset.store}:${asset.rel}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const file = storePath(asset.store, asset.rel);
  if (!file) return null;
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(/* turbopackIgnore: true */ file);
  } catch {
    return null;
  }
  if (asset.store === "photos" && createHash("sha256").update(bytes).digest("hex") !== asset.sha256) return null;
  // Cached only AFTER the hash check passed (a failed check returns above, uncached).
  const out = { bytes: new Uint8Array(bytes), contentType: asset.contentType };
  cache.set(key, out);
  return out;
}

/** Hash the local dev copy with bounded memory, then stream the selected bytes from the same handle. */
export async function readCoScenesMedia(asset: CoScenesAssetRef & { bytes: number }, range: Exclude<MediaRange, { status: 416 }>): Promise<{ body: ReadableStream<Uint8Array> } | null> {
  // These bytes are deliberately absent from production deployments. Compile out
  // the local FileHandle path so Turbopack cannot trace the ignored dev store.
  if (process.env.NODE_ENV === "production") return null;
  const file = storePath("photos", asset.rel);
  if (!file || !isMediaName(asset.rel)) return null;
  let handle;
  // The ignored local store must never expand Next's deployment trace.
  try { handle = await open(/*turbopackIgnore: true*/ file, "r"); } catch { return null; }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== asset.bytes) throw new Error("size mismatch");
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(64 * 1024);
    let offset = 0;
    while (offset < stat.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, stat.size - offset), offset);
      if (!bytesRead) throw new Error("truncated media");
      hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
    }
    if (hash.digest("hex") !== asset.sha256) throw new Error("hash mismatch");
    const stream = handle.createReadStream({ start: range.status === 206 ? range.start : 0, end: range.status === 206 ? range.end : stat.size - 1, autoClose: true });
    return { body: Readable.toWeb(stream) as ReadableStream<Uint8Array> };
  } catch {
    await handle.close();
    // A present but corrupt local copy must not silently become a valid local response.
    throw new Error("training media unavailable");
  }
}
