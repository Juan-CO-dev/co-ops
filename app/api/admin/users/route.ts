import { assertSameOrigin } from "@/lib/portal/csrf";
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES, isRoleCode } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { listUsers, createUser, AdminUserError, RehireMatchError, ADMIN_MIN_LEVEL, type CreateUserInput } from "@/lib/admin/users";

export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/admin/users");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < ADMIN_MIN_LEVEL) return jsonError(403, "forbidden");

  const url = new URL(req.url);
  const role = url.searchParams.get("role");
  const active = url.searchParams.get("active");
  const locationId = url.searchParams.get("location") ?? undefined;
  const query = url.searchParams.get("q") ?? undefined;
  try {
    const users = await listUsers({
      role: role && isRoleCode(role) ? role : undefined,
      active: active === "true" ? true : active === "false" ? false : undefined,
      locationId, query,
    }, { userId: ctx.user.id, role: ctx.user.role, locations: ctx.locations });
    return jsonOk({ users });
  } catch (e) {
    if (e instanceof AdminUserError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/users");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < ADMIN_MIN_LEVEL) return jsonError(403, "forbidden");

  const su = assertStepUp(ctx, "B"); // WB2-01: creating a user is a user-lifecycle action → Tier B (fresh ≤120s), like the other user mutations
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Partial<CreateUserInput> & { toast?: unknown };
  if (typeof b.name !== "string" || typeof b.role !== "string" || !isRoleCode(b.role) || typeof b.tempPin !== "string") {
    return jsonError(400, "invalid_payload", { message: "name, role, tempPin required" });
  }
  try {
    const created = await createUser(ctx, {
      name: b.name, role: b.role,
      email: typeof b.email === "string" ? b.email : null,
      tempPin: b.tempPin,
      tempPassword: typeof b.tempPassword === "string" ? b.tempPassword : null,
      locationIds: Array.isArray(b.locationIds) ? b.locationIds.filter((x): x is string => typeof x === "string") : [],
      phone: typeof b.phone === "string" ? b.phone : null,
      toast: toastOf(b.toast),
      confirmRehire: b.confirmRehire === true,
      rehireReason: typeof b.rehireReason === "string" ? b.rehireReason : null,
    });
    return jsonOk({ ...created }, 201);
  } catch (e) {
    // The rehire warning carries the matches, already redacted for this viewer (no reason unless they may read it).
    if (e instanceof RehireMatchError) return jsonError(e.status, e.code, { matches: e.matches });
    if (e instanceof AdminUserError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

function toastOf(v: unknown): CreateUserInput["toast"] {
  if (!v || typeof v !== "object") return null;
  const t = v as { locationId?: unknown; employeeGuid?: unknown };
  return typeof t.locationId === "string" && typeof t.employeeGuid === "string" ? { locationId: t.locationId, employeeGuid: t.employeeGuid } : null;
}
