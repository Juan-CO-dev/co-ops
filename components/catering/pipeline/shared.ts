/**
 * Shared client helpers for the catering pipeline board (Wave 1 slice 1C).
 * Same pessimistic postJson (redirect:"manual", machine-stable `code`) as the
 * admin surfaces, plus a pipeline-scoped error resolver.
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
        /* empty / non-JSON body is fine */
      }
      return { ok: true, data };
    }
    let code = "generic";
    try {
      const parsed = (await res.json()) as { code?: string };
      if (typeof parsed.code === "string") code = parsed.code;
    } catch {
      /* opaque (e.g. 307) → generic */
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
  "invalid_stage",
  "mixed_concerns",
  "generic",
]);

export function resolveErrorKey(code: string): TranslationKey {
  if (KNOWN_ERROR_CODES.has(code)) {
    return `catering.pipeline.error.${code}` as TranslationKey;
  }
  return "catering.pipeline.error.generic" as TranslationKey;
}
