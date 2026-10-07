import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { ReceivingError } from "@/lib/receiving";
import { createStore } from "@/lib/receiving-stores";

export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const ctx = await requireSession(req, "/api/operations/receiving/stores");
  if (ctx instanceof Response) return ctx;
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object" || !("locationId" in body) || typeof body.locationId !== "string" || !("name" in body)) {
    return jsonError(400, "invalid_payload");
  }
  try {
    return jsonOk(await createStore(ctx, { locationId: body.locationId, name: body.name }), 201);
  } catch (e) {
    if (e instanceof ReceivingError) return jsonError(e.status, e.code);
    throw e;
  }
}
