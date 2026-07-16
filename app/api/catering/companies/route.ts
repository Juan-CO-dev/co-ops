import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { createCompany, CateringCompanyError, COMPANY_WRITE_MIN } from "@/lib/catering/companies";

// POST — create a catering company account (catering_mgr+ >= 6), with optional corporate domains.
export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/catering/companies");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < COMPANY_WRITE_MIN) return jsonError(403, "forbidden");

  const b = parsed as Record<string, unknown>;
  const name = b.name;
  if (typeof name !== "string" || name.trim().length === 0) {
    return jsonError(400, "invalid_payload", { field: "name" });
  }
  const domains = Array.isArray(b.domains) ? b.domains.filter((d): d is string => typeof d === "string") : [];
  const notes = typeof b.notes === "string" ? b.notes : null;

  try {
    const { id } = await createCompany(ctx, { name, domains, notes });
    return jsonOk({ id }, 201);
  } catch (e) {
    if (e instanceof CateringCompanyError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
