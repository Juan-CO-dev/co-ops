/**
 * LABOR MONEY, the shared facts (digests round 3, PR 4): the budgets of the pre-load, the facts it seals and their keys.
 * PURE: zero I/O, no env read. The labor-money core (lib/business-labor-core.ts) and its two pure halves code against
 * this module; the digest side reads it through lib/report-digests-labor-shared.ts, which re-exports it and adds the
 * switch, the per-recipient access and the store.
 *
 * It lives beside the business report on purpose: the core is in the fact-layer no-notify scan
 * (tests/fact-layer-no-notify.test.ts), which refuses any import of a module that sends or is named for a digest. So
 * nothing here, and nothing this module imports, knows about emails.
 *
 * UNKNOWN IS NEVER ZERO. A figure prints only when every closing check it needs finished and passed.
 */
import type { LaborFigures, LaborWeekGenerationRow } from "@/lib/business-report-shared";

// ── Budgets (one table; plan §13.2.2, §15.2.2, CC addendum A4-1) ────────────────────────────────

/** The whole pre-load, counted from the end of phase 0 (the ordinary facts). */
export const LABOR_PRELOAD_BUDGET_MS = 20_000;
export const LABOR_SETTINGS_CAP_MS = 3_000;
export const LABOR_HOURLY_CAP_MS = 10_000;
export const LABOR_ROLE_CAP_MS = 3_000;
/** The hourly piece's inner stage ends, from the piece's start. Its LAST stage (bracket-2 closing checks) ends at the piece's cutoff, owned by the runner. */
export const LABOR_HOURLY_STAGE_MS = { bracket1Data: 4_000, bracket1Checks: 5_500, bracket2Data: 8_000 } as const;
/** The role piece: data by 2 s; its closing checks end at the piece's cutoff. */
export const LABOR_ROLE_STAGE_MS = { data: 2_000 } as const;
/** A4-1: phase 0 (the ordinary facts) may take this long per business day of the run. */
export const ORDINARY_FACTS_BUDGET_MS_PER_DAY = 45_000;

// ── The facts ───────────────────────────────────────────────────────────────────────────────────

export type LaborTarget = number | "target_varies";

/** One finished span priced by the business report's own functions. */
export interface LaborSpan { from: string; to: string; labor: LaborFigures; target: LaborTarget; loadedTarget: LaborTarget }

/**
 * `ok`          the span's closing checks finished and passed (its payroll week is usable). `labor.state` may still be
 *               a pricer state (`hours_unknown`, `sales_not_covered` …): the figures then carry their own reason.
 * `unavailable` a read failed, was cut, or a closing check did not finish → "Labor cost not available".
 * `updating`    the span's payroll week is not usable (not ready in both brackets, or its generation moved)
 *               → "Labor figures are updating".
 */
export type SpanPart = { kind: "ok"; span: LaborSpan } | { kind: "unavailable" } | { kind: "updating" };

export interface HourlyLaborFacts {
  /** The digest's business day D. Nothing below is about D itself. */
  day: string;
  /** F1 and F4's day part. `none` = D−1 … D−7 were all read and verified and none of them is final. */
  latestFinalDay: SpanPart | { kind: "none" };
  /** F2. `no_final_day_this_week` = the latest final day is in the previous payroll week (or there is none) and D's week is usable. */
  weekSoFar: SpanPart | { kind: "no_final_day_this_week" };
  /** F3 and F4's week part: the last full payroll week before D's. */
  lastFullWeek: SpanPart;
  /**
   * What the role step needs from this step (nothing a line prints, no person): present only when `latestFinalDay` is
   * `ok`. `generation` is that day's week as bracket 2 read it last; `dayStraightCents` is the day's own
   * `hourly_straight_cents`; `wageEstimated` is the day row's `estimated_rate_minutes > 0`.
   */
  roleStep: { date: string; weekStart: string; generation: LaborWeekGenerationRow; dayStraightCents: number; wageEstimated: boolean } | null;
}

/** `role` = a named 7shifts role; `other` = no role name on file (role 0, no name row, every Toast-sourced row); `pool` = "Other roles". */
export interface RoleBucket { kind: "role" | "other" | "pool"; /** The role name for kind `role`; null otherwise. */ name: string | null; cents: number }

/** Holds NO person: no label, no user id, no person key (the contributor sets are counted in the loader and dropped). */
export type RoleLaborFacts =
  | { kind: "ok"; date: string; buckets: RoleBucket[]; /** Each role rounded on its own; the sum differs from the day total within the bound. */ roundedSeparately: boolean; wageEstimated: boolean }
  /** Fewer than two printable buckets: the line does not exist. */
  | { kind: "omitted" }
  /** "Cost by role not available". */
  | { kind: "unavailable" };

// ── Keys of the sealed results ──────────────────────────────────────────────────────────────────

export const LABOR_SETTINGS_KEY = "settings";
export const laborHourlyKey = (locationId: string, day: string) => `hourly|${locationId}|${day}`;
export const laborRolesKey = (locationId: string, day: string) => `roles|${locationId}|${day}`;
