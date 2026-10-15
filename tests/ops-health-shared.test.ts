/**
 * Unit spine — the ops-health pure surface (Ops guardrails NOW #3): the cron run's
 * swallowed-failure counters. (The adoption roll-up tests left with the adoption card;
 * its replacement is pinned in tests/week-card-shared.test.ts.)
 */
import { describe, it, expect } from "vitest";
import {
  cronRunFailures,
  cronRunFailureTotal,
  cronRunIsDegraded,
  NO_CRON_RUN_FAILURES,
} from "@/lib/admin/ops-health-shared";

// ── The DEGRADED cron lane (wiring audit 2026-08-29) ─────────────────────────────
//
// app/api/cron/toast-sales-pull/route.ts emits exactly one audit row per run and it is
// always `cron.success`; every per-location pull / depletion / par failure is swallowed
// by design and survives only as a counter in that row's metadata. loadCronHealth read
// the timestamp and nothing else, so the admin hub rendered a quiet "last run OK" over
// four real runs whose sales pull had died for a whole shop.
//
// The metadata below is copied from an ACTUAL prod row (business_date 2026-08-08): a
// `cron.success` carrying per_location_failures: 1.

describe("cronRunFailures — reading the swallowed failures off a cron.success row", () => {
  it("reads the real prod row that rendered as OK for weeks", () => {
    const metadata = {
      job: "toast-sales-pull",
      business_date: "2026-08-08",
      rows_pulled: 0,
      per_location_failures: 1,
      depletion_failures: 0,
      par_run_failures: 0,
      depletion_rows: { "54ce1029-400e-4a92-9c2b-0ccb3b031f0a": 78 },
    };
    const f = cronRunFailures(metadata);
    expect(f).toEqual({ perLocation: 1, depletion: 0, parRun: 0 });
    expect(cronRunIsDegraded(f)).toBe(true);
    expect(cronRunFailureTotal(f)).toBe(1);
  });

  it("a genuinely clean run is NOT degraded", () => {
    const f = cronRunFailures({ per_location_failures: 0, depletion_failures: 0, par_run_failures: 0 });
    expect(f).toEqual(NO_CRON_RUN_FAILURES);
    expect(cronRunIsDegraded(f)).toBe(false);
  });

  it("counts each lane and totals them — depletion and pars are separate failures", () => {
    const f = cronRunFailures({ per_location_failures: 1, depletion_failures: 2, par_run_failures: 3 });
    expect(f).toEqual({ perLocation: 1, depletion: 2, parRun: 3 });
    expect(cronRunFailureTotal(f)).toBe(6);
    expect(cronRunIsDegraded(f)).toBe(true);
  });

  it("a lane failing ALONE still degrades the run", () => {
    for (const key of ["per_location_failures", "depletion_failures", "par_run_failures"]) {
      expect(cronRunIsDegraded(cronRunFailures({ [key]: 1 }))).toBe(true);
    }
  });

  it("absent metadata and absent keys read as zero, never as a phantom alarm", () => {
    // Rows written before a counter existed are real runs with no recorded failure of
    // that kind. Inventing a degraded state for every historical row makes the signal
    // noise on day one, which is how an ops lane gets scrolled past.
    expect(cronRunFailures(null)).toEqual(NO_CRON_RUN_FAILURES);
    expect(cronRunFailures(undefined)).toEqual(NO_CRON_RUN_FAILURES);
    expect(cronRunFailures({})).toEqual(NO_CRON_RUN_FAILURES);
    expect(cronRunFailures({ job: "toast-sales-pull" })).toEqual(NO_CRON_RUN_FAILURES);
  });

  it("tolerates the shapes untyped JSONB actually arrives in", () => {
    // A service-role read hands back `Record<string, unknown>`; a numeric-looking string
    // is a real counter, and junk must not throw on an ops read that fails soft anyway.
    expect(cronRunFailures({ per_location_failures: "2" }).perLocation).toBe(2);
    expect(cronRunFailures({ per_location_failures: "n/a" }).perLocation).toBe(0);
    expect(cronRunFailures({ per_location_failures: null }).perLocation).toBe(0);
    expect(cronRunFailures({ per_location_failures: -1 }).perLocation).toBe(0);
    expect(cronRunFailures({ per_location_failures: 1.9 }).perLocation).toBe(1);
  });
});
