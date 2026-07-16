/**
 * Shared client helpers for the catering companies surface.
 * Same postJson + error-resolver pattern as the other catering surfaces.
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
  "mixed_concerns",
  "personal_domain",
  "domain_taken",
  "contact_not_found",
  "generic",
]);

export function resolveErrorKey(code: string): TranslationKey {
  if (KNOWN_ERROR_CODES.has(code)) {
    return `catering.companies.error.${code}` as TranslationKey;
  }
  return "catering.companies.error.generic" as TranslationKey;
}
