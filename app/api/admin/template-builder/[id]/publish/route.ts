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
  isReconciledReportRefType,
  type TemplateItemEdit,
  type TemplatePatch,
  type PublishEffectiveMode,
} from "@/lib/admin/template-builder";
import type { GatePredicate } from "@/lib/types";

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

  // templatePatch — PR-4 (spec §5): the OPTIONAL template-level submission-gate change
  // riding the same publish. Only present when the manager edited the "Requires" setting.
  // A present-but-null field clears the gate; a GatePredicate sets it; absence copies
  // the source verbatim (coerceTemplatePatch returns undefined then).
  const templatePatch = coerceTemplatePatch(b.templatePatch);
  if (templatePatch === "invalid") return jsonError(400, "invalid_payload", { field: "templatePatch" });

  try {
    const result = await publishTemplateVersion(ctx, {
      templateId: id,
      edits,
      effectiveMode,
      ...(templatePatch !== undefined ? { templatePatch } : {}),
    });
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
  // Role floors are integers 0..10 (ROLES registry max) — an out-of-range floor
  // ships an unconfirmable required item (adversarial review L4). Reject, don't
  // silently clamp (the client never sends these; a hand-crafted payload should
  // fail loudly).
  const role = (v: unknown): v is number => num(v) && Number.isInteger(v) && v >= 0 && v <= 10;
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
      return str(o.itemId) && role(o.minRoleLevel) ? { op, itemId: o.itemId, minRoleLevel: o.minRoleLevel } : null;
    case "required":
      return str(o.itemId) && bool(o.required) ? { op, itemId: o.itemId, required: o.required } : null;
    case "gate_tier":
      // PR-4: the 3-way tier. Both booleans required. hardGate IMPLIES required
      // (adversarial review MED-2): a hard-gated-but-optional item would block
      // confirmInstance while staying invisible to the Doctor's role-floor trap
      // (classifyRoleFloor skips non-required) — the UI never emits that shape;
      // the server rejects it so the API can't either.
      if (!(str(o.itemId) && bool(o.required) && bool(o.hardGate))) return null;
      if (o.hardGate === true && o.required !== true) return null;
      return { op, itemId: o.itemId, required: o.required, hardGate: o.hardGate };
    case "set_report_ref":
      // PR-4: the report_reference_type picker — only the reconcile-backed values (or
      // null). An unrecognized value fails loudly (never silently drop the edit).
      if (!str(o.itemId)) return null;
      if (o.refType === null) return { op, itemId: o.itemId, refType: null };
      return isReconciledReportRefType(o.refType) ? { op, itemId: o.itemId, refType: o.refType } : null;
    case "ref_track":
      // PR-4: the ONE new mechanism. targetItemId is another item's id (or null to clear).
      return str(o.itemId) && strOrNull(o.targetItemId)
        ? { op, itemId: o.itemId, targetItemId: o.targetItemId }
        : null;
    case "input_type":
      // Fulledit PR-2: the question input type — yes_no / free_text / null (tick).
      // An unrecognized value fails loudly (never silently drop the edit).
      if (!str(o.itemId)) return null;
      if (o.inputType === null || o.inputType === "yes_no" || o.inputType === "free_text") {
        return { op, itemId: o.itemId, inputType: o.inputType };
      }
      return null;
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
      if (!str(o.tempId) || !str(o.label) || !num(o.displayOrder) || !role(o.minRoleLevel) || !bool(o.required) || !bool(o.expectsCount)) {
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
      // PR-5 (spec §8): a RECONCILE add carries the source's hard gate. hardGate IMPLIES
      // required (parity with the gate_tier guard — a hard-gated-but-optional line would
      // block confirmInstance while invisible to the Doctor's role-floor trap).
      if ("hardGate" in o) {
        if (!bool(o.hardGate)) return null;
        if (o.hardGate === true && edit.required !== true) return null;
        edit.hardGate = o.hardGate;
      }
      // Fulledit PR-2: the question input type on a fresh add. Mutually exclusive
      // with expectsCount (parity with the lib guard — reject at the wire too).
      if ("inputType" in o && o.inputType !== undefined && o.inputType !== null) {
        if (o.inputType !== "yes_no" && o.inputType !== "free_text") return null;
        if (edit.expectsCount) return null;
        edit.inputType = o.inputType;
      }
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

/**
 * Narrow the optional templatePatch (PR-4, spec §5). Returns:
 *   - undefined  → no patch present (copy the source predicate verbatim)
 *   - TemplatePatch → a valid patch (submissionGatePredicate: null clears, or a
 *     GatePredicate of the ONLY shape evaluateGatePredicate handles)
 *   - "invalid"  → malformed → the route 400s
 * The shape lock mirrors evaluateGatePredicate / GatePredicate (lib/types.ts): a
 * single `requires_state` array of { template_type, operational_date_offset,
 * status_in[] } clauses. We validate structurally here; the evaluator throws on an
 * unknown shape at gate time as the final backstop.
 */
function coerceTemplatePatch(raw: unknown): TemplatePatch | undefined | "invalid" {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object") return "invalid";
  const o = raw as Record<string, unknown>;
  if (!("submissionGatePredicate" in o)) return undefined; // nothing to patch
  const p = o.submissionGatePredicate;
  if (p === null) return { submissionGatePredicate: null };
  const pred = coerceGatePredicate(p);
  return pred ? { submissionGatePredicate: pred } : "invalid";
}

/** Narrow a GatePredicate ({ requires_state: [clauses] }) or null on malformed input.
 *  The builder only writes the ONE shape evaluateGatePredicate supports (a template
 *  requires an upstream artifact submitted); the clause fields match
 *  GatePredicateRequiresState. */
function coerceGatePredicate(raw: unknown): GatePredicate | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.requires_state) || o.requires_state.length === 0) return null;
  const clauses: GatePredicate["requires_state"] = [];
  for (const c of o.requires_state as unknown[]) {
    if (typeof c !== "object" || c === null) return null;
    const cl = c as Record<string, unknown>;
    if (typeof cl.template_type !== "string") return null;
    if (typeof cl.operational_date_offset !== "number" || !Number.isInteger(cl.operational_date_offset)) return null;
    if (!Array.isArray(cl.status_in) || cl.status_in.length === 0) return null;
    if (!cl.status_in.every((s) => typeof s === "string")) return null;
    clauses.push({
      template_type: cl.template_type as GatePredicate["requires_state"][number]["template_type"],
      operational_date_offset: cl.operational_date_offset,
      status_in: cl.status_in as GatePredicate["requires_state"][number]["status_in"],
    });
  }
  return { requires_state: clauses };
}
