/** Mid-shift Pulse v2 — the server half of page resolution: the active shops this actor may see. */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAllLocationsAccess } from "@/lib/locations";
import type { AuthContext } from "@/lib/session";
import type { PulseLocation } from "@/lib/pulse/page-shared";

export async function loadAccessibleLocations(service: SupabaseClient, auth: AuthContext): Promise<PulseLocation[]> {
  const all = isAllLocationsAccess({ role: auth.role, locations: auth.locations });
  const { data, error } = await service.from("locations").select("id, code, name").eq("active", true).order("name", { ascending: true }).returns<PulseLocation[]>();
  if (error) throw new Error(`pulse locations: ${error.message}`);
  return (data ?? []).filter((l) => all || auth.locations.includes(l.id));
}
