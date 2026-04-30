/**
 * GET /api/users/login-options?location_id=<uuid>&role=<role_code> — public.
 *
 * Returns active users matching (location_id, role) for the tile-flow's name
 * selection step (Phase 2 Session 4).
 *
 * Privacy contract (locked Phase 2 Session 4 — see AGENTS.md):
 *   Surfaces user names + roles by location, no email, no last_login.
 *
 * Response shape (locked):
 *   200 { users: [{ id, name, role }] }
 *
 * Filters:
 *   - users.active = true
 *   - users.role = $role
 *   - user_locations.location_id = $location_id
 *
 * Two-step query pattern: PostgREST embedded select with `.eq()` filters on
 * the embedded relation (`users!inner(...)` + `.eq("users.active", true)`)
 * returns 500s in this Supabase instance — FK detection / RLS interaction
 * doesn't resolve cleanly. Two-step (get user_ids by location, then load
 * users with role+active filters) is bulletproof and the round-trip cost is
 * irrelevant for a public, low-volume endpoint.
 */

import { type NextRequest } from "next/server";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { ROLES, type RoleCode } from "@/lib/roles";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRoleCode(v: string): v is RoleCode {
  return v in ROLES;
}

interface UserRow {
  id: string;
  name: string;
  role: RoleCode;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const locationId = url.searchParams.get("location_id");
  const role = url.searchParams.get("role");

  if (!locationId || !UUID_RE.test(locationId)) {
    return jsonError(400, "invalid_payload", {
      field: "location_id",
      message: "location_id must be a UUID",
    });
  }
  if (!role || !isRoleCode(role)) {
    return jsonError(400, "invalid_payload", {
      field: "role",
      message: "role must be a valid RoleCode",
    });
  }

  const sb = getServiceRoleClient();

  // 1. Get user_ids assigned to this location.
  const { data: assignments, error: assignErr } = await sb
    .from("user_locations")
    .select("user_id")
    .eq("location_id", locationId);

  if (assignErr) {
    return jsonError(500, "internal_error", { message: "user lookup failed" });
  }
  const userIds = (assignments ?? []).map((r) => r.user_id as string);
  if (userIds.length === 0) {
    return jsonOk({ users: [] });
  }

  // 2. Load matching active users with this role.
  const { data: users, error: usersErr } = await sb
    .from("users")
    .select("id, name, role")
    .in("id", userIds)
    .eq("active", true)
    .eq("role", role)
    .order("name", { ascending: true })
    .returns<UserRow[]>();

  if (usersErr) {
    return jsonError(500, "internal_error", { message: "user lookup failed" });
  }

  return jsonOk({ users: users ?? [] });
}
