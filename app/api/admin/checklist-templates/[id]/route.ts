import { NextResponse } from "next/server";

const NOT_IMPLEMENTED = NextResponse.json(
  { error: "Not implemented — checklist template admin API lands in Phase 5." },
  { status: 501 },
);

export async function GET() {
  return NOT_IMPLEMENTED;
}
export async function PATCH() {
  return NOT_IMPLEMENTED;
}
