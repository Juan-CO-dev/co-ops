/**
 * POST /api/catering/pipeline/[id]/reopen — reopen a LOST ezCater lead after ezCater un-cancelled
 * the order (W23/B126). Write floor 6 + the lead's shop (the lib), no step-up (a stage move takes
 * none). The target stage is decided in SQL (reopen_ezcater_lead, 0330); refusals are named 409s.
 */
import { assertSameOrigin } from "@/lib/portal/csrf";
import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { CateringPipelineError, PIPELINE_WRITE_MIN, reopenEzcaterLead } from "@/lib/catering/pipeline";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id } = await params;
  const ctx = await requireSession(req, `/api/catering/pipeline/${id}/reopen`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < PIPELINE_WRITE_MIN) return jsonError(403, "forbidden");
  try {
    const result = await reopenEzcaterLead(ctx, id);
    return jsonOk({ ok: true, ...result });
  } catch (e) {
    if (e instanceof CateringPipelineError) {
      const response = jsonError(e.status, e.code);
      if (e.status === 503) response.headers.set("Retry-After", "60");
      return response;
    }
    throw e;
  }
}
