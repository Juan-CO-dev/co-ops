/**
 * Catering refunds for one order (migrations 0357 -> 0359; lib/catering/refunds.ts). SHIPS DARK behind CATERING_REFUNDS=1.
 *
 *   GET  — the panel's read model (F7 `catering_refund_summary`): STORED STATE ONLY, zero Stripe calls (read floor 5, a
 *          shop the viewer sees). `{ summary }`.
 *   POST — the ONE explicit confirm tap: { clientToken, amountCents, seenRefundableCents, reasonCode, reasonNote,
 *          trigger }. Tier B step-up (a fresh password, like Send): money OUT. This path is a step-up surface
 *          (lib/session.ts `isCateringStepUpPath`) so its own requireSession keeps the unlock the preceding
 *          POST /api/auth/step-up set. `{ result: RefundPressResult, summary }`.
 *
 * Order (POST): same-origin, the session on the route's own path, the switch (503 `refunds_off` before the body is
 * read), the strict parse (400), the role gate (403 before the password is asked for), Tier B, the lib. With the switch
 * unset every answer up to and including the switch is main's, byte for byte. With it on, the lib refuses again by its
 * own gate: OBSERVE off = 503 `refunds_unavailable`; a build or a database without B2 / B3 = 503
 * `refunds_not_activated`. A refusal is `{ error, code, ...detail }` (main's shape); a 409 also carries a fresh
 * `summary` (null when it cannot be read), so the panel re-draws from what the server knows now [S11].
 */
import { type NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { assertStepUp } from "@/lib/admin/step-up";
import { requireSession, type AuthContext } from "@/lib/session";
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
import { RefundsUnavailableError } from "@/lib/catering/refund-observe";
import { ROLES } from "@/lib/roles";

export const maxDuration = 120;

/** A named refusal answers by name; anything else is a defect and is thrown (500), never a 2xx. */
async function refusal(e: unknown, fresh?: { ctx: AuthContext; id: string }) {
  if (e instanceof RefundsUnavailableError) return jsonError(503, "refunds_unavailable");
  if (!(e instanceof CateringRefundError)) throw e;
  const summary = fresh && e.status === 409 ? { summary: await loadRefundSummary(fresh.ctx, fresh.id).catch(() => null) } : {};
  return jsonError(e.status, e.code, { ...(e.detail ?? {}), ...summary });
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
    const result = await requestRefund(ctx, id, body);
    // Whatever the press did is done; a failed re-read must not turn that into an error the person would retry.
    const summary = await loadRefundSummary(ctx, id).catch(() => null);
    return jsonOk({ result, summary });
  } catch (e) {
    return refusal(e, { ctx, id });
  }
}
