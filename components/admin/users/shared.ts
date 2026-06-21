/**
 * Shared client helpers + prop types for the User Management admin UI
 * (C.44 Tasks 12/13). Imported by UserAdminClient, CreateUserForm, UserActions.
 */

import type { AdminUserListItem } from "@/lib/admin/users";
import type { RoleCode } from "@/lib/roles";
import type { TranslationKey } from "@/lib/i18n/types";

export type LocationOption = { id: string; name: string; code: string };

export interface UserAdminClientProps {
  users: AdminUserListItem[];
  /** Every active location — used to render location codes on rows + the filter select. */
  allLocations: LocationOption[];
  /** Locations the actor may assign (subset of allLocations, or all for 9+). */
  accessibleLocations: LocationOption[];
  /** Roles the actor can create/assign (canActOn === true). */
  assignableRoles: RoleCode[];
  actorRole: RoleCode;
  actorLevel: number;
  currentFilters: { role: string; status: string; location: string; q: string };
}

/** Mutating-fetch result, narrowed by the caller. */
export type PostResult =
  | { ok: true }
  | { ok: false; code: string };

/**
 * Mutating POST/PATCH helper — mirrors the UserMenu fetch shape (pessimistic,
 * redirect:"manual", JSON content type). Returns the machine-stable `code` on
 * failure so the caller can resolve a localized message.
 */
export async function postJson(
  url: string,
  body: unknown,
  method: "POST" | "PATCH" = "POST",
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

/** Resolve an error `code` to a localized message, falling back to the generic key. */
export function errorKey(code: string): TranslationKey {
  const candidate = `admin.users.error.${code}` as TranslationKey;
  return candidate;
}

/** All translatable error keys present in en.json (used to gate the fallback). */
const KNOWN_ERROR_CODES = new Set([
  "email_taken",
  "invalid_pin",
  "email_required",
  "password_required",
  "locations_required",
  "forbidden",
  "step_up_required",
  "step_up_stale",
]);

export function resolveErrorKey(code: string): TranslationKey {
  if (KNOWN_ERROR_CODES.has(code)) return errorKey(code);
  return "admin.users.error.generic";
}
