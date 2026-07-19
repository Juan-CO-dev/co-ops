/**
 * Public (customer-facing) locations loader — Portal-3 / 3a.
 *
 * SERVER-ONLY, un-gated (the portal has no staff AuthContext). Service-role read of the active
 * locations so the intake form can capture a REAL location_id (catering_quotes.location_id is
 * NOT NULL). Mirrors lib/portal/menu.ts: a thin public read; the id is the only thing the client
 * echoes back, and every downstream use validates it as a UUID.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";

export interface PublicLocation {
  id: string;
  name: string;
  code: string;
}

export async function loadPublicLocations(): Promise<PublicLocation[]> {
  const sb = getServiceRoleClient();
  // `active` is nullable; treat NULL as active (`NOT (active IS false)`), exclude only explicit false.
  const { data, error } = await sb
    .from("locations")
    .select("id, name, code")
    .not("active", "is", false)
    .order("name", { ascending: true })
    .returns<Array<{ id: string; name: string; code: string }>>();
  if (error) throw new Error(`loadPublicLocations: ${error.message}`);
  return (data ?? []).map((r) => ({ id: r.id, name: r.name, code: r.code }));
}
