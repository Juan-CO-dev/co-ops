/**
 * 7shifts adapter route — scaffolded, deferred per spec Section 2.8.
 * Activation gated behind SEVENSHIFTS_ENABLED env var.
 */

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      error: "7shifts integration is disabled in this environment.",
      hint: "Set SEVENSHIFTS_ENABLED=true and configure SEVENSHIFTS_API_KEY to activate.",
    },
    { status: 501 },
  );
}
export const POST = GET;
