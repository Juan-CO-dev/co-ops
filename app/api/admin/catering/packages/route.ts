import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  loadPackages,
  createPackage,
  AdminCateringError,
  type CreatePackageInput,
} from "@/lib/admin/catering/packages";

const PACKAGE_MIN = 6; // catering.kb.packages.write

// GET — list packages the actor can see (≥6). No step-up (read).
export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/admin/catering/packages");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < PACKAGE_MIN) return jsonError(403, "forbidden");

  try {
    const packages = await loadPackages(ctx);
    return jsonOk({ packages });
  } catch (e) {
    if (e instanceof AdminCateringError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

// POST — create a package (≥6, Tier B). location_id optional (null = global).
export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/catering/packages");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < PACKAGE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.labelEn !== "string" || typeof b.pricingMode !== "string" || typeof b.priceCents !== "number") {
    return jsonError(400, "invalid_payload", { message: "labelEn, pricingMode, priceCents required" });
  }
  if (b.locationId !== undefined && b.locationId !== null && typeof b.locationId !== "string") {
    return jsonError(400, "invalid_payload", { field: "locationId" });
  }
  for (const k of ["minHeadcount", "leadTimeHours", "serves"] as const) {
    if (b[k] !== undefined && b[k] !== null && typeof b[k] !== "number") {
      return jsonError(400, "invalid_payload", { field: k });
    }
  }

  const input: CreatePackageInput = {
    locationId: typeof b.locationId === "string" ? b.locationId : null,
    labelEn: b.labelEn,
    labelEs: typeof b.labelEs === "string" ? b.labelEs : null,
    descriptionEn: typeof b.descriptionEn === "string" ? b.descriptionEn : null,
    descriptionEs: typeof b.descriptionEs === "string" ? b.descriptionEs : null,
    pricingMode: b.pricingMode,
    priceCents: b.priceCents,
    minHeadcount: typeof b.minHeadcount === "number" ? b.minHeadcount : null,
    leadTimeHours: typeof b.leadTimeHours === "number" ? b.leadTimeHours : null,
    serves: typeof b.serves === "number" ? b.serves : null,
  };

  try {
    const { id, slug } = await createPackage(ctx, input);
    return jsonOk({ id, slug }, 201);
  } catch (e) {
    if (e instanceof AdminCateringError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
