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

import type { TranslationKey } from "@/lib/i18n/types";

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

/**
 * DISPLAY resolution for a lead source: a registry code renders through its i18n key,
 * legacy free text renders VERBATIM (never translated — the system-key rule), and an
 * absent source falls to the registry's own `other`. Returned as a discriminated pair
 * so the caller decides which of t()/serverT() it holds; this module stays pure.
 */
export function leadSourceLabelKey(source: string | null): { key: TranslationKey } | { verbatim: string } {
  if (source == null || source === "") return { key: "catering.intake.source.other" as TranslationKey };
  return isLeadSource(source)
    ? { key: `catering.intake.source.${source}` as TranslationKey }
    : { verbatim: source };
}
