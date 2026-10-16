/**
 * THE 7SHIFTS LINKS — pure (Scheduling Phase 1, Task 10). Client-safe: no I/O, no server import.
 *
 * R4 (CC default, 2026-10-15): the link screen shows each waiting 7shifts person's EMPLOYEE ID, name and
 * live role names, and a manager confirms every link. There is NO auto-match by name: this module never
 * compares a 7shifts name with a CO-OPS name, never suggests, never pre-selects and never scores. It
 * returns two independent, sorted lists, and the manager pairs them by hand (0269 refuses any link
 * without a `linked_by`).
 *
 * Names: `displayName` is the preferred first name (else the first name) plus the last INITIAL. The full
 * 7shifts last name never leaves the server.
 *
 * The status line reads the ledger only (counts and fixed codes): `summarizeRuns`, `screenStateFor`.
 * Sync health is shown in the app only; nothing here emails (R6).
 */
import type { SevenShiftsStatus } from "@/lib/sevenshifts/config";

/** The 11 parts a run syncs (whoami aside), in run order — `SYNC_ORDER` in lib/sevenshifts/sync.ts. */
export const SYNC_PARTS = [
  "locations", "departments", "roles", "users", "assignments", "wages", "labor_settings",
  "availabilities", "time_off", "shifts", "time_punches",
] as const;
export type SyncPart = (typeof SYNC_PARTS)[number];

/** A run id with no ledger row older than this is "interrupted"; younger, it is still "running". */
export const INTERRUPTED_AFTER_MS = 10 * 60_000;

export interface RemoteUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  preferredFirstName: string | null;
  employeeId: string | null;
  active: boolean;
}
export interface LiveEdge { userId: string; locationId: string | null; roleId: string | null }
export interface RemoteRole { id: string; name: string | null }
export interface CoopsMember { id: string; name: string }
/** A LIVE 0269 person link. */
export interface UserLink { id: string; sevenShiftsUserId: string; userId: string; linkedAtLocationId: string }

export interface WaitingPerson { remoteUserId: string; displayName: string; employeeId: string | null; roles: string[] }
export interface LinkCandidates { waiting: WaitingPerson[]; members: CoopsMember[] }
export interface LinkedPerson {
  linkId: string;
  remoteUserId: string;
  displayName: string;
  employeeId: string | null;
  userId: string;
  userName: string;
  /** Made for THIS shop (a GM may unlink it); otherwise made at another shop (MoO+ only). */
  linkedHere: boolean;
}

function clean(s: string | null | undefined): string {
  return (s ?? "").trim();
}

/** "Ana R.": preferred first name ‖ first name, plus the last initial. Never the full last name. */
export function displayName(u: Pick<RemoteUser, "firstName" | "lastName" | "preferredFirstName">): string {
  const first = clean(u.preferredFirstName) || clean(u.firstName);
  const last = clean(u.lastName);
  const initial = last ? `${last.charAt(0).toLocaleUpperCase("en-US")}.` : "";
  return [first, initial].filter(Boolean).join(" ");
}

const byText = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" });

/**
 * The two lists the manager pairs BY HAND:
 *   waiting — active 7shifts people with a live assignment at the shop's linked 7shifts location and no
 *             live link, each with its employee id and live role names (sorted);
 *   members — the shop's CO-OPS members (as the caller narrowed them) with no live link.
 * Each list sorted by its display name (ties by id). Nothing pairs, suggests, scores or pre-selects.
 */
export function linkCandidates(args: {
  remoteLocationId: string | null;
  users: readonly RemoteUser[];
  edges: readonly LiveEdge[];
  roles: readonly RemoteRole[];
  members: readonly CoopsMember[];
  links: readonly UserLink[];
}): LinkCandidates {
  const linkedRemote = new Set(args.links.map((l) => l.sevenShiftsUserId));
  const linkedUsers = new Set(args.links.map((l) => l.userId));
  const roleName = new Map(args.roles.map((r) => [r.id, clean(r.name)]));
  const rolesByUser = new Map<string, Set<string>>();
  for (const e of args.edges) {
    if (args.remoteLocationId === null || e.locationId !== args.remoteLocationId) continue;
    const set = rolesByUser.get(e.userId) ?? new Set<string>();
    const name = e.roleId === null ? "" : (roleName.get(e.roleId) ?? "");
    if (name) set.add(name);
    rolesByUser.set(e.userId, set);
  }
  const waiting = args.users
    .filter((u) => u.active && rolesByUser.has(u.id) && !linkedRemote.has(u.id))
    .map((u) => ({ remoteUserId: u.id, displayName: displayName(u), employeeId: u.employeeId, roles: [...rolesByUser.get(u.id)!].sort(byText) }))
    .sort((a, b) => byText(a.displayName, b.displayName) || (a.remoteUserId < b.remoteUserId ? -1 : 1));
  const members = args.members
    .filter((m) => !linkedUsers.has(m.id))
    .map((m) => ({ id: m.id, name: m.name }))
    .sort((a, b) => byText(a.name, b.name) || (a.id < b.id ? -1 : 1));
  return { waiting, members };
}

/**
 * The shop's live person links: those made for this shop, plus those of 7shifts people assigned at the
 * shop's linked 7shifts location. Sorted by the CO-OPS name.
 */
export function linkedPeople(args: {
  locationId: string;
  remoteLocationId: string | null;
  users: readonly RemoteUser[];
  edges: readonly LiveEdge[];
  links: readonly UserLink[];
  names: ReadonlyMap<string, string>;
}): LinkedPerson[] {
  const here = new Set(args.edges.filter((e) => args.remoteLocationId !== null && e.locationId === args.remoteLocationId).map((e) => e.userId));
  const byId = new Map(args.users.map((u) => [u.id, u]));
  return args.links
    .filter((l) => l.linkedAtLocationId === args.locationId || here.has(l.sevenShiftsUserId))
    .map((l) => {
      const u = byId.get(l.sevenShiftsUserId);
      return {
        linkId: l.id, remoteUserId: l.sevenShiftsUserId, displayName: u ? displayName(u) : "", employeeId: u?.employeeId ?? null,
        userId: l.userId, userName: args.names.get(l.userId) ?? "", linkedHere: l.linkedAtLocationId === args.locationId,
      };
    })
    .sort((a, b) => byText(a.userName, b.userName) || (a.linkId < b.linkId ? -1 : 1));
}

// ─── the status line ─────────────────────────────────────────────────────────

export interface RunIdRow { id: string; started_at: string; trigger: string }
export interface LedgerRow {
  id: string;
  trigger: string;
  started_at: string;
  finished_at: string;
  status: string;
  requests: number;
  results: unknown;
}
export type RunState = "ok" | "partial" | "failed" | "interrupted" | "running";
export interface RunSummary {
  id: string;
  trigger: "cron" | "manual";
  startedAt: string;
  finishedAt: string | null;
  state: RunState;
  okParts: number;
  totalParts: number;
  /** Parts 7shifts refused for the plan tier (`plan_forbidden`), in run order. */
  planForbidden: SyncPart[];
  /** The token covers more than one company (R2: not supported). */
  multiCompany: boolean;
}

function errorCodeOf(results: unknown, part: string): string | null | undefined {
  if (!results || typeof results !== "object") return undefined;
  const r = (results as Record<string, unknown>)[part];
  if (!r || typeof r !== "object") return undefined;
  const code = (r as Record<string, unknown>).error_code;
  return code === null ? null : typeof code === "string" ? code : undefined;
}

/** The latest runs, newest first (at most `limit`): ledger rows summarized, run ids without one marked. */
export function summarizeRuns(runIds: readonly RunIdRow[], ledger: readonly LedgerRow[], nowMs: number, limit = 5): RunSummary[] {
  const rows = new Map(ledger.map((r) => [r.id, r]));
  const started = new Map<string, RunIdRow>();
  for (const r of runIds) started.set(r.id, r);
  for (const r of ledger) if (!started.has(r.id)) started.set(r.id, { id: r.id, started_at: r.started_at, trigger: r.trigger });
  return [...started.values()]
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at) || (a.id < b.id ? 1 : -1))
    .slice(0, limit)
    .map((r) => {
      const row = rows.get(r.id);
      const trigger = r.trigger === "manual" ? "manual" : "cron";
      if (!row) {
        return {
          id: r.id, trigger, startedAt: r.started_at, finishedAt: null,
          state: nowMs - Date.parse(r.started_at) > INTERRUPTED_AFTER_MS ? "interrupted" : "running",
          okParts: 0, totalParts: SYNC_PARTS.length, planForbidden: [], multiCompany: false,
        } satisfies RunSummary;
      }
      const state: RunState = row.status === "ok" || row.status === "partial" || row.status === "failed" ? row.status : "failed";
      return {
        id: r.id, trigger, startedAt: row.started_at, finishedAt: row.finished_at, state,
        okParts: SYNC_PARTS.filter((p) => errorCodeOf(row.results, p) === null).length,
        totalParts: SYNC_PARTS.length,
        planForbidden: SYNC_PARTS.filter((p) => errorCodeOf(row.results, p) === "plan_forbidden"),
        multiCompany: errorCodeOf(row.results, "whoami") === "multi_company",
      } satisfies RunSummary;
    });
}

export type ScreenState = "not_connected" | "sync_off" | "not_supported" | "ready";

/** The env decides first; then the latest FINISHED run decides not_supported (multi-company, R2). */
export function screenStateFor(status: SevenShiftsStatus, runs: readonly RunSummary[] | null): ScreenState {
  if (status.reason === "token_missing") return "not_connected";
  if (status.reason === "sync_off") return "sync_off";
  const latest = (runs ?? []).find((r) => r.finishedAt !== null);
  return latest?.multiCompany ? "not_supported" : "ready";
}

/** Every code a link or Sync now act can answer with; each has `sevenshifts.error.<code>` in en + es. */
export const SEVENSHIFTS_LINK_ERROR_CODES = [
  "invalid_payload", "forbidden", "role_insufficient", "location_access_denied", "assignee_unavailable",
  "remote_unknown", "remote_not_at_shop", "shop_already_linked", "remote_already_linked", "user_already_linked",
  "link_not_found", "link_failed", "not_connected", "sync_off", "sync_busy", "deadline",
] as const;
export type SevenShiftsLinkErrorCode = (typeof SEVENSHIFTS_LINK_ERROR_CODES)[number];
