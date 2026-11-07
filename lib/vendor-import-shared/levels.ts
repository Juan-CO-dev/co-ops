import { getRoleLevel, type RoleCode } from "@/lib/roles";
import { catalogShopAllowed } from "@/lib/sku-versions-shared";

/** GM stages and applies to their shop; AGM could not stage before and still cannot. */
export const VENDOR_IMPORT_STAGE_MIN = 7;
export const VENDOR_IMPORT_SHOP_APPLY_MIN = 7;
export const VENDOR_IMPORT_APPLY_MIN = 9;
export const VENDOR_IMPORT_GLOBAL_STAGE_MIN = 8;

export function vendorImportScopeAllowed(
  actor: { role: RoleCode; locations: readonly string[] },
  shopId: string | null,
  mode: "stage" | "apply" = "stage",
): boolean {
  if (actor.role === "social_media_mgr") return false;
  const level = getRoleLevel(actor.role);
  if (shopId === null) return level >= (mode === "apply" ? VENDOR_IMPORT_APPLY_MIN : VENDOR_IMPORT_GLOBAL_STAGE_MIN);
  return level >= (mode === "apply" ? VENDOR_IMPORT_SHOP_APPLY_MIN : VENDOR_IMPORT_STAGE_MIN)
    && catalogShopAllowed({ level, locations: actor.locations }, shopId);
}
