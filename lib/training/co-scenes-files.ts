/**
 * co-scenes-files — the server side of the vendored <crunchy-build> bundle.
 *
 * `server-only`: this reads the filesystem. Code + data live in
 * vendor/co-scenes/dist/ (committed). The real food photos are never committed:
 * in a deploy they come from the private `training-assets` bucket (the route
 * 302s to a 60 s signed URL, lib/training/training-assets.ts);
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

import { coScenesAsset } from "./co-scenes-shared";

export interface CoScenesFile {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
}

const cache = new Map<string, CoScenesFile>();

function storePath(store: "dist" | "photos", rel: string): string {
  return store === "dist"
    ? path.join(process.cwd(), "vendor", "co-scenes", "dist", ...rel.split("/"))
    : path.join(process.cwd(), "vendor", "co-scenes", "photos", rel);
}

export function readCoScenesFile(rel: string): CoScenesFile | null {
  const asset = coScenesAsset(rel);
  if (!asset) return null;
  const key = `${asset.store}:${asset.rel}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(storePath(asset.store, asset.rel));
  } catch {
    return null;
  }
  if (asset.store === "photos" && createHash("sha256").update(bytes).digest("hex") !== asset.sha256) return null;
  const file = { bytes: new Uint8Array(bytes), contentType: asset.contentType };
  cache.set(key, file);
  return file;
}
