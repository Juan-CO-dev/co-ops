/**
 * EMPLOYMENT RECORDS — SERVER-ONLY (staff separations, Juan 2026-10-20; migration 0279).
 *
 *  - `loadEmploymentStates`: ONE batch read of 0279 for a set of people (paged, ids chunked) → each person's state.
 *    Before 0279 is applied the table is missing: `available: false`, every state active — nothing breaks.
 *  - `recordEmployment`: the one write path (leave, back from leave, separation, rehire, correction). In order: the act
 *    and the payload (exact keys), the target through `loadActionableTarget` (user management's rule — GM own shop,
 *    MoO+ any, strictly below), the state and the head the screen loaded (`employment_moved` otherwise), the act rule
 *    (`employmentActRefusal`), then 0279's writer, which re-checks ALL of it under its per-person lock. The audit row
 *    names the event and the statuses — NEVER the reason or a note (HR text stays in 0279).
 *  - `findRehireMatches`: the Add user warning. A separated person whose rehire setting needs more than the usual
 *    authority (`no`, `only_with_owner_ok`) matches the new person by the SAME normalized phone or the SAME Toast
 *    employee GUID (any of their Toast links, live or not). NEVER by name. The match carries the chip; the reasons only
 *    when the viewer may read them (`employmentViewFor`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import type { AuditAction } from "@/lib/audit-actions";
import { isMissingTable } from "@/lib/people/facts";
import { isRoleCode, type RoleCode } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";
import {
  actStateOf, correctedKindOf, EMPLOYMENT_EVENT_KINDS, employmentActRefusal, employmentViewFor, isEmploymentUuid,
  mayProceedPastRehire, normalizePhone, parseEmploymentFields, recordEmploymentEventCall, rehireWarns,
  type EmploymentEventKind, type EmploymentView, type RehireSetting,
} from "./employment-shared";
import { AdminUserError, loadActionableTarget } from "./users";

export { employmentAvailable, loadEmploymentStates, stateOf, type EmploymentStates } from "./employment-read";
import { ID_CHUNK, loadEmploymentStates, peopleWithEvents, stateOf } from "./employment-read";

// ─── The write ───────────────────────────────────────────────────────────────

const ACTION_OF: Record<EmploymentEventKind, AuditAction> = {
  leave_start: "user.leave_start", leave_end: "user.leave_end", separated: "user.separate", rehired: "user.rehire", correction: "user.employment_correct",
};
const RPC_CODES: Record<string, { status: number; code: string }> = {
  invalid_payload: { status: 400, code: "invalid_payload" },
  employment_forbidden: { status: 403, code: "forbidden" },
  employment_outside_shop: { status: 403, code: "target_outside_shop" },
  employment_not_found: { status: 404, code: "not_found" },
  employment_moved: { status: 409, code: "employment_moved" },
  employment_invalid_transition: { status: 409, code: "employment_invalid_transition" },
  rehire_owner_ok_required: { status: 403, code: "rehire_owner_ok_required" },
  rehire_owner_required: { status: 403, code: "rehire_owner_required" },
};

export interface RecordEmploymentResult { id: string; statusBefore: string; statusAfter: string; sessionsRevoked: number }

export async function recordEmployment(actor: AuthContext, userId: string, input: { act: unknown; fields: unknown; expectedId: unknown }): Promise<RecordEmploymentResult> {
  const act = input.act;
  if (typeof act !== "string" || !(EMPLOYMENT_EVENT_KINDS as readonly string[]).includes(act) || !isEmploymentUuid(userId)) {
    throw new AdminUserError(400, "invalid_payload");
  }
  const kind = act as EmploymentEventKind;
  const expectedId = input.expectedId === null || input.expectedId === undefined ? null : input.expectedId;
  if (expectedId !== null && !isEmploymentUuid(expectedId)) throw new AdminUserError(400, "invalid_payload");
  const raw = input.fields && typeof input.fields === "object" && !Array.isArray(input.fields) ? { ...(input.fields as Record<string, unknown>) } : null;
  if (!raw) throw new AdminUserError(400, "invalid_payload");

  const target = await loadActionableTarget(actor, userId);
  const sb = getServiceRoleClient();
  const states = await loadEmploymentStates(sb, [userId]);
  if (!states.available) throw new AdminUserError(503, "employment_unavailable");
  const state = stateOf(states, userId);
  if ((state.headId ?? null) !== (expectedId === null ? null : (expectedId as string).toLowerCase())) throw new AdminUserError(409, "employment_moved");

  let fields: Record<string, unknown>;
  if (kind === "correction") {
    const correctsId = raw.correctsId;
    delete raw.correctsId;
    const corrected = correctedKindOf(state);
    if (!corrected) throw new AdminUserError(409, "employment_invalid_transition");
    if (!isEmploymentUuid(correctsId) || correctsId.toLowerCase() !== state.current!.eventId) throw new AdminUserError(409, "employment_invalid_transition");
    const parsed = parseEmploymentFields(corrected, raw);
    if (!parsed) throw new AdminUserError(400, "invalid_payload");
    fields = { correctsId: correctsId.toLowerCase(), ...parsed };
  } else {
    const parsed = parseEmploymentFields(kind, raw);
    if (!parsed) throw new AdminUserError(400, "invalid_payload");
    fields = { ...parsed };
  }
  if (kind === "rehired" && state.current?.kind === "separated" && state.current.rehire !== "yes" && !(fields as { note?: string | null }).note) {
    throw new AdminUserError(400, "rehire_reason_required");
  }

  const refusal = employmentActRefusal({ userId: actor.user.id, role: actor.user.role, locations: actor.locations },
    { id: target.id, role: target.role, locationIds: target.locationIds }, kind, actStateOf(state),
    kind === "correction" ? (fields as { rehire?: RehireSetting }).rehire : undefined);
  if (refusal) throw new AdminUserError(refusal === "employment_invalid_transition" ? 409 : 403, refusal);

  const call = recordEmploymentEventCall({ actorId: actor.user.id, userId, expectedId: state.headId, kind, fields });
  const { data, error } = await sb.rpc(call.fn, call.args);
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message)) throw new AdminUserError(503, "employment_unavailable");
    const known = RPC_CODES[error.message];
    if (known) throw new AdminUserError(known.status, known.code);
    throw new Error(`recordEmployment failed: ${error.code ?? "unknown"}`);
  }
  const r = data as { id: string; status_before: string; status_after: string; sessions_revoked: number };
  // The audit row names the event and the statuses — never the reason or a note.
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: ACTION_OF[kind], resourceTable: "users", resourceId: userId,
    metadata: { event_id: r.id, kind, status_before: r.status_before, status_after: r.status_after, sessions_revoked: r.sessions_revoked },
    ipAddress: null, userAgent: null,
  });
  return { id: r.id, statusBefore: r.status_before, statusAfter: r.status_after, sessionsRevoked: r.sessions_revoked };
}

// ─── The Add user warning ────────────────────────────────────────────────────

export interface RehireMatch {
  userId: string;
  name: string;
  /** How they matched: never "name". */
  by: Array<"phone" | "toast">;
  rehire: RehireSetting;
  view: EmploymentView;
  /** The viewer may proceed past this match (the authority a rehire on this setting needs). */
  mayProceed: boolean;
}
export interface RehireCheck { available: boolean; matches: RehireMatch[] }

export interface RehireViewer { role: RoleCode; locations: readonly string[] }

/** Separated people (rehire `no` / `only_with_owner_ok`) with the same normalized phone or the same Toast employee GUID. */
export async function findRehireMatches(sb: SupabaseClient, viewer: RehireViewer, probe: { phone?: string | null; toastGuids?: readonly string[] }): Promise<RehireCheck> {
  const phone = normalizePhone(probe.phone ?? null);
  const guids = [...new Set((probe.toastGuids ?? []).filter((g) => typeof g === "string" && /^[A-Za-z0-9-]{1,64}$/.test(g)))];
  if (!phone && guids.length === 0) return { available: true, matches: [] };
  const candidates = await peopleWithEvents(sb);
  if (candidates === null) return { available: false, matches: [] };
  if (candidates.length === 0) return { available: true, matches: [] };
  const states = await loadEmploymentStates(sb, candidates);
  const separated = candidates.filter((u) => {
    const st = stateOf(states, u);
    return st.current?.kind === "separated" && rehireWarns(st.current.rehire);
  });
  if (separated.length === 0) return { available: true, matches: [] };

  const users: Array<{ id: string; name: string; role: string; phone: string | null }> = [];
  const memberships = new Map<string, string[]>();
  const toastBy = new Map<string, Set<string>>();
  for (let i = 0; i < separated.length; i += ID_CHUNK) {
    const ids = separated.slice(i, i + ID_CHUNK);
    const u = await sb.from("users").select("id, name, role, phone").in("id", ids);
    if (u.error) throw new Error("findRehireMatches: users read failed");
    users.push(...((u.data ?? []) as typeof users));
    const ul = await sb.from("user_locations").select("user_id, location_id").in("user_id", ids).eq("active", true);
    if (ul.error) throw new Error("findRehireMatches: memberships read failed");
    for (const r of (ul.data ?? []) as Array<{ user_id: string; location_id: string }>) memberships.set(r.user_id, [...(memberships.get(r.user_id) ?? []), r.location_id]);
    if (guids.length > 0) {
      const tl = await sb.from("toast_employee_links").select("user_id, employee_guid").in("user_id", ids).in("employee_guid", guids);
      if (tl.error && !isMissingTable(tl.error)) throw new Error("findRehireMatches: toast links read failed");
      for (const r of (tl.data ?? []) as Array<{ user_id: string; employee_guid: string }>) toastBy.set(r.user_id, (toastBy.get(r.user_id) ?? new Set()).add(r.employee_guid));
    }
  }
  const matches: RehireMatch[] = [];
  for (const u of users.sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1))) {
    const by: RehireMatch["by"] = [];
    if (phone && normalizePhone(u.phone) === phone) by.push("phone");
    if (toastBy.has(u.id)) by.push("toast");
    if (by.length === 0 || !isRoleCode(u.role)) continue;
    const st = stateOf(states, u.id);
    const rehire = (st.current as { rehire: RehireSetting }).rehire;
    matches.push({ userId: u.id, name: u.name, by, rehire, view: employmentViewFor(viewer, memberships.get(u.id) ?? [], st), mayProceed: mayProceedPastRehire(viewer.role, rehire) });
  }
  return { available: true, matches };
}
