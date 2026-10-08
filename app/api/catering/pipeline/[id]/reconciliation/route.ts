import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { CateringPipelineError } from "@/lib/catering/pipeline";
import { loadEzcaterReconciliation } from "@/lib/catering/ezcater-reconciliation";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireSession(req, `/api/catering/pipeline/${id}/reconciliation`);
  if (actor instanceof Response) return actor;
  try { return jsonOk({ reconciliation: await loadEzcaterReconciliation(actor, id) }); }
  catch (error) {
    if (error instanceof CateringPipelineError) return jsonError(error.status, error.code);
    return jsonError(503, "reconciliation_unavailable");
  }
}
