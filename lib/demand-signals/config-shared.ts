/**
 * Demand signals (item 4 PR 1): the one switch, pure (a -shared module never reads env; callers pass it in).
 * DEMAND_LEDGER=1 turns the nightly forecast ledger on. Unset (or anything else) = the nightly neither imports
 * nor calls the ledger pass, and nothing is read or written. Apply 0341 before setting it.
 * This file imports nothing, so the nightly's module graph is unchanged while the switch is off.
 */
export function demandLedgerEnabled(value: string | undefined): boolean {
  return value === "1";
}
