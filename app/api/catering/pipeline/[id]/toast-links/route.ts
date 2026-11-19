/**
 * Item 21 PR 3 — a house catering lead's Toast checks. GET: the link panel (null = nothing to show: the shop is off,
 * 0344 not installed, or not a booked house lead; with 0344 but without 0347 the panel is read-only, `linkStep:
 * "not_installed"`). POST: one decision (link / unlink / not_a_match /
 * no_ring_expected / ring_expected) through decideCateringToastLink, which binds the actor and the shop before any
 * write; decide_catering_toast (0347) re-checks both under its locks and writes the audit row.
 */
import type { NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { CateringPipelineError } from "@/lib/catering/pipeline";
import { decideCateringToastLink, loadHouseToastPanelFor } from "@/lib/catering/catering-toast-links";
import { parseToastDecision } from "@/lib/catering/catering-toast-links-shared";

function refusal(error: unknown) {
  if (error instanceof CateringPipelineError) {
    const response = jsonError(error.status, error.code);
    if (error.status === 503) response.headers.set("Retry-After", "60");
    return response;
  }
  throw error;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireSession(req, `/api/catering/pipeline/${id}/toast-links`);
  if (actor instanceof Response) return actor;
  try { return jsonOk({ panel: await loadHouseToastPanelFor(actor, id) }); }
  catch (error) { return refusal(error); }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id } = await params;
  const actor = await requireSession(req, `/api/catering/pipeline/${id}/toast-links`);
  if (actor instanceof Response) return actor;
  const raw = await parseJsonBody(req);
  if (raw instanceof Response) return raw;
  const input = parseToastDecision(raw);
  if (!input) return jsonError(400, "invalid_decision");
  try { return jsonOk({ ok: true, result: await decideCateringToastLink(actor, id, input) }); }
  catch (error) { return refusal(error); }
}
