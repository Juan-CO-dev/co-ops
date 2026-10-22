/**
 * `loadReconciliation` — THE THREE-WAY RECONCILIATION'S ONE LOADER (Scheduling Phase 2, Task 25). Server-only, service
 * role, READ-ONLY: no writer, no audit, no email, no notification. The rules are `reconcile-shared.ts` (pure).
 *
 * Order:
 *  1. the permission rule, BEFORE any I/O (`scheduleActRefusal(…, "reconciliation")`): GM own shop, MoO+ any; the social
 *     media manager refused by ROLE; the AGM, the catering / prep managers and everyone below refused by name;
 *  2. the window: the last 14 operational (ET) days, today included;
 *  3. the reads, every one PAGED (`selectAllRows`) and every id list chunked:
 *     - the shop's members (active `user_locations`, active users; levels 1–7, the social media manager and CGS aside —
 *       MoO and Owner are presence only on a schedule);
 *     - Toast: the shop's ACTIVE `toast_employee_links` (0233) and its `toast_time_entries` (0224, not deleted) in the
 *       window — the FIRST name only, never a wage. A missing 0233 reads as "no links" (`toastLinksAvailable: false`);
 *     - the CO-OPS proposal: the heads of the weeks covering the window (`schedule_weeks` → `schedule_revision_shifts`).
 *       A missing 0275 reads as "no proposal" (`proposalAvailable: false`), never a 500;
 *     - 7shifts ONLY when its status is `ready` (the token and the switch; 0268 / 0269 exist only then): the shop's live
 *       location link, the live assignments there, those users (display name = first name + last initial, the full last
 *       name never leaves the server), the live person links, the mirrored shifts (`sevenshifts_shifts`, filtered to
 *       draft = false and not deleted in the pure rule) and punches at that location in the window.
 *  4. the pure `reconcile`, observed at the loader's `now` (open punches = on shift now; shifts not started = upcoming);
 *     the 7shifts users assigned here but inactive in 7shifts are counted, never listed (Astra chunk G P3-5). Actions deep-link to the existing link screens (`/admin/toast-employees?loc=`,
 *     `/admin/sevenshifts?loc=`) — this view writes nothing.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { operationalNow } from "@/lib/midshift-shared";
import { operationalDayUtcRange } from "@/lib/operational-day";
import { isMissingTable } from "@/lib/people/facts";
import type { PeopleActor } from "@/lib/people/access-shared";
import { getRoleLevel, isRoleCode, type RoleCode } from "@/lib/roles";
import { sevenShiftsStatus } from "@/lib/sevenshifts/config";
import { displayName } from "@/lib/sevenshifts/links-shared";
import { selectAllRows } from "@/lib/supabase-paginate";
import { scheduleActRefusal } from "./access-shared";
import { loadEmploymentStates, stateOf } from "@/lib/admin/employment-read";
import { employmentChipOf } from "@/lib/admin/employment-core-shared";
import { loadPersonSettings } from "./inputs";
import { effectiveScheduleRole } from "./works-as-shared";
import { ScheduleError } from "./errors-shared";
import {
  reconcile, type ProposalShift, type ReconcileMember, type ReconcileView, type SevenLinkRow, type SevenPunch, type SevenShiftRow, type SevenStatus,
  type SevenUserAtShop, type ToastLinkRow, type ToastPunch,
} from "./reconcile-shared";
import { addDays, isoWeekStart } from "./time-shared";

type Env = Readonly<Record<string, string | undefined>>;

export interface ReconcileDeps { service: SupabaseClient; now?: Date }

export const RECONCILE_WINDOW_DAYS = 14;
/** Roles never on a shop's reconciliation (the social media manager and CGS); levels above 7 are presence only. */
const OFF_FLOOR_ROLES: readonly RoleCode[] = ["social_media_mgr", "cgs"];
const ID_CHUNK = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ReconcilePage {
  locationId: string;
  today: string;
  dates: string[];
  sevenStatus: SevenStatus;
  shopLinkedToSeven: boolean;
  toastLinksAvailable: boolean;
  proposalAvailable: boolean;
  view: ReconcileView;
  links: { toast: string; seven: string };
}

const str = (v: unknown) => String(v);
const chunks = <T>(xs: readonly T[]): T[][] => { const out: T[][] = []; for (let i = 0; i < xs.length; i += ID_CHUNK) out.push(xs.slice(i, i + ID_CHUNK)); return out; };

/** A read that may meet a table not applied yet: a missing relation is `null`, anything else throws. */
async function optional<T>(read: () => Promise<T>): Promise<T | null> {
  try { return await read(); } catch (e) {
    if (isMissingTable({ message: e instanceof Error ? e.message : String(e) })) return null;
    throw e;
  }
}

export async function loadReconciliation(deps: ReconcileDeps, args: { actor: PeopleActor; locationId: string }, env: Env = process.env): Promise<ReconcilePage> {
  const { actor, locationId } = args;
  const refusal = scheduleActRefusal(actor, locationId, "reconciliation", { agmAccess: "read" });
  if (refusal) throw new ScheduleError(refusal);
  if (!UUID.test(locationId)) throw new ScheduleError("shop_not_allowed");
  const { service } = deps;
  const nowDate = deps.now ?? new Date();
  const today = operationalNow(nowDate).date;
  const dates = Array.from({ length: RECONCILE_WINDOW_DAYS }, (_, i) => addDays(today, i - (RECONCILE_WINDOW_DAYS - 1)));
  const from = dates[0]!;
  const to = dates[dates.length - 1]!;

  // ── members ──
  const ul = await selectAllRows<{ user_id: string }>((f, t) => service.from("user_locations").select("user_id")
    .eq("location_id", locationId).eq("active", true).order("user_id", { ascending: true }).range(f, t));
  // Staff separations (0279): an inactive member ON LEAVE or SEPARATED is listed with their status chip (never as missing);
  // an active member whose record says on leave / separated (reactivated by mistake) carries the chip too.
  const memberIds = [...new Set(ul.map((r) => r.user_id))];
  const employment = await loadEmploymentStates(service, memberIds);
  const personSettings = new Map((await loadPersonSettings(service, locationId)).map((s) => [s.userId, s]));
  const members: ReconcileMember[] = [];
  for (const ids of chunks(memberIds)) {
    for (const u of await selectAllRows<{ id: string; name: string; role: string; active: boolean }>((f, t) => service.from("users")
      .select("id, name, role, active").in("id", ids).order("id", { ascending: true }).range(f, t))) {
      if (!isRoleCode(u.role)) continue;
      const role = effectiveScheduleRole(u.role, personSettings.get(u.id)?.worksAs);
      if (OFF_FLOOR_ROLES.includes(role)) continue;
      const level = getRoleLevel(role);
      if (level < 1 || level > 7) continue;
      const chip = employmentChipOf(stateOf(employment, u.id));
      if (!u.active && !chip) continue;
      members.push(chip ? { userId: u.id, name: u.name, employment: chip } : { userId: u.id, name: u.name });
    }
  }

  // ── Toast ──
  const toastLinkRows = await optional(() => selectAllRows<{ employee_guid: string; user_id: string }>((f, t) => service.from("toast_employee_links")
    .select("employee_guid, user_id").eq("location_id", locationId).eq("active", true).order("employee_guid", { ascending: true }).range(f, t)));
  const toastLinks: ToastLinkRow[] = (toastLinkRows ?? []).map((r) => ({ employeeGuid: r.employee_guid, userId: r.user_id }));
  const toastPunches: ToastPunch[] = (await selectAllRows<{ employee_guid: string; employee_first_name: string | null; business_date: string; in_at: string; out_at: string | null; hours: number | string | null }>(
    (f, t) => service.from("toast_time_entries").select("employee_guid, employee_first_name, business_date, in_at, out_at, hours")
      .eq("location_id", locationId).eq("deleted", false).gte("business_date", from).lte("business_date", to)
      .order("business_date", { ascending: true }).order("time_entry_guid", { ascending: true }).range(f, t)))
    .map((r) => ({ employeeGuid: r.employee_guid, firstName: r.employee_first_name, businessDate: r.business_date, inAt: r.in_at, outAt: r.out_at, hours: r.hours === null ? null : Number(r.hours) }));

  // ── the CO-OPS proposal: the heads of the weeks covering the window ──
  const weekStarts = [...new Set(dates.map(isoWeekStart))];
  const proposal = await optional(async () => {
    const weeks = await selectAllRows<{ week_start: string; head_revision_id: string | null }>((f, t) => service.from("schedule_weeks")
      .select("week_start, head_revision_id").eq("location_id", locationId).in("week_start", weekStarts).order("week_start", { ascending: true }).range(f, t));
    const heads = weeks.filter((w) => w.head_revision_id !== null);
    const covered = new Set(heads.flatMap((w) => Array.from({ length: 7 }, (_, i) => addDays(w.week_start, i))));
    const shifts: ProposalShift[] = [];
    for (const ids of chunks(heads.map((w) => w.head_revision_id!))) {
      for (const s of await selectAllRows<{ user_id: string; business_date: string; start_q: number; end_q: number }>((f, t) => service.from("schedule_revision_shifts")
        .select("user_id, business_date, start_q, end_q").eq("location_id", locationId).in("revision_id", ids)
        .gte("business_date", from).lte("business_date", to)
        .order("business_date", { ascending: true }).order("user_id", { ascending: true }).order("start_q", { ascending: true }).range(f, t))) {
        shifts.push({ userId: s.user_id, date: s.business_date, startQ: s.start_q, endQ: s.end_q });
      }
    }
    return { shifts, dates: dates.filter((d) => covered.has(d)) };
  });

  // ── 7shifts, only when ready (0268 / 0269 exist only then) ──
  const status = sevenShiftsStatus(env);
  const sevenStatus: SevenStatus = status.state === "ready" ? "ready" : status.state;
  let shopLinkedToSeven = false;
  let sevenLinks: SevenLinkRow[] = [];
  let sevenUsersAtShop: SevenUserAtShop[] = [];
  let sevenShifts: SevenShiftRow[] = [];
  let sevenPunches: SevenPunch[] = [];
  let sevenInactiveAtShop = 0;
  if (sevenStatus === "ready") {
    const link = await service.from("sevenshifts_location_links").select("sevenshifts_location_id").eq("location_id", locationId).eq("active", true).limit(1);
    if (link.error) throw new Error("reconciliation: 7shifts read failed");
    const remote = ((link.data ?? []) as Array<{ sevenshifts_location_id: number | string }>)[0];
    shopLinkedToSeven = !!remote;
    const allLinks = (await selectAllRows<{ sevenshifts_user_id: number | string; user_id: string; linked_at_location_id: string }>((f, t) => service.from("sevenshifts_user_links")
      .select("sevenshifts_user_id, user_id, linked_at_location_id").eq("active", true).order("id", { ascending: true }).range(f, t)))
      .map((l) => ({ sevenUserId: str(l.sevenshifts_user_id), userId: l.user_id, here: l.linked_at_location_id === locationId }));
    if (remote) {
      // The raw value as read (a bigint arrives as a number), so the filter matches it exactly.
      const remoteId = remote.sevenshifts_location_id;
      const edges = await selectAllRows<{ user_id: number | string }>((f, t) => service.from("sevenshifts_user_assignments")
        .select("user_id").eq("active", true).eq("location_id", remoteId).order("user_id", { ascending: true }).range(f, t));
      const atShop = [...new Set(edges.map((e) => str(e.user_id)))].sort();
      for (const ids of chunks(atShop)) {
        for (const u of await selectAllRows<{ id: number | string; first_name: string | null; last_name: string | null; preferred_first_name: string | null; employee_id: string | null; active: boolean }>(
          (f, t) => service.from("sevenshifts_users").select("id, first_name, last_name, preferred_first_name, employee_id, active").in("id", ids).order("id", { ascending: true }).range(f, t))) {
          if (!u.active) { sevenInactiveAtShop++; continue; }
          sevenUsersAtShop.push({ sevenUserId: str(u.id), displayName: displayName({ firstName: u.first_name, lastName: u.last_name, preferredFirstName: u.preferred_first_name }), employeeId: u.employee_id });
        }
      }
      const atShopSet = new Set(atShop);
      sevenLinks = allLinks.filter((l) => l.here || atShopSet.has(l.sevenUserId)).map(({ sevenUserId, userId }) => ({ sevenUserId, userId }));
      const startIso = operationalDayUtcRange(from).startIso;
      const endIso = operationalDayUtcRange(to).endExclusiveIso;
      sevenShifts = (await selectAllRows<{ user_id: number | string | null; start_at: string; end_at: string; draft: boolean | null; deleted: boolean }>((f, t) => service.from("sevenshifts_shifts")
        .select("user_id, start_at, end_at, draft, deleted").eq("location_id", remoteId).gte("start_at", startIso).lt("start_at", endIso)
        .order("start_at", { ascending: true }).order("id", { ascending: true }).range(f, t)))
        .map((s) => ({ sevenUserId: s.user_id === null ? null : str(s.user_id), startAt: s.start_at, endAt: s.end_at, draft: s.draft, deleted: s.deleted }));
      sevenPunches = (await selectAllRows<{ user_id: number | string; clocked_in: string; clocked_out: string | null; break_minutes: number | null }>((f, t) => service.from("sevenshifts_time_punches")
        .select("user_id, clocked_in, clocked_out, break_minutes").eq("location_id", remoteId).eq("deleted", false).gte("clocked_in", startIso).lt("clocked_in", endIso)
        .order("clocked_in", { ascending: true }).order("id", { ascending: true }).range(f, t)))
        .map((p) => ({ sevenUserId: str(p.user_id), clockedIn: p.clocked_in, clockedOut: p.clocked_out, breakMinutes: p.break_minutes }));
    } else {
      sevenLinks = allLinks.filter((l) => l.here).map(({ sevenUserId, userId }) => ({ sevenUserId, userId }));
    }
  }

  const view = reconcile({
    dates, sevenStatus, shopLinkedToSeven, members, toastLinks, sevenLinks, sevenUsersAtShop,
    toastPunches14d: toastPunches, sevenPunches14d: sevenPunches, publishedSevenShifts14d: sevenShifts,
    coopsProposalShifts14d: proposal?.shifts ?? [], coopsProposalDates: proposal?.dates ?? [],
    now: nowDate.toISOString(), sevenInactiveAtShop,
  });
  return {
    locationId, today, dates, sevenStatus, shopLinkedToSeven,
    toastLinksAvailable: toastLinkRows !== null, proposalAvailable: proposal !== null, view,
    links: { toast: `/admin/toast-employees?loc=${locationId}`, seven: `/admin/sevenshifts?loc=${locationId}` },
  };
}
