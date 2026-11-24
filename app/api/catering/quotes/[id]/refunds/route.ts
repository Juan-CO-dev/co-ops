/**
 * Catering refunds for one order (migration 0357; lib/catering/refunds.ts). SHIPS DARK behind CATERING_REFUNDS=1.
 *
 *   GET  — what was paid, what is still refundable, and the refund history (read floor 5, a shop the viewer sees).
 *   POST — the ONE explicit confirm tap: { clientToken, amountCents | null (= everything refundable), reasonCode,
 *          reasonNote, trigger }. Tier B step-up (a fresh password, like Send): money OUT. This path is a step-up
 *          surface (lib/session.ts `isCateringStepUpPath`) so its own requireSession keeps the unlock the preceding
 *          POST /api/auth/step-up set.
 *
 * Order (POST): same-origin, the session on the route's own path, the switch (503 `refunds_off` before the body is
 * read), the strict parse (400), the role gate (403 before the password is asked for), Tier B, the lib. The server
 * recomputes every figure under the payment locks; nothing the client sends about amounts is trusted beyond the
 * one number it asks for.
 */
import { type NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { assertStepUp } from "@/lib/admin/step-up";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  CateringRefundError,
  REFUND_READ_MIN,
  canRequestRefund,
  cateringRefundsOn,
  loadRefundSummary,
  isUuid,
  parseRefundBody,
  requestRefund,
} from "@/lib/catering/refunds";
import { ROLES } from "@/lib/roles";

function refusal(e: unknown) {
  if (e instanceof CateringRefundError) return jsonError(e.status, e.code, e.detail ?? {});
  throw e;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(req, `/api/catering/quotes/${id}/refunds`);
  if (ctx instanceof Response) return ctx;
  if (!cateringRefundsOn(process.env)) return jsonError(503, "refunds_off");
  if (ROLES[ctx.user.role].level < REFUND_READ_MIN) return jsonError(403, "forbidden");
  if (!isUuid(id)) return jsonError(400, "invalid_request");
  try {
    return jsonOk({ summary: await loadRefundSummary(ctx, id) });
  } catch (e) {
    return refusal(e);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id } = await params;
  const ctx = await requireSession(req, `/api/catering/quotes/${id}/refunds`);
  if (ctx instanceof Response) return ctx;
  if (!cateringRefundsOn(process.env)) return jsonError(503, "refunds_off");
  const raw = await parseJsonBody(req);
  if (raw instanceof Response) return raw;
  const body = parseRefundBody(raw);
  if (typeof body === "string") return jsonError(400, body);
  if (!isUuid(id)) return jsonError(400, "invalid_request");
  if (!canRequestRefund(ctx.user.role)) return jsonError(403, "forbidden");
  const step = assertStepUp(ctx, "B");
  if (!step.ok) return jsonError(403, step.code);
  try {
    const out = await requestRefund(ctx, id, body);
    return jsonOk({ ok: true, replay: out.replay, results: out.results, summary: await loadRefundSummary(ctx, id) });
  } catch (e) {
    return refusal(e);
  }
}
