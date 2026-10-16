/** Shared HTTP boundary; namespace status mapping belongs to the engine's error classes. */
import type { AuthContext } from "@/lib/session";
import { jsonError, type JsonErrorOptions } from "@/lib/api-helpers";
import { serverT } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/types";
import en from "@/lib/i18n/en.json";
import { ShopOwnedError } from "@/lib/catalog/shop-owned-shared";
import { SwapError } from "@/lib/catalog/swap-shared";
import { AdminSkuError } from "@/lib/admin/skus";
import { PackChainError } from "@/lib/admin/pack-chain";
import { SkuVersionError } from "@/lib/admin/sku-versions";
import { RecipeVersionError } from "@/lib/admin/recipe-versions";
import { RecipeError } from "@/lib/recipes";
import { OrderGuideError } from "@/lib/order-guides";
import { BarcodeError } from "@/lib/barcodes";
import { VendorRhythmError } from "@/lib/vendor-rhythm";
import { AdminToastMapError } from "@/lib/admin/toast-map";
import { logCatalogFailure } from "@/lib/catalog/error-log";
export const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const objectBody = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const token = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 1024;
export const uuidList = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 500 && v.every(uuid);
export function catalogRefusal(ctx: AuthContext, status: number, code: string, details: JsonErrorOptions = {}, namespace = "catalog.error") {
    const keys = [`${namespace}.${code}`, `catalog.error.${code}`, `admin.skus.error.${code}`, `recipes.error.${code}`, `admin.vendors.error.${code}`, `admin.toast.error.${code}`, `admin.toastsales.error.${code}`];
    const key = keys.find(candidate => Object.hasOwn(en, candidate)) ?? "catalog.error.generic";
    return jsonError(status, code, { ...details, message: serverT(ctx.user.language, key as TranslationKey) });
}
export function catalogError(ctx: AuthContext, error: unknown): Response {
    if (error instanceof ShopOwnedError || error instanceof SwapError || error instanceof AdminSkuError
        || error instanceof PackChainError || error instanceof SkuVersionError || error instanceof RecipeVersionError
        || error instanceof RecipeError || error instanceof OrderGuideError || error instanceof BarcodeError
        || error instanceof VendorRhythmError || error instanceof AdminToastMapError) {
        // Never expose Error.message: some existing writers include internal database text.
        const namespace = error instanceof AdminToastMapError ? "admin.toast.error" : error instanceof VendorRhythmError ? "admin.vendors.error" : error instanceof RecipeError ? "recipes.error" : error instanceof AdminSkuError || error instanceof PackChainError ? "admin.skus.error" : "catalog.error";
        return catalogRefusal(ctx, error.status, error.code, {
            ...("field" in error && typeof error.field === "string" ? { field: error.field } : {}),
            ...("line" in error && error.line ? { line: error.line } : {}),
        }, namespace);
    }
    logCatalogFailure(error);
    return catalogRefusal(ctx, 500, "generic");
}
