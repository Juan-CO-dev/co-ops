/** Mid-shift Pulse v2 — the server half of page resolution: the active shops this actor may see. */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAllLocationsAccess } from "@/lib/locations";
import type { AuthContext } from "@/lib/session";
import type { PulseLocation } from "@/lib/pulse/page-shared";
import { PULSE_READ_ALL_LEVEL } from "@/lib/pulse/scope-shared";

/** The shops this actor may READ on the pulse: 8+ every active shop (pulse read grant, Astra #5), else memberships. */
export async function loadAccessibleLocations(service: SupabaseClient, auth: AuthContext): Promise<PulseLocation[]> {
  const all = isAllLocationsAccess({ role: auth.role, locations: auth.locations }) || auth.level >= PULSE_READ_ALL_LEVEL;
  const { data, error } = await service.from("locations").select("id, code, name").eq("active", true).order("name", { ascending: true }).returns<PulseLocation[]>();
  if (error) throw new Error(`pulse locations: ${error.message}`);
  return (data ?? []).filter((l) => all || auth.locations.includes(l.id));
}
