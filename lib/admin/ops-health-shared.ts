/**
 * Ops-health PURE surface (Ops guardrails NOW #3) — client-safe, zero I/O, no server
 * imports. The hub's cron-health card renders the shapes here.
 *
 * (The curated "Used this week" adoption map that lived here was replaced by the
 * shops-side-by-side "This week in CO-OPS" card — lib/admin/week-card-shared.ts.)
 */

// ── Cron run health (the DEGRADED lane, wiring audit 2026-08-29) ───────────────
//
// app/api/cron/toast-sales-pull/route.ts writes exactly ONE audit row per run, and it is
// always `cron.success` — a per-location pull, depletion-materialize or par-run failure is
// try/catch-swallowed by design (the ledger is a re-derivable cache; one bad shop must not
// fail the batch) and survives only as a COUNTER in that row's metadata. `cron.failure` is
// reserved for the whole handler throwing, which in 95 recorded runs has never happened.
//
// The reader only ever looked at the row's timestamp, so a run in which a location's pull
// died still rendered "last run OK". Prod has four such runs — all four are the P Street
// ledger-truncation days fixed in lib/catering/toast-sales.ts in this same PR, and the
// reason that bug lived for weeks is that its own heartbeat kept saying OK.
//
// Pure so it is testable: the metadata is untyped JSONB off a service-role read, which is
// exactly the shape a parser should own rather than an inline `?? 0` at the call site.

/** The per-location step counters the cron route records on its `cron.success` row. */
export interface CronRunFailures {
  /** locations whose Toast pull threw (`pullSalesForAllLocations` recorded ok:false). */
  perLocation: number;
  /** locations whose `materializeDailyDepletion` threw — no depletion ledger for the day. */
  depletion: number;
  /** locations whose Dynamic Pars shadow run threw. */
  parRun: number;
}

/** The all-clear shape (also what an unparseable/absent metadata blob degrades to). */
export const NO_CRON_RUN_FAILURES: CronRunFailures = { perLocation: 0, depletion: 0, parRun: 0 };

/** Non-negative integer or 0 — JSONB numbers arrive as number|string|null|anything. */
function counter(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Read the per-location failure counters off a `cron.success` metadata blob.
 *
 * Absent keys read as 0 ON PURPOSE and not as "unknown": rows written before a counter
 * existed are genuinely runs with no recorded failure of that kind, and inventing a
 * degraded state for every historical row would make the signal noise on day one.
 */
export function cronRunFailures(metadata: Record<string, unknown> | null | undefined): CronRunFailures {
  if (metadata == null) return NO_CRON_RUN_FAILURES;
  return {
    perLocation: counter(metadata["per_location_failures"]),
    depletion: counter(metadata["depletion_failures"]),
    parRun: counter(metadata["par_run_failures"]),
  };
}

/** Any lane failed → the run is DEGRADED, however green its action name reads. */
export function cronRunIsDegraded(f: CronRunFailures): boolean {
  return f.perLocation > 0 || f.depletion > 0 || f.parRun > 0;
}

/** Total failing steps — the one number the hub line quotes. */
export function cronRunFailureTotal(f: CronRunFailures): number {
  return f.perLocation + f.depletion + f.parRun;
}
