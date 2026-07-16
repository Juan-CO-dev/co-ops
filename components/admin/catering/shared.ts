/**
 * Shared client helpers + error resolver for the Catering KB admin editors
 * (Wave 1 slice 1A). Clones components/admin/vendors/shared.ts: the same
 * pessimistic postJson (redirect:"manual", machine-stable `code`) plus a
 * catering-scoped error resolver. Every KB editor (packages / pricing /
 * capacity / delivery zones / FAQ / allergens / food-facts) imports these.
 */

import type { TranslationKey } from "@/lib/i18n/types";

/** Mutating-fetch result, narrowed by the caller. */
export type PostResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; code: string };

/**
 * Mutating POST/PATCH/DELETE helper. Returns the parsed JSON body on success
 * (so callers can read e.g. the new id) and the machine-stable `code` on
 * failure so the caller can resolve a localized message.
 */
export async function postJson(
  url: string,
  body: unknown,
  method: "POST" | "PUT" | "PATCH" | "DELETE" = "POST",
): Promise<PostResult> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      redirect: "manual",
    });
    if (res.ok) {
      let data: Record<string, unknown> = {};
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        // No / non-JSON body — fine; some routes return only {ok:true}.
      }
      return { ok: true, data };
    }
    let code = "generic";
    try {
      const parsed = (await res.json()) as { code?: string };
      if (typeof parsed.code === "string") code = parsed.code;
    } catch {
      // Non-JSON / opaque (e.g. 307 redirect) — fall through to generic.
    }
    return { ok: false, code };
  } catch {
    return { ok: false, code: "generic" };
  }
}

/** Error codes the catering KB routes + lib can emit that have a localized message. */
const KNOWN_ERROR_CODES = new Set([
  // shared
  "forbidden",
  "not_found",
  "invalid_payload",
  "mixed_concerns",
  "step_up_required",
  "step_up_stale",
  "generic",
  // domain
  "invalid_label",
  "invalid_slug",
  "invalid_price",
  "invalid_headcount",
  "invalid_mode",
  "invalid_rate",
  "invalid_fee",
  "invalid_date",
  "invalid_presence",
  "package_exists",
  "zone_exists",
  "faq_exists",
  "blackout_exists",
  "allergen_exists",
  "food_fact_exists",
  "last_active_row",
]);

/** Resolve an error `code` to a localized message, falling back to generic. */
export function resolveErrorKey(code: string): TranslationKey {
  if (KNOWN_ERROR_CODES.has(code)) {
    return `admin.catering.error.${code}` as TranslationKey;
  }
  return "admin.catering.error.generic" as TranslationKey;
}
