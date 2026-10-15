import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { SHOP_OWNED_ERROR_CODES } from "@/lib/catalog/shop-owned-shared";
import { resolveErrorKey } from "@/components/admin/recipes/shared";

describe("shop-owned refusal translations", () => {
  it("keeps the catalog refusal keys identical in English and Spanish", () => {
    const keys = (dictionary: Record<string, string>) => Object.keys(dictionary)
      .filter(key => key.startsWith("catalog.error.")).sort();
    expect(keys(en)).toEqual(keys(es));
  });

  it.each(SHOP_OWNED_ERROR_CODES)("renders %s through the catalog namespace in both languages", code => {
    const key = `catalog.error.${code}`;
    for (const dictionary of [en, es] as Record<string, string>[]) {
      expect(dictionary[key]).toEqual(expect.any(String));
      expect(dictionary[key]?.trim().length).toBeGreaterThan(0);
      expect(dictionary[key]).not.toContain(code);
    }
    expect(resolveErrorKey(code)).toBe(key);
  });

  it("preserves recipe-only errors and the safe fallback", () => {
    expect(resolveErrorKey("would_create_cycle")).toBe("recipes.error.would_create_cycle");
    expect(resolveErrorKey("unrecognized_database_error")).toBe("recipes.error.generic");
  });
});
