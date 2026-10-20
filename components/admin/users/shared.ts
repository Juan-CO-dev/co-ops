/**
 * Shared client helpers + prop types for the User Management admin UI
 * (C.44 Tasks 12/13). Imported by UserAdminClient, CreateUserForm, UserActions.
 */

import type { AdminUserListItem } from "@/lib/admin/users";
import type { RoleCode } from "@/lib/roles";
import type { TranslationKey } from "@/lib/i18n/types";
import type { ShopPositionPicker } from "@/lib/scheduling/user-positions-shared";

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
  /** The actor's id and active shops (a GM manages their own shops' people only — userAdminRefusal). */
  actorUserId: string;
  actorLocations: string[];
  /** 0279 is applied: the employment actions are offered. */
  employmentAvailable: boolean;
  /** The Add user Toast picker is offered (who's-here on). */
  toastPickerEnabled: boolean;
  /** The ET business date. */
  today: string;
  currentFilters: { role: string; status: string; location: string; q: string };
  /** Juan 2026-10-20: the primary / secondary picker data per accessible shop (null = scheduling not installed there). */
  positionShops?: Record<string, ShopPositionPicker | null>;
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

/**
 * A POST that also returns the JSON body on success (the Add user flow needs the new `userId` to write the person's
 * positions right after). Same fetch shape as `postJson`.
 */
export async function postJsonData<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; code: string; body?: unknown }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), redirect: "manual" });
    let parsed: unknown = null;
    try { parsed = await res.json(); } catch { /* opaque (e.g. a 307 redirect): no body */ }
    if (res.ok) return { ok: true, data: parsed as T };
    const code = parsed && typeof (parsed as { code?: unknown }).code === "string" ? (parsed as { code: string }).code : "generic";
    return { ok: false, code, body: parsed };
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
  // polish-c: routes/lib emit these but the client used to fall to generic
  // ("Something went wrong") for what are actually specific validation failures.
  "invalid_payload",
  "invalid_name",
  "invalid_password",
  "not_found",
  // Staff separations + GM user management (2026-10-20).
  "employment_moved",
  "employment_invalid_transition",
  "rehire_owner_ok_required",
  "rehire_owner_required",
  "rehire_reason_required",
  "target_outside_shop",
  "employment_unavailable",
  "user_admin_unavailable",
  "use_back_from_leave",
  "use_rehire",
  "rehire_match",
  "rehire_permission_required",
]);

export function resolveErrorKey(code: string): TranslationKey {
  if (KNOWN_ERROR_CODES.has(code)) return errorKey(code);
  return "admin.users.error.generic";
}
