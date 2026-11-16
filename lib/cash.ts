import { auditTaskOverride, hasTaskAccess } from "@/lib/assignments";
import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "@/lib/audit";
import type { RoleCode } from "@/lib/roles";
import { lockLocationContext, type LocationActor } from "@/lib/locations";

import {
  CASH_REPORT_BASE_LEVEL,
  DEFAULT_FLOAT_CENTS,
  DENOMINATION_UNITS_CENTS,
  computeCashTotals,
  cashDateRefusal,
  closingLocksCash,
  sumDenominations,
  type Denominations,
  type OnShiftEntry,
  type CashTotals,
} from "@/lib/cash-shared";
import type { ToastProjected } from "@/lib/cash-toast-shared";

// Client-safe money math lives in lib/cash-shared.ts (see its header for why);
// re-exported here so existing server consumers keep their import paths.
export {
  CASH_REPORT_BASE_LEVEL,
  DEFAULT_FLOAT_CENTS,
  DENOMINATION_UNITS_CENTS,
  computeCashTotals,
  sumDenominations,
  type Denominations,
  type OnShiftEntry,
  type CashTotals,
};

export interface CashActor { userId: string; role: RoleCode; level: number }

export interface CashReport {
  id: string;
  locationId: string;
  reportDate: string;
  projectedCents: number;
  drawerTotalCents: number;
  floatCents: number;
  countMethod: "hand" | "denomination";
  denominations: Denominations | null;
  cashTipsCents: number;
  onShift: OnShiftEntry[];
  overShortCents: number;
  depositCents: number;
  overShortNote: string | null;
  /** B10 (0253): the server-read Toast CASH figure at save time; null = none recorded. */
  toastProjectedCents: number | null;
  toastProjectedAsOf: string | null;
  signedBy: string;
  signedByName: string | null; // resolved by loader
  signedAt: string;
  createdAt: string;
}

const ROW = "id, location_id, report_date, projected_cents, drawer_total_cents, float_cents, count_method, denominations, cash_tips_cents, on_shift, over_short_cents, deposit_cents, over_short_note, toast_projected_cents, toast_projected_as_of, signed_by, signed_at, created_at";

function rowToCashReport(r: Record<string, unknown>, signedByName: string | null): CashReport {
  return {
    id: r.id as string, locationId: r.location_id as string, reportDate: r.report_date as string,
    projectedCents: r.projected_cents as number, drawerTotalCents: r.drawer_total_cents as number,
    floatCents: r.float_cents as number, countMethod: r.count_method as "hand" | "denomination",
    denominations: (r.denominations as Denominations | null) ?? null, cashTipsCents: r.cash_tips_cents as number,
    onShift: (r.on_shift as OnShiftEntry[]) ?? [], overShortCents: r.over_short_cents as number,
    depositCents: r.deposit_cents as number, overShortNote: (r.over_short_note as string | null) ?? null,
    toastProjectedCents: r.toast_projected_cents == null ? null : Number(r.toast_projected_cents),
    toastProjectedAsOf: (r.toast_projected_as_of as string | null) ?? null,
    signedBy: r.signed_by as string, signedByName, signedAt: r.signed_at as string, createdAt: r.created_at as string,
  };
}

/** The live cash report for a location/day, or null. */
export async function loadCashReport(
  service: SupabaseClient, args: { locationId: string; date: string },
): Promise<CashReport | null> {
  const { data, error } = await service.from("cash_reports").select(ROW)
    .eq("location_id", args.locationId).eq("report_date", args.date).is("superseded_at", null)
    .maybeSingle<Record<string, unknown>>();
  if (error) throw new Error(`loadCashReport: ${error.message}`);
  if (!data) return null;
  let name: string | null = null;
  if (data.signed_by) {
    const { data: u } = await service.from("users").select("name").eq("id", data.signed_by as string).maybeSingle<{ name: string }>();
    name = u?.name ?? null;
  }
  return rowToCashReport(data, name);
}

export interface CashDashboardState { isVisibleToActor: boolean; report: CashReport | null }

export async function loadCashDashboardState(
  service: SupabaseClient, args: { locationId: string; date: string; actor: CashActor },
): Promise<CashDashboardState> {
  if (!(await hasTaskAccess(service, { ...args.actor, locationId: args.locationId, date: args.date, task: "cash_report" }))) return { isVisibleToActor: false, report: null };
  return { isVisibleToActor: true, report: await loadCashReport(service, args) };
}

/**
 * Is the day's cash report locked by a finalized closing? (W03/B040, review r1.)
 *
 * Reads EVERY closing instance the shop has for the date — the embed joins checklist_templates on
 * type = 'closing' with no `active` / effective-date filter, so a night closed on a template version
 * that has since been retired (an admin published V2 and deactivated V1) stays locked. Keying the
 * lock on today's current-template resolution let that night fall out of it: the resolution returned
 * V2 (no instance) or nothing, and the gate went quiet. Any instance in a locking status locks
 * (closingLocksCash). A failed read THROWS — never "no closing, the edit window is open".
 * Migration 0304's in-transaction gate is the same rule in SQL. Service-role read, bounded by shop/date.
 */
export async function cashLockedByClosing(
  service: SupabaseClient, args: { locationId: string; date: string },
): Promise<boolean> {
  const { data, error } = await service.from("checklist_instances")
    .select("status, checklist_templates!inner(type)")
    .eq("location_id", args.locationId).eq("date", args.date)
    .eq("checklist_templates.type", "closing");
  if (error) throw new Error(`closing lock lookup: ${error.message}`);
  return ((data ?? []) as Array<{ status: string }>).some((r) => closingLocksCash(r.status));
}

export type CashSubmitResult =
  | { ok: true; id: string }
  | { ok: false; reason: "closing_finalized" | "assignment_required" | "location_access_denied" | "concurrent_submit" | "outside_current_week" };

/** Postgres unique violation: cash_reports_one_live_per_day refused a second live row. */
const PG_UNIQUE_VIOLATION = "23505";

type CashSubmitArgs = {
  locationId: string; date: string; actor: CashActor & LocationActor;
  projectedCents: number; drawerTotalCents: number; floatCents: number;
  countMethod: "hand" | "denomination"; denominations: Denominations | null;
  cashTipsCents: number; onShift: OnShiftEntry[]; overShortNote: string | null;
  /**
   * B10: the Toast CASH figure the SERVER read for this shop+day (lib/cash-toast.ts) — never a
   * client-sent number. null = Toast had no figure. Stored beside the typed projected_cents.
   */
  toastProjected: ToastProjected | null;
};

/**
 * W03/B041: the named arguments of migration 0304's `submit_cash_report_atomic`, in its signature
 * order (tests/cash-atomic-0304.test.ts pins the keys against the migration file). Pure.
 */
export function cashAtomicRpcArgs(
  args: CashSubmitArgs,
  w: { overShortCents: number; depositCents: number; nowIso: string },
): Record<string, unknown> {
  return {
    p_location_id: args.locationId,
    p_report_date: args.date,
    p_projected_cents: args.projectedCents,
    p_drawer_total_cents: args.drawerTotalCents,
    p_float_cents: args.floatCents,
    p_count_method: args.countMethod,
    p_denominations: args.countMethod === "denomination" ? args.denominations : null,
    p_cash_tips_cents: args.cashTipsCents,
    p_on_shift: args.onShift,
    p_over_short_cents: w.overShortCents,
    p_deposit_cents: w.depositCents,
    p_over_short_note: args.overShortNote,
    p_toast_projected_cents: args.toastProjected?.cents ?? null,
    p_toast_projected_as_of: args.toastProjected?.asOf ?? null,
    p_actor_id: args.actor.userId,
    p_now: w.nowIso,
  };
}

/** The function is not installed (0304 not applied yet): PostgREST's PGRST202 or Postgres's 42883. */
function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return error.code === "PGRST202" || error.code === "42883"
    || /could not find the function/i.test(error.message ?? "");
}

type AtomicOutcome =
  | { kind: "written"; id: string; supersededId: string | null }
  | { kind: "refused"; reason: "closing_finalized" | "concurrent_submit" }
  | { kind: "not_installed" };

/**
 * W03/B041: the write through 0304's transactional writer — the closing re-check (FOR SHARE on every
 * closing instance the shop has for the day, any template version), the compare-and-set supersede, the insert and the back-pointer in ONE
 * transaction, so a confirm or the auto-release that commits mid-request can no longer be overtaken.
 */
async function writeCashReportAtomic(
  service: SupabaseClient,
  rpcArgs: Record<string, unknown>,
): Promise<AtomicOutcome> {
  const { data, error } = await service.rpc("submit_cash_report_atomic", rpcArgs);
  if (error) {
    if (isMissingFunction(error)) {
      console.error("[cash 0304_missing] submit_cash_report_atomic (0304) is not installed; using the direct write path", { code: error.code });
      return { kind: "not_installed" };
    }
    if (error.message === "closing_finalized") return { kind: "refused", reason: "closing_finalized" };
    if (error.code === PG_UNIQUE_VIOLATION) return { kind: "refused", reason: "concurrent_submit" };
    throw new Error(`submitCashReport: submit_cash_report_atomic: ${error.message}`);
  }
  const row = (Array.isArray(data) && data.length === 1 ? data[0] : null) as { new_id?: unknown; superseded_id?: unknown } | null;
  if (!row || typeof row.new_id !== "string" || (row.superseded_id !== null && typeof row.superseded_id !== "string")) {
    throw new Error("submitCashReport: submit_cash_report_atomic returned an unexpected shape");
  }
  return { kind: "written", id: row.new_id, supersededId: (row.superseded_id as string | null) ?? null };
}

/** The audit row + the task-override row for a written cash report (both write paths). */
async function recordCashWrite(
  service: SupabaseClient,
  args: CashSubmitArgs,
  w: { id: string; supersededId: string | null; overShortCents: number; depositCents: number },
): Promise<void> {
  const action = w.supersededId ? "cash_report.supersede" : "cash_report.submit";
  void audit({
    actorId: args.actor.userId, actorRole: args.actor.role,
    action,
    resourceTable: "cash_reports", resourceId: w.id,
    metadata: {
      over_short_cents: w.overShortCents, deposit_cents: w.depositCents, superseded: w.supersededId,
      projected_cents: args.projectedCents, toast_projected_cents: args.toastProjected?.cents ?? null,
    },
    ipAddress: null, userAgent: null,
  });
  await auditTaskOverride(service, { ...args.actor, locationId: args.locationId, date: args.date, task: "cash_report", operation: action });
}

/**
 * Append-only signed write. Recomputes totals server-side (never trusts the
 * client). Supersedes the prior live row (edit). Refuses if the day's closing is
 * already finalized (edit window closed). PIN already verified by the route;
 * signedBy is the authenticated actor.
 *
 * W03/B041: the write goes through 0304's `submit_cash_report_atomic`, which re-checks the
 * closing under a lock in the same transaction as the supersede + insert. Until 0304 is applied
 * (the function is missing) it falls back to the direct three-write path below, which carries the
 * same status list (B040) and a compare-and-set supersede (B147) but not the in-transaction lock.
 */
export async function submitCashReport(
  service: SupabaseClient,
  args: CashSubmitArgs,
): Promise<CashSubmitResult> {
  if (!lockLocationContext(args.actor, args.locationId)) {
    return { ok: false, reason: "location_access_denied" };
  }
  // W03 follow-up (Juan 2026-11-15): below GM, only this business week (Mon–Sun, ET). Pure, before
  // any I/O; the clock is read once and the same instant is the write's signed_at.
  const nowIso = new Date().toISOString();
  if (cashDateRefusal(args.actor.level, args.date, nowIso)) {
    return { ok: false, reason: "outside_current_week" };
  }
  if (!(await hasTaskAccess(service, { ...args.actor, locationId: args.locationId, date: args.date, task: "cash_report" }))) {
    return { ok: false, reason: "assignment_required" };
  }
  // Edit-window gate: refuse if any of the day's closing instances is finalized — confirmed,
  // incomplete_confirmed OR auto_finalized (W03/B040: the system's release locks it too), on
  // whichever template version it was run (review r1 — see cashLockedByClosing).
  if (await cashLockedByClosing(service, { locationId: args.locationId, date: args.date })) {
    return { ok: false, reason: "closing_finalized" };
  }

  const { overShortCents, depositCents } = computeCashTotals({
    projectedCents: args.projectedCents,
    drawerTotalCents: args.drawerTotalCents,
    floatCents: args.floatCents,
  });

  // The early refusal above is the friendly one; this is the binding one (inside the transaction).
  const atomic = await writeCashReportAtomic(service, cashAtomicRpcArgs(args, { overShortCents, depositCents, nowIso }));
  if (atomic.kind === "refused") return { ok: false, reason: atomic.reason };
  if (atomic.kind === "written") {
    await recordCashWrite(service, args, { id: atomic.id, supersededId: atomic.supersededId, overShortCents, depositCents });
    return { ok: true, id: atomic.id };
  }

  // ── Direct path: only while 0304 is not applied (atomic.kind === "not_installed") ──
  const { data: prior } = await service.from("cash_reports").select("id")
    .eq("location_id", args.locationId).eq("report_date", args.date).is("superseded_at", null)
    .maybeSingle<{ id: string }>();

  // Supersede BEFORE insert: the partial unique index (superseded_at IS NULL)
  // enforces one live row per (location_id, report_date). We must clear the
  // prior row's null superseded_at before the new row can satisfy the index.
  // We temporarily write a sentinel superseded_at; after insert we overwrite
  // with the canonical (nowIso, new row id) pair.
  if (prior) {
    // BUG 4 fix: surface the supersede error (the insert has a partial-unique
    // backstop, so this is diagnostic clarity — match the file's discipline).
    // W03/B147: compare-and-set. Two submits that both read this prior row used to both stamp it,
    // and the winner's back-pointer then disagreed with the loser's superseded_at. Only a row that
    // is still live is superseded; 0 rows = a concurrent submit got there first.
    const { error: supersedeErr, count: superseded } = await service
      .from("cash_reports").update({ superseded_at: nowIso }, { count: "exact" })
      .eq("id", prior.id).is("superseded_at", null);
    if (supersedeErr) throw new Error(`submitCashReport: supersede: ${supersedeErr.message}`);
    if ((superseded ?? 0) === 0) return { ok: false, reason: "concurrent_submit" };
  }

  const { data: inserted, error: insErr } = await service.from("cash_reports").insert({
    location_id: args.locationId, report_date: args.date,
    projected_cents: args.projectedCents, drawer_total_cents: args.drawerTotalCents,
    float_cents: args.floatCents, count_method: args.countMethod,
    denominations: args.countMethod === "denomination" ? args.denominations : null,
    cash_tips_cents: args.cashTipsCents, on_shift: args.onShift,
    over_short_cents: overShortCents, deposit_cents: depositCents,
    over_short_note: args.overShortNote, signed_by: args.actor.userId, signed_at: nowIso,
    entered_by: args.actor.userId,
    toast_projected_cents: args.toastProjected?.cents ?? null,
    toast_projected_as_of: args.toastProjected?.asOf ?? null,
  }).select("id").single<{ id: string }>();
  if (insErr) {
    // A first submit that lost cash_reports_one_live_per_day to a concurrent first submit: the
    // winner's row stands and nothing of ours was written (W03/B147 — a named 409, not a 500).
    if (!prior && insErr.code === PG_UNIQUE_VIOLATION) return { ok: false, reason: "concurrent_submit" };
    // Attempt to undo the supersede so the prior row remains live.
    if (prior) {
      // The rollback lifts OUR OWN stamp and nobody else's. Two simultaneous
      // submits both read this same prior row and both supersede it; the loser's
      // insert then loses to `cash_reports_one_live_per_day`, and an unfiltered
      // rollback would be asking that same index for a SECOND live row — which it
      // refuses. Matching on the stamp we wrote makes the no-op explicit instead
      // of leaving the index to refuse it, and `count` makes the silent UPDATE 0
      // (someone re-stamped the row) visible per the house rowcount law.
      const { error: rollbackErr, count: rolledBack } = await service
        .from("cash_reports")
        .update({ superseded_at: null }, { count: "exact" })
        .eq("id", prior.id)
        .eq("superseded_at", nowIso);

      if (rollbackErr || (rolledBack ?? 0) === 0) {
        // A FAILED ROLLBACK IS NOT PROOF OF A STRAND (wiring audit, 2026-08-29).
        // In the concurrent case above the refusal is the index doing its job and
        // the day is fine; in the single-writer case the prior row is now
        // superseded with no live successor, and every read surface
        // (loadCashReport, reports hub, dashboard) filters `superseded_at IS
        // NULL`, so the location silently reads as having filed no cash report.
        // The two are indistinguishable from the rollback's error alone, so ask
        // the question that actually decides it.
        const { data: liveNow } = await service
          .from("cash_reports").select("id")
          .eq("location_id", args.locationId).eq("report_date", args.date)
          .is("superseded_at", null)
          .maybeSingle<{ id: string }>();

        if (liveNow) {
          console.warn(
            `[cash] submitCashReport rollback refused for prior ${prior.id} — a live report (${liveNow.id}) already covers ${args.locationId}/${args.date}; a concurrent submit won and nothing is stranded.`,
          );
        } else {
          // Forensic row, not just a log line: a strand is invisible on every
          // read surface, so the evidence has to live somewhere queryable. The
          // action is the one this write already speaks (`cash_report.supersede`,
          // closed vocabulary); the outcome names the failure. Awaited because we
          // throw on the next line — `audit()` is fail-open and never throws.
          console.error(
            `[cash] submitCashReport STRANDED prior ${prior.id}: the supersede rolled back neither cleanly (${rollbackErr?.message ?? "0 rows matched"}) nor into a live successor — ${args.locationId}/${args.date} now reads as having no cash report until someone resubmits.`,
          );
          await audit({
            actorId: args.actor.userId, actorRole: args.actor.role,
            action: "cash_report.supersede",
            resourceTable: "cash_reports", resourceId: prior.id,
            metadata: {
              outcome: "supersede_strand",
              location_id: args.locationId,
              report_date: args.date,
              insert_error: insErr.message,
              rollback_error: rollbackErr?.message ?? null,
              rollback_rows: rolledBack ?? null,
            },
            ipAddress: null, userAgent: null,
          });
        }
      }
    }
    throw new Error(`submitCashReport: insert: ${insErr.message}`);
  }

  // Now fill in the back-pointer on the prior row.
  if (prior) {
    // BUG 4 fix: log a failed back-pointer write (non-fatal — the insert already
    // succeeded and the supersede already committed; the chain link is forensic).
    const { error: backPtrErr } = await service
      .from("cash_reports").update({ superseded_by: inserted.id }).eq("id", prior.id);
    if (backPtrErr) {
      console.error(
        `[cash] submitCashReport back-pointer write failed for prior ${prior.id}: ${backPtrErr.message}`,
      );
    }
  }

  await recordCashWrite(service, args, { id: inserted.id, supersededId: prior?.id ?? null, overShortCents, depositCents });
  return { ok: true, id: inserted.id };
}
