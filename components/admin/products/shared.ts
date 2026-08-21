/**
 * Client helpers + error resolver for the product registry admin surface
 * (migration 0179). Clones components/admin/catering/shared.ts — the same
 * pessimistic postJson (redirect:"manual", machine-stable `code`) with a
 * product-scoped resolver, so each domain owns its own message keys.
 */

import type { TranslationKey } from "@/lib/i18n/types";

/** Mutating-fetch result, narrowed by the caller. */
export type PostResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; code: string };

/** Mutating POST/PATCH/DELETE helper — returns the machine-stable `code` on failure. */
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
        // No / non-JSON body — some routes return only {ok:true}.
      }
      return { ok: true, data };
    }
    let code = "generic";
    try {
      const parsed = (await res.json()) as { code?: string };
      if (typeof parsed.code === "string") code = parsed.code;
    } catch {
      // Non-JSON / opaque (e.g. a 307 redirect) — fall through to generic.
    }
    return { ok: false, code };
  } catch {
    return { ok: false, code: "generic" };
  }
}

/** Codes the product routes + lib can emit that carry a localized message. */
const KNOWN_ERROR_CODES = new Set([
  "forbidden",
  "not_found",
  "invalid_payload",
  "step_up_required",
  "step_up_stale",
  "generic",
  "invalid_name",
  "duplicate_name",
  "invalid_unit_oz",
  "invalid_product",
  "sku_not_found",
  "already_member",
  "not_a_member",
  "primary_must_be_reassigned",
  "primary_not_found",
  "products_schema_pending",
]);

/** Resolve an error `code` to a localized message, falling back to generic. */
export function resolveErrorKey(code: string): TranslationKey {
  if (KNOWN_ERROR_CODES.has(code)) {
    return `admin.products.error.${code}` as TranslationKey;
  }
  return "admin.products.error.generic" as TranslationKey;
}
