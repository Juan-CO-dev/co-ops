/** Catalog Phase 3b — every key the recipe / menu / shop-changes / notices screens use exists in en AND es; Spanish is tú. */
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { PHASE3B_KEYS } from "./catalog-phase3b-keys";

const E = en as Record<string, string>;
const S = es as Record<string, string>;

describe("catalog Phase 3b strings", () => {
  it.each(PHASE3B_KEYS)("%s exists in en and es", (key) => {
    expect(E[key], `en ${key}`).toBeTruthy();
    expect(S[key], `es ${key}`).toBeTruthy();
  });
  it("Spanish is tú, never usted", () => {
    for (const key of PHASE3B_KEYS) expect(S[key]).not.toMatch(/\busted(es)?\b/i);
  });
  it("placeholders match between the languages", () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of PHASE3B_KEYS) expect(ph(S[key]!), key).toEqual(ph(E[key]!));
  });
  it("the lead-decision sentences are the exact agreed English", () => {
    expect(E["catalog.recipe.preview.drops_link"]).toBe("This drops the link to {shop}'s recipe — you'll stop getting its updates.");
    expect(E["catalog.recipe.notice.edited_since"]).toMatch(/^You've changed your copy since adopting it\./);
    expect(E["catalog.menu.preview.name_es_fallback"]).toBe("Spanish users will see the English name until you add one.");
    expect(E["catalog.recipe.edit_rebase"]).toBe("Start over from the new version");
    expect(E["catalog.menu.edit_rebase"]).toBe("Start over from the new version");
    // CC note 5 #1: the level-6 reader's view-only sentence, the same pattern on both pages.
    expect(E["catalog.recipe.view_only"]).toBe("View only — a GM at this shop can change this recipe.");
    expect(S["catalog.recipe.view_only"]).toBe("Solo lectura — un GM de esta tienda puede cambiar esta receta.");
    expect(E["catalog.menu.view_only"]).toBe("View only — a GM at this shop can change this item.");
    expect(S["catalog.menu.view_only"]).toBe("Solo lectura — un GM de esta tienda puede cambiar este artículo.");
    expect(E["catalog.item.change_for_shop"]).toBe("Change it for {shop}");
    expect(E["readiness.hub.where_default"]).toBe("{count} in the default");
    expect(E["readiness.hub.where_shop"]).toBe("{count} at {shop}");
  });
});
