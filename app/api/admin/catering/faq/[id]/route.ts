// PATCH text (AGM+ ≥6, Tier A) · PATCH active (AGM+ ≥6, Tier B) — one concern per PATCH
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  updateFaqText,
  deactivateFaq,
  AdminCateringError,
  type UpdateFaqTextInput,
} from "@/lib/admin/catering/faq";

const MIN = 6;

const TEXT_KEYS = ["questionEn", "questionEs", "answerEn", "answerEs"] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catering/faq/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < MIN) return jsonError(403, "forbidden");

  const b = parsed as Record<string, unknown>;
  const hasText = TEXT_KEYS.some((k) => k in b);
  const hasActive = "active" in b;

  // Exactly one concern per PATCH.
  const concerns = [hasText, hasActive].filter(Boolean).length;
  if (concerns === 0) return jsonError(400, "invalid_payload", { message: "No recognized fields to update" });
  if (concerns > 1) return jsonError(400, "mixed_concerns", { message: "One concern per PATCH: text or active" });

  try {
    if (hasActive) {
      // deactivate / reactivate — Tier B
      const su = assertStepUp(ctx, "B");
      if (!su.ok) return jsonError(403, su.code);
      if (typeof b.active !== "boolean") return jsonError(400, "invalid_payload", { field: "active" });
      await deactivateFaq(ctx, { id, active: b.active });
      return jsonOk({ ok: true });
    }

    // hasText — edit text — Tier A
    const su = assertStepUp(ctx, "A");
    if (!su.ok) return jsonError(403, su.code);
    const changes: UpdateFaqTextInput = {};
    if ("questionEn" in b) {
      if (typeof b.questionEn !== "string") return jsonError(400, "invalid_payload", { field: "questionEn" });
      changes.questionEn = b.questionEn;
    }
    if ("questionEs" in b) {
      changes.questionEs = b.questionEs === null ? null : typeof b.questionEs === "string" ? b.questionEs : undefined;
      if (changes.questionEs === undefined) return jsonError(400, "invalid_payload", { field: "questionEs" });
    }
    if ("answerEn" in b) {
      if (typeof b.answerEn !== "string") return jsonError(400, "invalid_payload", { field: "answerEn" });
      changes.answerEn = b.answerEn;
    }
    if ("answerEs" in b) {
      changes.answerEs = b.answerEs === null ? null : typeof b.answerEs === "string" ? b.answerEs : undefined;
      if (changes.answerEs === undefined) return jsonError(400, "invalid_payload", { field: "answerEs" });
    }
    await updateFaqText(ctx, { id, changes });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminCateringError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
