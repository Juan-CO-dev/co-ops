import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { listProducts, createProduct, ProductError } from "@/lib/products";

// Product registry (migration 0179).
// GET  — list products with members + primaries (≥6; the lib enforces it too).
// POST — create a product (GM+ ≥7, Tier B — mirrors a SKU create).
// Every mutation's real authority is lib/products.ts; the route floors are the
// outer layer of the same gate (defense in depth, app/api/admin/skus precedent).

export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/admin/products");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 6) return jsonError(403, "forbidden");

  try {
    const products = await listProducts(ctx);
    return jsonOk({ products });
  } catch (e) {
    if (e instanceof ProductError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/products");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.name !== "string") return jsonError(400, "invalid_payload", { field: "name" });
  for (const k of ["nameEs", "notes"] as const) {
    if (b[k] !== undefined && b[k] !== null && typeof b[k] !== "string") {
      return jsonError(400, "invalid_payload", { field: k });
    }
  }

  try {
    const { id } = await createProduct(ctx, {
      name: b.name,
      nameEs: typeof b.nameEs === "string" ? b.nameEs : null,
      notes: typeof b.notes === "string" ? b.notes : null,
    });
    return jsonOk({ id }, 201);
  } catch (e) {
    if (e instanceof ProductError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
