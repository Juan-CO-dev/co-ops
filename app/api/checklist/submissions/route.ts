import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Not implemented — checklist submission API lands in Phase 6." },
    { status: 501 },
  );
}
