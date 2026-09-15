/**
 * GET /api/guides/img/[guide]/[file] — one screenshot from a written guide.
 *
 * STAFF LOGIN REQUIRED. The PNGs are photographs of this app's own screens —
 * rosters, prep numbers, a quote's money. They live under docs/, not public/,
 * and they stay behind the same session the screens themselves are behind. No
 * role floor here on purpose: which GUIDE a person may open is decided on the
 * page (lib/guides/access-shared.ts), and a second, differently-spelled floor on
 * the image URL would be a second opinion about the same question.
 *
 * NO USER-CONTROLLED PATH IS EVER JOINED. `guide` must be one of three literal
 * slugs and `file` must match GUIDE_IMAGE_FILE (two digits, optional letter,
 * lowercase slug, `.png`) — a shape in which no traversal sequence, separator,
 * or dotfile can be spelled. Anything else is a flat 404: a validation failure
 * and a missing file are indistinguishable to the caller, which is the right
 * answer for a probe.
 */

import fs from "node:fs";

import { NextResponse, type NextRequest } from "next/server";

import { GUIDE_IMAGE_FILE, guideImagePath } from "@/lib/guides/content";
import { isGuideSlug } from "@/lib/guides/markdown-shared";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";

function notFound(): NextResponse {
  return new NextResponse(null, { status: 404 });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ guide: string; file: string }> },
): Promise<Response> {
  const auth = await requireSession(req, "/training");
  if (auth instanceof NextResponse) return auth; // 401 (with cleared cookie)

  const { guide, file } = await ctx.params; // Next 16 — params is a Promise.
  if (!isGuideSlug(guide) || !GUIDE_IMAGE_FILE.test(file)) return notFound();

  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(guideImagePath(guide, file));
  } catch {
    // A guide referencing a screenshot that is not in the repo is a docs bug,
    // not a server error — the page around it still reads.
    return notFound();
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(bytes.byteLength),
      // PRIVATE — a shared cache must never hold a logged-in screenshot. An hour
      // in the reader's own browser is what keeps a 73-image guide from
      // re-fetching every scroll.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
