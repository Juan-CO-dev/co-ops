import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { CateringPipelineError } from "@/lib/catering/pipeline";
import { transferCateringLead } from "@/lib/catering/transfers";
import { TRANSFER_REASONS } from "@/lib/catering/transfers-shared";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireSession(req, `/api/catering/pipeline/${id}/transfer`);
  if (actor instanceof Response) return actor;
  const raw = await parseJsonBody(req);
  if (raw instanceof Response) return raw;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return jsonError(400, "invalid_payload");
  const b = raw as Record<string, unknown>;
  if (typeof b.locationId !== "string" || typeof b.reason !== "string" ||
      !(TRANSFER_REASONS as readonly string[]).includes(b.reason) ||
      (b.note !== undefined && typeof b.note !== "string")) return jsonError(400, "invalid_payload");
  try {
    const result = await transferCateringLead(actor, id, {
      locationId: b.locationId,
      reason: b.reason as (typeof TRANSFER_REASONS)[number],
      note: b.note as string | undefined,
    });
    return jsonOk({ ok: true, result });
  } catch (error) {
    if (error instanceof CateringPipelineError) {
      const response = jsonError(error.status, error.code);
      if (error.status === 503) response.headers.set("Retry-After", "60");
      return response;
    }
    throw error;
  }
}
