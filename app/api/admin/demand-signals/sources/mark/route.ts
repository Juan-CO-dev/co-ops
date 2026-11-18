import type { NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { canMarkSource } from "@/lib/demand-signals/access-shared";
import { parseSourceMark } from "@/lib/demand-signals/sources-shared";
import { DemandSignalError, markSource } from "@/lib/demand-signals/signal-store";

export const runtime = "nodejs";

/**
 * Item 4 PR 2: mark a demand-signal SOURCE verified or revoked (0343 demand_source_mark). THE HUMAN DOOR OF THE
 * GATE: nothing is ingested from a source, and nothing stored from it is used, unless a person marked its
 * current definition verified here. Same-origin first, then the session, the trusted role (moo / owner / cgs),
 * Tier B (always prompted), then the writer, which re-reads the role on the users row, refuses a definition
 * other than the one the person read (`definitionHash`), and writes its own audit row (who, when, which
 * definition; never the note). Under /api/admin, so this route's own requireSession keeps the Tier B unlock.
 * No page yet (PR 5); sends nothing.
 */
export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const ctx = await requireSession(req, "/api/admin/demand-signals/sources/mark");
  if (ctx instanceof Response) return ctx;
  if (!canMarkSource(ctx.role)) return jsonError(403, "forbidden");
  const stepUp = assertStepUp(ctx, "B");
  if (!stepUp.ok) return jsonError(403, stepUp.code);
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  const input = parseSourceMark(body);
  if (!input) return jsonError(400, "invalid");
  try {
    return jsonOk(await markSource(getServiceRoleClient(), { userId: ctx.user.id, role: ctx.role }, input));
  } catch (error) {
    if (error instanceof DemandSignalError) return jsonError(error.status, error.code);
    return jsonError(500, "generic");
  }
}
