/**
 * Inbound PO-matching PRIMITIVES — the ONE pure home for the display-code extractor
 * (Vendor Ordering V2 §4). Client-safe LEAF module: zero I/O, no server imports (no
 * supabase-server, no "server-only"). It lives here — not inline in lib/email-receipts.ts —
 * for two reasons the codebase's *-shared.ts law already anticipates:
 *   1. lib/email-receipts.ts carries `import "server-only"`, which the vitest spine cannot
 *      import; the extractor's boundary behavior is load-bearing and MUST be unit-tested.
 *   2. Task 7's SMS leg reuses extractPoCodes verbatim (the PO code is channel-agnostic —
 *      it rides email subjects/bodies AND SMS bodies). A shared leaf keeps ONE grammar.
 * lib/email-receipts.ts re-exports extractPoCodes so server callers keep their import path.
 */

/** Cap on PO codes extracted from one document — a junk/adversarial body must not fan out
 *  into an unbounded `.in()` query. Ten distinct codes is already generous for one email. */
export const MAX_PO_CODES = 10;

/**
 * Extract candidate PO display codes from arbitrary document text. PURE. The display-code
 * grammar (spec §5b.3 / lib/purchase-orders.ts baseDisplayCode) is
 * `{loc code}-{YYYYMMDD}-{vendor first-6 alnum}` with an optional `-N` collision suffix:
 *   {1-8 alnum}-{exactly 8 digits}-{1-6 alnum}(-{digits})?
 * BOUNDARY-PROTECTED: a code embedded in a longer alphanumeric token must NOT match (e.g.
 * `XPST-20260806-SYSCOX` — SYSCO is 6 alnum but a 7th char `X` follows — is rejected), so
 * the code is anchored by non-alphanumeric boundaries on BOTH sides via lookarounds.
 * Input is uppercased first (codes are stored uppercase; a lowercased quote still matches).
 * De-duped; capped at MAX_PO_CODES. Never throws on junk / empty / non-string.
 */
export function extractPoCodes(text: string): string[] {
  if (typeof text !== "string" || !text) return [];
  const upper = text.toUpperCase();
  // (?<![A-Z0-9]) / (?![A-Z0-9]) boundaries — a longer alnum run on either side rejects the
  // match, so an embedded fragment never counts. The trailing `-N` suffix is optional.
  const re = /(?<![A-Z0-9])[A-Z0-9]{1,8}-\d{8}-[A-Z0-9]{1,6}(?:-\d+)?(?![A-Z0-9])/g;
  const seen = new Set<string>();
  for (const m of upper.matchAll(re)) {
    seen.add(m[0]);
    if (seen.size >= MAX_PO_CODES) break; // bound the fan-out (junk-safety)
  }
  return [...seen];
}
