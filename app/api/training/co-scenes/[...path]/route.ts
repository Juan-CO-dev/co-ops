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
import { readCoScenesFile } from "@/lib/training/co-scenes-files";
import { coScenesAsset, coScenesEtag, ifNoneMatchHits } from "@/lib/training/co-scenes-shared";

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
      headers: { ETag: etag, "Cache-Control": CACHE_CONTROL, "X-Content-Type-Options": "nosniff" },
    });
  }

  const file = readCoScenesFile(rel);
  if (!file) return new NextResponse(null, { status: 404 });

  return new Response(file.bytes, {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.bytes.byteLength),
      ETag: etag,
      "Cache-Control": CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
