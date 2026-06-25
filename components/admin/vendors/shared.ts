/**
 * Shared client helpers + prop types for the Vendor Directory admin UI
 * (Item/Inventory Spine — Vendor Directory slice). Mirrors the User Management
 * shared.ts pattern (postJson + resolveErrorKey + a vendor-scoped error namespace).
 */

import type { VendorView } from "@/lib/admin/vendors";
import type { TranslationKey } from "@/lib/i18n/types";

export interface VendorAdminClientProps {
  vendors: VendorView[];
  /** GM+ may create / edit full fields / (de)activate; AGM+ may edit trivial fields only. */
  canManageFull: boolean;
  actorLevel: number;
}

/** Mutating-fetch result, narrowed by the caller. */
export type PostResult = { ok: true } | { ok: false; code: string };

/**
 * Mutating POST/PATCH helper — mirrors the users shared.ts fetch (pessimistic,
 * redirect:"manual", JSON content type). Returns the machine-stable `code` on
 * failure so the caller can resolve a localized message.
 */
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
    if (res.ok) return { ok: true };
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

/** All translatable vendor error keys present in en.json (gates the fallback). */
const KNOWN_ERROR_CODES = new Set([
  "invalid_name",
  "invalid_payload",
  "vendor_not_found",
  "forbidden",
  "step_up_required",
  "step_up_stale",
]);

export function resolveErrorKey(code: string): TranslationKey {
  if (KNOWN_ERROR_CODES.has(code)) {
    return `admin.vendors.error.${code}` as TranslationKey;
  }
  return "admin.vendors.error.generic";
}
