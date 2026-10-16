/**
 * THE SKILL TUNABLES WRITER — MoO (8)+ only (R11, J19). Server-only, service role. Scheduling Phase 1, Task 16.
 *
 * `canEditSkillTunables` first (before any I/O), then `tunablesProblem` (refused `invalid_tunables`, naming
 * the key — a rejected set never reaches the database, so the previous set stays live), then the 0270 RPC
 * `save_skill_tunables` (MoO+ again, the CHECK as the backstop), then the audit row with before/after.
 * The route adds the Tier E edit window (it shapes how every shop's people are read).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "@/lib/audit";
import { canEditSkillTunables, type PeopleActor } from "@/lib/people/access-shared";
import { PeopleSkillError, rpcFailure } from "@/lib/people/skills";
import { tunablesProblem } from "@/lib/people/tunables-shared";

export { loadShopTunables } from "@/lib/people/skills";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Save the company set (`locationId: null`) or one shop's override. */
export async function saveSkillTunables(
  service: SupabaseClient, args: { actor: PeopleActor; locationId: string | null; tunables: unknown },
): Promise<{ id: string }> {
  if (!canEditSkillTunables(args.actor)) throw new PeopleSkillError(403, "forbidden");
  if (args.locationId !== null && (typeof args.locationId !== "string" || !UUID.test(args.locationId))) throw new PeopleSkillError(400, "invalid_payload");
  const problem = tunablesProblem(args.tunables);
  if (problem !== null) throw new PeopleSkillError(400, "invalid_tunables", problem);
  const { data, error } = await service.rpc("save_skill_tunables", { p_actor: args.actor.userId, p_location: args.locationId, p_tunables: args.tunables });
  if (error) rpcFailure(error);
  const r = data as { id: string; before: unknown; after: unknown };
  await audit({
    actorId: args.actor.userId, actorRole: args.actor.role, action: "people.skill_tunables_update", resourceTable: "people_skill_tunables",
    resourceId: r.id, metadata: { location_id: args.locationId, before: r.before, after: r.after }, ipAddress: null, userAgent: null,
  });
  return { id: r.id };
}
