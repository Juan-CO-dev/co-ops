import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES, isRoleCode } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { listUsers, createUser, AdminUserError, type CreateUserInput } from "@/lib/admin/users";

const ADMIN_MIN_LEVEL = 8;

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
    });
    return jsonOk({ users });
  } catch (e) {
    if (e instanceof AdminUserError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/users");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < ADMIN_MIN_LEVEL) return jsonError(403, "forbidden");

  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Partial<CreateUserInput>;
  if (typeof b.name !== "string" || typeof b.role !== "string" || !isRoleCode(b.role) || typeof b.tempPin !== "string") {
    return jsonError(400, "invalid_payload", { message: "name, role, tempPin required" });
  }
  try {
    const { userId } = await createUser(ctx, {
      name: b.name, role: b.role,
      email: typeof b.email === "string" ? b.email : null,
      tempPin: b.tempPin,
      tempPassword: typeof b.tempPassword === "string" ? b.tempPassword : null,
      locationIds: Array.isArray(b.locationIds) ? b.locationIds.filter((x): x is string => typeof x === "string") : [],
    });
    return jsonOk({ userId }, 201);
  } catch (e) {
    if (e instanceof AdminUserError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
