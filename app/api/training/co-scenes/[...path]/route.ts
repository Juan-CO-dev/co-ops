/**
 * GET /api/training/co-scenes/[...path] — the vendored <crunchy-build> bundle
 * for "Learn the build" (/training/build/[item]).
 *
 * STAFF LOGIN REQUIRED, with FULL session validation (`requireSession`: JWT,
 * the sessions row, token-hash dual verification, revocation, idle timeout) —
 * the same gate as the page. The proxy's signature-only JWT check is not enough
 * on its own: a revoked or idle-expired session can still hold an unexpired JWT.
 * That is why the bundle does not live in public/.
 *
 * Only paths the vendored asset manifest names are served (lib/training/
 * co-scenes-files.ts); anything else is a flat 404. The browser's module
 * import is same-origin, so the session cookie rides along, and the bundle's
 * relative chunk imports resolve under this same route.
 */

import { NextResponse, type NextRequest } from "next/server";

import { requireSession } from "@/lib/session";
import { readCoScenesFile, readCoScenesMedia } from "@/lib/training/co-scenes-files";
import { coScenesAsset, coScenesEtag, ifNoneMatchHits } from "@/lib/training/co-scenes-shared";
import { signTrainingPhoto, fetchTrainingMedia } from "@/lib/training/training-assets";
import { resolveMediaRange, mediaHeaders, validMediaResponse } from "@/lib/training/media-http";

/**
 * EVERY load revalidates through this route, so every load passes requireSession:
 * `private, no-cache` lets the browser keep a copy but never reuse it without asking,
 * and the strong ETag (the manifest sha256) makes the ask cheap. A 304 is answered
 * ONLY after the session check — a revoked session gets its 401, never a 304.
 * (A long max-age / immutable would let a revoked browser keep running the bundle.)
 */
const CACHE_CONTROL = "private, no-cache";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  return serve(req, ctx, false);
}
export async function HEAD(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const response = await serve(req, ctx, true);
  return new Response(null, { status: response.status, headers: response.headers });
}
async function serve(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }, head: boolean): Promise<Response> {
  const auth = await requireSession(req, "/training");
  if (auth instanceof NextResponse) return auth; // 401 (with cleared cookie)

  const { path } = await ctx.params; // Next 16 — params is a Promise.
  const rel = path.join("/");
  const asset = coScenesAsset(rel);
  if (!asset) return new NextResponse(null, { status: 404 });
  const etag = coScenesEtag(asset.sha256);

  if (ifNoneMatchHits(req.headers.get("if-none-match"), etag)) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": CACHE_CONTROL, "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" },
    });
  }

  if (asset.bytes !== undefined) {
    const media = { ...asset, bytes: asset.bytes };
    const range = resolveMediaRange(!head && asset.contentType === "video/mp4" ? req.headers.get("range") : null,
      req.headers.get("if-range"), etag, media.bytes);
    const headers = mediaHeaders(media, range);
    if (head || range.status === 416) return new Response(null, { status: range.status, headers });
    try {
      const local = await readCoScenesMedia(media, range);
      if (local) return new Response(local.body, { status: range.status, headers });
      const upstream = await fetchTrainingMedia(asset.rel, range.status === 206 ? `bytes=${range.start}-${range.end}` : null, req.signal);
      if (!upstream || !validMediaResponse(upstream, media, range)) {
        await upstream?.body?.cancel();
        return new Response(null, { status: 502, headers: { "Cache-Control": "no-store" } });
      }
      return new Response(upstream.body, { status: range.status, headers });
    } catch {
      return new Response(null, { status: 502, headers: { "Cache-Control": "no-store" } });
    }
  }

  const file = readCoScenesFile(rel);
  if (!file) {
    // A PHOTO not in the local (dev-only, git-ignored) store comes from the private
    // `training-assets` bucket: a 60 s signed URL, minted only now — after
    // requireSession and the manifest check — and never cached. The page re-checks
    // the photo's sha256 against the manifest before use.
    if (asset.store === "photos") {
      const signed = await signTrainingPhoto(asset.rel);
      if (signed) {
        return new Response(null, {
          status: 302,
          headers: { Location: signed, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" },
        });
      }
    }
    return new NextResponse(null, { status: 404 });
  }

  return new Response(head ? null : file.bytes, {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.bytes.byteLength),
      ETag: etag,
      "Cache-Control": CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
