/**
 * Toast POS adapter route — scaffolded, deferred per spec Section 2.8.
 * Activation gated behind TOAST_ENABLED env var.
 */

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      error: "Toast integration is disabled in this environment.",
      hint: "Set TOAST_ENABLED=true and configure TOAST_CLIENT_ID / TOAST_CLIENT_SECRET to activate.",
    },
    { status: 501 },
  );
}
export const POST = GET;
