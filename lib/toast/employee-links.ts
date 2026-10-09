/**
 * Toast employee → CO-OPS user links — SERVER-ONLY (0233). Juan 2026-10-08.
 *
 * - The labor pull auto-links EXACT full-name matches at the same shop (runAutoLinks, system actor).
 * - GM+ (own shop) / level 8+ (every shop) review the rest on /admin/toast-employees and link or
 *   unlink (linkToastEmployee / unlinkToastEmployee). The location bind lives HERE, before any I/O.
 * - The RPCs are the only writers; a link backfills toast_time_entries.user_id on every date and the
 *   0233 trigger keeps it filled on every later pull. Full Toast names are read in memory only.
 *
 * Gated by WHOS_HERE=1 (nothing runs before 0233 is applied).
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "@/lib/audit";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { getRoleLevel, isRoleCode, ROLES, type RoleCode } from "@/lib/roles";
import { selectAllRows } from "@/lib/supabase-paginate";
import { toastGet } from "./client";
import {
  parseToastEmployees, planLinks, toastDisplayName, type ExistingLink, type LinkCandidateUser, type LinkSuggestion, type ToastEmployee,
} from "./employee-links-shared";

export { whosHereEnabled } from "@/lib/whos-here";

/** GM (7) for their own shop; level 8+ for every shop. */
export const LINK_ADMIN_MIN_LEVEL = 7;
export const LINK_ALL_SHOPS_LEVEL = 8;

export interface LinkActor extends LocationActor { userId: string; level: number }
export class LinkError extends Error {
  constructor(public code: string, public status = 403) { super(code); }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GUID = /^[A-Za-z0-9-]{1,64}$/;
const KNOWN = ["employee_already_linked", "user_already_linked", "link_not_found", "role_insufficient",
  "location_access_denied", "assignee_unavailable", "invalid_payload", "link_rejected"] as const;
/** A signal that never fires, for callers without a deadline (reads stay written one way). */
const NEVER = new AbortController().signal;

function rpcError(error: { message: string; code?: string }): never {
  const code = KNOWN.find((c) => c === error.message);
  if (code) throw new LinkError(code, code === "invalid_payload" ? 400 : code === "link_not_found" ? 404
    : code.endsWith("already_linked") ? 409 : 403);
  throw new Error(`toast employee link failure: ${error.code ?? "unknown"}`);
}

/** The bind, before any I/O: level 7 own shop, level 8+ any shop. */
export function canAdminLinks(actor: LinkActor, locationId: string): boolean {
  if (!UUID.test(locationId) || actor.level < LINK_ADMIN_MIN_LEVEL) return false;
  return actor.level >= LINK_ALL_SHOPS_LEVEL || lockLocationContext(actor, locationId);
}
function requireAdmin(actor: LinkActor, locationId: string): void {
  if (!UUID.test(locationId)) throw new LinkError("invalid_payload", 400);
  if (actor.level < LINK_ADMIN_MIN_LEVEL) throw new LinkError("role_insufficient");
  if (!canAdminLinks(actor, locationId)) throw new LinkError("location_access_denied");
}

const ALL_SHOP_ROLES = (Object.values(ROLES).filter((r) => r.level >= 9).map((r) => r.code)) as RoleCode[];

/** Who may be linked at a shop: active members, plus all-shops (9+) accounts — as the RPC allows. */
export async function linkableUsers(service: SupabaseClient, locationId: string, signal?: AbortSignal): Promise<Array<LinkCandidateUser & { level: number }>> {
  const sig = signal ?? NEVER;
  const members = await selectAllRows<{ user_id: string }>((from, to) => service.from("user_locations").select("user_id")
    .eq("location_id", locationId).eq("active", true).order("user_id").range(from, to).abortSignal(sig));
  const ids = [...new Set(members.map((m) => m.user_id))];
  const rows: Array<{ id: string; name: string; role: string }> = [];
  for (let i = 0; i < ids.length; i += 100) {
    const r = await service.from("users").select("id,name,role").eq("active", true).in("id", ids.slice(i, i + 100)).abortSignal(sig);
    if (r.error) throw new Error("toast employee links: users read failed");
    rows.push(...(r.data ?? []));
  }
  const top = await service.from("users").select("id,name,role").eq("active", true).in("role", ALL_SHOP_ROLES).abortSignal(sig);
  if (top.error) throw new Error("toast employee links: users read failed");
  const seen = new Set<string>();
  return [...rows, ...(top.data ?? [])].filter((u) => isRoleCode(u.role) && !seen.has(u.id) && seen.add(u.id))
    .map((u) => ({ id: u.id, name: u.name, level: getRoleLevel(u.role as RoleCode) }));
}

/** EVERY link row for the shop, active and inactive: an inactive row is a rejected pair (r1 P1-2). */
export async function loadLinks(service: SupabaseClient, locationId: string, signal?: AbortSignal): Promise<ExistingLink[]> {
  const rows = await selectAllRows<{ id: string; employee_guid: string; user_id: string; active: boolean; source: "auto" | "manual" }>((from, to) =>
    service.from("toast_employee_links").select("id,employee_guid,user_id,active,source")
      .eq("location_id", locationId).order("linked_at").order("id").range(from, to).abortSignal(signal ?? NEVER));
  return rows.map((r) => ({ id: r.id, employeeGuid: r.employee_guid, userId: r.user_id, active: r.active, source: r.source }));
}

/** Bounded Toast read of one shop's employees; a failure names a fixed code, never provider text. */
export async function fetchEmployees(service: SupabaseClient, locationId: string, signal: AbortSignal): Promise<ToastEmployee[]> {
  const loc = await service.from("locations").select("toast_restaurant_guid").eq("id", locationId).abortSignal(signal).maybeSingle<{ toast_restaurant_guid: string | null }>();
  if (loc.error) throw new Error("toast_employees_location_failed");
  if (!loc.data?.toast_restaurant_guid) throw new Error("toast_employees_not_connected");
  return parseToastEmployees(await toastGet<unknown>("/labor/v1/employees", loc.data.toast_restaurant_guid, signal));
}

export interface ReviewEmployeeView { guid: string; name: string; deleted: boolean; suggestions: Array<LinkSuggestion & { name: string }> }
export interface LinkView { id: string; employeeGuid: string; employeeName: string | null; userId: string; userName: string; source: "auto" | "manual" }
export interface LinkReview {
  locationId: string;
  /** Null when Toast answered; otherwise a fixed code and the review list is empty. */
  toastError: string | null;
  unlinked: ReviewEmployeeView[];
  links: LinkView[];
  /** People the viewer may link (level ≤ viewer), for the manual picker. */
  users: Array<{ id: string; name: string }>;
}

export async function loadLinkReview(service: SupabaseClient, args: { actor: LinkActor; locationId: string; deadlineMs?: number }): Promise<LinkReview> {
  requireAdmin(args.actor, args.locationId);
  const [users, allLinks] = await Promise.all([linkableUsers(service, args.locationId), loadLinks(service, args.locationId)]);
  const links = allLinks.filter((l) => l.active);
  let employees: ToastEmployee[] = [];
  let toastError: string | null = null;
  try { employees = await fetchEmployees(service, args.locationId, AbortSignal.timeout(args.deadlineMs ?? 8_000)); }
  catch (e) {
    toastError = e instanceof Error && /^toast_employees_/.test(e.message) ? e.message
      : e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError") ? "toast_employees_deadline" : "toast_employees_failed";
  }
  const pickable = users.filter((u) => u.level <= args.actor.level);
  const names = new Map(users.map((u) => [u.id, u.name]));
  const byGuid = new Map(employees.map((e) => [e.guid, e]));
  // Ambiguity and rejections are judged over the whole roster and every link row (r1 P1-1/P1-2);
  // what the VIEWER may pick is narrowed only afterwards.
  const plan = planLinks(employees, users, allLinks);
  const canPick = new Set(pickable.map((u) => u.id));
  // A pending auto match shows as a full-name suggestion until the next tick links it.
  const autoRows = plan.auto.map((a) => ({ employee: byGuid.get(a.employeeGuid)!, suggestions: [{ userId: a.userId, kind: "full_name" as const }] }));
  const unlinked = [...autoRows, ...plan.review].map((r) => ({
    guid: r.employee.guid, name: toastDisplayName(r.employee), deleted: r.employee.deleted,
    suggestions: r.suggestions.filter((s) => canPick.has(s.userId)).map((s) => ({ ...s, name: names.get(s.userId) ?? "" })),
  }));
  return {
    locationId: args.locationId, toastError, unlinked,
    links: links.map((l) => ({ id: l.id, employeeGuid: l.employeeGuid, userId: l.userId, source: l.source,
      employeeName: byGuid.has(l.employeeGuid) ? toastDisplayName(byGuid.get(l.employeeGuid)!) : null,
      userName: names.get(l.userId) ?? "" })),
    users: pickable.map((u) => ({ id: u.id, name: u.name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function linkToastEmployee(service: SupabaseClient, args: { actor: LinkActor; locationId: string; employeeGuid: string; userId: string }): Promise<{ id: string; changed: boolean; backfilled: number }> {
  requireAdmin(args.actor, args.locationId);
  if (!GUID.test(args.employeeGuid) || !UUID.test(args.userId)) throw new LinkError("invalid_payload", 400);
  const { data, error } = await service.rpc("link_toast_employee", {
    p_actor_id: args.actor.userId, p_location_id: args.locationId, p_employee_guid: args.employeeGuid,
    p_user_id: args.userId, p_source: "manual",
  });
  if (error) rpcError(error);
  const result = data as { id: string; changed: boolean; backfilled: number };
  if (result.changed) await audit({ actorId: args.actor.userId, actorRole: args.actor.role, action: "toast_employee_link.create",
    resourceTable: "toast_employee_links", resourceId: result.id,
    metadata: { location_id: args.locationId, employee_guid: args.employeeGuid, user_id: args.userId, source: "manual", backfilled: result.backfilled },
    ipAddress: null, userAgent: null });
  return result;
}

export async function unlinkToastEmployee(service: SupabaseClient, args: { actor: LinkActor; locationId: string; linkId: string }): Promise<{ id: string; changed: boolean }> {
  requireAdmin(args.actor, args.locationId);
  if (!UUID.test(args.linkId)) throw new LinkError("invalid_payload", 400);
  const { data, error } = await service.rpc("unlink_toast_employee", {
    p_actor_id: args.actor.userId, p_location_id: args.locationId, p_link_id: args.linkId,
  });
  if (error) rpcError(error);
  const result = data as { id: string; changed: boolean; cleared: number; employee_guid?: string; user_id?: string };
  if (result.changed) await audit({ actorId: args.actor.userId, actorRole: args.actor.role, action: "toast_employee_link.deactivate",
    resourceTable: "toast_employee_links", resourceId: result.id,
    metadata: { location_id: args.locationId, employee_guid: result.employee_guid ?? null, user_id: result.user_id ?? null, cleared: result.cleared },
    ipAddress: null, userAgent: null });
  return { id: result.id, changed: result.changed };
}

/**
 * System auto links for ONE shop (r1 P2-6: its own step on the who's-here tick, never inside the labor
 * pull's budget). Exact full-name matches only, ambiguity over the whole roster, rejected pairs never
 * re-proposed (planLinks). Every query and RPC carries the caller's signal; a lost race or a
 * rejection the RPC enforces ('link_rejected') is skipped, anything else is a fixed code.
 */
export async function runAutoLinks(service: SupabaseClient, args: { locationId: string; rawEmployees: unknown; signal?: AbortSignal }): Promise<{ linked: number; skipped: number }> {
  const employees = parseToastEmployees(args.rawEmployees);
  const [users, links] = await Promise.all([linkableUsers(service, args.locationId, args.signal), loadLinks(service, args.locationId, args.signal)]);
  const plan = planLinks(employees, users, links);
  let linked = 0; let skipped = 0;
  for (const a of plan.auto) {
    if (args.signal?.aborted) throw new Error("toast_autolink_deadline");
    const call = service.rpc("link_toast_employee", {
      p_actor_id: null, p_location_id: args.locationId, p_employee_guid: a.employeeGuid, p_user_id: a.userId, p_source: "auto",
    });
    const { data, error } = await call.abortSignal(args.signal ?? NEVER);
    if (error) {
      if (KNOWN.some((c) => c === error.message)) { skipped += 1; continue; }
      throw new Error(args.signal?.aborted ? "toast_autolink_deadline" : "toast_autolink_failed");
    }
    const result = data as { id: string; changed: boolean; backfilled: number };
    if (!result.changed) continue;
    linked += 1;
    await audit({ actorId: null, actorRole: null, action: "toast_employee_link.auto_create", resourceTable: "toast_employee_links",
      resourceId: result.id, metadata: { location_id: args.locationId, employee_guid: a.employeeGuid, user_id: a.userId,
        source: "auto", rule: "exact_full_name", backfilled: result.backfilled }, ipAddress: null, userAgent: null });
  }
  return { linked, skipped };
}
