import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Not implemented — photo upload lands in Phase 6." },
    { status: 501 },
  );
}
export const GET = POST;
