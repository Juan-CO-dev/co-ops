/**
 * GET /api/admin/catering/packages/[id]/recommend?location=<uuid?> — advisory package price.
 *
 * Read-only (no step-up). Returns the à-la-carte catering value of the package's constituents +
 * the implied bundle discount vs the team's flat price_cents. `?location=` is the preview-location
 * basis for a GLOBAL package (a per-location package uses its own location). ≥6 (catering_mgr+).
 */

import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { recommendPackagePrice } from "@/lib/admin/catering/package-pricing";

const PACKAGE_MIN = 6;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(req, `/api/admin/catering/packages/${id}/recommend`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < PACKAGE_MIN) return jsonError(403, "forbidden");

  const locationId = req.nextUrl.searchParams.get("location");
  const rec = await recommendPackagePrice(ctx, { packageId: id, locationId });
  return jsonOk({ ...rec });
}
