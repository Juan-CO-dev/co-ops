/**
 * Item 21 PR 4 — the HOUSE RECONCILER's caller (migration 0348). Read with docs/runbooks/catering-toast.md.
 *
 * For each shop whose `catering_toast_settings` is enabled:
 *   - `ring_code_enabled`: `ensure_catering_ring_codes` gives every booked house lead from today on its code;
 *   - `auto_link_enabled` / `origin_auto_link_enabled`: `reconcile_catering_toast` adds the automatic links
 *     (ring code / Toast origin), never before the shop's `auto_link_from_date`.
 * No row, or a shop that is off = no call at all. 0344 / 0348 not applied = "not installed", never a failure.
 *
 * EVERY RPC HERE IS ITS OWN REQUEST, hence its own top-level transaction, and this runs AFTER the ezCater reconciler
 * returned: `reconcile_ezcater_toast` must never run inside a savepoint (0347's incumbent rule reads xmin of the row
 * it retired in the same top-level transaction), so nothing here wraps it, calls it, or shares a transaction with it
 * (pinned: tests/ezcater-reconcile-no-subtransaction.test.ts).
 * Fail-soft: a failure is counted and logged by code, and never changes the health of the capture run that called it.
 */
import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { lookupHouseNoteCodes } from "./toast-note-codes";

type Sb = ReturnType<typeof getServiceRoleClient>;
const NOT_INSTALLED = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);

export interface HouseReconcileResult {
  /** Shops that had at least one switch on. */
  shops: number;
  /** Links added, by evidence. */
  added: number; ringCode: number; toastOrigin: number;
  /** Ring codes generated. */
  codes: number;
  failed: number;
  /** Note lookups made (the nightly pass only). */
  lookups?: number;
  skipped?: "not_installed";
}
interface ShopSwitches { location_id: string; ring_code_enabled: boolean; auto_link_enabled: boolean; origin_auto_link_enabled: boolean }
const EMPTY = (): HouseReconcileResult => ({ shops: 0, added: 0, ringCode: 0, toastOrigin: 0, codes: 0, failed: 0 });

class NotInstalled extends Error {}
const signalled = <T extends { abortSignal: (s: AbortSignal) => PromiseLike<unknown> }>(q: T, signal?: AbortSignal) => (signal ? q.abortSignal(signal) : q) as T;

export async function reconcileHouseCateringToast(args: {
  from: string; to: string; today: string; signal?: AbortSignal; client?: Sb;
  /** Nightly only: look for note-typed ring codes first (Toast API calls), inside this deadline. */
  noteLookupDeadlineAt?: number;
}): Promise<HouseReconcileResult> {
  const sb = args.client ?? getServiceRoleClient();
  const out = EMPTY();
  const settings = await signalled(sb.from("catering_toast_settings")
    .select("location_id,ring_code_enabled,auto_link_enabled,origin_auto_link_enabled").eq("enabled", true).order("location_id").range(0, 999), args.signal);
  if (settings.error) {
    if (settings.error.code && NOT_INSTALLED.has(settings.error.code)) return { ...out, skipped: "not_installed" };
    throw new Error("catering_toast_read_failed");
  }
  const shops = ((settings.data ?? []) as ShopSwitches[]).filter((s) => s.ring_code_enabled || s.auto_link_enabled || s.origin_auto_link_enabled);
  if (shops.length === 0) return out;
  const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const rpc = async (name: string, params: Record<string, unknown>) => {
    const { data, error } = await signalled(sb.rpc(name, params), args.signal);
    if (error) {
      if (error.code && NOT_INSTALLED.has(error.code)) throw new NotInstalled();
      throw new Error(`${name}_failed`);
    }
    return data as unknown;
  };
  try {
    if (args.noteLookupDeadlineAt && shops.some((s) => s.ring_code_enabled)) {
      try {
        const looked = await lookupHouseNoteCodes(sb, { from: args.from, to: args.to, today: args.today, deadlineAt: args.noteLookupDeadlineAt, signal: args.signal });
        out.lookups = looked.lookups;
        out.failed += looked.failed;
      } catch { out.failed += 1; }
    }
    for (const shop of shops) {
      if (args.signal?.aborted) break;
      out.shops += 1;
      try {
        if (shop.ring_code_enabled) out.codes += number(await rpc("ensure_catering_ring_codes", { p_location_id: shop.location_id, p_from: args.today }));
        if (shop.auto_link_enabled || shop.origin_auto_link_enabled) {
          const run = await rpc("reconcile_catering_toast", { p_location_id: shop.location_id, p_from: args.from, p_to: args.to }) as
            { added?: unknown; ring_code?: unknown; toast_origin?: unknown } | null;
          out.added += number(run?.added);
          out.ringCode += number(run?.ring_code);
          out.toastOrigin += number(run?.toast_origin);
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

/** The cron seam: never throws. null = it could not even read the settings (logged by code). */
export async function runHouseCateringToast(args: Parameters<typeof reconcileHouseCateringToast>[0]): Promise<HouseReconcileResult | null> {
  try { return await reconcileHouseCateringToast(args); }
  catch (error) {
    console.error("[catering toast] house reconcile unavailable:", error instanceof Error ? error.message : "unknown");
    return null;
  }
}
