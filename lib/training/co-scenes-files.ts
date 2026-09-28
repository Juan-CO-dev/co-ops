/**
 * co-scenes-files — the server side of the vendored <crunchy-build> bundle.
 *
 * `server-only`: this reads the filesystem. The bundle lives in
 * vendor/co-scenes/dist/ (NOT public/), so the only way to fetch it is
 * app/api/training/co-scenes/[...path]/route.ts, which runs full session
 * validation first — the same gate as the /training pages, not the proxy's
 * signature-only JWT check.
 *
 * NO USER-CONTROLLED PATH IS EVER JOINED. A request path is served only if it
 * is a key of the vendored asset manifest's `files` map — an allowlist written
 * by scripts/vendor-co-scenes.ts and hash-checked by tests. Anything else is a
 * null (the route's flat 404).
 *
 * LITERAL BASE PATH, for Vercel's static file tracing (see lib/guides/content.ts);
 * next.config.ts also names vendor/co-scenes/dist in outputFileTracingIncludes.
 */

import "server-only";

import fs from "node:fs";
import path from "node:path";

import { coScenesAsset } from "./co-scenes-shared";

export interface CoScenesFile {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
}

const cache = new Map<string, CoScenesFile>();

export function readCoScenesFile(rel: string): CoScenesFile | null {
  const asset = coScenesAsset(rel);
  if (!asset) return null;
  const hit = cache.get(asset.rel);
  if (hit) return hit;
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(path.join(process.cwd(), "vendor", "co-scenes", "dist", ...asset.rel.split("/")));
  } catch {
    return null;
  }
  const file = { bytes: new Uint8Array(bytes), contentType: asset.contentType };
  cache.set(asset.rel, file);
  return file;
}
