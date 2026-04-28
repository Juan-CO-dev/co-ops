import { NextResponse } from "next/server";

const NOT_IMPLEMENTED = NextResponse.json(
  { error: "Not implemented — par levels admin API lands in Phase 5." },
  { status: 501 },
);

export async function GET() {
  return NOT_IMPLEMENTED;
}
export async function POST() {
  return NOT_IMPLEMENTED;
}
