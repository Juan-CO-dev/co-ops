/**
 * POST /api/portal/magic-link/request — customer requests a sign-in link.
 *
 * PUBLIC (no staff auth). Constant-shape `{ok:true}` regardless of internal disposition
 * (enumeration defense — never leak whether an email exists). Honeypot + Origin/Referer
 * check are the spam/CSRF guards; the real rate-limit + allowlist gating live in
 * lib/portal/magic-link.ts requestMagicLink.
 *
 * The intake parser is lib/portal/intake-parser.ts (pure, pinned): it never emits `pipelineId`,
 * so a public caller can never steer a draft onto an existing pipeline lead (build 2, A1).
 */

import { NextRequest, NextResponse } from "next/server";
import { requestMagicLink } from "@/lib/portal/magic-link";
import { parsePublicIntake } from "@/lib/portal/intake-parser";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { trustedClientIp } from "@/lib/client-ip";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const csrf = assertSameOrigin(req); // A-H5 — fail closed on missing/cross-site Origin
  if (csrf) return csrf;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Honeypot: bots fill hidden fields. Pretend success, do nothing.
  if (typeof body.website === "string" && body.website.length > 0) {
    return NextResponse.json({ ok: true });
  }

  const ip = trustedClientIp(req.headers); // A-M2 — platform-trusted, not the spoofable leftmost XFF
  if (typeof body.email === "string") {
    await requestMagicLink({ email: body.email, name: typeof body.name === "string" ? body.name : null, ip, intake: parsePublicIntake(body.intake) });
  }

  // Constant shape regardless of internal disposition.
  return NextResponse.json({ ok: true });
}
