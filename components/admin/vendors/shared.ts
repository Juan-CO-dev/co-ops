/**
 * Shared client helpers + prop types for the Vendor Directory admin UI
 * (Vendor Directory v2, Slice A). Mirrors components/admin/users/shared.ts:
 * the same pessimistic postJson (redirect:"manual", machine-stable `code`)
 * plus a vendor-scoped error resolver.
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

/** Error codes the routes + lib can emit that have a localized message. */
const KNOWN_ERROR_CODES = new Set([
  "forbidden",
  "mixed_concerns",
  "last_contact",
  "last_ordering_detail",
  "category_exists",
  "order_type_exists",
  "invalid_label",
  "vendor_not_found",
  "not_found",
  "invalid_payload",
  "invalid_name",
  "invalid_category",
  "invalid_order_type",
  "invalid_contact",
  "invalid_ordering",
  "invalid_method",
  "invalid_day",
  "invalid_color",
  "step_up_required",
  "step_up_stale",
]);

/** Resolve an error `code` to a localized message, falling back to generic. */
export function resolveErrorKey(code: string): TranslationKey {
  // `not_found` and `vendor_not_found` share one message.
  const normalized = code === "vendor_not_found" ? "not_found" : code;
  if (KNOWN_ERROR_CODES.has(code)) {
    return `admin.vendors.error.${normalized}` as TranslationKey;
  }
  return "admin.vendors.error.generic";
}

export const ORDERING_METHODS = ["email", "url", "phone", "portal", "other"] as const;
export type OrderingMethodOption = (typeof ORDERING_METHODS)[number];
