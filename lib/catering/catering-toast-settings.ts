/**
 * Item 21 PR 5 — the server side of the catering ↔ Toast settings card (migration 0350) and of "match the older orders".
 *
 * Every entry point refuses anyone but the Owner / CGS / MoO by TRUSTED ROLE before any I/O.
 *  - loadCateringToastSettings: every active shop with its row (no row = the defaults, off) and the two facts the
 *    writer's refusals rest on (0350's probe). 0344 or 0350 missing = `not_installed`, never a 500.
 *  - saveCateringToastSettings: ONE call of `set_catering_toast_settings`, the only writer of the table. It re-checks
 *    the role on the locked users row, the row the person saw, every dependency, and writes its own destructive
 *    `catering.toast_settings_update` audit row in the same transaction (so this module never calls audit() for a
 *    save: there is no way to change a switch without that row). Never write `catering_toast_settings` any other way.
 *  - loadBackfillStatus / runBackfillStep: the older orders (Juan answer 7). The cron's reconciler looks at the last
 *    nine days only; a step runs the SAME reconciler (`reconcile_catering_toast`, 0348) over one older stretch, after
 *    the one note lookup examined that stretch's captures. It decides nothing itself: every rule is the reconciler's,
 *    in SQL, including "never before the shop's start date" and "never a check whose capture has not been examined".
 *    The cursor is a date. A step that added links writes one audit row naming the person who started it.
 */
import "server-only";
import type { AuthContext } from "@/lib/session";
import { audit } from "@/lib/audit";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { etCalendarDate } from "@/lib/operational-day";
import { CateringToastNotInstalled, NOT_INSTALLED, raise } from "./catering-toast";
import { coverUncoveredNotes } from "./toast-note-codes";
import { bounded } from "./catering-toast-reconcile";
import {
  canManageCateringToastSettings, DEFAULT_CATERING_TOAST_SETTINGS, fromSettingsRow, SETTINGS_ERRORS, SETTINGS_ROW_COLUMNS, toSettingsRow,
  type CateringToastSettingsView, type CateringToastShopCard, type SettingsError, type SettingsRow, type SettingsSave,
} from "./catering-toast-settings-shared";
import {
  addDays, backfillSkips, backfillWindow, EMPTY_BACKFILL_STATUS, nextCursor, type BackfillStatus, type BackfillStep,
} from "./catering-toast-backfill-shared";

type Sb = ReturnType<typeof getServiceRoleClient>;
/** Every day of a stretch may need its own Toast lookup; a step examines as many as its deadline allows. */
export const BACKFILL_LOOKUP_DAYS = 80;
export class CateringToastSettingsError extends Error {
  constructor(public status: number, public code: SettingsError | "generic") { super(code); }
}
function assertRole(actor: AuthContext) {
  if (!canManageCateringToastSettings(actor.role)) throw new CateringToastSettingsError(403, "forbidden");
}

export async function loadCateringToastSettings(actor: AuthContext, deps: { client?: Sb } = {}): Promise<CateringToastSettingsView> {
  assertRole(actor);
  const sb = deps.client ?? getServiceRoleClient();
  const probe = await sb.rpc("catering_toast_settings_ready");
  if (probe.error) {
    if (probe.error.code && NOT_INSTALLED.has(probe.error.code)) return { state: "not_installed" };
    throw new CateringToastSettingsError(503, "settings_unavailable");
  }
  const ready = probe.data as { link_step?: unknown; automatic?: unknown } | null;
  try {
    const [shops, rows] = await Promise.all([
      selectAllRows<{ id: string; name: string }>((from, to) => sb.from("locations").select("id,name").eq("active", true).order("name").order("id").range(from, to)),
      selectAllRows<SettingsRow & { location_id: string; updated_at: string }>(async (from, to) => {
        const res = await sb.from("catering_toast_settings").select(SETTINGS_ROW_COLUMNS).order("location_id").range(from, to);
        if (res.error) raise(res.error);
        return res;
      }),
    ]);
    const byShop = new Map(rows.map((r) => [r.location_id, r]));
    const cards: CateringToastShopCard[] = shops.map((s) => {
      const row = byShop.get(s.id);
      return { locationId: s.id, name: s.name, values: row ? fromSettingsRow(row) : { ...DEFAULT_CATERING_TOAST_SETTINGS }, updatedAt: row?.updated_at ?? null };
    });
    return { state: "ready", readiness: { linkStep: ready?.link_step === true, automatic: ready?.automatic === true }, shops: cards };
  } catch (error) {
    if (error instanceof CateringToastNotInstalled) return { state: "not_installed" };
    throw new CateringToastSettingsError(503, "settings_unavailable");
  }
}

export async function saveCateringToastSettings(actor: AuthContext, input: SettingsSave, deps: { client?: Sb } = {}): Promise<CateringToastShopCard["values"] & { updatedAt: string }> {
  assertRole(actor);
  const sb = deps.client ?? getServiceRoleClient();
  const { data, error } = await sb.rpc("set_catering_toast_settings", {
    p_actor_id: actor.user.id, p_location_id: input.locationId, p_settings: toSettingsRow(input.values), p_expected_updated_at: input.expectedUpdatedAt,
  });
  if (error) {
    if (error.code && NOT_INSTALLED.has(error.code)) throw new CateringToastSettingsError(503, "settings_unavailable");
    // The function's own refusals pass through by name; anything else is a failure, never a silent success.
    const code = (SETTINGS_ERRORS as readonly string[]).find((c) => c === error.message) as SettingsError | undefined;
    if (!code) throw new CateringToastSettingsError(500, "generic");
    throw new CateringToastSettingsError(code === "forbidden" ? 403 : code === "location_not_found" ? 404 : code === "invalid_settings" ? 400 : 409, code);
  }
  const row = data as (SettingsRow & { updated_at?: string }) | null;
  if (!row || typeof row.updated_at !== "string") throw new CateringToastSettingsError(500, "generic");
  return { ...fromSettingsRow(row), updatedAt: row.updated_at };
}

interface ShopSwitches { enabled: boolean; auto_link_enabled: boolean; origin_auto_link_enabled: boolean; auto_link_from_date: string | null }
const never = new AbortController().signal;
async function shopSwitches(sb: Sb, locationId: string, signal: AbortSignal = never): Promise<ShopSwitches | null> {
  const { data, error } = await sb.from("catering_toast_settings").select("enabled,auto_link_enabled,origin_auto_link_enabled,auto_link_from_date")
    .eq("location_id", locationId).abortSignal(signal).maybeSingle<ShopSwitches>();
  if (error) raise(error);
  return data ?? null;
}
/** What the backfill may run for: null = it may; otherwise why not. */
function backfillState(row: ShopSwitches | null): "off" | "no_switch" | null {
  if (!row?.enabled) return "off";
  if (!(row.auto_link_enabled || row.origin_auto_link_enabled) || !row.auto_link_from_date) return "no_switch";
  return null;
}
/** Event dates of the shop's booked house orders with no Toast check linked, through `today`. Read to completion. */
async function unmatchedDates(sb: Sb, locationId: string, today: string, from?: string, signal: AbortSignal = never): Promise<string[]> {
  const rows = await selectAllRows<{ event_date: string }>(async (a, b) => {
    let q = sb.from("catering_reconciliation_status").select("lead_id,event_date").eq("location_id", locationId).eq("status", "not_rung_in_toast").lte("event_date", today);
    if (from) q = q.gte("event_date", from);
    const res = await q.order("event_date").order("lead_id").range(a, b).abortSignal(signal);
    if (res.error) raise(res.error);
    return res;
  });
  return rows.map((r) => String(r.event_date).slice(0, 10));
}

export async function loadBackfillStatus(actor: AuthContext, locationId: string, deps: { client?: Sb; now?: Date } = {}): Promise<BackfillStatus> {
  assertRole(actor);
  const sb = deps.client ?? getServiceRoleClient();
  try {
    const row = await shopSwitches(sb, locationId);
    const start = row?.auto_link_from_date ? String(row.auto_link_from_date).slice(0, 10) : null;
    const state = backfillState(row);
    if (state === "off") return EMPTY_BACKFILL_STATUS("off", start);
    const dates = await unmatchedDates(sb, locationId, etCalendarDate((deps.now ?? new Date()).toISOString()));
    const fromStart = start ? dates.filter((d) => d >= start).length : 0;
    return { state: state ?? "ready", startDate: start, unmatched: dates.length, fromStart, beforeStart: dates.length - fromStart };
  } catch (error) {
    if (error instanceof CateringToastNotInstalled) return EMPTY_BACKFILL_STATUS("not_installed");
    throw new CateringToastSettingsError(503, "settings_unavailable");
  }
}

const ZERO = { examined: 0, pendingOrders: 0, added: 0, ringCode: 0, toastOrigin: 0, skipped: {} };
const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/**
 * ONE step of the backfill for one shop. `cursor` = where to go on from (null = the shop's start date; never earlier).
 *  1. The next stretch: from the first unmatched event on or after the cursor, at most 60 days, never past today.
 *  2. The note lookup examines the stretch's unexamined captures (its checks are rung from the day before to a week
 *     after). If it examined some and some are left, the step answers "checking" with the SAME cursor.
 *  3. Otherwise (nothing left, or what is left cannot be read now) the reconciler runs over the stretch. What it could
 *     not link it counts by reason; an unexamined capture is `evidence_pending`, never a link.
 * ONE DEADLINE OWNS THE STEP (review PORTAL5-r2): `bounded` (the house steps' own helper) races the whole step against
 * `deadlineAt` and hands every read and RPC its signal; nothing new starts after it, and a step that ran out of time
 * answers `backfill_timeout` by name. The step is safe to ask again with the same cursor: the lookup's coverage is
 * recorded, and the reconciler only adds what is still missing.
 */
export async function runBackfillStep(actor: AuthContext, locationId: string, cursor: string | null,
  deps: { client?: Sb; now?: Date; deadlineAt?: number; signal?: AbortSignal; cover?: typeof coverUncoveredNotes } = {}): Promise<BackfillStep> {
  assertRole(actor);
  const sb = deps.client ?? getServiceRoleClient();
  const cover = deps.cover ?? coverUncoveredNotes;
  const deadlineAt = deps.deadlineAt ?? Date.now() + 40_000;
  const today = etCalendarDate((deps.now ?? new Date()).toISOString());
  if (Date.now() >= deadlineAt) throw new CateringToastSettingsError(503, "backfill_timeout");
  try {
    return await bounded({ deadlineAt, signal: deps.signal }, async (signal) => {
      /** Nothing new starts once the deadline has passed. */
      const alive = () => { if (signal.aborted || Date.now() >= deadlineAt) throw new CateringToastSettingsError(503, "backfill_timeout"); };
      const row = await shopSwitches(sb, locationId, signal);
      const state = backfillState(row);
      if (state === "off") throw new CateringToastSettingsError(409, "switch_needs_enabled");
      if (state === "no_switch") throw new CateringToastSettingsError(409, "backfill_needs_switch");
      const start = String(row!.auto_link_from_date).slice(0, 10);
      // Never before the shop's start date, whatever cursor was sent.
      const from = cursor && cursor > start ? cursor : start;
      alive();
      const window = backfillWindow(await unmatchedDates(sb, locationId, today, from, signal), from, today);
      if (!window) return { phase: "done", from: null, to: null, ...ZERO, next: null };

      const lookFrom = addDays(window.from, -1), lookTo = addDays(window.to, 7) < today ? addDays(window.to, 7) : today;
      const uncovered = async () => {
        alive();
        const res = await sb.rpc("catering_toast_uncovered_orders", { p_location_id: locationId, p_from: lookFrom, p_to: lookTo }).abortSignal(signal);
        if (res.error) {
          if (res.error.code && NOT_INSTALLED.has(res.error.code)) throw new CateringToastSettingsError(409, "automatic_not_installed");
          throw new CateringToastSettingsError(503, "settings_unavailable");
        }
        return ((res.data ?? []) as unknown[]).length;
      };
      if (await uncovered() > 0 && deadlineAt - Date.now() > 12_000) {
        const looked = await cover(sb, { from: lookFrom, to: lookTo, maxDays: BACKFILL_LOOKUP_DAYS, deadlineAt: deadlineAt - 10_000, signal, onlyLocationId: locationId });
        if (looked.examined > 0) {
          const left = await uncovered();
          // Progress, and more to examine: the same stretch again. (No progress = what is left cannot be read now: link.)
          if (left > 0) return { phase: "checking", from: window.from, to: window.to, ...ZERO, examined: looked.examined, pendingOrders: left, next: window.from };
        }
      }

      alive();
      const run = await sb.rpc("reconcile_catering_toast", { p_location_id: locationId, p_from: window.from, p_to: window.to }).abortSignal(signal);
      if (run.error) {
        if (run.error.code && NOT_INSTALLED.has(run.error.code)) throw new CateringToastSettingsError(409, "automatic_not_installed");
        throw new CateringToastSettingsError(503, "settings_unavailable");
      }
      const answer = run.data as { added?: unknown; ring_code?: unknown; toast_origin?: unknown; skipped?: unknown } | null;
      // The switch went off between the read above and the reconciler's own read under its lock: nothing was linked.
      if (answer?.skipped === "off" || answer?.skipped === "not_ready") throw new CateringToastSettingsError(409, "backfill_needs_switch");
      const step: BackfillStep = { phase: "linked", from: window.from, to: window.to, examined: 0, pendingOrders: 0, added: count(answer?.added),
        ringCode: count(answer?.ring_code), toastOrigin: count(answer?.toast_origin), skipped: backfillSkips(answer?.skipped), next: nextCursor(window, today) };
      if (step.next === null) step.phase = "done";
      if (step.added > 0) {
        // The links themselves are recorded by the reconciler (catering.toast_reconciled, no actor). This row names the
        // PERSON who ran it over an older stretch. Ids and counts only. (audit() is fail-open and bounded by itself.)
        await audit({ actorId: actor.user.id, actorRole: actor.role, action: "catering.toast_backfill", resourceTable: "catering_toast_links", resourceId: null,
          metadata: { location_id: locationId, from: window.from, to: window.to, added: step.added, ring_code: step.ringCode, toast_origin: step.toastOrigin, skipped: step.skipped },
          ipAddress: null, userAgent: null });
      }
      return step;
    });
  } catch (error) {
    if (error instanceof CateringToastSettingsError) throw error;
    if (error instanceof CateringToastNotInstalled) throw new CateringToastSettingsError(409, "automatic_not_installed");
    // The step's own deadline (the budget rejects with capture_deadline; an aborted request surfaces as an abort).
    if (Date.now() >= deadlineAt || (error instanceof Error && error.message === "capture_deadline")) throw new CateringToastSettingsError(503, "backfill_timeout");
    throw new CateringToastSettingsError(503, "settings_unavailable");
  }
}
