/**
 * THE 7SHIFTS LINKS — SERVER-ONLY (Scheduling Phase 1, Task 10). The lib over the 0269 RPCs and the
 * read behind /admin/sevenshifts.
 *
 * - EVERY act checks lib/people/access-shared.ts BEFORE any I/O: shop links MoO+ (company-level config);
 *   person links GM own shop, MoO+ any (`canManageSevenShiftsPeople`), then the SUBJECT through
 *   `canLinkSevenShiftsUser` (actor ≥ subject; a GM's subject holds a membership at the shop). The 0269
 *   RPCs enforce the same rules again in the database; their P0001 codes map to SevenShiftsLinkError.
 * - DORMANT without SEVENSHIFTS_ACCESS_TOKEN or SEVENSHIFTS_SYNC=1: 0268/0269 are applied before the switch
 *   is set, so with it off the tables may not exist. Writers answer 409 and the screen reads NOTHING.
 * - Audited `sevenshifts_location_link.*` / `sevenshifts_user_link.*` (destructive), ids only, and only
 *   when something changed.
 * - No link is ever proposed: the screen gets two independent lists (links-shared.ts, R4).
 * - Wages: the screen gets a COUNT of people with a wage on file. The only wage read selects `user_id`;
 *   no rate is read, returned or logged (R5: rates are MoO+ and Phase 1 has no wage surface).
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "@/lib/audit";
import {
  canLinkSevenShiftsUser, canManageSevenShiftsPeople, canManageSevenShiftsShops, canSyncNow, canViewSevenShiftsStatus, linkNeedsRemoteAtShop,
  type PeopleActor,
} from "@/lib/people/access-shared";
import { getRoleLevel, isRoleCode } from "@/lib/roles";
import { selectAllRows } from "@/lib/supabase-paginate";
import { sevenShiftsStatus } from "@/lib/sevenshifts/config";
import { linkableUsers } from "@/lib/toast/employee-links";
import {
  linkCandidates, linkedPeople, screenStateFor, summarizeRuns,
  type CoopsMember, type LedgerRow, type LinkedPerson, type LiveEdge, type RemoteUser, type RunIdRow, type RunSummary,
  type ScreenState, type SevenShiftsLinkErrorCode, type UserLink, type WaitingPerson,
} from "@/lib/sevenshifts/links-shared";

type Env = Readonly<Record<string, string | undefined>>;

export class SevenShiftsLinkError extends Error {
  constructor(public status: number, public code: SevenShiftsLinkErrorCode) { super(code); }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REMOTE_ID = /^[1-9]\d{0,17}$/;
const ID_CHUNK = 100;

/** The 0269 refusals, by name, and their HTTP status. Anything else is `link_failed` (500). */
const RPC_CODES: Partial<Record<SevenShiftsLinkErrorCode, number>> = {
  invalid_payload: 400, role_insufficient: 403, location_access_denied: 403, remote_not_at_shop: 403,
  link_not_found: 404, remote_unknown: 404,
  shop_already_linked: 409, remote_already_linked: 409, user_already_linked: 409, assignee_unavailable: 409,
};

function rpcError(error: { message: string }): never {
  const code = Object.keys(RPC_CODES).find((c) => c === error.message) as SevenShiftsLinkErrorCode | undefined;
  if (code) throw new SevenShiftsLinkError(RPC_CODES[code]!, code);
  throw new SevenShiftsLinkError(500, "link_failed");
}

/** 0269 and the mirrors exist only once the switch is on; before that, nothing is read or written. */
function requireReady(env: Env): void {
  const s = sevenShiftsStatus(env);
  if (s.reason === "token_missing") throw new SevenShiftsLinkError(409, "not_connected");
  if (s.reason === "sync_off") throw new SevenShiftsLinkError(409, "sync_off");
}

function requireUuid(v: string): void {
  if (!UUID.test(v)) throw new SevenShiftsLinkError(400, "invalid_payload");
}
function requireRemote(v: string): void {
  if (!REMOTE_ID.test(v)) throw new SevenShiftsLinkError(400, "invalid_payload");
}

// ─── writers ─────────────────────────────────────────────────────────────────

export async function linkShop(
  service: SupabaseClient,
  args: { actor: PeopleActor; locationId: string; remoteLocationId: string },
  env: Env = process.env,
): Promise<{ id: string; changed: boolean }> {
  if (!canManageSevenShiftsShops(args.actor)) throw new SevenShiftsLinkError(403, "forbidden");
  requireReady(env);
  requireUuid(args.locationId);
  requireRemote(args.remoteLocationId);
  const { data, error } = await service.rpc("link_sevenshifts_location", {
    p_actor: args.actor.userId, p_location: args.locationId, p_remote: args.remoteLocationId,
  });
  if (error) rpcError(error);
  const r = data as { id: string; changed: boolean };
  if (r.changed) await audit({
    actorId: args.actor.userId, actorRole: args.actor.role, action: "sevenshifts_location_link.create",
    resourceTable: "sevenshifts_location_links", resourceId: r.id,
    metadata: { location_id: args.locationId, sevenshifts_location_id: args.remoteLocationId }, ipAddress: null, userAgent: null,
  });
  return { id: r.id, changed: r.changed };
}

export async function unlinkShop(
  service: SupabaseClient,
  args: { actor: PeopleActor; linkId: string },
  env: Env = process.env,
): Promise<{ id: string; changed: boolean }> {
  if (!canManageSevenShiftsShops(args.actor)) throw new SevenShiftsLinkError(403, "forbidden");
  requireReady(env);
  requireUuid(args.linkId);
  const { data, error } = await service.rpc("unlink_sevenshifts_location", { p_actor: args.actor.userId, p_link: args.linkId });
  if (error) rpcError(error);
  const r = data as { id: string; changed: boolean; location_id?: string; sevenshifts_location_id?: number | string };
  if (r.changed) await audit({
    actorId: args.actor.userId, actorRole: args.actor.role, action: "sevenshifts_location_link.deactivate",
    resourceTable: "sevenshifts_location_links", resourceId: r.id,
    metadata: { location_id: r.location_id ?? null, sevenshifts_location_id: r.sevenshifts_location_id == null ? null : String(r.sevenshifts_location_id) },
    ipAddress: null, userAgent: null,
  });
  return { id: r.id, changed: r.changed };
}

/** The subject's level and active memberships, for `canLinkSevenShiftsUser` (the RPC re-checks both). */
async function loadSubject(service: SupabaseClient, userId: string): Promise<{ level: number; locations: string[] }> {
  const u = await service.from("users").select("id,role,active").eq("id", userId).maybeSingle<{ id: string; role: string; active: boolean }>();
  if (u.error) throw new SevenShiftsLinkError(500, "link_failed");
  if (!u.data || !u.data.active || !isRoleCode(u.data.role)) throw new SevenShiftsLinkError(409, "assignee_unavailable");
  const m = await service.from("user_locations").select("location_id").eq("user_id", userId).eq("active", true);
  if (m.error) throw new SevenShiftsLinkError(500, "link_failed");
  return { level: getRoleLevel(u.data.role), locations: (m.data ?? []).map((r) => String((r as { location_id: string }).location_id)) };
}

/**
 * Ruling (a): the 7shifts person holds a LIVE assignment at the shop's LIVE-linked 7shifts location, or
 * 403 `remote_not_at_shop`. A failed read is 500 `link_failed`, never a pass. The RPC re-checks it.
 */
async function requireRemoteAtShop(service: SupabaseClient, locationId: string, remoteUserId: string): Promise<void> {
  const link = await service.from("sevenshifts_location_links").select("sevenshifts_location_id")
    .eq("location_id", locationId).eq("active", true).limit(1);
  if (link.error) throw new SevenShiftsLinkError(500, "link_failed");
  const remoteLocation = (link.data ?? [])[0] as { sevenshifts_location_id: number | string } | undefined;
  if (!remoteLocation) throw new SevenShiftsLinkError(403, "remote_not_at_shop");
  const edge = await service.from("sevenshifts_user_assignments").select("user_id")
    .eq("user_id", remoteUserId).eq("location_id", String(remoteLocation.sevenshifts_location_id)).eq("active", true).limit(1);
  if (edge.error) throw new SevenShiftsLinkError(500, "link_failed");
  if ((edge.data ?? []).length === 0) throw new SevenShiftsLinkError(403, "remote_not_at_shop");
}

export async function linkUser(
  service: SupabaseClient,
  args: { actor: PeopleActor; locationId: string; remoteUserId: string; userId: string },
  env: Env = process.env,
): Promise<{ id: string; changed: boolean }> {
  if (!canManageSevenShiftsPeople(args.actor, args.locationId)) throw new SevenShiftsLinkError(403, "forbidden");
  requireReady(env);
  requireUuid(args.locationId);
  requireUuid(args.userId);
  requireRemote(args.remoteUserId);
  const subject = await loadSubject(service, args.userId);
  if (!canLinkSevenShiftsUser(args.actor, subject.level, subject.locations, args.locationId)) {
    throw new SevenShiftsLinkError(403, subject.level > args.actor.level ? "role_insufficient" : "location_access_denied");
  }
  if (linkNeedsRemoteAtShop(args.actor)) await requireRemoteAtShop(service, args.locationId, args.remoteUserId);
  const { data, error } = await service.rpc("link_sevenshifts_user", {
    p_actor: args.actor.userId, p_location: args.locationId, p_remote_user: args.remoteUserId, p_user: args.userId,
  });
  if (error) rpcError(error);
  const r = data as { id: string; changed: boolean };
  if (r.changed) await audit({
    actorId: args.actor.userId, actorRole: args.actor.role, action: "sevenshifts_user_link.create",
    resourceTable: "sevenshifts_user_links", resourceId: r.id,
    metadata: { location_id: args.locationId, sevenshifts_user_id: args.remoteUserId, user_id: args.userId }, ipAddress: null, userAgent: null,
  });
  return { id: r.id, changed: r.changed };
}

export async function unlinkUser(
  service: SupabaseClient,
  args: { actor: PeopleActor; locationId: string; linkId: string },
  env: Env = process.env,
): Promise<{ id: string; changed: boolean }> {
  if (!canManageSevenShiftsPeople(args.actor, args.locationId)) throw new SevenShiftsLinkError(403, "forbidden");
  requireReady(env);
  requireUuid(args.locationId);
  requireUuid(args.linkId);
  const { data, error } = await service.rpc("unlink_sevenshifts_user", {
    p_actor: args.actor.userId, p_location: args.locationId, p_link: args.linkId,
  });
  if (error) rpcError(error);
  const r = data as { id: string; changed: boolean; sevenshifts_user_id?: number | string; user_id?: string; linked_at_location_id?: string };
  if (r.changed) await audit({
    actorId: args.actor.userId, actorRole: args.actor.role, action: "sevenshifts_user_link.deactivate",
    resourceTable: "sevenshifts_user_links", resourceId: r.id,
    metadata: {
      location_id: args.locationId, linked_at_location_id: r.linked_at_location_id ?? null,
      sevenshifts_user_id: r.sevenshifts_user_id == null ? null : String(r.sevenshifts_user_id), user_id: r.user_id ?? null,
    },
    ipAddress: null, userAgent: null,
  });
  return { id: r.id, changed: r.changed };
}

// ─── the screen ──────────────────────────────────────────────────────────────

export interface ShopLinkView { id: string; remoteId: string; remoteName: string }
export interface LinkScreen {
  locationId: string;
  state: ScreenState;
  can: { manageShops: boolean; linkPeople: boolean; syncNow: boolean };
  recentRuns: RunSummary[];
  /** MoO+ only: every active CO-OPS shop and its live 7shifts link. */
  shops: Array<{ locationId: string; name: string; link: ShopLinkView | null }>;
  /** MoO+ only: 7shifts locations no shop is linked to (the Link picker). */
  remoteLocations: Array<{ id: string; name: string }>;
  shopLink: ShopLinkView | null;
  linked: LinkedPerson[];
  waiting: WaitingPerson[];
  members: CoopsMember[];
  /** People at this shop's 7shifts location with a wage on file. A COUNT; never a rate. */
  wagesCount: number;
}

const str = (v: unknown) => String(v);

async function inChunks<T>(ids: readonly string[], read: (chunk: string[]) => PromiseLike<{ data: unknown[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await read(ids.slice(i, i + ID_CHUNK));
    if (error) throw new Error("sevenshifts link screen: read failed");
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

export async function loadLinkScreen(
  service: SupabaseClient,
  args: { actor: PeopleActor; locationId: string; now?: number },
  env: Env = process.env,
): Promise<LinkScreen> {
  const { actor, locationId } = args;
  if (!UUID.test(locationId) || !canViewSevenShiftsStatus(actor, locationId)) throw new SevenShiftsLinkError(403, "forbidden");
  const can = {
    manageShops: canManageSevenShiftsShops(actor),
    linkPeople: canManageSevenShiftsPeople(actor, locationId),
    syncNow: canSyncNow(actor),
  };
  const empty: LinkScreen = {
    locationId, state: screenStateFor(sevenShiftsStatus(env), null), can, recentRuns: [], shops: [], remoteLocations: [],
    shopLink: null, linked: [], waiting: [], members: [], wagesCount: 0,
  };
  // Not connected / switched off: the 0268–0269 tables may not exist yet. Read nothing.
  if (empty.state !== "ready") return empty;

  // ── the ledger: the status line and "Recent syncs" ──
  const ids = await service.from("sevenshifts_sync_run_ids").select("id,started_at,trigger").order("started_at", { ascending: false }).limit(5);
  if (ids.error) throw new Error("sevenshifts link screen: read failed");
  const runIds = ((ids.data ?? []) as Array<{ id: string; started_at: string; trigger: string }>).map((r) => ({ id: str(r.id), started_at: r.started_at, trigger: r.trigger }) satisfies RunIdRow);
  const ledger = runIds.length === 0 ? [] : await inChunks<LedgerRow>(runIds.map((r) => r.id), (chunk) =>
    service.from("sevenshifts_sync_runs").select("id,trigger,started_at,finished_at,status,requests,results").in("id", chunk));
  const recentRuns = summarizeRuns(runIds, ledger, args.now ?? Date.now());
  const state = screenStateFor(sevenShiftsStatus(env), recentRuns);
  if (state !== "ready") return { ...empty, state, recentRuns };

  // ── shops ──
  const shopLinksRes = await service.from("sevenshifts_location_links").select("id,location_id,sevenshifts_location_id").eq("active", true);
  if (shopLinksRes.error) throw new Error("sevenshifts link screen: read failed");
  const shopLinks = (shopLinksRes.data ?? []) as Array<{ id: string; location_id: string; sevenshifts_location_id: number | string }>;
  const remoteRes = await service.from("sevenshifts_locations").select("id,name").order("name");
  if (remoteRes.error) throw new Error("sevenshifts link screen: read failed");
  const remoteNames = new Map(((remoteRes.data ?? []) as Array<{ id: number | string; name: string | null }>).map((r) => [str(r.id), (r.name ?? "").trim()]));
  const view = (l: { id: string; sevenshifts_location_id: number | string }): ShopLinkView =>
    ({ id: l.id, remoteId: str(l.sevenshifts_location_id), remoteName: remoteNames.get(str(l.sevenshifts_location_id)) ?? "" });
  const own = shopLinks.find((l) => l.location_id === locationId);
  const shopLink = own ? view(own) : null;
  let shops: LinkScreen["shops"] = [];
  let remoteLocations: LinkScreen["remoteLocations"] = [];
  if (can.manageShops) {
    const locs = await service.from("locations").select("id,name").eq("active", true).order("name");
    if (locs.error) throw new Error("sevenshifts link screen: read failed");
    shops = ((locs.data ?? []) as Array<{ id: string; name: string }>).map((l) => {
      const link = shopLinks.find((x) => x.location_id === l.id);
      return { locationId: l.id, name: l.name, link: link ? view(link) : null };
    });
    const taken = new Set(shopLinks.map((l) => str(l.sevenshifts_location_id)));
    remoteLocations = [...remoteNames].filter(([id]) => !taken.has(id)).map(([id, name]) => ({ id, name }));
  }

  // ── people ──
  const remoteLocationId = shopLink?.remoteId ?? null;
  const edges: LiveEdge[] = remoteLocationId === null ? [] : (await selectAllRows<{ user_id: number | string; location_id: number | string | null; role_id: number | string | null }>((from, to) =>
    service.from("sevenshifts_user_assignments").select("user_id,location_id,role_id").eq("active", true).eq("location_id", remoteLocationId)
      .order("user_id").range(from, to)))
    .map((e) => ({ userId: str(e.user_id), locationId: e.location_id === null ? null : str(e.location_id), roleId: e.role_id === null ? null : str(e.role_id) }));
  const links: UserLink[] = (await selectAllRows<{ id: string; sevenshifts_user_id: number | string; user_id: string; linked_at_location_id: string }>((from, to) =>
    service.from("sevenshifts_user_links").select("id,sevenshifts_user_id,user_id,linked_at_location_id").eq("active", true).order("id").range(from, to)))
    .map((l) => ({ id: l.id, sevenShiftsUserId: str(l.sevenshifts_user_id), userId: l.user_id, linkedAtLocationId: l.linked_at_location_id }));
  const atShop = new Set(edges.map((e) => e.userId));
  const shopLinks2 = links.filter((l) => l.linkedAtLocationId === locationId || atShop.has(l.sevenShiftsUserId));
  const remoteIds = [...new Set([...atShop, ...shopLinks2.map((l) => l.sevenShiftsUserId)])].sort();
  const users: RemoteUser[] = (await inChunks<{ id: number | string; first_name: string | null; last_name: string | null; preferred_first_name: string | null; employee_id: string | null; active: boolean }>(remoteIds,
    (chunk) => service.from("sevenshifts_users").select("id,first_name,last_name,preferred_first_name,employee_id,active").in("id", chunk)))
    .map((u) => ({ id: str(u.id), firstName: u.first_name, lastName: u.last_name, preferredFirstName: u.preferred_first_name, employeeId: u.employee_id, active: u.active }));
  const roles = remoteLocationId === null ? [] : await (async () => {
    const r = await service.from("sevenshifts_roles").select("id,name").eq("location_id", remoteLocationId);
    if (r.error) throw new Error("sevenshifts link screen: read failed");
    return ((r.data ?? []) as Array<{ id: number | string; name: string | null }>).map((x) => ({ id: str(x.id), name: x.name }));
  })();
  const pickable = (await linkableUsers(service, locationId)).filter((u) => u.level <= actor.level).map((u) => ({ id: u.id, name: u.name }));
  const { waiting, members } = linkCandidates({ remoteLocationId, users, edges, roles, members: pickable, links });
  const names = new Map(pickable.map((m) => [m.id, m.name]));
  const missing = [...new Set(shopLinks2.map((l) => l.userId).filter((id) => !names.has(id)))];
  for (const u of await inChunks<{ id: string; name: string }>(missing, (chunk) => service.from("users").select("id,name").in("id", chunk))) names.set(u.id, u.name);
  const linked = linkedPeople({ locationId, remoteLocationId, users, edges, links: shopLinks2, names });

  // ── wages: a COUNT of people with a wage on file; `user_id` is the only column read ──
  const wageRows = await inChunks<{ user_id: number | string }>(remoteIds,
    (chunk) => service.from("sevenshifts_wages").select("user_id").eq("active", true).in("user_id", chunk));
  const wagesCount = new Set(wageRows.map((w) => str(w.user_id))).size;

  return { locationId, state, can, recentRuns, shops, remoteLocations, shopLink, linked, waiting, members, wagesCount };
}
