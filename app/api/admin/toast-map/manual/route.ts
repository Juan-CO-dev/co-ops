// POST manually map a Toast guid to a CO entity (GM+ >= 7, Tier A step-up) —
// the alias affordance: what the matcher can't resolve, a human can.
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { manualMap, AdminToastMapError, TOAST_MAP_MIN } from "@/lib/admin/toast-map";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/toast-map/manual");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < TOAST_MAP_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.locationId !== "string" || !UUID_RE.test(b.locationId)) return jsonError(400, "invalid_payload", { field: "locationId" });
  if (typeof b.toastItemGuid !== "string" || b.toastItemGuid.length === 0) return jsonError(400, "invalid_payload", { field: "toastItemGuid" });
  if (typeof b.toastItemName !== "string" || b.toastItemName.length === 0) return jsonError(400, "invalid_payload", { field: "toastItemName" });
  const KINDS = new Set(["menu_item", "item", "package", "assortment_full", "assortment_classics"]);
  if (typeof b.entityKind !== "string" || !KINDS.has(b.entityKind)) return jsonError(400, "invalid_payload", { field: "entityKind" });
  const kind = b.entityKind as "menu_item" | "item" | "package" | "assortment_full" | "assortment_classics";
  const isAssortment = kind === "assortment_full" || kind === "assortment_classics";
  // Assortment behaviors carry no target entity; everything else requires one.
  if (!isAssortment && (typeof b.entityId !== "string" || !UUID_RE.test(b.entityId))) return jsonError(400, "invalid_payload", { field: "entityId" });
  if (typeof b.isModifier !== "boolean") return jsonError(400, "invalid_payload", { field: "isModifier" });

  try {
    const { id } = await manualMap(ctx, {
      locationId: b.locationId,
      toastItemGuid: b.toastItemGuid,
      toastItemName: b.toastItemName,
      entityKind: kind,
      entityId: isAssortment ? null : (b.entityId as string),
      isModifier: b.isModifier,
    });
    return jsonOk({ id });
  } catch (e) {
    if (e instanceof AdminToastMapError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
