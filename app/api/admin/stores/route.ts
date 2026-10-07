import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { ReceivingError } from "@/lib/receiving";
import { loadManagedStores, manageStore } from "@/lib/receiving-stores";
const PATH = "/api/admin/stores";
export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, PATH);
  if (ctx instanceof Response) return ctx;
  try { return jsonOk({ stores: await loadManagedStores(ctx, req.nextUrl.searchParams.get("locationId") ?? "") }); }
  catch (e) { if (e instanceof ReceivingError) return jsonError(e.status, e.code); throw e; }
}
export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req); if (origin) return origin;
  const ctx = await requireSession(req, PATH); if (ctx instanceof Response) return ctx;
  const step = assertStepUp(ctx, "B"); if (!step.ok) return jsonError(403, step.code);
  const raw = await parseJsonBody(req); if (raw instanceof Response) return raw;
  if (!raw || typeof raw !== "object") return jsonError(400, "invalid_payload");
  const b = raw as Record<string, unknown>;
  if (typeof b.locationId !== "string" || typeof b.storeId !== "string") return jsonError(400, "invalid_payload");
  try { return jsonOk(await manageStore(ctx, { locationId: b.locationId, storeId: b.storeId, action: b.action, name: b.name, targetId: b.targetId })); }
  catch (e) { if (e instanceof ReceivingError) return jsonError(e.status, e.code); throw e; }
}
