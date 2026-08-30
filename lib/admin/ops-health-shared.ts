/**
 * Ops-health PURE surface (Ops guardrails NOW #3) — client-safe, zero I/O, no server
 * imports. The server module lib/admin/ops-health.ts re-exports these so consumers keep
 * one import path; the adoption card renders the shapes here.
 *
 * The adoption map is deliberately CURATED and SMALL (a handful of surfaces) — this
 * answers "is anyone using it this week?", not analytics. Each surface names a set of
 * audit actions that mean "someone used that surface". Counts are raw event counts over
 * the window (not distinct actors) — a coarse activity pulse.
 */
import type { TranslationKey } from "@/lib/i18n/types";

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

/** One curated adoption surface: an i18n label + the audit actions that mean "used". */
export interface AdoptionSurface {
  /** stable id (React key + test anchor). */
  id: string;
  /** i18n key for the surface's display name. */
  labelKey: TranslationKey;
  /** the audit action string(s) that count as "this surface was used". */
  actions: readonly string[];
}

/** One rolled-up surface count (the card row shape). */
export interface AdoptionSurfaceCount {
  id: string;
  labelKey: TranslationKey;
  count: number;
}

/**
 * THE CURATED MAP (8 surfaces, capped). Each surface's `actions` are real audit action
 * names (verified against lib/ emitters, 2026-07-29). Keep this short — a growing map
 * turns a pulse into analytics, which is a different (and unbuilt) feature.
 */
export const ADOPTION_SURFACES: readonly AdoptionSurface[] = [
  { id: "checklists", labelKey: "admin.hub.adoption.checklists", actions: ["checklist.confirm", "checklist_submission.create"] },
  { id: "counts", labelKey: "admin.hub.adoption.counts", actions: ["sku_count.recorded"] },
  { id: "receiving", labelKey: "admin.hub.adoption.receiving", actions: ["delivery.received"] },
  { id: "prep", labelKey: "admin.hub.adoption.prep", actions: ["prep.submit", "prep.mid_day.item_saved"] },
  { id: "reports", labelKey: "admin.hub.adoption.reports", actions: ["written_report.submit", "pm_report.submit"] },
  { id: "photos", labelKey: "admin.hub.adoption.photos", actions: ["photo.upload"] },
  { id: "production", labelKey: "admin.hub.adoption.production", actions: ["production.recorded"] },
  { id: "catering", labelKey: "admin.hub.adoption.catering", actions: ["catering.quote.create", "catering.quote.send"] },
] as const;

/**
 * Roll a raw per-action count map into the curated surfaces (declaration order preserved).
 * Pure — the server fn hands it the GROUP-BY result. A surface's count sums every one of
 * its mapped actions. Surfaces with zero activity are returned too (the card mutes them),
 * so the card always renders the full, stable roster.
 */
export function bucketAdoptionCounts(countsByAction: ReadonlyMap<string, number>): AdoptionSurfaceCount[] {
  return ADOPTION_SURFACES.map((s) => ({
    id: s.id,
    labelKey: s.labelKey,
    count: s.actions.reduce((n, a) => n + (countsByAction.get(a) ?? 0), 0),
  }));
}
