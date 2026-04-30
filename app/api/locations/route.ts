/**
 * GET /api/locations — public.
 *
 * Returns active locations for the unauthenticated tile-flow login surface
 * (Phase 2 Session 4). Public path; no auth required so the picker can
 * render before any sign-in attempt.
 *
 * Response shape (locked):
 *   200 { locations: [{ id, name, code, type }] }
 *
 * `address`/`phone`/`created_*` are omitted — the login surface only needs
 * the user-visible name + code for tile labels.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { jsonError, jsonOk } from "@/lib/api-helpers";

interface LocationRow {
  id: string;
  name: string;
  code: string;
  type: "permanent" | "dark_kitchen";
}

export async function GET() {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("locations")
    .select("id, name, code, type")
    .eq("active", true)
    .order("name", { ascending: true })
    .returns<LocationRow[]>();

  if (error) {
    return jsonError(500, "internal_error", { message: "locations lookup failed" });
  }

  return jsonOk({ locations: data ?? [] });
}
