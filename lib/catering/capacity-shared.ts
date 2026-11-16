/**
 * Catering capacity — CLIENT-SAFE shared surface (pure; no I/O, no server import). Re-exported by
 * lib/catering/capacity.ts so server consumers keep their import path.
 */

/**
 * THE one "can this date take the order" rule (audit W22/B123): not a blackout, and available, limited, or
 * unconfigured (no caps seeded = advisory, never a no). Public routing, the pickup check, the submit-time
 * flag, the order page and the staff capacity pill all read this, so they cannot disagree.
 */
export function isBookableSignal(r: { signal: string; isBlackout: boolean }): boolean {
  return !r.isBlackout && (r.signal === "available" || r.signal === "limited" || r.signal === "unconfigured");
}
