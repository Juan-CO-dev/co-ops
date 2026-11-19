import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { runOrderCapture } from "@/lib/toast/capture-job";
import { materializeCapturedDepletion } from "@/lib/toast/depletion";
import { completeElapsedCateringEvents } from "@/lib/catering/system-intake";
import { refreshKnownEzcaterOrders } from "@/lib/ezcater/refresh";
import { materializeEzcaterReconciliation } from "@/lib/ezcater/reconcile";
import { coverHouseNoteEvidence, runHouseCateringToast, type HouseReconcileResult } from "@/lib/catering/catering-toast-reconcile";
import { etCalendarDate, etYmdMinusDays } from "@/lib/operational-day";
import { runParShadowForLocation } from "@/lib/dynamic-pars";
import { captureBudget, captureErrorCode } from "@/lib/toast/capture-runner";
import { runToastLaborPull } from "@/lib/toast/labor";
import type { DemandInputs } from "@/lib/dynamic-pars-engine-shared";
import { demandLedgerEnabled } from "@/lib/demand-signals/config-shared";

/** Nightly capture, materialization and pars; heartbeat contract is unchanged. */
export async function runToastSalesPull(opts: { businessDate: string; deadlineAt?: number; signal?: AbortSignal }) {
  const { businessDate } = opts;
  const deadlineAt = opts.deadlineAt ?? Date.now() + 300_000;
  const ezcaterEnabled = process.env.EZCATER_DEPLETION_ENABLED === "1";
  let ezcaterShadow = { processed: 0, failed: 0, deferred: false };
  let cateringToast: HouseReconcileResult | null | undefined;
  const reconcile = async () => {
    try {
      const result = await materializeEzcaterReconciliation(etYmdMinusDays(businessDate, 7), businessDate, Math.min(deadlineAt, Date.now() + 60_000));
      ezcaterShadow = { ...result, deferred: result.deferred || "skipped" in result };
    } catch { ezcaterShadow.failed++; }
  };
  const dates = [businessDate, etYmdMinusDays(businessDate, 1), etYmdMinusDays(businessDate, 2)];
  const results: { locationId: string; ok: boolean; error?: string; skipped?: boolean; reason?: "capture_fixture_mode" }[] = [];
  const depletionRows: Record<string, number> = {};
  const parRows: Record<string, number> = {};
  let depletionFailures = 0;
  let parRunFailures = 0;
  let capture: Awaited<ReturnType<typeof runOrderCapture>>;
  const captureProgress = { planned: 0, started: 0 };
  let elapsedCompleted = 0, elapsedFailed = 0;
  let elapsedError: string | null = null;
  const todayEt = etCalendarDate(new Date().toISOString());
  // Item 4 PR 1: OFF unless DEMAND_LEDGER=1. When off, nothing below differs from before: the par run is
  // called with its two arguments and the ledger module is never imported.
  const demandLedgerOn = demandLedgerEnabled(process.env.DEMAND_LEDGER);
  const demandParInputs = new Map<string, DemandInputs>();
  let demandShopIds: string[] = [];
  // Cancellation discovered here becomes lost before generic completion. An API failure
  // never excludes ezCater from that existing loop or consumes the sales-pull budget.
  try { await refreshKnownEzcaterOrders(todayEt, Math.min(Date.now() + 20_000, deadlineAt - 10_000), opts.signal); }
  catch { /* Independent heartbeat reports failure; completion still runs. */ }
  try {
    const elapsed = await completeElapsedCateringEvents(todayEt);
    elapsedCompleted = elapsed.completed.length;
    elapsedFailed = elapsed.failed.length;
  } catch (error) { elapsedError = captureErrorCode(error); }
  {
    const sb = getServiceRoleClient();
    const locations = await sb.from("locations").select("id").eq("active", true)
      .not("toast_restaurant_guid", "is", null);
    if (locations.error) throw new Error("capture_location_unavailable");
    const ids = (locations.data ?? []).map((r: { id: string }) => r.id);
    demandShopIds = ids;
    capture = await runOrderCapture(ids, businessDate, "cron", dates, Math.max(0, deadlineAt - Date.now()), opts.signal, captureProgress);
    // PASS 3 pars must see this capture's links, including late code/batch matches.
    if (ezcaterEnabled) await reconcile();
    const completed = new Set<string>();
    for (const date of dates) {
      for (const locationId of ids) {
        const run = capture.results.find((r) => r.locationId === locationId && r.businessDate === date);
        if (!run?.complete) continue;
        try {
          const result = await materializeCapturedDepletion(locationId, date);
          depletionRows[`${locationId}:${date}`] = result.rows;
          // Reviewed-label gaps disclose partial data; they do not invalidate a day.
          completed.add(`${locationId}:${date}`);
        } catch { depletionFailures++; }
      }
    }
    // T-2/T-3 are capture repairs only. Pars are computed once, for T-1.
    for (const locationId of ids) {
      if (!completed.has(`${locationId}:${businessDate}`)) continue;
      if (ezcaterEnabled && (ezcaterShadow.failed || ezcaterShadow.deferred)) { parRunFailures++; continue; }
      try {
        parRows[`${locationId}:${businessDate}`] = (demandLedgerOn
          ? await runParShadowForLocation(locationId, businessDate, (inputs) => { demandParInputs.set(locationId, inputs); })
          : await runParShadowForLocation(locationId, businessDate)).rows;
      } catch { parRunFailures++; }
    }
    for (const locationId of ids) {
      if (capture.skipped && capture.reason === "capture_fixture_mode") {
        results.push({ locationId, ok: true, skipped: true, reason: "capture_fixture_mode" });
        continue;
      }
      const ok = dates.every((date) => completed.has(`${locationId}:${date}`));
      results.push({ locationId, ok, ...(!ok ? { error: "capture_day_incomplete" } : {}) });
    }
  }
  if (!ezcaterEnabled) await reconcile();
  // OFF shadow is independent; enabled reconciliation gates operational pars.
  const heartbeatBudget = captureBudget(1_000);
  try {
    await heartbeatBudget.wait(() => audit({ actorId: null, actorRole: null,
      action: ezcaterShadow.failed || ezcaterShadow.deferred ? "cron.failure" : "cron.success",
      resourceTable: "cron", resourceId: null,
      metadata: { job: "ezcater-shadow", business_date: businessDate, ...ezcaterShadow },
      ipAddress: null, userAgent: null }));
  } catch { /* Heartbeat persistence is fail-open, independent of sales health. */ }
  finally { heartbeatBudget.close(); }
  // Item 21 PR 4: the HOUSE reconciler, after the ezCater pass and as its own requests (never inside the ezCater
  // reconciler's transaction). Off unless a shop's settings say so; fail-soft, never part of this run's health, and
  // only with a minute to spare. First the one note lookup examines the captures of the window nobody examined yet
  // (runbook contract #3); a check it did not reach stays pending for both sources. EACH STEP HAS ITS OWN DEADLINE
  // inside this run's: every request carries its signal, so neither can hold the route (review PORTAL4-r1).
  {
    const from = etYmdMinusDays(businessDate, 7), to = etYmdMinusDays(businessDate, -2);
    const left = () => deadlineAt - Date.now() - 60_000;
    if (left() > 5_000) {
      await coverHouseNoteEvidence({ from: etYmdMinusDays(from, 1), to: todayEt, maxDays: 12, deadlineAt: Date.now() + Math.min(30_000, left()), signal: opts.signal });
    }
    if (left() > 5_000) {
      cateringToast = await runHouseCateringToast({ from, to, today: todayEt, deadlineAt: Date.now() + Math.min(20_000, left()), signal: opts.signal });
    }
  }
  const perLocationFailures = results.filter((r) => !r.ok).length;
  const fixtureSkip = capture.skipped && capture.reason === "capture_fixture_mode";
  const healthy = ((!capture.skipped || fixtureSkip) && capture.failures === 0) && perLocationFailures === 0
    && (!ezcaterEnabled || (!ezcaterShadow.failed && !ezcaterShadow.deferred))
    && depletionFailures === 0 && parRunFailures === 0 && elapsedFailed === 0 && elapsedError === null;
  const metadata = {
    job: "toast-sales-pull", source: "capture", business_date: businessDate, dates,
    capture_failures: capture.failures, capture_skipped: capture.skipped,
    capture_skip_reason: capture.skipped ? capture.reason ?? null : null,
    ezcater_shadow: ezcaterShadow,
    ...(cateringToast !== undefined ? { catering_toast: cateringToast } : {}),
    per_location_failures: perLocationFailures, depletion_rows: depletionRows,
    depletion_failures: depletionFailures, par_rows: parRows, par_run_failures: parRunFailures,
    pars_pending_activation: false,
    elapsed_completed: elapsedCompleted, elapsed_failed: elapsedFailed, elapsed_error: elapsedError,
  };
  // The demand forecast ledger (item 4 PR 1, 0342): fail-soft, its own heartbeat (demand-ledger), never part of
  // this run's health. It starts only with a minute to spare and leaves the labor pull its time.
  if (demandLedgerOn) {
    try {
      const left = deadlineAt - Date.now() - 60_000;
      if (left > 10_000) {
        const { runDemandLedgerNight, DEMAND_LEDGER_BUDGET_MS } = await import("@/lib/demand-signals/ledger");
        await runDemandLedgerNight({ sb: getServiceRoleClient(), locationIds: demandShopIds, todayEt, parInputsByShop: demandParInputs,
          deadlineAt: Date.now() + Math.min(DEMAND_LEDGER_BUDGET_MS, left) });
      }
    } catch { console.error("[demand ledger] pass threw"); }
  }
  // Labor (0224) LAST, inside what is left of the deadline (at most 45 s), fail-soft: its own
  // heartbeat (toast-labor-pull) reports it, and it never changes this run's health. Off until
  // TOAST_LABOR_PULL=1 (after 0224 is applied).
  try {
    const left = deadlineAt - Date.now() - 5_000;
    if (left > 5_000) await runToastLaborPull(dates, { deadlineMs: Math.min(45_000, left), context: "cron" });
  } catch (error) { console.error("[toast labor] pull threw:", captureErrorCode(error)); }
  // A COUNTER of units that began (W27/B225 r5), never a skip reason or a timeout flag: the pull's unit of work is a
  // shop-day capture; shop-days were owed and none began, so no day was pulled. The caller decides what that means
  // (the catch-up defers it). Capture off / fixture mode / no shop owes nothing, so it is not "started nothing".
  const startedNothing = captureProgress.planned > 0 && captureProgress.started === 0;
  return { businessDate, results, metadata, healthy, startedNothing };
}
