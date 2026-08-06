import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  loadWalkerData,
  loadRecentParPasses,
  loadParPassDetail,
  submitParPass,
  OrderingError,
  PAR_PASS_MIN,
  type ParPassLineInput,
} from "@/lib/ordering";

// The par-pass ordering surface. Mirrors the receiving route idiom (KH+ front gate,
// OrderingError → jsonError). All authorization + location-bind (IDOR) is enforced
// inside the lib; this handler validates shape + maps typed errors.
//
//   GET ?locationId=<uuid>            → walker data (loadWalkerData)
//   GET ?locationId=<uuid>&history=1  → recent par-passes (loadRecentParPasses)
//   GET ?eventId=<uuid>               → one par-pass detail (loadParPassDetail; bound
//                                        via the event's OWN location_id in the lib)
//   POST { locationId, lines }        → submit the walk (submitParPass)

export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/operations/ordering");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < PAR_PASS_MIN) return jsonError(403, "forbidden");

  const params = req.nextUrl.searchParams;
  const eventId = params.get("eventId");
  const locationId = params.get("locationId");
  const history = params.get("history");

  try {
    // eventId branch: one par-pass detail (its own location_id binds the read).
    // Exclusive with locationId — reject the ambiguous ?eventId=&locationId= combination
    // before any locationId handling (mirrors the credits route's exclusive-param idiom).
    if (typeof eventId === "string" && eventId) {
      if (typeof locationId === "string" && locationId) {
        return jsonError(400, "invalid_payload", { message: "Provide eventId OR locationId, not both" });
      }
      const detail = await loadParPassDetail(ctx, eventId);
      return jsonOk({ detail });
    }
    if (typeof locationId !== "string" || !locationId) {
      return jsonError(400, "invalid_payload", { field: "locationId" });
    }
    if (history === "1") {
      const passes = await loadRecentParPasses(ctx, locationId);
      return jsonOk({ passes });
    }
    const walker = await loadWalkerData(ctx, locationId);
    return jsonOk({ walker });
  } catch (e) {
    if (e instanceof OrderingError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/operations/ordering");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < PAR_PASS_MIN) return jsonError(403, "forbidden");

  const b = parsed as { locationId?: unknown; lines?: unknown };
  if (typeof b.locationId !== "string" || !b.locationId) {
    return jsonError(400, "invalid_payload", { field: "locationId" });
  }
  if (!Array.isArray(b.lines)) return jsonError(400, "no_lines");
  // The lib re-validates each line (SKU active + par'd + qty finite ≥ 0, no dupes);
  // this cast just narrows the wire shape. Extra fields are ignored by the lib.
  const lines = b.lines as ParPassLineInput[];

  try {
    const res = await submitParPass(ctx, b.locationId, lines);
    return jsonOk(
      {
        eventId: res.eventId,
        draftOrders: res.draftOrders,
        shrinkage: res.shrinkage,
        pos: res.pos,
        poError: res.poError,
      },
      201,
    );
  } catch (e) {
    if (e instanceof OrderingError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
