/**
 * 7shifts adapter route — scaffolded, not implemented. Placeholder only; no env
 * var currently activates it and no scheduler invokes it.
 */

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { error: "Not implemented — 7shifts adapter is scaffolded but not yet wired." },
    { status: 501 },
  );
}
export const POST = GET;
