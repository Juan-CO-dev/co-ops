/** Swap preview uses the production graph; SQL owns atomic comparison and restoration. */
import "server-only";
import { randomUUID } from "node:crypto";
import type { AuthContext } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { newThingScopeGate, ShopOwnedError } from "@/lib/catalog/shop-owned-shared";
import { catalogShopAllowed } from "@/lib/sku-versions-shared";
import { parseSwapRequest, swapLine, SwapError, swapErrorFromRpc, type SwapRequest } from "@/lib/catalog/swap-shared";
import { recipeVersionErrorFromRpc } from "@/lib/admin/recipe-versions";
import { lineFromRow, lineToRow, type RecipeLineRow, type RecipeLineFields } from "@/lib/recipe-line-shared";
import type { RecipeVersionLineRow } from "@/lib/recipe-versions-shared";
import { loadProductIndex, type ProductProposal } from "@/lib/products";
import { loadRecipeGraph } from "@/lib/prep-consumption";
import { loadCurrentSkuPrices } from "@/lib/admin/cost";
import { ozForRecipeInput } from "@/lib/recipe-math";
import { costPerOzFromGraph, rollupMenuItemCost } from "@/lib/menu-costing-shared";
import { previewToken } from "@/lib/catalog/change-preview-shared";
import { selectAllRows } from "@/lib/supabase-paginate";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Named = { id: string; name: string };
type Sku = Named & { product_id: string | null; location_id: string | null; active: boolean; vendor_id: string | null; inventory_only?: boolean };
type Primary = { id: string; primary_sku_id: string; revision: number | string; note: string | null; updated_by: string | null; location_id: string | null };
export interface SwapProductSnapshot {
 old_sku: Sku | null; new_sku: Sku | null; product: (Named & { active: boolean }) | null;
 scoped_primary: Primary | null; default_primary: Primary | null;
 measures: Record<string, unknown>[]; receipts: Record<string, unknown>[];
 packs: Record<string, unknown>[]; pack_levels: Record<string, unknown>[]; price_lanes: Record<string, unknown>[]; prices: Record<string, unknown>[];
 members: Sku[]; settings: Array<{ sku_id: string; active_override: boolean | null }>;
 vendors: Array<Named & { active: boolean }>; location: (Named & { active: boolean }) | null;
}
export interface SwapRecipeSnapshot {
 recipe_id: string; version_id: string; own_version_id: string | null;
 lines: RecipeLineRow[]; snapshot: Record<string, unknown>; write_scope: string | null;
}
type PreparedRecipe = SwapRecipeSnapshot & { replacement_lines: RecipeLineRow[] };
function requireLocation(actor: AuthContext, scope: string | null) {
 const gate = newThingScopeGate({ role: actor.user.role, level: getRoleLevel(actor.user.role), locations: actor.locations }, scope);
 if (!gate.ok) throw new ShopOwnedError(gate.status, gate.code);
}
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
 const { data, error } = await getServiceRoleClient().rpc(name, args);
 if (error) {
  if (error.message.includes("swap:")) swapErrorFromRpc(error.message);
  recipeVersionErrorFromRpc(error.message, error.code);
 }
 if (data == null) throw new Error(`${name}: missing result`);
 return data as T;
}
async function rows<T>(table: string, columns: string): Promise<T[]> {
 return selectAllRows<T>((from, to) => getServiceRoleClient().from(table).select(columns).order("id").range(from, to).returns<T[]>());
}
export interface SwapPreview {
 request: SwapRequest; oldSku: Named & { vendorName: string | null }; newSku: Named & { vendorName: string | null };
 scopeName: string | null; product: { kind: "existing"; id: string; name: string } | { kind: "create"; name: string; nameEs: string | null };
 productSnapshot: SwapProductSnapshot; recipeSnapshots: PreparedRecipe[];
 recipes: Array<{ recipeId: string; recipeName: string; changes: Array<{ position: number; before: RecipeLineFields; after: RecipeLineFields; converted: boolean }> }>;
 refused: Array<{ recipeId: string; recipeName: string; position: number; reason: "unit_unknown" }>;
 followsPrimary: Named[]; untouchedShops: Named[];
 costs: Array<{ menuItemId: string; name: string; nameEs: string | null; before: number | null; after: number | null }>; token: string;
}
export async function previewSkuSwap(actor: AuthContext, req: SwapRequest): Promise<SwapPreview> {
 requireLocation(actor, req.scope);
 const parsed = parseSwapRequest(req, req.oldSkuId);
 if (!parsed.ok) throw new SwapError(400, "invalid_payload");
 req = parsed.request;
 const args = { p_old: req.oldSkuId, p_new: req.newSkuId, p_location: req.scope };
 // Product evidence is mandatory even with an empty recipe set.
 const productSnapshot = await rpc<SwapProductSnapshot>("sku_swap_product_snapshot", args);
 const old = productSnapshot.old_sku, neu = productSnapshot.new_sku;
 const usable = (s: Sku | null): s is Sku => !!s && s.active && !s.inventory_only && (s.location_id == null || s.location_id === req.scope);
 if (!usable(old) || !usable(neu) || (req.scope !== null && !productSnapshot.location?.active)
  || productSnapshot.settings.some(s => s.sku_id === req.newSkuId && s.active_override === false)
  || productSnapshot.vendors.some(v => v.id === neu.vendor_id && !v.active)) throw new SwapError(400, "replacement_ineligible");
 if (old.product_id && neu.product_id && old.product_id !== neu.product_id) throw new SwapError(409, "in_other_product");
 if (productSnapshot.product && !productSnapshot.product.active) throw new SwapError(400, "replacement_ineligible");
 const product: SwapPreview["product"] = productSnapshot.product
  ? { kind: "existing", id: productSnapshot.product.id, name: productSnapshot.product.name }
  : { kind: "create", name: req.productName ?? old.name, nameEs: req.productNameEs };
 const request = { ...req, productName: product.kind === "create" ? product.name : null, productNameEs: product.kind === "create" ? product.nameEs : null };
 const eligibilityProposal: ProductProposal = product.kind === "existing"
  ? { productId: product.id, primarySkuId: neu.id, joinSkuIds: [old, neu].filter(s => !s.product_id).map(s => s.id) }
  : { productId: randomUUID(), primarySkuId: neu.id, joinSkuIds: [old.id, neu.id], draftProduct: { name: product.name, unitOz: null } };
 const eligible = await loadProductIndex([eligibilityProposal.productId], req.scope, { proposal: eligibilityProposal });
 if (eligible.index.resolution.get(eligibilityProposal.productId)?.skuId !== neu.id) throw new SwapError(400, "replacement_ineligible");
 const captured = await rpc<SwapRecipeSnapshot[]>("sku_swap_recipe_snapshot", args);
 const recs = await rows<Named>("recipes", "id,name");
 const nameOf = (id: string) => recs.find(r => r.id === id)?.name ?? "";
 const probe = { recipeId: randomUUID(), batchYield: 1, outputs: [], inputs: [old.id, neu.id].map(id => ({ componentSkuId: id, componentItemId: null, componentProductId: null, quantity: 1, unit: "oz" })) };
 const before = await loadRecipeGraph({ locationId: req.scope, draftRecipes: [probe] });
 const ozOf = (id: string) => (unit: string) => { const pack = before.skuPack.get(id); return pack ? ozForRecipeInput(1, unit, pack, before.measures) : null; };
 const ctx = { isMeasure: (unit: string) => before.measures.has(unit), oldOz: ozOf(old.id), newOz: ozOf(neu.id) };
 const refused: SwapPreview["refused"] = [], recipes: SwapPreview["recipes"] = [], followsPrimary: Named[] = [];
 const recipeSnapshots = captured.map(r => {
  const changes: SwapPreview["recipes"][number]["changes"] = [];
  const replacement_lines = r.lines.map((row, index) => {
   const line = lineFromRow(row);
   if (line.componentSkuId !== old.id) return row;
   const result = swapLine(line, neu.id, ctx);
   if (!result.ok) { refused.push({ recipeId: r.recipe_id, recipeName: nameOf(r.recipe_id), position: index + 1, reason: result.reason }); return row; }
   changes.push({ position: index + 1, before: line, after: result.line, converted: result.converted });
   return lineToRow(result.line);
  });
  if (changes.length) recipes.push({ recipeId: r.recipe_id, recipeName: nameOf(r.recipe_id), changes });
  else followsPrimary.push({ id: r.recipe_id, name: nameOf(r.recipe_id) });
  return { ...r, replacement_lines };
 });
 const overrides = new Map(recipeSnapshots.map(r => [r.recipe_id, r.replacement_lines.map((line, i): RecipeVersionLineRow => ({ ...line, id: `swap-${i}`, version_id: "swap", recipe_id: r.recipe_id, display_order: i }))]));
 const proposal = product.kind === "existing" ? eligibilityProposal : undefined;
 const after = await loadRecipeGraph({ locationId: req.scope, recipeOverrides: overrides, productProposal: proposal });
 const prices = await loadCurrentSkuPrices([...new Set([...before.skuPack.keys(), ...after.skuPack.keys()])], req.scope);
 const bp = costPerOzFromGraph(before, prices), ap = costPerOzFromGraph(after, prices);
 const menus = await rows<Named & { name_es: string | null }>("menu_items", "id,name,name_es");
 const costs = menus.filter(m => after.byOutputMenuItem.has(m.id)).map(m => ({ menuItemId: m.id, name: m.name, nameEs: m.name_es,
  before: rollupMenuItemCost(before, m.id, bp).cost, after: rollupMenuItemCost(after, m.id, ap).cost })).filter(m => m.before !== m.after);
 const shops = await rows<Named>("locations", "id,name");
 const versions = req.scope === null ? await rows<{ recipe_id: string; location_id: string | null; active: boolean }>("recipe_versions", "id,recipe_id,location_id,active") : [];
 const keptShopIds = new Set(versions.filter(v => v.active && v.location_id && captured.some(r => r.recipe_id === v.recipe_id)).map(v => v.location_id));
 // A preview assembled across reads must describe one stable dependency state.
 const [productEnd, recipesEnd] = await Promise.all([
  rpc<SwapProductSnapshot>("sku_swap_product_snapshot", args), rpc<SwapRecipeSnapshot[]>("sku_swap_recipe_snapshot", args),
 ]);
 if (previewToken(productEnd) !== previewToken(productSnapshot)) throw new SwapError(409, "product_changed");
 if (previewToken(recipesEnd) !== previewToken(captured)) throw new SwapError(409, "recipes_changed");
 const vendorName = (id: string | null) => productSnapshot.vendors.find(v => v.id === id)?.name ?? null;
 const body = { request, oldSku: { id: old.id, name: old.name, vendorName: vendorName(old.vendor_id) }, newSku: { id: neu.id, name: neu.name, vendorName: vendorName(neu.vendor_id) },
  scopeName: shops.find(s => s.id === req.scope)?.name ?? null, product, productSnapshot, recipeSnapshots, recipes, refused, followsPrimary, untouchedShops: shops.filter(s => keptShopIds.has(s.id)), costs };
 return { ...body, token: previewToken({ request, productSnapshot, recipeSnapshots, refused, costs }) };
}
export interface SwapStarted { swapId: string; productId: string; versions: Array<{ recipeId: string; versionId: string }> }
export async function startSkuSwap(actor: AuthContext, req: SwapRequest, token: string): Promise<SwapStarted> {
 requireLocation(actor, req.scope);
 const p = await previewSkuSwap(actor, req);
 if (p.token !== token) throw new SwapError(409, "preview_stale");
 if (p.refused.length) throw new SwapError(400, "unit_unknown");
 const r = await rpc<{ swap_id: string; product_id: string; recipes: Array<{ recipe_id: string; version_id: string }> }>("start_sku_swap", {
  p_old: p.request.oldSkuId, p_new: p.request.newSkuId, p_location: p.request.scope, p_actor: actor.user.id,
  p_product_snapshot: p.productSnapshot, p_recipes: p.recipeSnapshots, p_temporary: p.request.mode === "for_now", p_note: p.request.note,
  p_product: p.product.kind === "create" ? { name: p.product.name, name_es: p.product.nameEs } : null,
 });
 await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "vendor_item.update", resourceTable: "sku_swaps", resourceId: r.swap_id,
  metadata: { operation: "swap_start", location_id: req.scope, product_id: r.product_id, recipes: r.recipes }, ipAddress: null, userAgent: null });
 return { swapId: r.swap_id, productId: r.product_id, versions: r.recipes.map(v => ({ recipeId: v.recipe_id, versionId: v.version_id })) };
}
type Journal = { id: string; old_sku_id: string; new_sku_id: string; location_id: string | null; temporary: boolean; created_at: string;
 primary_after: Primary; recipes: Array<PreparedRecipe & { after_version_id: string; unchanged?: boolean }> };
export interface BackToNormalPreview {
 swapId: string; oldSku: Named; newSku: Named; shopId: string; shopName: string | null; startedAt: string;
 goingBack: Array<{ recipeId: string; recipeName: string; how: "restore" | "retire" }>;
 kept: Array<{ recipeId: string; recipeName: string }>; primary: "restore" | "changed_since"; token: string;
}
export async function previewBackToNormal(actor: AuthContext, swapId: string): Promise<BackToNormalPreview> {
 // The journal supplies scope, but role authority is checked before that opaque-id lookup.
 if (getRoleLevel(actor.user.role) < 7 || actor.user.role === "social_media_mgr") throw new ShopOwnedError(403, "forbidden");
 if (!UUID.test(swapId)) throw new SwapError(400, "invalid_payload");
 const sb = getServiceRoleClient();
 const { data: journal, error } = await sb.from("sku_swaps").select("*").eq("id", swapId).maybeSingle<Journal>();
 if (error) throw new Error(`swap journal: ${error.message}`);
 if (!journal || !journal.location_id || !catalogShopAllowed({ level: getRoleLevel(actor.user.role), locations: actor.locations }, journal.location_id)) throw new SwapError(404, "swap_not_found");
 requireLocation(actor, journal.location_id);
 const { data: ended, error: endError } = await sb.from("sku_swap_ends").select("id").eq("swap_id", swapId).maybeSingle();
 if (endError) throw new Error(`swap end: ${endError.message}`);
 if (ended || !journal.temporary) throw new SwapError(409, "not_live");
 const [versions, recs, skus, shops, primaries] = await Promise.all([
  rows<{ id: string; recipe_id: string; location_id: string | null; active: boolean }>("recipe_versions", "id,recipe_id,location_id,active"),
  rows<Named>("recipes", "id,name"), rows<Named>("vendor_items", "id,name"), rows<Named>("locations", "id,name"),
  rows<Primary>("product_primaries", "id,primary_sku_id,revision"),
 ]);
 const nameOf = (id: string) => recs.find(r => r.id === id)?.name ?? "";
 const goingBack: BackToNormalPreview["goingBack"] = [], kept: BackToNormalPreview["kept"] = [];
 for (const r of journal.recipes) {
  if (r.unchanged) continue;
  if (!versions.some(v => v.id === r.after_version_id && v.active)) { kept.push({ recipeId: r.recipe_id, recipeName: nameOf(r.recipe_id) }); continue; }
  const defaultUnchanged = versions.some(v => v.id === r.version_id && v.location_id === null && v.active);
  goingBack.push({ recipeId: r.recipe_id, recipeName: nameOf(r.recipe_id), how: !r.own_version_id && defaultUnchanged ? "retire" : "restore" });
 }
 const after = journal.primary_after;
 const primary = primaries.some(p => p.id === after.id && String(p.revision) === String(after.revision) && p.primary_sku_id === after.primary_sku_id) ? "restore" as const : "changed_since" as const;
 const body = { swapId, oldSku: skus.find(s => s.id === journal.old_sku_id) ?? { id: journal.old_sku_id, name: "" }, newSku: skus.find(s => s.id === journal.new_sku_id) ?? { id: journal.new_sku_id, name: "" },
  shopId: journal.location_id, shopName: shops.find(s => s.id === journal.location_id)?.name ?? null, startedAt: journal.created_at, goingBack, kept, primary };
 return { ...body, token: previewToken({ journal, goingBack, kept, primary }) };
}
export async function endSkuSwap(actor: AuthContext, swapId: string, token: string): Promise<{ back: string[]; kept: string[]; primary: string; grouping: string }> {
 const p = await previewBackToNormal(actor, swapId);
 requireLocation(actor, p.shopId);
 if (p.token !== token) throw new SwapError(409, "preview_stale");
 // SQL locks before comparing journal effects, including edits after this preview.
 const r = await rpc<{ recipes: Array<{ recipe_id: string; outcome: string }>; primary: string; grouping: string }>("end_sku_swap", { p_swap: swapId, p_actor: actor.user.id });
 const result = { back: r.recipes.filter(v => v.outcome === "restored").map(v => v.recipe_id), kept: r.recipes.filter(v => v.outcome === "changed_since").map(v => v.recipe_id), primary: r.primary, grouping: r.grouping };
 await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "vendor_item.update", resourceTable: "sku_swaps", resourceId: swapId,
  metadata: { operation: "swap_end", location_id: p.shopId, ...result }, ipAddress: null, userAgent: null });
 return result;
}
export async function loadLiveSwapsForItem(actor: AuthContext, skuId: string, shopId: string): Promise<Array<{ swapId: string; oldSkuId: string; newSkuId: string; startedAt: string }>> {
 if (getRoleLevel(actor.user.role) < 6 || !catalogShopAllowed({ level: getRoleLevel(actor.user.role), locations: actor.locations }, shopId)) throw new ShopOwnedError(404, "not_found");
 if (!UUID.test(skuId) || !UUID.test(shopId)) throw new SwapError(400, "invalid_payload");
 const [journals, ends] = await Promise.all([rows<Journal>("sku_swaps", "*"), rows<{ swap_id: string }>("sku_swap_ends", "id,swap_id")]);
 return journals.filter(j => j.temporary && j.location_id === shopId && !ends.some(e => e.swap_id === j.id) && (j.old_sku_id === skuId || j.new_sku_id === skuId))
 .map(j => ({ swapId: j.id, oldSkuId: j.old_sku_id, newSkuId: j.new_sku_id, startedAt: j.created_at }));
}
