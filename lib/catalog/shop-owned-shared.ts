/** Catalog ownership contracts. Pure: no session, database, or server-only imports.
 * Owner visibility, authorization to edit, and version/cost scope are separate.
 * These gates do not prove that a shop is active or bind a mutation to its owner:
 * callers must read/validate the shop and compare ownership atomically in SQL.
 */
import type { RoleCode } from "@/lib/roles";
import { recipeVersionWriteGate } from "@/lib/recipe-versions-shared";
import { catalogShopAllowed, catalogWriteRoleAllowed, GLOBAL_VERSION_WRITE_MIN, type VersionScope } from "@/lib/sku-versions-shared";

export const NEW_THING_MIN = 7;
export const SHARE_MIN = GLOBAL_VERSION_WRITE_MIN;
export interface ShopOwnedActor { role: RoleCode; level: number; locations: readonly string[] }

/** Closed application codes; SQL emits shop_owned:<code>[:position].
 * Chunk 2 must pin every actual 0264 refusal to this list; swap has its own namespace.
 */
export const SHOP_OWNED_ERROR_CODES = [
  "forbidden", "not_found", "global_requires_moo", "location_required", "shop_owned_edit_here",
  "location_not_found", "sku_not_found", "vendor_not_found", "name_taken", "ownership_changed",
  "already_shared", "skus_changed", "items_changed", "item_number_taken", "uses_other_shop_sku",
  "uses_shop_only_item", "share_the_sandwich", "share_the_recipe", "invalid_name", "invalid_price",
  "invalid_yield", "incomplete_recipe", "invalid_payload", "line_other_shop", "output_other_shop",
  "global_recipe_makes_shop_item", "recipe_has_no_shop_versions", "menu_item_has_no_shop_settings",
  "toast_other_shop", "owner_is_set_at_creation", "owned_not_catering",
] as const;
export type ShopOwnedErrorCode = typeof SHOP_OWNED_ERROR_CODES[number];
type RefusalStatus = 400 | 403 | 404 | 409;
export type OwnerRefusal = { ok: false; status: RefusalStatus; code: ShopOwnedErrorCode };
type Gate = { ok: true } | OwnerRefusal;

const RPC_STATUS: Record<ShopOwnedErrorCode, RefusalStatus> = {
  forbidden: 403, not_found: 404, global_requires_moo: 403, location_required: 400, shop_owned_edit_here: 409,
  location_not_found: 404, sku_not_found: 404, vendor_not_found: 404, name_taken: 409, ownership_changed: 409,
  already_shared: 409, skus_changed: 409, items_changed: 409, item_number_taken: 409, uses_other_shop_sku: 409,
  uses_shop_only_item: 409, share_the_sandwich: 409, share_the_recipe: 409, invalid_name: 400, invalid_price: 400,
  invalid_yield: 400, incomplete_recipe: 400, invalid_payload: 400, line_other_shop: 400, output_other_shop: 400,
  global_recipe_makes_shop_item: 400, recipe_has_no_shop_versions: 409, menu_item_has_no_shop_settings: 409,
  toast_other_shop: 400, owner_is_set_at_creation: 400, owned_not_catering: 400,
};
function refusal(code: ShopOwnedErrorCode): OwnerRefusal {
  return { ok: false, status: RPC_STATUS[code], code };
}
function canWrite(actor: Pick<ShopOwnedActor, "role" | "level">): boolean {
  return actor.role !== "social_media_mgr" && actor.level >= NEW_THING_MIN && catalogWriteRoleAllowed(actor.role, actor.level);
}

/** Missing owner is compatible with pre-0264 projections; loaders must select ownership after cutover. */
export function ownerVisible(owner: string | null | undefined, scope: VersionScope): boolean {
  return owner == null || owner === scope;
}
/** The map must describe the complete entity universe; an absent entry means shared. */
export function filterOwnedEntities<E extends { id: string }>(entities: readonly E[], owners: ReadonlyMap<string, string>, scope: VersionScope): E[] {
  return entities.filter(e => ownerVisible(owners.get(e.id), scope));
}

export function newThingScopeGate(actor: ShopOwnedActor, scope: VersionScope): Gate {
  if (!canWrite(actor)) return refusal("forbidden");
  if (scope === null) return actor.level >= SHARE_MIN ? { ok: true } : refusal("global_requires_moo");
  return catalogShopAllowed(actor, scope) ? { ok: true } : refusal("not_found");
}

/** Only omission can infer a sole membership. Global creation requires explicit null. */
export function creationScope(actor: ShopOwnedActor, requested?: VersionScope): { ok: true; scope: VersionScope } | OwnerRefusal {
  if (!canWrite(actor)) return refusal("forbidden");
  let scope = requested;
  if (scope === undefined) {
    const memberships = [...new Set(actor.locations)];
    if (memberships.length !== 1) return refusal("location_required");
    scope = memberships[0]!;
  }
  if (scope !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scope)) {
    return refusal("invalid_payload");
  }
  const gate = newThingScopeGate(actor, scope);
  return gate.ok ? { ok: true, scope } : gate;
}

/** Before I/O: a GM requesting a direct edit must still pass ownerWriteCheck after the read. */
export function ownedAwareRecipeGate(input: {
  role: RoleCode; level: number; scope: VersionScope; scopeAllowed: boolean;
}): { ok: true; ownerCheck: boolean } | OwnerRefusal {
  if (!canWrite(input)) return refusal("forbidden");
  const base = recipeVersionWriteGate(input);
  if (base.ok) return { ok: true, ownerCheck: false };
  if (input.scope === null && base.code === "global_requires_moo") return { ok: true, ownerCheck: true };
  return base;
}

/** After I/O: a shared default stays MoO+; owning GM may directly edit an owned entity. */
export function ownerWriteCheck(actor: ShopOwnedActor, owner: string | null): Gate {
  if (!canWrite(actor)) return refusal("forbidden");
  if (actor.level >= SHARE_MIN) return { ok: true };
  if (owner === null) return refusal("global_requires_moo");
  return catalogShopAllowed(actor, owner) ? { ok: true } : refusal("not_found");
}
export function ownedRecipeScopeRefusal(owner: string | null, scope: VersionScope): OwnerRefusal | null {
  if (owner === null || scope === null) return null;
  return refusal(scope === owner ? "shop_owned_edit_here" : "not_found");
}
export function shareGate(actor: Pick<ShopOwnedActor, "role" | "level">): Gate {
  if (!canWrite(actor)) return refusal("forbidden");
  return actor.level >= SHARE_MIN ? { ok: true } : refusal("global_requires_moo");
}

/** One-based ingredient positions. Ownership maps contain owned rows only; existence is checked separately. */
export function linesOwnedElsewhere(
  lines: ReadonlyArray<{ componentSkuId: string | null; componentItemId: string | null }>,
  owners: { skus: ReadonlyMap<string, string>; items: ReadonlyMap<string, string> },
  scope: VersionScope,
): number[] {
  return lines.flatMap((line, i) => {
    const skuOwner = line.componentSkuId === null ? undefined : owners.skus.get(line.componentSkuId);
    const itemOwner = line.componentItemId === null ? undefined : owners.items.get(line.componentItemId);
    return ownerVisible(skuOwner, scope) && ownerVisible(itemOwner, scope) ? [] : [i + 1];
  });
}

export class ShopOwnedError extends Error {
  constructor(public status: RefusalStatus, public code: ShopOwnedErrorCode, message?: string,
    public line?: { position: number; name?: string; reason: ShopOwnedErrorCode }) {
    super(message ?? code);
    this.name = "ShopOwnedError";
  }
}

/** Parse the ownership namespace once. Unknown/malformed refusals remain server errors. */
export function shopOwnedErrorFromRpc(message: string): never {
  const match = /^shop_owned:([a-z_]+)(?::([1-9][0-9]*))?$/.exec(message);
  const code = SHOP_OWNED_ERROR_CODES.find(code => code === match?.[1]);
  const position = match?.[2] === undefined ? undefined : Number(match[2]);
  if (!code || (position !== undefined && (!Number.isSafeInteger(position) || code !== "line_other_shop"))) throw new Error(message);
  throw new ShopOwnedError(RPC_STATUS[code], code, undefined,
    position === undefined ? undefined : { position, reason: code });
}
