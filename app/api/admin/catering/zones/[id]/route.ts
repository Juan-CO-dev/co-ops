// PATCH fee/labels (GM+ ≥7, Tier A) · PATCH active (GM+ ≥7, Tier B) — one concern per PATCH
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  updateZone,
  deactivateZone,
  AdminCateringError,
  type UpdateZoneInput,
} from "@/lib/admin/catering/zones";

const MIN = 7;

const EDIT_KEYS = ["labelEn", "labelEs", "feeCents", "minOrderCents"] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catering/zones/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < MIN) return jsonError(403, "forbidden");

  const b = parsed as Record<string, unknown>;
  const hasEdit = EDIT_KEYS.some((k) => k in b);
  const hasActive = "active" in b;

  // Exactly one concern per PATCH.
  const concerns = [hasEdit, hasActive].filter(Boolean).length;
  if (concerns === 0) return jsonError(400, "invalid_payload", { message: "No recognized fields to update" });
  if (concerns > 1) return jsonError(400, "mixed_concerns", { message: "One concern per PATCH: edit or active" });

  try {
    if (hasActive) {
      // deactivate / reactivate — Tier B
      const su = assertStepUp(ctx, "B");
      if (!su.ok) return jsonError(403, su.code);
      if (typeof b.active !== "boolean") return jsonError(400, "invalid_payload", { field: "active" });
      await deactivateZone(ctx, { id, active: b.active });
      return jsonOk({ ok: true });
    }

    // hasEdit — fee / labels — Tier A
    const su = assertStepUp(ctx, "A");
    if (!su.ok) return jsonError(403, su.code);
    const changes: UpdateZoneInput = {};
    if ("labelEn" in b) {
      if (typeof b.labelEn !== "string") return jsonError(400, "invalid_payload", { field: "labelEn" });
      changes.labelEn = b.labelEn;
    }
    if ("labelEs" in b) {
      changes.labelEs = b.labelEs === null ? null : typeof b.labelEs === "string" ? b.labelEs : undefined;
      if (changes.labelEs === undefined) return jsonError(400, "invalid_payload", { field: "labelEs" });
    }
    if ("feeCents" in b) {
      if (typeof b.feeCents !== "number") return jsonError(400, "invalid_payload", { field: "feeCents" });
      changes.feeCents = b.feeCents;
    }
    if ("minOrderCents" in b) {
      changes.minOrderCents = b.minOrderCents === null ? null : typeof b.minOrderCents === "number" ? b.minOrderCents : undefined;
      if (changes.minOrderCents === undefined) return jsonError(400, "invalid_payload", { field: "minOrderCents" });
    }
    await updateZone(ctx, { id, changes });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminCateringError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
