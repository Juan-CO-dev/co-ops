import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { error: "Not implemented — notifications API lands in Phase 6." },
    { status: 501 },
  );
}
export const POST = GET;
