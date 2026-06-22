import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { listPrepTemplates, AdminTemplateError } from "@/lib/admin/templates";

const ADMIN_MIN_LEVEL = 7;

export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/admin/templates");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < ADMIN_MIN_LEVEL) return jsonError(403, "forbidden");

  const location = new URL(req.url).searchParams.get("location");
  if (!location) return jsonError(400, "invalid_payload", { field: "location" });
  try {
    const templates = await listPrepTemplates(ctx, location);
    return jsonOk({ templates });
  } catch (e) {
    if (e instanceof AdminTemplateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
