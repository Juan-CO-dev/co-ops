/** Client-safe job previews. Project at HTTP and page-prop boundaries; never
 * use these projections as engine evidence or recompute a token from them. */
import type { SwapRequest } from "@/lib/catalog/swap-shared";
import type { RecipeLineFields } from "@/lib/recipe-line-shared";

type Named = { id: string; name: string };
type Blocker = Named & { shopName: string | null; kind: "sku" | "item"; producers?: Array<Named & { ownerLocationId: string | null }> };
export interface PublicSwapPreview {
  request: SwapRequest;
  oldSku: Named & { vendorName: string | null };
  newSku: Named & { vendorName: string | null };
  scopeName: string | null;
  product: { kind: "existing"; id: string; name: string } | { kind: "create"; name: string; nameEs: string | null };
  recipes: Array<{ recipeId: string; recipeName: string; changes: Array<{ position: number; before: RecipeLineFields; after: RecipeLineFields; converted: boolean }> }>;
  refused: Array<{ recipeId: string; recipeName: string; position: number; reason: "unit_unknown" }>;
  followsPrimary: Named[];
  untouchedShops: Named[];
  ordering: { scope: string | null; primarySkuId: string; parsChanged: false; messageKey: "catalog.swap.ordering_consequence" };
  costs: Array<{ menuItemId: string; name: string; nameEs: string | null; before: number | null; after: number | null }>;
  token: string;
}
interface PublicShareCommon {
  name: string; ownerShopId: string; ownerShopName: string | null; token: string;
}
export interface PublicShareSkuPreview extends PublicShareCommon {
  skuId: string; usedIn: Named[]; ownerKeepsOwnPack: boolean; ownerKeepsOwnPrice: boolean;
}
export interface PublicShareRecipePreview extends PublicShareCommon {
  recipeId: string; shopOnlyItems: Named[]; shopOnlySkus: Named[]; makesSandwich: Named | null; blockedBy: Blocker[];
}
export interface PublicShareMenuItemPreview extends PublicShareCommon {
  menuItemId: string; nameEs: string | null; price: number | null; recipes: Named[];
  shopOnlyItems: Named[]; shopOnlySkus: Named[]; blockedBy: Blocker[];
}
export interface PublicBackToNormalPreview {
  swapId: string; oldSku: Named; newSku: Named; shopId: string; shopName: string | null; startedAt: string;
  goingBack: Array<{ recipeId: string; recipeName: string; how: "restore" | "retire" }>;
  kept: Array<{ recipeId: string; recipeName: string }>; primary: "restore" | "changed_since"; token: string;
}
const named = ({ id, name }: Named): Named => ({ id, name });
const blocker = ({ id, name, shopName, kind, producers }: Blocker): Blocker => ({ id, name, shopName, kind,
  ...(producers ? { producers: producers.map(({ id: producerId, name: producerName, ownerLocationId }) => ({ id: producerId, name: producerName, ownerLocationId })) } : {}) });
const line = ({ componentSkuId, componentItemId, componentProductId, quantity, unit, eachContainerLabel, portioned }: RecipeLineFields): RecipeLineFields =>
  ({ componentSkuId, componentItemId, componentProductId, quantity, unit, eachContainerLabel, portioned });
const common = ({ name, ownerShopId, ownerShopName, token }: PublicShareCommon): PublicShareCommon => ({ name, ownerShopId, ownerShopName, token });

export function publicSwapPreview(p: PublicSwapPreview): PublicSwapPreview {
  const { oldSkuId, newSkuId, scope, mode, productName, productNameEs, note } = p.request;
  const { scope: orderScope, primarySkuId, parsChanged, messageKey } = p.ordering;
  return {
    request: { oldSkuId, newSkuId, scope, mode, productName, productNameEs, note },
    oldSku: { ...named(p.oldSku), vendorName: p.oldSku.vendorName },
    newSku: { ...named(p.newSku), vendorName: p.newSku.vendorName }, scopeName: p.scopeName,
    product: p.product.kind === "existing" ? { kind: "existing", id: p.product.id, name: p.product.name }
      : { kind: "create", name: p.product.name, nameEs: p.product.nameEs },
    recipes: p.recipes.map(({ recipeId, recipeName, changes }) => ({ recipeId, recipeName,
      changes: changes.map(({ position, before, after, converted }) => ({ position, before: line(before), after: line(after), converted })) })),
    refused: p.refused.map(({ recipeId, recipeName, position, reason }) => ({ recipeId, recipeName, position, reason })),
    followsPrimary: p.followsPrimary.map(named), untouchedShops: p.untouchedShops.map(named),
    ordering: { scope: orderScope, primarySkuId, parsChanged, messageKey },
    costs: p.costs.map(({ menuItemId, name, nameEs, before, after }) => ({ menuItemId, name, nameEs, before, after })), token: p.token,
  };
}
export function publicShareSkuPreview(p: PublicShareSkuPreview): PublicShareSkuPreview {
  return { ...common(p), skuId: p.skuId, usedIn: p.usedIn.map(named), ownerKeepsOwnPack: p.ownerKeepsOwnPack, ownerKeepsOwnPrice: p.ownerKeepsOwnPrice };
}
export function publicShareRecipePreview(p: PublicShareRecipePreview): PublicShareRecipePreview {
  return { ...common(p), recipeId: p.recipeId, shopOnlyItems: p.shopOnlyItems.map(named), shopOnlySkus: p.shopOnlySkus.map(named),
    makesSandwich: p.makesSandwich ? named(p.makesSandwich) : null, blockedBy: p.blockedBy.map(blocker) };
}
export function publicShareMenuItemPreview(p: PublicShareMenuItemPreview): PublicShareMenuItemPreview {
  return { ...common(p), menuItemId: p.menuItemId, nameEs: p.nameEs, price: p.price, recipes: p.recipes.map(named),
    shopOnlyItems: p.shopOnlyItems.map(named), shopOnlySkus: p.shopOnlySkus.map(named), blockedBy: p.blockedBy.map(blocker) };
}
export function publicBackToNormalPreview(p: PublicBackToNormalPreview): PublicBackToNormalPreview {
  return { swapId: p.swapId, oldSku: named(p.oldSku), newSku: named(p.newSku), shopId: p.shopId, shopName: p.shopName, startedAt: p.startedAt,
    goingBack: p.goingBack.map(({ recipeId, recipeName, how }) => ({ recipeId, recipeName, how })),
    kept: p.kept.map(({ recipeId, recipeName }) => ({ recipeId, recipeName })), primary: p.primary, token: p.token };
}
