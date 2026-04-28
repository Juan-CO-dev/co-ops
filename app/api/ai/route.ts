/**
 * AI proxy — Phase 6 wires this to the Anthropic API using
 * `claude-sonnet-4-6`. Server-side only; client never holds the key.
 */

import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Not implemented — AI proxy lands in Phase 6." },
    { status: 501 },
  );
}
