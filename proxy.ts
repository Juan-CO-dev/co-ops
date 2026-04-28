/**
 * Edge proxy — Phase 2.
 *
 * Renamed from `middleware.ts` per Next.js 16 deprecation. Spec Section 15
 * lists `middleware.ts`; current convention is `proxy.ts` with the same
 * semantics. Recap of foundation phase 0 documents the deviation.
 *
 * Responsibilities:
 *   1. Read session JWT from httpOnly cookie
 *   2. Validate signature + expiry; reject if invalid
 *   3. Enforce 10-minute idle timeout (last_activity_at + 10m < now)
 *   4. Touch last_activity_at on each authenticated request
 *   5. Redirect unauthed users to /
 *   6. Clear step_up_unlocked when navigating away from /admin/*
 *   7. Pass session claims through to route handlers via x-co-* headers
 *
 * Phase 0 stub — runs no-op so dev works without auth.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(_req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [],
};
