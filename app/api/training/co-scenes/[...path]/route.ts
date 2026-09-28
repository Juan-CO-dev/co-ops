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

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const auth = await requireSession(req, "/training");
  if (auth instanceof NextResponse) return auth; // 401 (with cleared cookie)

  const { path } = await ctx.params; // Next 16 — params is a Promise.
  const file = readCoScenesFile(path.join("/"));
  if (!file) return new NextResponse(null, { status: 404 });

  return new Response(file.bytes, {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.bytes.byteLength),
      // PRIVATE (never a shared cache — the bundle is behind login) and immutable:
      // every filename carries its content hash, so a re-vendor is a new URL.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
