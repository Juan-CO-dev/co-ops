/**
 * Inventory aggregation — Phase 5.
 *
 * Functions:
 *   - getAggregatedInventory(supabase, options?): InventoryItemView[]
 *     Union of active vendor_items across active vendors, grouped by category.
 *   - getInventoryWithPars(supabase, locationId, dayOfWeek?): InventoryItemViewWithPar[]
 *     Resolves par from par_levels (day-specific > all-days > vendor default).
 */
export {};
