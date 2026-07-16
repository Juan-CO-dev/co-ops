/**
 * Shared client helpers for the catering customer directory (Wave 1 slice 1D).
 * Same postJson + error-resolver pattern as the pipeline board.
 */

import type { TranslationKey } from "@/lib/i18n/types";

export type PostResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; code: string };

export async function postJson(
  url: string,
  body: unknown,
  method: "POST" | "PATCH" | "DELETE" = "POST",
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
        /* empty */
      }
      return { ok: true, data };
    }
    let code = "generic";
    try {
      const parsed = (await res.json()) as { code?: string };
      if (typeof parsed.code === "string") code = parsed.code;
    } catch {
      /* opaque */
    }
    return { ok: false, code };
  } catch {
    return { ok: false, code: "generic" };
  }
}

const KNOWN_ERROR_CODES = new Set([
  "forbidden",
  "not_found",
  "invalid_payload",
  "location_access_denied",
  "mixed_concerns",
  "generic",
]);

export function resolveErrorKey(code: string): TranslationKey {
  if (KNOWN_ERROR_CODES.has(code)) {
    return `catering.customers.error.${code}` as TranslationKey;
  }
  return "catering.customers.error.generic" as TranslationKey;
}
