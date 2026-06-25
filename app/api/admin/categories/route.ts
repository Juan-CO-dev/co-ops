import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { loadCategories, addCategory, AdminVendorError } from "@/lib/admin/vendors";

// GET — list active categories (≥6). POST — add a category to the shared
// registry (MoO+ ≥8, Tier B).
export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/admin/categories");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 6) return jsonError(403, "forbidden");

  try {
    const categories = await loadCategories(ctx);
    return jsonOk({ categories });
  } catch (e) {
    if (e instanceof AdminVendorError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/categories");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 8) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.label !== "string" || !b.label.trim()) {
    return jsonError(400, "invalid_label", { field: "label" });
  }

  try {
    const { id, slug } = await addCategory(ctx, {
      label: b.label,
      labelEs: typeof b.labelEs === "string" ? b.labelEs : null,
    });
    return jsonOk({ id, slug }, 201);
  } catch (e) {
    if (e instanceof AdminVendorError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
