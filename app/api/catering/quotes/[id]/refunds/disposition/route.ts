/**
 * Operator disposition of ONE open refund issue on this order (migration 0359 `catering_refund_resolve_anomaly`;
 * lib/catering/refunds.ts `resolveRefundAnomaly`; plan B1.4 "Operator disposition"). SHIPS DARK behind
 * CATERING_REFUNDS=1: with the switch OFF this route is INERT — 503 `refunds_off` before the body, the role or the
 * database is read.
 *
 *   POST — { issueId, expectedGeneration, action, evidenceRef?, target? } (lib/catering/refund-outcomes-shared.ts
 *          `parseDispositionBody`: strict, the closed action vocabulary, a structured evidence reference only — no
 *          free-form customer data). Answers { ok, result, summary } with the re-read STORED summary (zero provider
 *          calls); a failed re-read is `summary: null`, never an error.
 *
 * Order: same-origin, the session on the route's OWN path, the switch (503 `refunds_off` before the body is read), the
 * strict parse (400 by name, `evidence_required` included), the quote id, the ROLE (MoO / Owner / CGS: 403 `forbidden`
 * BEFORE the password is asked for), Tier B (a fresh password), the lib. This path is a step-up surface (lib/session.ts
 * `isCateringStepUpPath`) so its own requireSession keeps the unlock the preceding POST /api/auth/step-up set. The lib
 * checks the shop (a MoO needs a membership there) and the database checks everything again from the session row
 * itself: actor, freshness, role, shop, family, evidence and the expected generation (409 `stale_generation`).
 */
import { type NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { assertStepUp } from "@/lib/admin/step-up";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { CateringRefundError, cateringRefundsOn, isUuid, loadRefundSummary, resolveRefundAnomaly } from "@/lib/catering/refunds";
import { DISPOSITION_ROLES, parseDispositionBody } from "@/lib/catering/refund-outcomes-shared";

/** Plan B1.6: a money mutation's route budget (REFUND_ROUTE_BUDGET_MS); a recheck action runs one pass. */
export const maxDuration = 120;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id } = await params;
  const ctx = await requireSession(req, `/api/catering/quotes/${id}/refunds/disposition`);
  if (ctx instanceof Response) return ctx;
  if (!cateringRefundsOn(process.env)) return jsonError(503, "refunds_off");
  const raw = await parseJsonBody(req);
  if (raw instanceof Response) return raw;
  const body = parseDispositionBody(raw);
  if (typeof body === "string") return jsonError(400, body);
  if (!isUuid(id)) return jsonError(400, "invalid_request");
  if (!(DISPOSITION_ROLES as readonly string[]).includes(ctx.user.role)) return jsonError(403, "forbidden");
  const step = assertStepUp(ctx, "B");
  if (!step.ok) return jsonError(403, step.code);
  try {
    const result = await resolveRefundAnomaly(ctx, id, body);
    // The disposition is recorded; a failed re-read must not turn that into an error the person would retry.
    const summary = await loadRefundSummary(ctx, id).catch(() => null);
    return jsonOk({ ok: true, result, summary });
  } catch (e) {
    if (e instanceof CateringRefundError) return jsonError(e.status, e.code, e.detail ?? {});
    throw e;
  }
}
