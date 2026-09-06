// GET nightly Toast sales pull for all Toast-connected locations (Vercel Cron).
// Auth: x-cron-secret header (or Vercel Cron's Authorization: Bearer CRON_SECRET)
// must match env CRON_SECRET via constant-time compare. 503 no-op when unset
// (dormant-safe); locations without a Toast GUID are skipped by the lib.
import { timingSafeEqual } from "node:crypto";
import { type NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { pullSalesForAllLocations, materializeDailyDepletion } from "@/lib/catering/toast-sales";
import { completeElapsedCateringEvents } from "@/lib/catering/system-intake";
import { etCalendarDate, etYmdMinusDays } from "@/lib/operational-day";
import { loadDepletionWatermark } from "@/lib/counts";
import { runParShadowForLocation, recordParRunSkipped } from "@/lib/dynamic-pars";

/** Truncate a caught error message so a giant stack never bloats the audit row. */
function truncateErr(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.length > 500 ? `${msg.slice(0, 500)}…` : msg;
}

function secretOk(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = req.headers.get("x-cron-secret")
    ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Yesterday in the operational timezone (business dates close overnight).
 *  DST-safe: ET calendar date first, then pure grid math — the previous
 *  toLocaleString round-trip computed D-2 all winter on UTC servers. */
function todayYmd(): string {
  return etCalendarDate(new Date().toISOString());
}

function yesterdayYmd(): string {
  return etYmdMinusDays(todayYmd(), 1);
}

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) return jsonError(503, "cron_disabled");
  if (!secretOk(req)) return jsonError(401, "unauthorized");
  const businessDate = req.nextUrl.searchParams.get("date") ?? yesterdayYmd();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return jsonError(400, "invalid_date");
  try {
    // ── Catering: elapsed events complete themselves (spec 2026-09-05 §1) ────────────
    // FIRST, before the sales pull: this is the ET day rollover, and a confirmed/out lead whose
    // event date has passed is a served event nobody clicked done on. Juan: "if it's passed, it
    // already completed." Chained here rather than scheduled — the nightly cron already IS the
    // rollover, so no second vercel.json entry, no second secret, no clock to keep in sync.
    //
    // TODAY, not `businessDate`: the predicate is "the event date is behind us", which is about
    // the wall clock, not the sales day being pulled. On a `?date=` backfill run this still
    // completes today's elapsed events — correct and idempotent (a second pass finds nothing).
    //
    // BEST-EFFORT, exactly like the depletion and par steps below: a failure here is caught,
    // recorded in the heartbeat as `elapsed_error`, and never aborts the sales pull it precedes.
    let elapsedCompleted = 0;
    let elapsedFailed = 0;
    let elapsedError: string | null = null;
    try {
      const elapsed = await completeElapsedCateringEvents(todayYmd());
      elapsedCompleted = elapsed.completed.length;
      elapsedFailed = elapsed.failed.length;
    } catch (e) {
      elapsedError = truncateErr(e);
      console.error("[cron toast-sales-pull] catering elapsed completion failed:", elapsedError);
    }

    const results = await pullSalesForAllLocations(businessDate);

    // Drift spec 2026-07-31: materialize the day's depletion ledger for every
    // location whose pull succeeded. Best-effort per location — a materialize
    // failure NEVER fails the pull (the ledger is a re-derivable cache; the
    // next run or a manual backfill recovers it) but is surfaced in the
    // heartbeat metadata.
    let depletionFailures = 0;
    const depletionRows: Record<string, number> = {};
    for (const r of results) {
      if (!r.ok) continue;
      try {
        const { rows } = await materializeDailyDepletion(r.locationId, businessDate);
        depletionRows[r.locationId] = rows;
      } catch (e) {
        depletionFailures += 1;
        console.error(`[cron toast-sales-pull] depletion materialize failed for ${r.locationId}:`, truncateErr(e));
      }
    }

    // ── Dynamic Pars: the nightly shadow computation (spec 2026-08-21) ───────────
    // CHAINED, NOT SCHEDULED. It runs here so the ordering is structural: the pars engine
    // reads the ledger this handler just materialized, in the same request, for the same
    // business date. No vercel.json entry, no second secret, no clock to keep in sync.
    //
    // GATED ON "DID THE MATERIALIZATION SUCCEED" (r3): a location whose depletion is not
    // current through this business date is SKIPPED with an advisory-null run, never
    // computed on a stale day. Recomputing yesterday's rates as today's is how a phantom
    // velocity signal is born, and the pull is verifiably best-effort (the loop above
    // swallows per-location failures by design).
    //
    // ⚠ THE ORACLE IS THE MATERIALIZE LOOP'S OWN RESULT, NOT `watermark === businessDate`.
    // Two ways the strict equality is wrong, and both of them WRITE — recordParRunSkipped
    // replaces the day's ledger rows, so a false skip is data loss, not a no-op:
    //   · A ZERO-CONSUMPTION DAY materializes successfully with zero rows
    //     (materializeDailyDepletion only inserts when rows.length > 0), so the watermark
    //     stays on yesterday even though tonight succeeded. `depletionRows` has the key.
    //   · A BACKFILL (`?date=` for a past date, which this route supports) has a watermark
    //     LATER than the target date. "More than current" is not stale.
    // So: the location is current if tonight's materialization succeeded for it, OR the
    // ledger already reaches this business date. The watermark is still read — it is the
    // evidence recorded on the skip row — but it is compared with `>=`, never `!==`.
    //
    // A par-step failure must NEVER fail the pull or the depletion materialization — the
    // try/catch mirrors the depletion loop's own best-effort posture exactly.
    let parRunFailures = 0;
    const parRows: Record<string, number> = {};
    for (const r of results) {
      if (!r.ok) continue;
      try {
        const materialized = Object.prototype.hasOwnProperty.call(depletionRows, r.locationId);
        const watermark = await loadDepletionWatermark(r.locationId);
        const depletionCurrent = materialized || (watermark != null && watermark >= businessDate);
        if (!depletionCurrent) {
          const skipped = await recordParRunSkipped(r.locationId, businessDate, watermark);
          parRows[r.locationId] = skipped.rows;
          continue;
        }
        const { rows } = await runParShadowForLocation(r.locationId, businessDate);
        parRows[r.locationId] = rows;
      } catch (e) {
        parRunFailures += 1;
        console.error(`[cron toast-sales-pull] par shadow failed for ${r.locationId}:`, truncateErr(e));
      }
    }

    // Heartbeat (fail-open): a cron.success row lets the admin hub show "last run OK".
    // rowsPulled = total appended selections across locations (a cheap "did it do work"
    // signal); perLocationFailures counts locations that errored inside the batch (the
    // batch itself succeeded, but a per-location failure is still worth surfacing).
    const rowsPulled = results.reduce((n, r) => n + (r.result?.appended ?? 0), 0);
    const perLocationFailures = results.filter((r) => !r.ok).length;
    void audit({
      actorId: null,
      actorRole: null,
      action: "cron.success",
      resourceTable: "cron",
      resourceId: null,
      metadata: { job: "toast-sales-pull", business_date: businessDate, rows_pulled: rowsPulled, per_location_failures: perLocationFailures, depletion_rows: depletionRows, depletion_failures: depletionFailures, par_rows: parRows, par_run_failures: parRunFailures, elapsed_completed: elapsedCompleted, elapsed_failed: elapsedFailed, elapsed_error: elapsedError },
      ipAddress: null,
      userAgent: null,
    });
    return jsonOk({ businessDate, results });
  } catch (e) {
    // A LIVE failure is otherwise silent (console only). Write a fail-open audit row
    // so the admin hub can surface it (Ops guardrails NOW #3). audit() never throws.
    void audit({
      actorId: null,
      actorRole: null,
      action: "cron.failure",
      resourceTable: "cron",
      resourceId: null,
      metadata: { job: "toast-sales-pull", business_date: businessDate, error: truncateErr(e) },
      ipAddress: null,
      userAgent: null,
    });
    // Spec contract: never throw to the platform — surface as a structured 500.
    return jsonError(500, "cron_failed", { message: e instanceof Error ? e.message : String(e) });
  }
}
