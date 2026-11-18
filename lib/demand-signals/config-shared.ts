/**
 * Demand signals (item 4 PR 1): the one switch, pure (a -shared module never reads env; callers pass it in).
 * DEMAND_LEDGER=1 turns the nightly forecast ledger on. Unset (or anything else) = the nightly neither imports
 * nor calls the ledger pass, and nothing is read or written. Apply 0342 before setting it.
 * This file imports nothing, so the nightly's module graph is unchanged while the switch is off.
 */
export function demandLedgerEnabled(value: string | undefined): boolean {
  return value === "1";
}

/**
 * Item 4 PR 2: DEMAND_SIGNALS=1 turns the signal collection cron on. NECESSARY, NOT SUFFICIENT: with it set,
 * nothing is requested from a source until a person has marked that source verified in the register (0343),
 * and the adapter also needs NWS_USER_AGENT. Unset (or anything else) = the cron reads nothing at all.
 */
export function demandSignalsEnabled(value: string | undefined): boolean {
  return value === "1";
}
/** One collection pass: an absolute budget inside the cron's 60 s function limit. */
export const DEMAND_SIGNALS_PASS_BUDGET_MS = 45_000;
