/** Catalog Phase 3b — the recipe page: "What this changes" and the page body (version, connections, lines, notices, other shops, history), en + es, 44px, 375px. */
import { type ReactNode } from "react";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import type { Language } from "@/lib/i18n/types";
import type { RecipePreview } from "@/lib/catalog/recipe-preview-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: async () => "ok", forgetStepUp: () => {} }) }));
vi.mock("@/components/admin/useStepUpPost", () => ({ useStepUpPost: () => async () => ({ ok: true, data: {} }) }));
const { RecipePreviewPanel } = await import("@/components/catalog/RecipePreviewPanel");

const SHOP = "6f1d2c3e-0000-4000-8000-00000000000a";
const OTHER = "6f1d2c3e-0000-4000-8000-00000000000b";
const turkey = { componentSkuId: "sku-t", componentItemId: null, componentProductId: null, quantity: 5, unit: "oz", eachContainerLabel: null, portioned: false };
const mayo = { componentSkuId: null, componentItemId: null, componentProductId: "p-mayo", quantity: 1, unit: "each", eachContainerLabel: null, portioned: false };

/** React's static markup escapes an apostrophe; compare a translated string the way it is rendered. */
const html_ = (s: string) => s.replace(/'/g, "&#x27;");
const render = (children: ReactNode, language: Language = "en") =>
  renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children }));
/** Every <button> and <a> carries the 44px floor with items-center (AGENTS.md). */
const expect44 = (html: string) => {
  expect(html).not.toMatch(/<button(?![^>]*min-h-\[44px\])[^>]*>/);
  expect(html).not.toMatch(/<button(?![^>]*items-center)[^>]*>/);
  expect(html).not.toMatch(/<a\s(?![^>]*min-h-\[44px\])[^>]*>/);
  expect(html).not.toMatch(/<a\s(?![^>]*items-center)[^>]*>/);
};

const preview: RecipePreview = {
  kind: "restore",
  recipeId: "7d0c1f2e-0000-4000-8000-000000000001",
  target: { kind: "shop", shopId: SHOP },
  changes: [{ kind: "changed", key: "sku:sku-t", before: { ...turkey, quantity: 4 }, after: turkey }],
  names: { "sku:sku-t": "Turkey", "product:p-mayo": "Mayo" },
  reached: [{ scope: SHOP, scopeName: "P Street", menu: [{ menuItemId: "m1", name: "Italian", nameEs: "Italiano", before: 2.5, after: 2.75, statusBefore: "costed", statusAfter: "costed" }], items: [] }],
  untouched: [{ shopId: OTHER, shopName: "Capitol Hill" }],
  returnedShop: null,
  dropsLinkTo: "Capitol Hill",
  flagged: [{ position: 2, name: "Mayo", reason: "product_line_needs_measure_unit" }],
  expectedVersionId: "sv", basedOnVersionId: "g0",
  snapshot: {},
  token: "tok",
};

describe("RecipePreviewPanel — what this changes", () => {
  it("names the change, the cost moves per shop, the shops left untouched, and the save", () => {
    const html = render(jsx(RecipePreviewPanel, { preview, saveLabel: "Restore this version", busy: false, onSave: () => {}, onDiscard: () => {} }));
    expect(html).toContain(en["catalog.recipe.preview.title"]);
    expect(html).toContain("Turkey 4 oz");
    expect(html).toContain("Turkey 5 oz");
    expect(html).toContain("P Street");
    expect(html).toContain("Italian");
    expect(html).toContain("Capitol Hill");
    expect(html).toContain("Restore this version");
    expect(html).toContain(en["catalog.recipe.preview.discard"]);
    expect44(html);
  });
  it("lead decision: restoring pre-adoption history says, BEFORE saving, that it drops the link to that shop's recipe", () => {
    const html = render(jsx(RecipePreviewPanel, { preview, saveLabel: "Save", busy: false, onSave: () => {}, onDiscard: () => {} }));
    expect(html).toContain(html_("This drops the link to Capitol Hill's recipe — you'll stop getting its updates."));
    const keeps = render(jsx(RecipePreviewPanel, { preview: { ...preview, dropsLinkTo: null }, saveLabel: "Save", busy: false, onSave: () => {}, onDiscard: () => {} }));
    expect(keeps).not.toContain("This drops the link");
  });
  it("lead decision (b): a CARRIED broken line is flagged by position, name and reason — not refused", () => {
    const html = render(jsx(RecipePreviewPanel, { preview, saveLabel: "Save", busy: false, onSave: () => {}, onDiscard: () => {} }));
    expect(html).toContain(en["catalog.recipe.preview.flagged_title"].replace(/'/g, "&#x27;"));
    expect(html).toContain(html_(`Line 2 (Mayo) needs fixing: ${en["catalog.recipe.error.product_line_needs_measure_unit"]}`));
  });
  it("a promote names the shop that goes back to the default", () => {
    const html = render(jsx(RecipePreviewPanel, {
      preview: { ...preview, kind: "promote", target: { kind: "global" }, dropsLinkTo: null, returnedShop: { shopId: OTHER, shopName: "Capitol Hill" } },
      saveLabel: "Save", busy: false, onSave: () => {}, onDiscard: () => {},
    }));
    expect(html).toContain("Capitol Hill goes back to the default. Its food stays the same.");
  });
  it("Spanish (tú), Spanish sandwich names, and the drop-link sentence", () => {
    const html = render(jsx(RecipePreviewPanel, { preview, saveLabel: "Guardar", busy: false, onSave: () => {}, onDiscard: () => {} }), "es");
    expect(html).toContain(es["catalog.recipe.preview.title"]);
    expect(html).toContain("Italiano");
    expect(html).toContain("Esto quita el vínculo con la receta de Capitol Hill — dejarás de recibir sus actualizaciones.");
  });
  it("375px: nothing in the panel scrolls sideways or clips — its rows and buttons wrap", () => {
    const html = render(jsx(RecipePreviewPanel, { preview, saveLabel: "Save", busy: false, onSave: () => {}, onDiscard: () => {} }));
    expect(html).not.toMatch(/overflow-x-auto|whitespace-nowrap|\btruncate\b/);
    expect(html).toContain("flex-wrap");
    expect(html).toContain("break-words");
  });
});

// ── The page body ─────────────────────────────────────────────────────────────

const { RecipeItemClient, RecipeHistoryList, StaleLineNotice } = await import("@/components/catalog/RecipeItemClient");
type View = import("@/lib/catalog/recipe-item-shared").RecipeItemView;

const RECIPE = "7d0c1f2e-0000-4000-8000-000000000001";
const view: View = {
  recipe: { id: RECIPE, name: "Italian", nameEs: "Italiano", recipeType: "consumer", active: true },
  shops: [{ id: SHOP, name: "P Street" }, { id: OTHER, name: "Capitol Hill" }],
  scope: SHOP, scopeName: "P Street",
  can: { editShop: true, editGlobal: false, shopsToEdit: [{ id: SHOP, name: "P Street" }] },
  version: { scopeVersionId: "sv", globalVersionId: "gv", ridesDefault: false, adoptedFromShopName: null, validFrom: "2026-10-10T00:00:00Z" },
  lines: [
    { lineId: "l1", fields: turkey, name: "Turkey", kind: "sku", vendorName: "Baldor", changedHere: true, problem: null },
    { lineId: "l2", fields: mayo, name: "Mayo", kind: "product", vendorName: null, changedHere: false, problem: "product_line_needs_measure_unit" },
  ],
  differsFromDefault: [{ kind: "changed", key: "sku:sku-t", before: { ...turkey, quantity: 4 }, after: turkey }],
  makes: [{ kind: "menu_item", id: "m1", name: "Italian", nameEs: "Italiano", yield: 1, costHere: 2.5 }],
  usedIn: [],
  vendors: ["Baldor"],
  otherShopVersions: [{ versionId: "ov", shopId: OTHER, shopName: "Capitol Hill", validFrom: "2026-10-11T00:00:00Z", createdByName: "Luis", changes: [] }],
  notices: [{ kind: "new_default", recipeId: RECIPE, recipeName: "Italian", seenVersionId: "gv", fromShopName: "Capitol Hill", at: "2026-10-12T00:00:00Z" }],
  history: [
    { id: "sv", scope: "shop", shopName: "P Street", active: true, validFrom: "2026-10-10T00:00:00Z", validTo: null, who: "Ana", note: null, lineCount: 2, promotedFromShopName: null, adoptedFromShopName: null, linkEndedFromShopName: null },
    { id: "sv0", scope: "shop", shopName: "P Street", active: false, validFrom: "2026-10-05T00:00:00Z", validTo: "2026-10-10T00:00:00Z", who: "Ana", note: null, lineCount: 2, promotedFromShopName: null, adoptedFromShopName: null, linkEndedFromShopName: "Capitol Hill" },
    { id: "g0", scope: "global", shopName: null, active: false, validFrom: "2000-01-01T00:00:00Z", validTo: "2026-10-01T00:00:00Z", who: null, note: "0262 baseline", lineCount: 1, promotedFromShopName: null, adoptedFromShopName: null, linkEndedFromShopName: null },
  ],
  names: { "sku:sku-t": "Turkey", "product:p-mayo": "Mayo" },
  picker: { skus: [], items: [], products: [], measures: [{ label: "oz", dimension: "weight", toBaseFactor: 1 }], activeMeasureLabels: ["oz"] },
};
const sourceChanged = (edited: boolean): View["notices"][number] => ({
  kind: "source_changed", recipeId: RECIPE, recipeName: "Italian", sourceShopId: OTHER, sourceShopName: "Capitol Hill",
  seenVersionId: "ov2", sourceLiveVersionId: "ov2", dismissKind: "source_changed", editedSinceAdopting: edited, promotedToDefault: false, at: "2026-10-12T00:00:00Z",
});

describe("RecipeItemClient", () => {
  it("says which version it shows, how it connects, what changed here, and the notice — always visible", () => {
    const html = render(jsx(RecipeItemClient, { view }));
    expect(html).toContain("P Street&#x27;s version · based on the global default");
    expect(html).toContain(en["catalog.recipe.connections"]);
    expect(html).toContain("Baldor");
    expect(html).toContain(en["catalog.recipe.changed_here"]);
    expect(html).toContain(en["catalog.recipe.notices"]);
    expect(html).toContain("Italian has a new default for every shop (from Capitol Hill).");
    expect(html).toContain(en["catalog.recipe.back_to_default"]);
  });
  it("collapsed sections carry their counts; every control is 44px", () => {
    const html = render(jsx(RecipeItemClient, { view }));
    for (const k of ["catalog.recipe.section.makes", "catalog.recipe.section.others", "catalog.recipe.section.history"] as const) expect(html).toContain(html_(en[k]));
    expect(html).toContain(en["catalog.recipe.history_count"].replace("{n}", "3"));
    expect(html).toContain('aria-expanded="false"');
    expect44(html);
  });
  it("a GM never sees 'for everyone' choices; a MoO in the global view does", () => {
    expect(render(jsx(RecipeItemClient, { view }))).not.toContain(en["catalog.recipe.promote"]);
    const moo: View = { ...view, scope: null, scopeName: null, notices: [], can: { editShop: false, editGlobal: true, shopsToEdit: view.shops }, version: { ...view.version, ridesDefault: false } };
    const html = render(jsx(RecipeItemClient, { view: moo }));
    expect(html).toContain(en["catalog.recipe.version.global"]);
    expect(html).toContain(en["catalog.recipe.add_line"]);
    expect(html).not.toContain(html_(en["catalog.recipe.global_moo_hint"]));
  });
  it("lead decision (b): a carried broken line is FLAGGED with its position and reason, and stays editable (repair one line at a time)", () => {
    const html = render(jsx(RecipeItemClient, { view }));
    expect(html).toContain(html_(`Line 2 (Mayo) needs fixing: ${en["catalog.recipe.error.product_line_needs_measure_unit"]}`));
    expect(html.split(`>${en["catalog.recipe.edit_line"]}<`).length - 1).toBe(2);
  });
  it("lead decision: an adopted copy edited since adopting keeps its notice, with the added line", () => {
    const html = render(jsx(RecipeItemClient, { view: { ...view, notices: [sourceChanged(true)] } }));
    expect(html).toContain(html_(en["catalog.recipe.notice.edited_since"]));
    expect(html).toContain(en["catalog.recipe.notice.take_update"]);
    expect(html).toContain(en["catalog.recipe.notice.keep_mine"]);
    expect(render(jsx(RecipeItemClient, { view: { ...view, notices: [sourceChanged(false)] } }))).not.toContain(html_(en["catalog.recipe.notice.edited_since"]));
  });

  describe("no dead ends: a control the viewer can't use is read-only, with a plain sentence and a way forward", () => {
    it("a GM reading ANOTHER shop's recipe: no edit controls, and 'Change it for P Street' to its own", () => {
      const other: View = { ...view, scope: OTHER, scopeName: "Capitol Hill", notices: [], can: { editShop: false, editGlobal: false, shopsToEdit: [{ id: SHOP, name: "P Street" }] } };
      const html = render(jsx(RecipeItemClient, { view: other }));
      expect(html).toContain(html_(en["catalog.recipe.pick_shop_hint"]));
      expect(html).toContain("Change it for P Street");
      expect(html).toContain(`href="/admin/catalog/recipe/${RECIPE}?location=${SHOP}"`);
      expect(html).not.toContain(`>${en["catalog.recipe.edit_line"]}<`);
      expect(html).not.toContain(`>${en["catalog.recipe.add_line"]}<`);
      expect(html).not.toContain(`>${en["catalog.recipe.back_to_default"]}<`);
    });
    it("a GM on the global default: only the Director of Operations changes it for everyone — change it for your shop", () => {
      const global: View = { ...view, scope: null, scopeName: null, notices: [], can: { editShop: false, editGlobal: false, shopsToEdit: [{ id: SHOP, name: "P Street" }] } };
      const html = render(jsx(RecipeItemClient, { view: global }));
      expect(html).toContain(en["catalog.recipe.global_moo_hint"]);
      expect(html).toContain("Change it for P Street");
      expect(html).not.toContain(`>${en["catalog.recipe.edit_line"]}<`);
    });
    it("a GM of several shops picks one; a reader with no shop to change is told who does", () => {
      const two: View = { ...view, scope: null, scopeName: null, notices: [], can: { editShop: false, editGlobal: false, shopsToEdit: view.shops } };
      const html = render(jsx(RecipeItemClient, { view: two }));
      expect(html).toContain(en["catalog.item.pick_shop"]);
      expect(html).toContain("Change it for P Street");
      expect(html).toContain("Change it for Capitol Hill");
      const reader: View = { ...view, notices: [], can: { editShop: false, editGlobal: false, shopsToEdit: [] } };
      expect(render(jsx(RecipeItemClient, { view: reader }))).toContain(en["catalog.recipe.view_only"]);
    });
  });

  it("375px: the shop chips WRAP (no sideways scroller), and nothing truncates a label", () => {
    const many: View = { ...view, shops: [...view.shops, { id: "6f1d2c3e-0000-4000-8000-00000000000c", name: "Navy Yard Catering Kitchen" }] };
    const html = render(jsx(RecipeItemClient, { view: many }));
    const nav = new RegExp(`<nav[^>]*aria-label="${en["catalog.recipe.shop_switcher"]}"[^>]*>`).exec(html)?.[0] ?? "";
    expect(nav).toContain("flex-wrap");
    expect(html).not.toMatch(/overflow-x-auto|whitespace-nowrap|\btruncate\b|shrink-0/);
    expect(html).toContain("Navy Yard Catering Kitchen");
    expect(html).toContain("break-words");
  });

  it("Spanish throughout (tú)", () => {
    const html = render(jsx(RecipeItemClient, { view }), "es");
    expect(html).toContain("Versión de P Street · basada en el predeterminado global");
    expect(html).toContain(es["catalog.recipe.section.lines"]);
    expect(html).toContain(es["catalog.recipe.notice.got_it"]);
    expect(html).toContain(`La línea 2 (Mayo) necesita arreglo: ${es["catalog.recipe.error.product_line_needs_measure_unit"]}`);
  });
});

describe("History — restore, and the recorded end of an adoption link", () => {
  it("lead decision: History names the version that ENDED the link (adoption_ended_from_version_id), and offers Restore on the past ones", () => {
    const html = render(jsx(RecipeHistoryList, { view, target: { kind: "shop", shopId: SHOP }, busy: false, onRestore: () => {} }));
    expect(html).toContain(html_("Link to Capitol Hill's recipe ended"));
    expect(html).toContain(en["catalog.recipe.current"]);
    expect(html.split(`>${en["catalog.recipe.restore"]}<`).length - 1).toBe(2);
    expect44(html);
  });
  it("a viewer who can't save here gets no Restore", () => {
    const html = render(jsx(RecipeHistoryList, { view, target: null, busy: false, onRestore: () => {} }));
    expect(html).not.toContain(`>${en["catalog.recipe.restore"]}<`);
  });
  it("Spanish", () => {
    const html = render(jsx(RecipeHistoryList, { view, target: null, busy: false, onRestore: () => {} }), "es");
    expect(html).toContain("Terminó el vínculo con la receta de Capitol Hill");
  });
});

describe("an edit whose line moved underneath (lead decision: the draft keeps its ORIGINAL baseline; show what changed; Start over)", () => {
  it("shows what the line was and what it is now, and offers 'Start over from the new version'", () => {
    const html = render(jsx(StaleLineNotice, { expected: { ...turkey, quantity: 4 }, current: turkey, names: view.names, busy: false, onRebase: () => {} }));
    expect(html).toContain(en["catalog.recipe.edit_conflict"]);
    expect(html).toContain("Turkey 4 oz → Turkey 5 oz");
    expect(html).toContain(en["catalog.recipe.edit_rebase"]);
    expect44(html);
    expect(render(jsx(StaleLineNotice, { expected: { ...turkey, quantity: 4 }, current: turkey, names: view.names, busy: false, onRebase: () => {} }), "es"))
      .toContain(es["catalog.recipe.edit_rebase"]);
  });
});

// ── The menu item page (plan Task 9) ──────────────────────────────────────────
const { MenuPreviewPanel } = await import("@/components/catalog/MenuPreviewPanel");
import type { MenuPreview } from "@/lib/catalog/recipe-preview-shared";

const menuSave: MenuPreview = {
  kind: "save", menuItemId: "7d0c1f2e-0000-4000-8000-0000000000a1", shopId: SHOP,
  before: { name: "Italian", nameEs: "Italiano", price: 12.5, soldHere: true, inherits: { price: true, name: true } },
  after: { name: "Italian", nameEs: "Italiano", price: 13.5, soldHere: true, inherits: { price: false, name: true } },
  cost: 2.5, marginBefore: 10, marginAfter: 11, changedShops: [], returnedShop: null, spanishFallsBackToEnglish: false,
  snapshot: {}, expectedSettingId: null, expectedGlobal: null, token: "tok",
};
const menuPromote: MenuPreview = {
  ...menuSave, kind: "promote", shopId: null,
  before: { name: "Italian", nameEs: "Italiano", price: 12.5, soldHere: true, inherits: { price: false, name: false } },
  // An English-only rename: the shop has no Spanish name, so the promote leaves NONE — never the old "Italiano".
  after: { name: "Big Italian", nameEs: null, price: 12.5, soldHere: true, inherits: { price: false, name: false } },
  changedShops: [{ shopId: OTHER, shopName: "Capitol Hill" }], returnedShop: { shopId: SHOP, shopName: "P Street" },
  spanishFallsBackToEnglish: true, expectedSettingId: "ms", expectedGlobal: { price: 12.5, name: "Italian", nameEs: "Italiano" },
};
const noop = () => {};

describe("MenuPreviewPanel — what this changes", () => {
  it("a shop save: price, margin, sold here, both names and what is inherited; one save and Cancel; 44px", () => {
    const html = render(jsx(MenuPreviewPanel, { preview: menuSave, saveLabel: "Save for P Street", busy: false, onSave: noop, onDiscard: noop }));
    expect(html).toContain(en["catalog.menu.preview.title"]);
    expect(html).toContain("Price: $12.50 → $13.50");
    expect(html).toContain("Margin: $10.00 → $11.00");
    expect(html).toContain("Sold here: yes → yes");
    expect(html).toContain("Spanish name: Italiano → Italiano");
    expect(html).toContain(html_("After this save — price: this shop's own · name: the default's"));
    expect(html).toContain("Save for P Street");
    expect(html).toContain(en["catalog.menu.cancel"]);
    expect(html).not.toContain(en["catalog.menu.preview.name_es_fallback"]);
    expect44(html);
  });
  it("lead decision: a promote shows the Spanish name before → after TRUTHFULLY — no resurrected old name — and the English fallback when it ends up empty", () => {
    const html = render(jsx(MenuPreviewPanel, {
      preview: menuPromote, saveLabel: en["catalog.menu.preview.save_promote"], busy: false, onSave: noop, onDiscard: noop,
      promoteNameEs: { value: "", previewed: "", onChange: noop, onRepreview: noop },
    }));
    expect(html).toContain("Name: Italian → Big Italian");
    expect(html).toContain("Spanish name: Italiano → —");
    expect(html).not.toContain("Big Italian → Italiano");
    expect(html).toContain(en["catalog.menu.preview.name_es_fallback"]);
    expect(html).toContain("Shops that change: Capitol Hill");
    expect(html).toContain("P Street goes back to the default for what you share.");
    // the optional Spanish name field, in the same step
    expect(html).toContain(en["catalog.menu.promote.name_es_field"]);
    expect(html).toMatch(/<input[^>]*min-h-\[44px\]/);
    expect(html).toContain(html_(en["catalog.menu.preview.save_promote"]));
    expect44(html);
  });
  it("a typed Spanish name the preview has not shown yet hides Save and asks to look again (the preview binds the complete change)", () => {
    const html = render(jsx(MenuPreviewPanel, {
      preview: menuPromote, saveLabel: "SAVE-IT", busy: false, onSave: noop, onDiscard: noop,
      promoteNameEs: { value: "Italiano grande", previewed: "", onChange: noop, onRepreview: noop },
    }));
    expect(html).toContain(en["catalog.menu.promote.name_es_unpreviewed"]);
    expect(html).toContain(en["catalog.menu.see_changes"]);
    expect(html).not.toContain("SAVE-IT");
    const shown = render(jsx(MenuPreviewPanel, {
      preview: { ...menuPromote, after: { ...menuPromote.after, nameEs: "Italiano grande" }, spanishFallsBackToEnglish: false },
      saveLabel: "SAVE-IT", busy: false, onSave: noop, onDiscard: noop,
      promoteNameEs: { value: "Italiano grande ", previewed: "Italiano grande", onChange: noop, onRepreview: noop },
    }));
    expect(shown).toContain("Spanish name: Italiano → Italiano grande");
    expect(shown).toContain("SAVE-IT");
    expect(shown).not.toContain(en["catalog.menu.preview.name_es_fallback"]);
  });
  it("a price-only promote has no Spanish name field", () => {
    const html = render(jsx(MenuPreviewPanel, { preview: { ...menuPromote, after: { ...menuPromote.before, price: 13.5 }, spanishFallsBackToEnglish: false }, saveLabel: "S", busy: false, onSave: noop, onDiscard: noop }));
    expect(html).not.toContain(en["catalog.menu.promote.name_es_field"]);
  });
  it("Spanish (tú)", () => {
    const html = render(jsx(MenuPreviewPanel, {
      preview: menuPromote, saveLabel: es["catalog.menu.preview.save_promote"], busy: false, onSave: noop, onDiscard: noop,
      promoteNameEs: { value: "", previewed: "", onChange: noop, onRepreview: noop },
    }), "es");
    expect(html).toContain(es["catalog.menu.preview.name_es_fallback"]);
    expect(html).toContain(es["catalog.menu.promote.name_es_field"]);
    expect(html).toContain(es["catalog.menu.preview.title"]);
  });
});
