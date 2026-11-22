import type { NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { canEnterDemandEvent } from "@/lib/demand-signals/access-shared";
import { demandSignalsEnabled } from "@/lib/demand-signals/config-shared";
import { parseDemandEvent } from "@/lib/demand-signals/sources-shared";
import { DemandSignalError, saveDemandEvent } from "@/lib/demand-signals/signal-store";

export const runtime = "nodejs";

/**
 * Item 4 PR 5: a demand EVENT entered by hand (0343 demand_event_save): a new entry, a correction of the entry's
 * current head, or a retraction. Same-origin first, then the session, the trusted role (gm / moo / owner / cgs;
 * the level-6 roles are refused), the switch (DEMAND_SIGNALS, else 503 and nothing is read or written), then
 * the writer. The writer re-reads the role and the GM's membership on the rows, refuses a head that moved
 * (`demand_event_moved`), and writes its own audit row (demand_event.record / demand_event.correct; never the
 * title). NO STEP-UP: an event is a named note on the signals page. It changes no order, par or schedule,
 * nothing is deleted, and a correction is one more row.
 */
export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const ctx = await requireSession(req, "/api/admin/demand-signals/events");
  if (ctx instanceof Response) return ctx;
  if (!canEnterDemandEvent(ctx.role)) return jsonError(403, "demand_event_forbidden");
  if (!demandSignalsEnabled(process.env.DEMAND_SIGNALS)) return jsonError(503, "demand_signals_off");
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  const input = parseDemandEvent(body);
  if (!input) return jsonError(400, "demand_event_invalid");
  try {
    return jsonOk(await saveDemandEvent(getServiceRoleClient(), { userId: ctx.user.id, role: ctx.role, locations: ctx.locations }, input));
  } catch (error) {
    if (error instanceof DemandSignalError) return jsonError(error.status, error.code);
    return jsonError(500, "generic");
  }
}
