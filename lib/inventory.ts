/**
 * Inventory — pointer stub (no runtime exports).
 *
 * This module is intentionally empty. The inventory aggregation logic that
 * an earlier docstring promised here was built elsewhere:
 *   - SKU/vendor-item views + par resolution → lib/items.ts
 *   - prep/production inventory state        → lib/prep.ts
 *   - receiving                              → lib/receiving.ts
 *
 * Kept (rather than deleted) so greps for "inventory" land on this pointer
 * instead of silently finding nothing. Do not add logic here — extend the
 * real homes above. (Docstring honesty fix, 2026-07-23: the prior header
 * described functions that never lived here.)
 */
export {};
