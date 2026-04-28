/**
 * SMS queue processor — Phase 6 wires this to Twilio (or no-ops when disabled).
 * Invoked by Vercel Cron on a schedule.
 */

import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Not implemented — SMS queue processor lands in Phase 6." },
    { status: 501 },
  );
}
