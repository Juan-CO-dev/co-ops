import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { addItemQuestion, AdminTemplateError } from "@/lib/admin/templates";
import type { LineInputType } from "@/lib/types";

const INPUT_TYPES: readonly LineInputType[] = ["on_hand", "portioned", "line", "yes_no", "free_text"];

// Add a non-inventory question to an item. Propagates to every prep list where
// the item appears. MoO+ (≥8), Tier B.
export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/checklist-templates/item-questions");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 8) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.itemId !== "string" || !b.itemId) return jsonError(400, "item_not_found", { field: "itemId" });
  if (typeof b.label !== "string" || !b.label.trim()) return jsonError(400, "invalid_label", { field: "label" });
  if (typeof b.inputType !== "string" || !(INPUT_TYPES as readonly string[]).includes(b.inputType)) {
    return jsonError(400, "invalid_input_type", { field: "inputType" });
  }
  if (b.minRoleLevel !== null && b.minRoleLevel !== undefined && typeof b.minRoleLevel !== "number") {
    return jsonError(400, "invalid_min_role", { field: "minRoleLevel" });
  }
  const minRoleLevel = typeof b.minRoleLevel === "number" ? b.minRoleLevel : null;
  const labelEs = b.labelEs === null || typeof b.labelEs === "string" ? (b.labelEs as string | null) : null;
  try {
    const result = await addItemQuestion(ctx, {
      itemId: b.itemId,
      label: b.label,
      labelEs,
      inputType: b.inputType as LineInputType,
      includeNote: b.includeNote === true,
      minRoleLevel,
      required: b.required === true,
    });
    return jsonOk(result);
  } catch (e) {
    if (e instanceof AdminTemplateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
