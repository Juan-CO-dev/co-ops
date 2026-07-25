import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp, type StepUpTier } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  updatePackage,
  deactivatePackage,
  addPackageLineItem,
  addPackageLine,
  addSlotOption,
  removeSlotOption,
  setSlotOptionClassic,
  removePackageLineItem,
  AdminCateringError,
  type UpdatePackageChanges,
  type LineSlotType,
} from "@/lib/admin/catering/packages";

const PACKAGE_MIN = 6; // catering.kb.packages.write — floor for every concern below

// PATCH — one concern per call, each with its own step-up tier:
//   fields  {labelEn,labelEs,descriptionEn,descriptionEs,pricingMode,priceCents,
//            minHeadcount,leadTimeHours} → edit package fields → ≥6, Tier A
//   active  {active}                    → deactivate/reactivate → ≥6, Tier B
//   addItem {addItem:{description,quantity}} → add line item     → ≥6, Tier A
//   removeItem {removeItemId}            → remove line item      → ≥6, Tier A
const FIELD_KEYS = [
  "labelEn",
  "labelEs",
  "descriptionEn",
  "descriptionEs",
  "pricingMode",
  "priceCents",
  "minHeadcount",
  "leadTimeHours",
  "serves",
] as const;

/** Parse a {kind, id} spine ref from the body, or null if absent/malformed. */
function parseRef(raw: unknown): { kind: "item" | "menu_item"; id: string } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if ((r.kind !== "item" && r.kind !== "menu_item") || typeof r.id !== "string") return null;
  return { kind: r.kind, id: r.id };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catering/packages/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < PACKAGE_MIN) return jsonError(403, "forbidden");

  const b = parsed as Record<string, unknown>;
  const hasFields = FIELD_KEYS.some((k) => k in b);
  const hasActive = "active" in b;
  const hasAddItem = "addItem" in b;
  const hasRemoveItem = "removeItemId" in b;
  const hasAddLine = "addLine" in b; // W1b: {slotType, ref?, description?, quantity}
  const hasAddSlotOption = "addSlotOption" in b; // W1b: {lineItemId, ref}
  const hasRemoveSlotOption = "removeSlotOptionId" in b; // W1b
  const hasSetOptionClassic = "setOptionClassic" in b; // platter spec: {optionId, classic}

  const concerns = [hasFields, hasActive, hasAddItem, hasRemoveItem, hasAddLine, hasAddSlotOption, hasRemoveSlotOption, hasSetOptionClassic].filter(Boolean).length;
  if (concerns === 0) return jsonError(400, "invalid_payload", { message: "No recognized fields to update" });
  if (concerns > 1) {
    return jsonError(400, "mixed_concerns", { message: "One concern per PATCH: fields, active, addItem, removeItemId, addLine, addSlotOption, removeSlotOptionId, or setOptionClassic" });
  }

  // Step-up tier per concern: active/deactivate = B; everything else = A.
  const tier: StepUpTier = hasActive ? "B" : "A";
  const su = assertStepUp(ctx, tier);
  if (!su.ok) return jsonError(403, su.code);

  try {
    if (hasActive) {
      if (typeof b.active !== "boolean") return jsonError(400, "invalid_payload", { field: "active" });
      await deactivatePackage(ctx, { id, active: b.active });
      return jsonOk({ ok: true });
    }

    if (hasAddItem) {
      const item = b.addItem;
      if (typeof item !== "object" || item === null) return jsonError(400, "invalid_payload", { field: "addItem" });
      const it = item as Record<string, unknown>;
      if (typeof it.description !== "string") return jsonError(400, "invalid_payload", { field: "description" });
      if (typeof it.quantity !== "number") return jsonError(400, "invalid_payload", { field: "quantity" });
      const { id: itemId } = await addPackageLineItem(ctx, {
        packageId: id,
        description: it.description,
        quantity: it.quantity,
      });
      return jsonOk({ id: itemId }, 201);
    }

    if (hasRemoveItem) {
      if (typeof b.removeItemId !== "string") return jsonError(400, "invalid_payload", { field: "removeItemId" });
      await removePackageLineItem(ctx, { itemId: b.removeItemId });
      return jsonOk({ ok: true });
    }

    if (hasAddLine) {
      const line = b.addLine;
      if (typeof line !== "object" || line === null) return jsonError(400, "invalid_payload", { field: "addLine" });
      const l = line as Record<string, unknown>;
      if (l.slotType !== "fixed" && l.slotType !== "choice") return jsonError(400, "invalid_payload", { field: "slotType" });
      if (typeof l.quantity !== "number") return jsonError(400, "invalid_payload", { field: "quantity" });
      const ref = parseRef(l.ref);
      if (l.ref != null && !ref) return jsonError(400, "invalid_payload", { field: "ref" });
      const { id: lineId } = await addPackageLine(ctx, {
        packageId: id,
        slotType: l.slotType as LineSlotType,
        ref,
        description: typeof l.description === "string" ? l.description : null,
        quantity: l.quantity,
      });
      return jsonOk({ id: lineId }, 201);
    }

    if (hasAddSlotOption) {
      const so = b.addSlotOption;
      if (typeof so !== "object" || so === null) return jsonError(400, "invalid_payload", { field: "addSlotOption" });
      const s = so as Record<string, unknown>;
      if (typeof s.lineItemId !== "string") return jsonError(400, "invalid_payload", { field: "lineItemId" });
      const ref = parseRef(s.ref);
      if (!ref) return jsonError(400, "invalid_payload", { field: "ref" });
      const { id: optId } = await addSlotOption(ctx, { lineItemId: s.lineItemId, ref });
      return jsonOk({ id: optId }, 201);
    }

    if (hasRemoveSlotOption) {
      if (typeof b.removeSlotOptionId !== "string") return jsonError(400, "invalid_payload", { field: "removeSlotOptionId" });
      await removeSlotOption(ctx, { optionId: b.removeSlotOptionId });
      return jsonOk({ ok: true });
    }

    if (hasSetOptionClassic) {
      const so = b.setOptionClassic;
      if (typeof so !== "object" || so === null) return jsonError(400, "invalid_payload", { field: "setOptionClassic" });
      const s = so as Record<string, unknown>;
      if (typeof s.optionId !== "string") return jsonError(400, "invalid_payload", { field: "optionId" });
      if (typeof s.classic !== "boolean") return jsonError(400, "invalid_payload", { field: "classic" });
      await setSlotOptionClassic(ctx, { optionId: s.optionId, classic: s.classic });
      return jsonOk({ ok: true });
    }

    // hasFields — edit package fields (Tier A).
    const changes: UpdatePackageChanges = {};
    if ("labelEn" in b) {
      if (typeof b.labelEn !== "string") return jsonError(400, "invalid_payload", { field: "labelEn" });
      changes.labelEn = b.labelEn;
    }
    if ("labelEs" in b) {
      if (b.labelEs !== null && typeof b.labelEs !== "string") return jsonError(400, "invalid_payload", { field: "labelEs" });
      changes.labelEs = b.labelEs as string | null;
    }
    if ("descriptionEn" in b) {
      if (b.descriptionEn !== null && typeof b.descriptionEn !== "string") return jsonError(400, "invalid_payload", { field: "descriptionEn" });
      changes.descriptionEn = b.descriptionEn as string | null;
    }
    if ("descriptionEs" in b) {
      if (b.descriptionEs !== null && typeof b.descriptionEs !== "string") return jsonError(400, "invalid_payload", { field: "descriptionEs" });
      changes.descriptionEs = b.descriptionEs as string | null;
    }
    if ("pricingMode" in b) {
      if (typeof b.pricingMode !== "string") return jsonError(400, "invalid_payload", { field: "pricingMode" });
      changes.pricingMode = b.pricingMode;
    }
    if ("priceCents" in b) {
      if (typeof b.priceCents !== "number") return jsonError(400, "invalid_payload", { field: "priceCents" });
      changes.priceCents = b.priceCents;
    }
    if ("minHeadcount" in b) {
      if (b.minHeadcount !== null && typeof b.minHeadcount !== "number") return jsonError(400, "invalid_payload", { field: "minHeadcount" });
      changes.minHeadcount = b.minHeadcount as number | null;
    }
    if ("leadTimeHours" in b) {
      if (b.leadTimeHours !== null && typeof b.leadTimeHours !== "number") return jsonError(400, "invalid_payload", { field: "leadTimeHours" });
      changes.leadTimeHours = b.leadTimeHours as number | null;
    }
    if ("serves" in b) {
      if (b.serves !== null && typeof b.serves !== "number") return jsonError(400, "invalid_payload", { field: "serves" });
      changes.serves = b.serves as number | null;
    }

    await updatePackage(ctx, { id, changes });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminCateringError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
