/** Atomic SKU/first pack/first price creation, followed by independent existing setup writers. */
import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { loadMeasureLabels, loadMeasuresMap, validateSubmission } from "@/lib/admin/pack-chain";
import { rpcLevels, versionErrorFromRpc } from "@/lib/admin/sku-versions";
import { AdminSkuError, upsertLocationSkuSettings } from "@/lib/admin/skus";
import { setVendorRhythmPair } from "@/lib/vendor-rhythm";
import { applyGuideEdit, createEmptyGuide, loadOrderGuide, ORDER_GUIDE_EDIT_MIN, OrderGuideError, saveOrderGuide } from "@/lib/order-guides";
import { recipeVersionErrorFromRpc, saveRecipeLines } from "@/lib/admin/recipe-versions";
import { teachBarcode } from "@/lib/barcodes";
import { creationScope, NEW_THING_MIN, ownerVisible, ShopOwnedError, shopOwnedErrorFromRpc } from "@/lib/catalog/shop-owned-shared";
import { parseNewItemRequest, parseSetupStep, type NewItemRequest, type SetupStep } from "@/lib/catalog/new-item-shared";
import { logCatalogFailure } from "@/lib/catalog/error-log";
import en from "@/lib/i18n/en.json";

function requireLocation(actor: AuthContext, requested?: string | null): string | null {
  const gate = creationScope({ role: actor.user.role, level: actor.level, locations: actor.locations }, requested);
  if (!gate.ok) throw new ShopOwnedError(gate.status, gate.code);
  return gate.scope;
}

function requireActor(actor: AuthContext): void {
  if (actor.level < NEW_THING_MIN || actor.user.role === "social_media_mgr") throw new ShopOwnedError(403, "forbidden");
}

function setupRefusal(error: unknown): { status: number; code: string; messageKey: string } {
  const named = error as { status?: unknown; code?: unknown } | null;
  if (typeof named?.status === "number" && named.status >= 400 && named.status < 500 && typeof named.code === "string") {
    const vendorKey = `admin.vendors.error.${named.code}`;
    const catalogKey = `catalog.error.${named.code}`;
    return { status: named.status, code: named.code, messageKey: Object.hasOwn(en, vendorKey) ? vendorKey : Object.hasOwn(en, catalogKey) ? catalogKey : "catalog.error.generic" };
  }
  logCatalogFailure(error);
  return { status: 500, code: "generic", messageKey: "catalog.error.generic" };
}

export interface CreatedItem { skuId: string; ownerLocationId: string | null; replayed: boolean }

/** No setup write is part of this transaction. The returned identity is already committed. */
export async function createCatalogItem(actor: AuthContext, input: NewItemRequest): Promise<CreatedItem> {
  requireActor(actor);
  const parsed = parseNewItemRequest(input);
  if (!parsed.ok) throw new AdminSkuError(400, parsed.code, parsed.field);
  const req = parsed.request;
  const scope = requireLocation(actor, req.scope);
  const [labels, measures] = await Promise.all([loadMeasureLabels(), loadMeasuresMap()]);
  const levels = validateSubmission(req.levels, labels, measures, req.avgOzPerEach, req.skuClass);
  const pack = { levels: rpcLevels(levels) };
  const price = { unitPrice: req.unitPrice, effectiveDate: req.priceDate };
  const { data, error } = await getServiceRoleClient().rpc("create_catalog_sku", {
    p_sku: { request_id: req.request_id, name: req.name, vendorId: req.vendorId, itemNumber: req.itemNumber, skuClass: req.skuClass, avgOzPerEach: req.avgOzPerEach },
    p_pack: pack, p_price: price, p_actor: actor.user.id, p_location_id: scope,
  });
  if (error) {
    if (error.message.startsWith("shop_owned:")) shopOwnedErrorFromRpc(error.message);
    if (error.message.startsWith("recipe_version:")) recipeVersionErrorFromRpc(error.message, error.code);
    versionErrorFromRpc(error.message);
  }
  const result = data as { id: string; replayed?: boolean; location_id?: string | null } | null;
  if (!result || typeof result.id !== "string") throw new Error("create_catalog_sku returned no committed identity");
  // Record initial facts only on creation; replay returns the current identity/owner,
  // without claiming pack/price row identities or an audit transaction guarantee.
  if (!result.replayed) await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "vendor_item.create", resourceTable: "vendor_items", resourceId: result.id,
    metadata: { name: req.name, vendor_id: req.vendorId, item_number: req.itemNumber, location_id: scope, job: "new_item", initial_pack: pack, initial_price: price, avg_oz_per_each: req.avgOzPerEach },
    ipAddress: null, userAgent: null });
  return { skuId: result.id, ownerLocationId: result.location_id === undefined ? scope : result.location_id, replayed: result.replayed === true };
}

export type OrderDayOutcome = { orderDow: number; leadDays: number } & (
  { ok: true; pairId: string } | { ok: false; status: number; code: string; messageKey: string; refreshRequired: boolean }
);
export interface SetupResult { step: SetupStep["kind"]; ok: boolean; detail: Record<string, unknown> }

/** ONE setup step. A multi-day rhythm step reports EACH independent writer outcome. */
export async function setUpItemAtShop(actor: AuthContext, input: { skuId: string; shopId: string; step: SetupStep }): Promise<SetupResult> {
  requireActor(actor);
  const parsed = parseSetupStep(input);
  if (!parsed.ok || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.skuId)) throw new ShopOwnedError(400, "invalid_payload");
  requireLocation(actor, parsed.shopId);
  const sb = getServiceRoleClient();
  const { data: sku, error } = await sb.from("vendor_items").select("id, name, vendor_id, location_id, item_number, active").eq("id", input.skuId)
    .maybeSingle<{ id: string; name: string; vendor_id: string | null; location_id: string | null; item_number: string | null; active: boolean }>();
  if (error) throw new Error(`setUpItemAtShop: ${error.message}`);
  if (!sku || !sku.active || !ownerVisible(sku.location_id, input.shopId)) throw new ShopOwnedError(404, "sku_not_found");
  const step = parsed.step;
  switch (step.kind) {
    case "par":
      // Retry a failed first save with the same empty baseline. Once saved, edit
      // through the normal overlay writer with the freshly read baseline.
      await upsertLocationSkuSettings(actor, { skuId: sku.id, locationId: input.shopId, activeOverride: null, weekdayPar: step.weekdayPar, weekendPar: step.weekendPar, expected: { activeOverride: null, weekdayPar: null, weekendPar: null } });
      return { step: step.kind, ok: true, detail: { weekdayPar: step.weekdayPar, weekendPar: step.weekendPar } };
    case "order_days": {
      if (!sku.vendor_id) throw new AdminSkuError(400, "needs_vendor", "Choose a vendor first");
      const outcomes: OrderDayOutcome[] = [];
      for (const day of step.days) {
        try {
          const pair = await setVendorRhythmPair(actor, { vendorId: sku.vendor_id, locationId: input.shopId, ...day });
          outcomes.push({ ...day, ok: true, pairId: pair.id });
        } catch (error) {
          // No internal exception text or SQL is exposed. Earlier days may have
          // committed even if this writer failed; callers must show this ledger.
          const refusal = setupRefusal(error);
          // An unknown failure may follow a committed insert. Refresh the
          // rhythm before retrying instead of treating it as rolled back.
          outcomes.push({ ...day, ok: false, ...refusal, refreshRequired: refusal.status === 500 });
        }
      }
      return { step: step.kind, ok: outcomes.every(outcome => outcome.ok), detail: { outcomes } };
    }
    case "guide_line": {
      if (actor.level < ORDER_GUIDE_EDIT_MIN) throw new ShopOwnedError(403, "forbidden");
      if (!sku.vendor_id) throw new AdminSkuError(400, "needs_vendor", "Choose a vendor first");
      // A filtered shop guide must never be submitted as a complete editor model.
      const existingGuide = await loadOrderGuide(sku.vendor_id);
      if (!existingGuide && step.sectionId !== null) throw new OrderGuideError(404, "section_not_found", "That section is not on this vendor guide");
      const guide = existingGuide ?? await createEmptyGuide(actor, sku.vendor_id);
      try {
        let next = guide, sectionId = step.sectionId;
        if (step.newSectionName !== null) {
          next = applyGuideEdit(next, { kind: "add_section", name: step.newSectionName });
          sectionId = next.sections.at(-1)!.id;
        }
        next = applyGuideEdit(next, { kind: "add_line", sectionId: sectionId!, skuId: sku.id, label: sku.name, itemNumber: sku.item_number });
        const saved = await saveOrderGuide(actor, sku.vendor_id, next, guide.updatedAt);
        return { step: step.kind, ok: true, detail: { guideId: saved.guideId, guideCreated: existingGuide === null, lineSaved: true } };
      } catch (error) {
        if (existingGuide !== null) throw error;
        const refusal = setupRefusal(error);
        return { step: step.kind, ok: false, detail: { guideId: guide.guideId, guideCreated: true, lineSaved: refusal.status === 500 ? null : false, refreshRequired: refusal.status === 500, ...refusal } };
      }
    }
    case "use_in": {
      const { data: recipe, error: recipeError } = await sb.from("recipes").select("id, location_id, active").eq("id", step.recipeId).maybeSingle<{ id: string; location_id: string | null; active: boolean }>();
      if (recipeError) throw new Error(`setUpItemAtShop recipe: ${recipeError.message}`);
      if (!recipe || !recipe.active || !ownerVisible(recipe.location_id, input.shopId)) throw new ShopOwnedError(404, "not_found");
      const saved = await saveRecipeLines(actor, { recipeId: recipe.id, scope: recipe.location_id === input.shopId ? null : input.shopId, expectedVersionId: step.expectedVersionId, basedOnVersionId: step.basedOnVersionId,
        op: { kind: "add", line: { componentSkuId: sku.id, componentItemId: null, componentProductId: null, quantity: step.quantity, unit: step.unit, eachContainerLabel: null, portioned: false } } });
      return { step: step.kind, ok: true, detail: { recipeId: recipe.id, versionId: saved.versionId, changed: saved.changed } };
    }
    case "barcode": {
      if (!sku.vendor_id) throw new AdminSkuError(400, "needs_vendor", "Choose a vendor first");
      const saved = await teachBarcode(actor, { vendorId: sku.vendor_id, locationId: input.shopId, code: step.code, skuId: sku.id, level: step.level });
      return { step: step.kind, ok: true, detail: { created: saved.created } };
    }
  }
}
