/**
 * POST /api/maintenance/note — log a maintenance note against a piece of equipment
 * or a free-text label (C.XX Maintenance Log).
 *
 * Body: { locationId: string (uuid), note: string (≤2000 chars),
 *          equipmentId?: string (uuid) | otherLabel?: string }
 * Response (success): { id: string }
 * Response (error): lib/api-helpers.ts jsonError shape.
 *
 * Authorization: any staff at level >= MAINTENANCE_BASE_LEVEL (3).
 * Location access enforced via lockLocationContext (defense-in-depth; RLS also gates).
 */

import { type NextRequest } from "next/server";

import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { lockLocationContext } from "@/lib/locations";
import { MAINTENANCE_BASE_LEVEL, addMaintenanceNote } from "@/lib/maintenance";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  // 1. Auth.
  const ctx = await requireSession(req, "/api/maintenance/note");
  if (ctx instanceof Response) return ctx;

  // 2. Parse body.
  const raw = await parseJsonBody(req);
  if (raw instanceof Response) return raw;
  const b = raw as Record<string, unknown>;

  // 3. Validate fields.
  if (typeof b.locationId !== "string" || !UUID_RE.test(b.locationId))
    return jsonError(400, "invalid_payload", { field: "locationId" });
  if (typeof b.note !== "string" || b.note.trim() === "" || b.note.length > 2000)
    return jsonError(400, "invalid_payload", { field: "note" });

  const equipmentId =
    typeof b.equipmentId === "string" && UUID_RE.test(b.equipmentId)
      ? b.equipmentId
      : null;
  const otherLabel =
    !equipmentId && typeof b.otherLabel === "string" && b.otherLabel.trim()
      ? b.otherLabel.trim()
      : null;

  if (!equipmentId && !otherLabel)
    return jsonError(400, "invalid_payload", {
      field: "equipment",
      message: "Pick equipment or provide a label.",
    });

  // 4. Location access (defense-in-depth; RLS also gates).
  if (!lockLocationContext({ role: ctx.role, locations: ctx.locations }, b.locationId)) {
    return jsonError(403, "location_access_denied", { location_id: b.locationId });
  }

  // 5. Level gate.
  if (ctx.level < MAINTENANCE_BASE_LEVEL) {
    return jsonError(403, "role_insufficient", { required_level: MAINTENANCE_BASE_LEVEL });
  }

  // 6. Persist.
  const service = getServiceRoleClient();
  try {
    const { id } = await addMaintenanceNote(service, {
      locationId: b.locationId as string,
      actor: { userId: ctx.user.id, role: ctx.role, level: ctx.level },
      equipmentId,
      otherLabel,
      note: (b.note as string).trim(),
    });
    return jsonOk({ id });
  } catch (err) {
    console.error(
      "[/api/maintenance/note] failed:",
      err instanceof Error ? err.message : err,
    );
    return jsonError(500, "internal_error", { message: "could not save note" });
  }
}
