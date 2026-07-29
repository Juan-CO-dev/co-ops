// POST — PUBLISH a new template version (Template Builder, spec §1/§10 PR-3). Every
// publish MINTS a new checklist_templates version (fresh item rows) effective NEXT
// OPERATIONAL DAY, or TODAY when apply_now (Tier-A step-up + gated on no open
// instance). GM+ (>= 7), Tier A step-up. No in-place mutation of a served version —
// history is immutable by construction. Mirror rows copy verbatim (never edited).
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  publishTemplateVersion,
  TemplateBuilderError,
  type TemplateItemEdit,
  type PublishEffectiveMode,
} from "@/lib/admin/template-builder";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/template-builder/${id}/publish`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;

  // effectiveMode — apply_now vs next_day (default next_day; the safe path).
  const effectiveMode: PublishEffectiveMode = b.effectiveMode === "apply_now" ? "apply_now" : "next_day";

  // edits — a JSON array of TemplateItemEdit. Validate the discriminated shape
  // defensively (the lib re-enforces the spine-link + mirror invariants server-side).
  if (!Array.isArray(b.edits)) return jsonError(400, "invalid_payload", { field: "edits" });
  const edits: TemplateItemEdit[] = [];
  for (const raw of b.edits as unknown[]) {
    const e = coerceEdit(raw);
    if (!e) return jsonError(400, "invalid_payload", { field: "edits" });
    edits.push(e);
  }

  try {
    const result = await publishTemplateVersion(ctx, { templateId: id, edits, effectiveMode });
    return jsonOk({
      ok: true,
      newTemplateId: result.newTemplateId,
      effectiveFrom: result.effectiveFrom,
      diff: result.diff,
    });
  } catch (e) {
    if (e instanceof TemplateBuilderError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

/** Narrow one raw edit object to a TemplateItemEdit, or null when malformed. The lib
 *  is the authority (mirror + spine-link enforcement); this is the wire-shape guard. */
function coerceEdit(raw: unknown): TemplateItemEdit | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const op = o.op;
  const str = (v: unknown): v is string => typeof v === "string";
  const strOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
  const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  const bool = (v: unknown): v is boolean => typeof v === "boolean";

  switch (op) {
    case "relabel":
      return str(o.itemId) && str(o.label) ? { op, itemId: o.itemId, label: o.label } : null;
    case "describe":
      return str(o.itemId) && strOrNull(o.description) ? { op, itemId: o.itemId, description: o.description } : null;
    case "station":
      return str(o.itemId) && strOrNull(o.station) ? { op, itemId: o.itemId, station: o.station } : null;
    case "reorder":
      return str(o.itemId) && num(o.displayOrder) ? { op, itemId: o.itemId, displayOrder: o.displayOrder } : null;
    case "role":
      return str(o.itemId) && num(o.minRoleLevel) ? { op, itemId: o.itemId, minRoleLevel: o.minRoleLevel } : null;
    case "required":
      return str(o.itemId) && bool(o.required) ? { op, itemId: o.itemId, required: o.required } : null;
    case "disable":
      return str(o.itemId) ? { op, itemId: o.itemId } : null;
    case "enable":
      return str(o.itemId) ? { op, itemId: o.itemId } : null;
    case "translate": {
      if (!str(o.itemId) || typeof o.es !== "object" || o.es === null) return null;
      const es = o.es as Record<string, unknown>;
      const out: { label?: string | null; description?: string | null; specialInstruction?: string | null } = {};
      if ("label" in es) { if (!strOrNull(es.label)) return null; out.label = es.label; }
      if ("description" in es) { if (!strOrNull(es.description)) return null; out.description = es.description; }
      if ("specialInstruction" in es) { if (!strOrNull(es.specialInstruction)) return null; out.specialInstruction = es.specialInstruction; }
      return { op, itemId: o.itemId, es: out };
    }
    case "add": {
      if (!str(o.tempId) || !str(o.label) || !num(o.displayOrder) || !num(o.minRoleLevel) || !bool(o.required) || !bool(o.expectsCount)) {
        return null;
      }
      const edit: Extract<TemplateItemEdit, { op: "add" }> = {
        op: "add",
        tempId: o.tempId,
        label: o.label,
        displayOrder: o.displayOrder,
        minRoleLevel: o.minRoleLevel,
        required: o.required,
        expectsCount: o.expectsCount,
      };
      if ("description" in o) { if (!strOrNull(o.description)) return null; edit.description = o.description; }
      if ("station" in o) { if (!strOrNull(o.station)) return null; edit.station = o.station; }
      if ("expectsPhoto" in o) { if (!bool(o.expectsPhoto)) return null; edit.expectsPhoto = o.expectsPhoto; }
      if ("spineLink" in o && o.spineLink !== null) {
        const sl = o.spineLink;
        if (typeof sl !== "object" || sl === null) return null;
        const slo = sl as Record<string, unknown>;
        const kind = slo.kind === "item" ? "item" : slo.kind === "sku" ? "sku" : null;
        if (!kind || !str(slo.id)) return null;
        edit.spineLink = { kind, id: slo.id };
      }
      if ("es" in o && o.es !== null && typeof o.es === "object") {
        const es = o.es as Record<string, unknown>;
        const esOut: { label?: string | null; description?: string | null } = {};
        if ("label" in es) { if (!strOrNull(es.label)) return null; esOut.label = es.label; }
        if ("description" in es) { if (!strOrNull(es.description)) return null; esOut.description = es.description; }
        edit.es = esOut;
      }
      return edit;
    }
    default:
      return null;
  }
}
