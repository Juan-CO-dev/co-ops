/**
 * Client helpers + error resolver for the weight & trim audit surface.
 *
 * Clones components/admin/products/shared.ts — the same pessimistic postJson
 * (redirect:"manual", machine-stable `code`) with a weights-scoped resolver, so
 * each domain owns its own message keys rather than borrowing another's.
 */

import type { TranslationKey } from "@/lib/i18n/types";

/** Mutating-fetch result, narrowed by the caller. */
export type PostResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; code: string };

/** Mutating POST helper — returns the machine-stable `code` on failure. */
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
        // No / non-JSON body.
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

/** Codes the weights route + lib can emit that carry a localized message. */
const KNOWN_ERROR_CODES = new Set([
  "forbidden",
  "not_found",
  "invalid_payload",
  "invalid_weight",
  "too_many_measurements",
  "step_up_required",
  "step_up_stale",
  "generic",
]);

/** Resolve an error `code` to a localized message, falling back to generic. */
export function resolveErrorKey(code: string): TranslationKey {
  if (KNOWN_ERROR_CODES.has(code)) {
    return `admin.weights.error.${code}` as TranslationKey;
  }
  return "admin.weights.error.generic" as TranslationKey;
}
