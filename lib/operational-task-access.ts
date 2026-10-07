import "server-only";
import { hasTaskAccess } from "@/lib/assignments";
import type { TaskType } from "@/lib/assignments-shared";
import { accessibleLocations, lockLocationContext } from "@/lib/locations";
import { etCalendarDate } from "@/lib/operational-day";
import { getRoleLevel } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

/** Re-evaluate today's assignment at every operational read/write boundary. */
export async function canDoOperationalTask(actor: AuthContext, locationId: string, task: TaskType): Promise<boolean> {
  if (!lockLocationContext({ role: actor.user.role, locations: actor.locations }, locationId)) return false;
  return hasTaskAccess(getServiceRoleClient(), {
    userId: actor.user.id, level: getRoleLevel(actor.user.role), locationId,
    date: etCalendarDate(new Date().toISOString()), task,
  });
}

/** Unattributed vendor receipts belong to the triage queue of any authorized shop. */
export async function canTriageUnattributedReceipt(actor: AuthContext): Promise<boolean> {
  if (getRoleLevel(actor.user.role) < 4) return false;
  const reachable = accessibleLocations({ role: actor.user.role, locations: actor.locations });
  let locationIds: string[];
  if (reachable === "all") {
    const { data, error } = await getServiceRoleClient().from("locations").select("id").eq("active", true);
    if (error) throw new Error("Receipt triage location lookup failed");
    locationIds = (data ?? []).map((row: { id: string }) => row.id);
  } else locationIds = reachable;
  const access = await Promise.all(locationIds.map((id) => canDoOperationalTask(actor, id, "receiving")));
  return access.some(Boolean);
}
