import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { completeYieldRetrain, YieldStatsError } from "@/lib/yield-stats";

/**
 * POST /api/operations/production/yield/retrain/done — "Mark done" on a retrain task (the
 * assignee's My shift, or a GM). The lib binds the note's shop, allows only the assignee or a
 * GM, and completes it exactly once (complete_yield_retrain).
 */
export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const ctx = await requireSession(req, "/api/operations/production/yield/retrain/done");
  if (ctx instanceof Response) return ctx;
  const raw = await parseJsonBody(req);
  if (raw instanceof Response) return raw;
  if (!raw || typeof raw !== "object") return jsonError(400, "invalid_payload");
  const b = raw as Record<string, unknown>;
  if (typeof b.noteId !== "string") return jsonError(400, "invalid_payload");
  try {
    return jsonOk(await completeYieldRetrain(ctx, { noteId: b.noteId, doneNote: b.doneNote }));
  } catch (e) {
    if (e instanceof YieldStatsError) return jsonError(e.status, e.code);
    throw e;
  }
}
