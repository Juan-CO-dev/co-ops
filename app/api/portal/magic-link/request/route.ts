/**
 * POST /api/portal/magic-link/request — customer requests a sign-in link.
 *
 * PUBLIC (no staff auth). Constant-shape `{ok:true}` regardless of internal disposition
 * (enumeration defense — never leak whether an email exists). Honeypot + Origin/Referer
 * check are the spam/CSRF guards; the real rate-limit + allowlist gating live in
 * lib/portal/magic-link.ts requestMagicLink.
 */

import { NextRequest, NextResponse } from "next/server";
import { requestMagicLink } from "@/lib/portal/magic-link";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  // CSRF: reject cross-site POSTs (a same-site fetch sends a matching Origin).
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== req.nextUrl.host) return NextResponse.json({ error: "bad_origin" }, { status: 403 });
    } catch {
      return NextResponse.json({ error: "bad_origin" }, { status: 403 });
    }
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Honeypot: bots fill hidden fields. Pretend success, do nothing.
  if (typeof body.website === "string" && body.website.length > 0) {
    return NextResponse.json({ ok: true });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip");
  if (typeof body.email === "string") {
    await requestMagicLink({ email: body.email, name: typeof body.name === "string" ? body.name : null, ip });
  }

  // Constant shape regardless of internal disposition.
  return NextResponse.json({ ok: true });
}
