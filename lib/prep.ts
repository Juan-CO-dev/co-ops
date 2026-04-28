/**
 * Prep list resolution — Phase 6.
 *
 * generatePrepResolutions(prepInstanceId):
 *   1. Resolve par per vendor_item for (location, day-of-week)
 *   2. Read on-hand from latest opening checklist closing-count completions
 *   3. needed = max(par_target − on_hand, 0)
 *   4. Insert prep_list_resolutions rows (service role)
 */
export {};
