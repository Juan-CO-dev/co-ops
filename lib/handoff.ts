/**
 * Handoff flag generator — Phase 6 (reworked from v1.1 `daily_reports` model).
 *
 * Sources:
 *   - Most recent confirmed closing checklist instance (incomplete_confirmed,
 *     incomplete_reasons with critical-keyword content)
 *   - Most recent shift_overlay (cash O/S, comps, complaints, voids,
 *     employee_concern, equipment notes)
 *   - Active par_levels vs latest closing inventory counts (par breaches)
 *   - Open high/critical maintenance_tickets at the location
 *
 * Returns flags grouped by severity with source pointers for drill-down.
 *
 * Stored on shift_overlays.handoff_flags JSONB at submit time and
 * regenerated whenever a closing checklist is confirmed.
 */
export {};
