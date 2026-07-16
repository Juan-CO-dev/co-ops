import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { sendQuote, CateringQuoteError, QUOTE_WRITE_MIN } from "@/lib/catering/quotes";

/**
 * POST — send a catering quote to the customer. Step-up-gated MONEY action.
 *
 * The path "/api/catering/quotes/[id]/send" is a step-up SURFACE (lib/session.ts
 * isCateringStepUpPath), so the step-up flag set by the immediately-preceding
 * POST /api/auth/step-up survives to this requireSession. Tier B requires the
 * unlock to be FRESH (within the freshness window) — a deliberate re-confirm
 * right before money leaves the building. On step_up_required/step_up_stale the
 * client opens the password modal and retries.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(req, `/api/catering/quotes/${id}/send`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < QUOTE_WRITE_MIN) return jsonError(403, "forbidden");

  const step = assertStepUp(ctx, "B");
  if (!step.ok) return jsonError(403, step.code);

  try {
    const result = await sendQuote(ctx, id);
    return jsonOk({ ok: true, emailed: result.emailed, recipient: result.recipient });
  } catch (e) {
    if (e instanceof CateringQuoteError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
