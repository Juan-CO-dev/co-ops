import { NextResponse } from "next/server";

const NOT_IMPLEMENTED = NextResponse.json(
  { error: "Not implemented — checklist instance API lands in Phase 6." },
  { status: 501 },
);

export async function GET() {
  return NOT_IMPLEMENTED;
}
export async function PATCH() {
  return NOT_IMPLEMENTED;
}
