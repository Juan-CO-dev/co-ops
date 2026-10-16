/**
 * THE SKILLS LIB — the loaders and the writers. Server-only, service role. Scheduling Phase 1, Task 16.
 *
 * Every entry decides its rule FIRST, from `lib/people/access-shared.ts`, before any I/O:
 *   loadSkillMatrix / loadSkills — `canViewPeople` (GM / Op-6 own shop, MoO+ any, never the SMM);
 *   loadMySkills                 — `canViewOwnSkills` (the person from the session, a shop they belong to);
 *   adjustSkill / rateNewHire    — `canAdjustSkillsAt` (GM own shop, MoO+ any), then `canAdjustSkill` on the
 *                                  subject's trusted role (the actor strictly outranks the subject).
 * The 0270 RPCs decide the same rules again in the database.
 *
 * ONE batch load per call (`loadPeopleFacts` with the skill families), then the pure assembly
 * (lib/people/skill-matrix-shared.ts). No per-person queries. The tunables are read first (they set the
 * window), then everything else in one call.
 *
 * Before 0270 is applied, every surface answers "not available" (`skills_unavailable`), never a 500.
 * No email, no notification.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "@/lib/audit";
import type { AuditAction } from "@/lib/audit-actions";
import { operationalNow } from "@/lib/midshift-shared";
import { ROLES, type RoleCode } from "@/lib/roles";
import { selectAllRows } from "@/lib/supabase-paginate";
import { canAdjustSkill, canAdjustSkillsAt, canViewOwnSkills, canViewPeople, type PeopleActor } from "@/lib/people/access-shared";
import { loadPeopleFacts, SkillsUnavailableError } from "@/lib/people/facts";
import { SKILL_FAMILIES, type FactSubject, type PeopleFacts } from "@/lib/people/facts-shared";
import {
  computeSkills, positionUsable, skillFactWindow, toManagerSkillView, toSelfSkillView, type ManagerSkillView, type SelfSkillRow, type SkillMatrix,
  type SkillMember,
} from "@/lib/people/skill-matrix-shared";
import { skillReasonValid, toCents, validAdjustmentDelta, validSkillRating } from "@/lib/people/skills-shared";
import { resolveTunables, type SkillTunables } from "@/lib/people/tunables-shared";

export const PEOPLE_SKILL_ERROR_CODES = [
  "forbidden", "not_found", "invalid_payload", "invalid_adjustment", "invalid_rating", "invalid_reason", "invalid_tunables",
  "role_insufficient", "location_access_denied", "assignee_unavailable", "position_not_at_shop", "position_retired",
  "skills_unavailable", "pm_v2_unavailable", "pm_v2_not_ready", "pm_v2_moo_only", "write_failed",
] as const;
export type PeopleSkillErrorCode = (typeof PEOPLE_SKILL_ERROR_CODES)[number];

export class PeopleSkillError extends Error {
  constructor(public status: number, public code: PeopleSkillErrorCode, public key?: string) { super(code); }
}

/** The 0270 refusals by name and their status. Anything else is `write_failed` (500). */
const RPC_CODES: Partial<Record<PeopleSkillErrorCode, number>> = {
  invalid_payload: 400, invalid_adjustment: 400, invalid_rating: 400, invalid_reason: 400, invalid_tunables: 400,
  role_insufficient: 403, location_access_denied: 403, assignee_unavailable: 409, position_not_at_shop: 404, position_retired: 409,
};
export function rpcFailure(error: { code?: string; message: string }): never {
  if (/does not exist|could not find the function/i.test(error.message) || error.code === "42883" || error.code === "PGRST202") {
    throw new PeopleSkillError(503, "skills_unavailable");
  }
  const code = Object.keys(RPC_CODES).find((c) => c === error.message) as PeopleSkillErrorCode | undefined;
  if (code) throw new PeopleSkillError(RPC_CODES[code]!, code);
  throw new PeopleSkillError(500, "write_failed");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_CHUNK = 100;
function requireUuid(v: unknown): asserts v is string {
  if (typeof v !== "string" || !UUID.test(v)) throw new PeopleSkillError(400, "invalid_payload");
}

/** The shop's active members (every level: Phase 2's preferred cover positions rank managers too). */
async function loadMembers(service: SupabaseClient, locationId: string): Promise<SkillMember[]> {
  const ul = await selectAllRows<{ user_id: string }>((from, to) => service
    .from("user_locations").select("user_id").eq("location_id", locationId).eq("active", true)
    .order("user_id", { ascending: true }).range(from, to));
  const ids = [...new Set(ul.map((r) => r.user_id))];
  const out: SkillMember[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const rows = await selectAllRows<{ id: string; name: string; role: RoleCode }>((from, to) => service
      .from("users").select("id, name, role").in("id", ids.slice(i, i + ID_CHUNK)).eq("active", true)
      .order("id", { ascending: true }).range(from, to));
    for (const r of rows) if (ROLES[r.role]) out.push({ userId: r.id, name: r.name, role: r.role });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
}

async function loadNames(service: SupabaseClient, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  const out = new Map<string, string>();
  for (let i = 0; i < unique.length; i += ID_CHUNK) {
    const rows = await selectAllRows<{ id: string; name: string }>((from, to) => service
      .from("users").select("id, name").in("id", unique.slice(i, i + ID_CHUNK)).order("id", { ascending: true }).range(from, to));
    for (const r of rows) out.set(r.id, r.name);
  }
  return out;
}

/** The tunables in force at a shop (shop row > company row > defaults). */
export async function loadShopTunables(service: SupabaseClient, locationId: string): Promise<SkillTunables> {
  const day = operationalNow(new Date()).date;
  const facts = await loadPeopleFacts(service, {
    locationId, subject: { kind: "team", memberIds: [] }, window: { bounds: { start: `${day}T00:00:00Z`, end: `${day}T00:00:00Z` }, dates: { from: day, to: day } },
    families: ["skillTunables"],
  });
  return resolveTunables(facts.skills.tunables.company, facts.skills.tunables.shop);
}

interface Loaded { facts: PeopleFacts; tunables: SkillTunables; asOf: string; nowIso: string; names: Map<string, string> }

/** ONE skill-family load for a subject at a shop, over the tunables' window ending today (ET). */
async function loadSkillFacts(service: SupabaseClient, locationId: string, subject: FactSubject, now: Date): Promise<Loaded> {
  const tunables = await loadShopTunables(service, locationId);
  const asOf = operationalNow(now).date;
  const facts = await loadPeopleFacts(service, { locationId, subject, window: skillFactWindow(asOf, tunables), families: SKILL_FAMILIES });
  const actorIds = [...facts.skills.adjustments.map((a) => a.actor_id), ...facts.skills.ratings.map((r) => r.actor_id)];
  return { facts, tunables, asOf, nowIso: now.toISOString(), names: await loadNames(service, actorIds) };
}

function unavailable(e: unknown): boolean {
  return e instanceof SkillsUnavailableError;
}

// ─── loaders ─────────────────────────────────────────────────────────────────

/**
 * THE PHASE 2 READ: every active member of the shop (managers included) × every active position, each with
 * its `SkillResult`. One batch load, no per-person queries.
 */
export async function loadSkillMatrix(
  service: SupabaseClient, args: { actor: PeopleActor; locationId: string; now?: Date },
): Promise<SkillMatrix> {
  if (!canViewPeople(args.actor, args.locationId)) throw new PeopleSkillError(403, "forbidden");
  try {
    const members = await loadMembers(service, args.locationId);
    const l = await loadSkillFacts(service, args.locationId, { kind: "team", memberIds: members.map((m) => m.userId) }, args.now ?? new Date());
    return computeSkills({ locationId: args.locationId, facts: l.facts.skills, members, asOf: l.asOf, nowIso: l.nowIso, tunables: l.tunables, actorNames: l.names, pmV2: l.facts.pmV2 }).matrix;
  } catch (e) {
    if (unavailable(e)) throw new PeopleSkillError(503, "skills_unavailable");
    throw e;
  }
}

export type SkillsRead<T> = { available: true; view: T } | { available: false };

/** One person's skills at one shop, for a manager (the person page). */
export async function loadSkills(
  service: SupabaseClient, args: { actor: PeopleActor; locationId: string; personId: string; now?: Date },
): Promise<SkillsRead<ManagerSkillView>> {
  if (!canViewPeople(args.actor, args.locationId)) throw new PeopleSkillError(403, "forbidden");
  requireUuid(args.personId);
  const { data: subject, error } = await service.from("users").select("id, name, role").eq("id", args.personId).maybeSingle();
  if (error) throw new Error(`loadSkills subject: ${error.message}`);
  if (!subject) throw new PeopleSkillError(404, "not_found");
  const s = subject as { id: string; name: string; role: RoleCode };
  try {
    const l = await loadSkillFacts(service, args.locationId, { kind: "person", personId: s.id }, args.now ?? new Date());
    const computed = computeSkills({
      locationId: args.locationId, facts: l.facts.skills, members: [{ userId: s.id, name: s.name, role: s.role }],
      asOf: l.asOf, nowIso: l.nowIso, tunables: l.tunables, actorNames: l.names, pmV2: l.facts.pmV2,
    });
    return {
      available: true,
      view: toManagerSkillView({ computed, subjectId: s.id, facts: l.facts.skills, actorNames: l.names, canAdjust: canAdjustSkill(args.actor, { role: s.role }, args.locationId) }),
    };
  } catch (e) {
    if (unavailable(e)) return { available: false };
    throw e;
  }
}

/** The person's OWN skills (R8): stripped at this boundary by `toSelfSkillView`. */
export async function loadMySkills(
  service: SupabaseClient, args: { actor: PeopleActor; locationId: string; now?: Date },
): Promise<SkillsRead<SelfSkillRow[]>> {
  if (!canViewOwnSkills(args.actor, args.locationId)) throw new PeopleSkillError(403, "forbidden");
  try {
    const l = await loadSkillFacts(service, args.locationId, { kind: "person", personId: args.actor.userId }, args.now ?? new Date());
    const computed = computeSkills({
      locationId: args.locationId, facts: l.facts.skills, members: [{ userId: args.actor.userId, name: "", role: args.actor.role }],
      asOf: l.asOf, nowIso: l.nowIso, tunables: l.tunables, actorNames: new Map(), pmV2: l.facts.pmV2,
    });
    return { available: true, view: toSelfSkillView(computed.matrix, args.actor.userId, l.tunables) };
  } catch (e) {
    if (unavailable(e)) return { available: false };
    throw e;
  }
}

// ─── writers ─────────────────────────────────────────────────────────────────

export interface SkillWriteArgs {
  actor: PeopleActor; locationId: string; userId: string; positionId: string; reasonCode: string; reasonNote?: string | null;
}

async function requireSubject(service: SupabaseClient, actor: PeopleActor, args: SkillWriteArgs): Promise<void> {
  const { data, error } = await service.from("users").select("id, role, active").eq("id", args.userId).maybeSingle();
  if (error) throw new PeopleSkillError(500, "write_failed");
  const subject = data as { id: string; role: RoleCode; active: boolean } | null;
  if (!subject) throw new PeopleSkillError(404, "not_found");
  if (!subject.active) throw new PeopleSkillError(409, "assignee_unavailable");
  if (!canAdjustSkill(actor, { role: subject.role }, args.locationId)) throw new PeopleSkillError(403, "forbidden");
}

/**
 * Astra chunk E #2, the lib half: a write names a position of THIS shop that is active ON AN ACTIVE STATION,
 * refused by name before the RPC (`position_not_at_shop` / `position_retired`); 0270's
 * `people_position_at_shop` decides it again in SQL.
 */
export async function requireUsablePosition(service: SupabaseClient, locationId: string, positionId: string): Promise<void> {
  const { data, error } = await service.from("station_positions").select("id, station_id, location_id, active").eq("id", positionId).maybeSingle();
  if (error) throw new PeopleSkillError(500, "write_failed");
  const position = data as { id: string; station_id: string; location_id: string; active: boolean } | null;
  if (!position || position.location_id !== locationId) throw new PeopleSkillError(404, "position_not_at_shop");
  const station = await service.from("stations").select("id, active").eq("id", position.station_id).maybeSingle();
  if (station.error) throw new PeopleSkillError(500, "write_failed");
  const rows = station.data ? [station.data as { id: string; active: boolean }] : [];
  if (!positionUsable(position, rows)) throw new PeopleSkillError(409, "position_retired");
}

async function record(
  service: SupabaseClient, fn: "record_skill_adjustment" | "record_skill_rating", action: AuditAction,
  args: SkillWriteArgs, value: number, valueKey: "delta" | "rating",
): Promise<{ id: string }> {
  const note = typeof args.reasonNote === "string" && /\S/.test(args.reasonNote) ? args.reasonNote.trim() : null;
  const { data, error } = await service.rpc(fn, {
    p_actor: args.actor.userId, p_location: args.locationId, p_user: args.userId, p_position: args.positionId,
    [valueKey === "delta" ? "p_delta" : "p_rating"]: value, p_reason: args.reasonCode, p_note: note,
  });
  if (error) rpcFailure(error);
  const id = (data as { id?: string } | null)?.id ?? null;
  // The note is never copied into the audit row (free text stays on the record it belongs to).
  await audit({
    actorId: args.actor.userId, actorRole: args.actor.role, action, resourceTable: fn === "record_skill_adjustment" ? "people_skill_adjustments" : "people_skill_ratings",
    resourceId: id, metadata: { location_id: args.locationId, user_id: args.userId, position_id: args.positionId, [valueKey]: value, reason_code: args.reasonCode },
    ipAddress: null, userAgent: null,
  });
  return { id: id ?? "" };
}

function frontDoor(args: SkillWriteArgs): void {
  if (!canAdjustSkillsAt(args.actor, args.locationId)) throw new PeopleSkillError(403, "forbidden");
  requireUuid(args.locationId); requireUuid(args.userId); requireUuid(args.positionId);
  if (!skillReasonValid(args.reasonCode, args.reasonNote ?? null)) throw new PeopleSkillError(400, "invalid_reason");
}

/** A manager adjustment: ±0.30 in 0.05 steps, a reason; audited `people.skill_adjust` (no note text). */
export async function adjustSkill(service: SupabaseClient, args: SkillWriteArgs & { delta: unknown }): Promise<{ id: string }> {
  frontDoor(args);
  if (!validAdjustmentDelta(args.delta)) throw new PeopleSkillError(400, "invalid_adjustment");
  await requireSubject(service, args.actor, args);
  await requireUsablePosition(service, args.locationId, args.positionId);
  return record(service, "record_skill_adjustment", "people.skill_adjust", args, toCents(args.delta), "delta");
}

/** The new-hire starting rating: 0..1 in 0.05 steps, a reason; audited `people.skill_rating`. */
export async function rateNewHire(service: SupabaseClient, args: SkillWriteArgs & { rating: unknown }): Promise<{ id: string }> {
  frontDoor(args);
  if (!validSkillRating(args.rating)) throw new PeopleSkillError(400, "invalid_rating");
  await requireSubject(service, args.actor, args);
  await requireUsablePosition(service, args.locationId, args.positionId);
  return record(service, "record_skill_rating", "people.skill_rating", args, toCents(args.rating), "rating");
}
