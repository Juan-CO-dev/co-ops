/**
 * Item 21 PR 4 — the HOUSE RECONCILER's caller (migration 0348). Read with docs/runbooks/catering-toast.md.
 *
 * Two steps, both fail-soft, both off unless a shop's `catering_toast_settings` say otherwise:
 *   1. coverHouseNoteEvidence: the one note lookup examines the captures nobody examined yet (lib/catering/toast-note-codes.ts).
 *      It runs BEFORE the reconcilers. If it fails or runs out of time, the unexamined checks simply stay
 *      `evidence_pending` for BOTH sources (0348 refuses them in SQL): a failed lookup can never let one side link
 *      (review PORTAL4-r1).
 *   2. runHouseCateringToast: per shop, `ensure_catering_ring_codes` (ring_code_enabled) and `reconcile_catering_toast`
 *      (auto_link_enabled / origin_auto_link_enabled; never before the shop's `auto_link_from_date`).
 * No row, or a shop with no switch = no call at all. 0344 / 0348 not applied = "not installed", never a failure.
 *
 * EVERY RPC HERE IS ITS OWN REQUEST, hence its own top-level transaction, and step 2 runs AFTER the ezCater reconciler
 * returned: `reconcile_ezcater_toast` must never run inside a savepoint (0347's incumbent rule reads xmin of the row
 * it retired in the same top-level transaction), so nothing here wraps it, calls it, or shares a transaction with it
 * (pinned: tests/ezcater-reconcile-no-subtransaction.test.ts).
 *
 * ONE DEADLINE OWNS EACH STEP: every read and RPC carries the budget's signal and the whole step is raced against it,
 * so a request that never answers cannot hold the cron route past `deadlineAt`. A failure is counted and logged by
 * code, and never changes the health of the capture run that called it.
 */
import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { captureBudget } from "@/lib/toast/capture-runner";
import { coverUncoveredNotes, type CoverResult } from "./toast-note-codes";

type Sb = ReturnType<typeof getServiceRoleClient>;
const NOT_INSTALLED = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);

export interface HouseReconcileResult {
  /** Shops that had at least one switch on. */
  shops: number;
  /** Links added, by evidence. */
  added: number; ringCode: number; toastOrigin: number;
  /** Checks left for the next run because the note lookup has not examined their capture yet. */
  evidencePending: number;
  /** Ring codes generated. */
  codes: number;
  failed: number;
  skipped?: "not_installed";
}
interface ShopSwitches { location_id: string; ring_code_enabled: boolean; auto_link_enabled: boolean; origin_auto_link_enabled: boolean }
const EMPTY = (): HouseReconcileResult => ({ shops: 0, added: 0, ringCode: 0, toastOrigin: 0, evidencePending: 0, codes: 0, failed: 0 });
class NotInstalled extends Error {}
const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

export interface HouseStepArgs { from: string; to: string; today: string; deadlineAt: number; signal?: AbortSignal; client?: Sb }

async function reconcile(sb: Sb, args: HouseStepArgs, signal: AbortSignal): Promise<HouseReconcileResult> {
  const out = EMPTY();
  const settings = await sb.from("catering_toast_settings")
    .select("location_id,ring_code_enabled,auto_link_enabled,origin_auto_link_enabled").eq("enabled", true).order("location_id").range(0, 999).abortSignal(signal);
  if (settings.error) {
    if (settings.error.code && NOT_INSTALLED.has(settings.error.code)) return { ...out, skipped: "not_installed" };
    throw new Error("catering_toast_read_failed");
  }
  const shops = ((settings.data ?? []) as ShopSwitches[]).filter((s) => s.ring_code_enabled || s.auto_link_enabled || s.origin_auto_link_enabled);
  const rpc = async (name: string, params: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(name, params).abortSignal(signal);
    if (error) {
      if (error.code && NOT_INSTALLED.has(error.code)) throw new NotInstalled();
      throw new Error(`${name}_failed`);
    }
    return data as unknown;
  };
  try {
    for (const shop of shops) {
      if (signal.aborted || Date.now() >= args.deadlineAt) break;
      out.shops += 1;
      try {
        if (shop.ring_code_enabled) out.codes += number(await rpc("ensure_catering_ring_codes", { p_location_id: shop.location_id, p_from: args.today }));
        if (shop.auto_link_enabled || shop.origin_auto_link_enabled) {
          const run = await rpc("reconcile_catering_toast", { p_location_id: shop.location_id, p_from: args.from, p_to: args.to }) as
            { added?: unknown; ring_code?: unknown; toast_origin?: unknown; skipped?: { evidence_pending?: unknown } | string } | null;
          out.added += number(run?.added);
          out.ringCode += number(run?.ring_code);
          out.toastOrigin += number(run?.toast_origin);
          if (run?.skipped && typeof run.skipped === "object") out.evidencePending += number(run.skipped.evidence_pending);
        }
      } catch (error) {
        if (error instanceof NotInstalled) throw error;
        out.failed += 1;
        console.error("[catering toast] house reconcile failed:", error instanceof Error ? error.message : "unknown");
      }
    }
  } catch (error) {
    if (error instanceof NotInstalled) return { ...EMPTY(), skipped: "not_installed" };
    throw error;
  }
  return out;
}

/**
 * One deadline for the whole step: its signal goes to every request, and the step itself is raced against it (rejects
 * `capture_deadline`). THE one helper for a deadline-bound catering / Toast step: the cron's two house steps here and
 * the backfill step (lib/catering/catering-toast-settings.ts) all run under it, never under a bare request signal.
 */
export async function bounded<T>(args: { deadlineAt: number; signal?: AbortSignal }, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const budget = captureBudget(Math.max(1, args.deadlineAt - Date.now()), args.signal);
  try { return await budget.wait(() => work(budget.signal)); }
  finally { budget.close(); }
}

/** Throws on a failed settings read or a passed deadline; `runHouseCateringToast` is the seam the crons call. */
export function reconcileHouseCateringToast(args: HouseStepArgs): Promise<HouseReconcileResult> {
  return bounded(args, (signal) => reconcile(args.client ?? getServiceRoleClient(), args, signal));
}

/** The cron seam: never throws. null = it could not run (settings unreadable, or its deadline passed), logged by code. */
export async function runHouseCateringToast(args: HouseStepArgs): Promise<HouseReconcileResult | null> {
  try { return await reconcileHouseCateringToast(args); }
  catch (error) {
    console.error("[catering toast] house reconcile unavailable:", error instanceof Error ? error.message : "unknown");
    return null;
  }
}

/**
 * The cron seam of step 1: never throws. Examines the unexamined captures of [from, to] (at most `maxDays` days per
 * shop). null = it could not run; either way the reconcilers that follow refuse what is still unexamined.
 */
export async function coverHouseNoteEvidence(args: { from: string; to: string; maxDays: number; deadlineAt: number; signal?: AbortSignal; client?: Sb }): Promise<CoverResult | null> {
  try {
    return await bounded(args, (signal) => coverUncoveredNotes(args.client ?? getServiceRoleClient(),
      { from: args.from, to: args.to, maxDays: args.maxDays, deadlineAt: args.deadlineAt, signal }));
  } catch (error) {
    console.error("[catering toast] note lookup unavailable:", error instanceof Error ? error.message : "unknown");
    return null;
  }
}
