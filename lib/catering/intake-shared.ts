/**
 * Catering intake source registry (spec #2b). CLIENT-SAFE, pure. Formalizes
 * `catering_pipeline.lead_source` from free text into a picker-backed registry
 * (Juan 2026-07-23: catering is MIXED — Toast catering page, EZCater and other
 * platforms, direct invoices, phone, walk-ins — every order gets labeled where
 * it came from; platform APIs auto-ingest later via lib/catering/intake-providers).
 *
 * System-key rule (i18n law): codes are the invariant; display renders via
 * `catering.intake.source.<code>` keys. Legacy free-text values on existing
 * rows stay readable (render verbatim); new writes validate against the
 * registry app-layer — no DB CHECK, so adding a source is additive.
 */

export const LEAD_SOURCES = [
  "portal",
  "staff",
  "phone",
  "walk_in",
  "toast_catering",
  "ezcater",
  "direct_invoice",
  "other",
] as const;

export type LeadSource = (typeof LEAD_SOURCES)[number];

export function isLeadSource(v: string): v is LeadSource {
  return (LEAD_SOURCES as readonly string[]).includes(v);
}

/** i18n key for a registry code; null for legacy free-text values (render verbatim). */
export function leadSourceKey(v: string | null): string | null {
  return v != null && isLeadSource(v) ? `catering.intake.source.${v}` : null;
}
