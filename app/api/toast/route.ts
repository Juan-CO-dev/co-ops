/**
 * Toast POS adapter route — scaffolded, not implemented. This generic endpoint
 * is a placeholder; the live Toast read-track ingests via the scheduled
 * /api/cron/toast-sales-pull path, not here. No env var currently activates it.
 */

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { error: "Not implemented — Toast adapter is scaffolded but not yet wired." },
    { status: 501 },
  );
}
export const POST = GET;
