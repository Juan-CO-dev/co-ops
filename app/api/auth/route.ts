/**
 * Auth root — Phase 2 splits this into:
 *   /api/auth/sign-in     POST  PIN or email+password sign-in
 *   /api/auth/sign-out    POST  Revoke current session
 *   /api/auth/step-up     POST  Password re-entry for destructive actions
 *   /api/auth/verify      POST  Email verification token consumption
 *   /api/auth/reset       POST  Password reset (request + consume)
 *
 * Stubbed for Phase 0.
 */

import { NextResponse } from "next/server";

const NOT_IMPLEMENTED = NextResponse.json(
  { error: "Not implemented — auth routes land in Phase 2." },
  { status: 501 },
);

export async function GET() {
  return NOT_IMPLEMENTED;
}
export async function POST() {
  return NOT_IMPLEMENTED;
}
