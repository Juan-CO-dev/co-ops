// GET list (GM+ ≥7, no step-up) · POST create (GM+ ≥7, Tier B)
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  loadZoneGroups,
  createZone,
  AdminCateringError,
  type CreateZoneInput,
} from "@/lib/admin/catering/zones";

const MIN = 7;

export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/admin/catering/zones");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < MIN) return jsonError(403, "forbidden");
  try {
    const groups = await loadZoneGroups(ctx);
    return jsonOk({ groups });
  } catch (e) {
    if (e instanceof AdminCateringError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/catering/zones");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < MIN) return jsonError(403, "forbidden");

  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Partial<CreateZoneInput>;
  if (typeof b.locationId !== "string" || typeof b.labelEn !== "string") {
    return jsonError(400, "invalid_payload", { message: "locationId and labelEn are required" });
  }
  if (typeof b.feeCents !== "number") {
    return jsonError(400, "invalid_payload", { field: "feeCents" });
  }
  const minOrderCents =
    b.minOrderCents === null || b.minOrderCents === undefined
      ? null
      : typeof b.minOrderCents === "number"
        ? b.minOrderCents
        : undefined;
  if (minOrderCents === undefined) {
    return jsonError(400, "invalid_payload", { field: "minOrderCents" });
  }

  try {
    const result = await createZone(ctx, {
      locationId: b.locationId,
      labelEn: b.labelEn,
      labelEs: typeof b.labelEs === "string" ? b.labelEs : null,
      feeCents: b.feeCents,
      minOrderCents,
    });
    return jsonOk({ id: result.id, slug: result.slug }, 201);
  } catch (e) {
    if (e instanceof AdminCateringError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
