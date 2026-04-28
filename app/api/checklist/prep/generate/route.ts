/**
 * Prep list resolver — given a prep instance, computes the prep_list_resolutions
 * rows from current par_levels and on-hand counts (latest opening checklist).
 *
 * Phase 6 wires this. Service-role insert into prep_list_resolutions per RLS
 * (no user-facing direct write).
 */

import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Not implemented — prep generator lands in Phase 6." },
    { status: 501 },
  );
}
