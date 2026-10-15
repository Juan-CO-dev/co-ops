/** Catalog Phase 3b — the recipe page: "What this changes" and the page body (version, connections, lines, notices, other shops, history), en + es, 44px, 375px. */
import { readFileSync } from "node:fs";
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
  it("CC note 5 #2: restoring for a shop says it becomes THAT shop's own version, not the default", () => {
    const html = render(jsx(RecipePreviewPanel, { preview: { ...preview, dropsLinkTo: null }, saveLabel: "Save", busy: false, onSave: () => {}, onDiscard: () => {}, becomesShopVersion: "P Street" }));
    expect(html).toContain(html_("This becomes P Street's own version. The default for everyone doesn't change."));
    const plain = render(jsx(RecipePreviewPanel, { preview, saveLabel: "Save", busy: false, onSave: () => {}, onDiscard: () => {} }));
    expect(plain).not.toContain("This becomes");
    const esHtml = render(jsx(RecipePreviewPanel, { preview, saveLabel: "Save", busy: false, onSave: () => {}, onDiscard: () => {}, becomesShopVersion: "P Street" }), "es");
    expect(esHtml).toContain("Esto se vuelve la versión propia de P Street. El predeterminado de todos no cambia.");
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

const { RecipeItemClient, RecipeHistoryList, StaleLineNotice, RecipeLinesList } = await import("@/components/catalog/RecipeItemClient");
type View = import("@/lib/catalog/recipe-item-shared").RecipeItemView;

const RECIPE = "7d0c1f2e-0000-4000-8000-000000000001";
const view: View = {
  recipe: { id: RECIPE, name: "Italian", nameEs: "Italiano", recipeType: "consumer", active: true },
  shops: [{ id: SHOP, name: "P Street" }, { id: OTHER, name: "Capitol Hill" }],
  scope: SHOP, scopeName: "P Street",
  can: { editShop: true, editGlobal: false, shopsToEdit: [{ id: SHOP, name: "P Street" }] },
  version: { scopeVersionId: "sv", globalVersionId: "gv", ridesDefault: false, adoptedFromShopName: null, validFrom: "2026-10-10T00:00:00Z" },
  lines: [
    { lineId: "l1", lineage: [], fields: turkey, name: "Turkey", kind: "sku", vendorName: "Baldor", changedHere: true, problem: null },
    { lineId: "l2", lineage: [], fields: mayo, name: "Mayo", kind: "product", vendorName: null, changedHere: false, problem: "product_line_needs_measure_unit" },
  ],
  differsFromDefault: [{ kind: "changed", key: "sku:sku-t", before: { ...turkey, quantity: 4 }, after: turkey }],
  makes: [{ kind: "menu_item", id: "m1", name: "Italian", nameEs: "Italiano", yield: 1, costHere: 2.5 }],
  usedIn: [],
  vendors: ["Baldor"],
  otherShopVersions: [{ versionId: "ov", shopId: OTHER, shopName: "Capitol Hill", validFrom: "2026-10-11T00:00:00Z", createdByName: "Luis", changes: [] }],
  notices: [{ kind: "new_default", recipeId: RECIPE, recipeName: "Italian", seenVersionId: "gv", fromShopName: "Capitol Hill", at: "2026-10-12T00:00:00Z" }],
  history: [
    { id: "sv", scope: "shop", shopId: SHOP, shopName: "P Street", active: true, validFrom: "2026-10-10T00:00:00Z", validTo: null, who: "Ana", note: null, lineCount: 2, promotedFromShopName: null, adoptedFromShopName: null, linkEndedFromShopName: null },
    { id: "sv0", scope: "shop", shopId: SHOP, shopName: "P Street", active: false, validFrom: "2026-10-05T00:00:00Z", validTo: "2026-10-10T00:00:00Z", who: "Ana", note: null, lineCount: 2, promotedFromShopName: null, adoptedFromShopName: null, linkEndedFromShopName: "Capitol Hill" },
    { id: "g0", scope: "global", shopId: null, shopName: null, active: false, validFrom: "2000-01-01T00:00:00Z", validTo: "2026-10-01T00:00:00Z", who: null, note: "0262 baseline", lineCount: 1, promotedFromShopName: null, adoptedFromShopName: null, linkEndedFromShopName: null },
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
    // the shop's own past version: Restore; the old DEFAULT version: "Restore as P Street's version" (CC note 5 #2)
    expect(html.split(`>${en["catalog.recipe.restore"]}<`).length - 1).toBe(1);
    expect(html).toContain(html_("Restore as P Street's version"));
    expect44(html);
  });
  it("CC note 5 #2: another shop's version is NEVER offered as Restore (that is adopt); the global view restores the default's own history", () => {
    const foreign = { ...view, history: [{ ...view.history[1]!, id: "ov0", shopId: OTHER, shopName: "Capitol Hill", linkEndedFromShopName: null }] };
    const html = render(jsx(RecipeHistoryList, { view: foreign, target: { kind: "shop", shopId: SHOP }, busy: false, onRestore: () => {} }));
    expect(html).not.toContain(`>${en["catalog.recipe.restore"]}<`);
    expect(html).not.toContain("Restore as");
    const globalView = { ...view, scope: null, scopeName: null, history: [view.history[2]!] };
    const g = render(jsx(RecipeHistoryList, { view: globalView, target: { kind: "global" }, busy: false, onRestore: () => {} }));
    expect(g.split(`>${en["catalog.recipe.restore"]}<`).length - 1).toBe(1);
    expect(g).not.toContain("Restore as");
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

describe("an open line edit across another manager's save (Astra chunks 3-4 review)", () => {
  // Another manager saved P Street's recipe while this line was open: 0262 wrote the set again with NEW ids.
  const saved: View = { ...view, lines: [
    { ...view.lines[0]!, lineId: "l1-v2", lineage: ["l1"] },
    { ...view.lines[1]!, lineId: "l2-v2", lineage: ["l2"] },
  ] };
  const base = {
    target: { kind: "shop" as const, shopId: SHOP }, refused: null, busy: false, previewDropped: false, options: [], measures: new Map(),
    onStartEdit: noop, onRemove: noop, onSubmitEdit: noop, onRebase: noop, onCancel: noop, onDraftChange: noop,
  };
  it("P2 #1: the draft SURVIVES — the line is found by its lineage, the editor stays open, nothing says the line is gone", () => {
    const html = render(jsx(RecipeLinesList, { ...base, view: saved, editing: { mode: "edit", lineId: "l1", expected: turkey, name: "Turkey" } }));
    expect(html).toContain(html_(en["catalog.recipe.edit_title"]));
    expect(html).not.toContain(html_(en["catalog.recipe.error.edge_not_found"]));
    expect(html).not.toContain(html_(en["catalog.recipe.edit_conflict"]));
  });
  it("P2 #1: when the edited line itself changed, the draft stays and the page shows what moved, with Start over", () => {
    const moved: View = { ...saved, lines: [{ ...saved.lines[0]!, fields: { ...turkey, quantity: 6 } }, saved.lines[1]!] };
    const html = render(jsx(RecipeLinesList, { ...base, view: moved, editing: { mode: "edit", lineId: "l1", expected: turkey, name: "Turkey" } }));
    expect(html).toContain(html_(en["catalog.recipe.edit_conflict"]));
    expect(html).toContain("Turkey 5 oz → Turkey 6 oz");
    expect(html).toContain(en["catalog.recipe.edit_rebase"]);
    expect(html).toContain(html_(en["catalog.recipe.edit_title"]));
  });
  it("a line really removed underneath says so (and offers Not now)", () => {
    const html = render(jsx(RecipeLinesList, { ...base, view: saved, editing: { mode: "edit", lineId: "gone", expected: turkey, name: "Turkey" } }));
    expect(html).toContain(html_(en["catalog.recipe.error.edge_not_found"]));
    expect(html).toContain(en["catalog.recipe.preview.discard"]);
  });
  it("P2 #2: an edit after a preview drops its Save — the editor asks to Preview again (en + es)", () => {
    const html = render(jsx(RecipeLinesList, { ...base, view: saved, previewDropped: true, editing: { mode: "edit", lineId: "l1", expected: turkey, name: "Turkey" } }));
    expect(html).toContain(en["catalog.recipe.preview_again"]);
    expect(html).toContain(html_(en["catalog.recipe.preview_again_hint"]));
    const esHtml = render(jsx(RecipeLinesList, { ...base, view: saved, previewDropped: true, editing: { mode: "edit", lineId: "l1", expected: turkey, name: "Turkey" } }), "es");
    expect(esHtml).toContain(es["catalog.recipe.preview_again"]);
    expect44(html);
  });
});

// ── The menu item page body (plan Task 9 Step 1, with the lead decisions) ─────
const { MenuItemClient, MenuHistoryList, MenuStaleNotice, menuRefusalText } = await import("@/components/catalog/MenuItemClient");
type MenuView = import("@/lib/catalog/recipe-item-shared").MenuItemPageView;
const { serverT } = await import("@/lib/i18n/server");

const menuView: MenuView = {
  item: { id: "7d0c1f2e-0000-4000-8000-0000000000a1", name: "Italian", nameEs: "Italiano", menuPrice: 12.5, section: "Subs" },
  shops: [{ id: SHOP, name: "P Street" }, { id: OTHER, name: "Capitol Hill" }],
  scope: SHOP, scopeName: "P Street",
  can: { editShop: true, promote: false, shopsToEdit: [{ id: SHOP, name: "P Street" }] },
  here: { settingId: "ms", price: 13.5, soldHere: true, nameOverride: null, nameOverrideEs: null, name: "Italian", nameEs: "Italiano", typedPrice: 13.5 },
  cost: 2.5,
  recipe: { id: "7d0c1f2e-0000-4000-8000-0000000000r1", name: "Italian" },
  toastLinks: 1,
  history: [
    { id: "ms", active: true, validFrom: "2026-10-10T00:00:00Z", validTo: null, who: "Ana", price: 13.5, soldHere: true, nameOverride: null, nameOverrideEs: null },
    { id: "ms0", active: false, validFrom: "2026-10-01T00:00:00Z", validTo: "2026-10-10T00:00:00Z", who: "Ana", price: 14, soldHere: false, nameOverride: "Big Italian", nameOverrideEs: null },
  ],
};

describe("MenuItemClient", () => {
  it("shows this shop's settings, its food cost, the recipe and the Toast link; every control is 44px", () => {
    const html = render(jsx(MenuItemClient, { view: menuView }));
    expect(html).toContain("P Street&#x27;s settings");
    expect(html).toContain(en["catalog.menu.section.here"]);
    expect(html).toContain('value="13.5"');
    expect(html).toContain("Linked in Toast: 1");
    expect(html).toContain("Food cost here: $2.50");
    expect(html).toContain(en["catalog.menu.back_to_default"]);
    expect(html).toContain(en["catalog.menu.see_changes"]);
    expect44(html);
  });
  it("the global view asks to pick a shop, with the way forward; Spanish throughout", () => {
    const g: MenuView = { ...menuView, scope: null, scopeName: null, can: { editShop: false, promote: false, shopsToEdit: [{ id: SHOP, name: "P Street" }] }, history: [] };
    const html = render(jsx(MenuItemClient, { view: g }));
    expect(html).toContain(en["catalog.menu.global_view_hint"]);
    expect(html).toContain("Change it for P Street");
    expect(html).not.toContain('value="13.5"');
    expect(render(jsx(MenuItemClient, { view: menuView }), "es")).toContain(es["catalog.menu.section.here"]);
    expect(render(jsx(MenuItemClient, { view: g }), "es")).toContain("Cámbialo para P Street");
  });
  it("no dead ends: another shop's view is read-only with 'Change it for <shop>'; a reader with no shop sees the view-only sentence", () => {
    const other: MenuView = { ...menuView, scope: OTHER, scopeName: "Capitol Hill", can: { editShop: false, promote: false, shopsToEdit: [{ id: SHOP, name: "P Street" }] } };
    const html = render(jsx(MenuItemClient, { view: other }));
    expect(html).toContain(html_(en["catalog.menu.pick_shop_hint"]));
    expect(html).toContain("Change it for P Street");
    expect(html).toContain(`href="/admin/catalog/menu-item/${menuView.item.id}?location=${SHOP}"`);
    expect(html).not.toContain(en["catalog.menu.back_to_default"]);
    const reader: MenuView = { ...other, can: { editShop: false, promote: false, shopsToEdit: [] } };
    expect(render(jsx(MenuItemClient, { view: reader }))).toContain(en["catalog.menu.view_only"]);
    const many: MenuView = { ...menuView, scope: null, scopeName: null, can: { editShop: false, promote: true, shopsToEdit: menuView.shops } };
    const m = render(jsx(MenuItemClient, { view: many }));
    expect(m).toContain(en["catalog.item.pick_shop"]);
    expect(m).toContain("Change it for Capitol Hill");
  });
  it("the Director of Operations sees Promote for a shop's OWN price and name — never a GM, never a shop riding the global menu", () => {
    const own: MenuView = { ...menuView, can: { editShop: true, promote: true, shopsToEdit: menuView.shops },
      here: { ...menuView.here, nameOverride: "Big Italian", name: "Big Italian" } };
    const html = render(jsx(MenuItemClient, { view: own }));
    expect(html).toContain(html_(en["catalog.menu.promote.title"]));
    expect(html).toContain(html_("Make $13.50 everyone's price"));
    expect(html).toContain(html_("Make “Big Italian” everyone's name"));
    expect(html).toContain(html_("Every shop on the global menu gets P Street's own price or name. P Street then follows the global menu for it."));
    expect(render(jsx(MenuItemClient, { view: { ...own, can: { ...own.can, promote: false } } }))).not.toContain("everyone&#x27;s price");
    const riding: MenuView = { ...own, here: { ...own.here, settingId: null, price: null, nameOverride: null } };
    expect(render(jsx(MenuItemClient, { view: riding }))).not.toContain(html_(en["catalog.menu.promote.title"]));
    const priceOnly = render(jsx(MenuItemClient, { view: { ...own, here: { ...own.here, nameOverride: null } } }));
    expect(priceOnly).not.toContain("everyone&#x27;s name");
    expect44(html);
  });
  it("375px: the shop chips WRAP (no sideways scroll), long names break, nothing is clipped", () => {
    const many: MenuView = { ...menuView, shops: [...menuView.shops, { id: "6f1d2c3e-0000-4000-8000-00000000000c", name: "Navy Yard Catering Kitchen" }] };
    const html = render(jsx(MenuItemClient, { view: many }));
    const nav = new RegExp(`<nav[^>]*aria-label="${en["catalog.menu.shop_switcher"]}"[^>]*>`).exec(html)?.[0] ?? "";
    expect(nav).toContain("flex-wrap");
    expect(html).not.toMatch(/overflow-x-auto|whitespace-nowrap|\btruncate\b|shrink-0/);
    expect(html).toContain("Navy Yard Catering Kitchen");
    expect(html).toContain("break-words");
  });
});

describe("the menu History", () => {
  it("lists every change here with Restore on the past ones (who can save here only); 44px; Spanish", () => {
    const html = render(jsx(MenuHistoryList, { view: menuView, busy: false, onRestore: noop }));
    expect(html).toContain(en["catalog.menu.current"]);
    expect(html.split(`>${en["catalog.menu.restore"]}<`).length - 1).toBe(1);
    expect(html).toContain("Price $14.00");
    expect(html).toContain(en["catalog.menu.history_off"]);
    expect(html).toContain("Name “Big Italian”");
    expect44(html);
    const ro = render(jsx(MenuHistoryList, { view: { ...menuView, can: { ...menuView.can, editShop: false } }, busy: false, onRestore: noop }));
    expect(ro).not.toContain(`>${en["catalog.menu.restore"]}<`);
    expect(render(jsx(MenuHistoryList, { view: menuView, busy: false, onRestore: noop }), "es")).toContain(es["catalog.menu.restore"]);
  });
});

describe("the menu form across a refresh (lead decision: the draft keeps its ORIGINAL baseline; show what moved; Start over)", () => {
  it("shows each field of the shop's row that moved — was → now — with 'Start over from the new version'", () => {
    const html = render(jsx(MenuStaleNotice, { moves: [{ field: "price", before: 13.5, after: 14 }, { field: "soldHere", before: true, after: false }, { field: "nameEs", before: null, after: "Grande" }], busy: false, onRebase: noop }));
    expect(html).toContain(html_(en["catalog.menu.edit_conflict"]));
    expect(html).toContain("Price: $13.50 → $14.00");
    expect(html).toContain("Sold here: yes → no");
    expect(html).toContain("Spanish name: — → Grande");
    expect(html).toContain(en["catalog.menu.edit_rebase"]);
    expect44(html);
    expect(render(jsx(MenuStaleNotice, { moves: [{ field: "name", before: null, after: "Big" }], busy: false, onRebase: noop }), "es")).toContain(es["catalog.menu.edit_rebase"]);
  });
});

describe("a refusal on the menu page is named — and a promote refused after its Spanish name saved says so plainly (CC note 2 #3)", () => {
  const tEn = (k: Parameters<typeof serverT>[1], p?: Parameters<typeof serverT>[2]) => serverT("en", k, p);
  const tEs = (k: Parameters<typeof serverT>[1], p?: Parameters<typeof serverT>[2]) => serverT("es", k, p);
  it("the shop's label changed (in History) but the promote did not happen — then the reason", () => {
    const text = menuRefusalText(tEn, { code: "version_changed", spanishNameSaved: { settingId: "s2", locationId: SHOP } }, menuView.shops);
    expect(text).toContain("P Street's own Spanish name was saved (you can see it in History), but the promote did not happen.");
    expect(text).toContain(en["catalog.menu.error.version_changed"]);
    const unnamed = menuRefusalText(tEn, { code: "promote_not_done", spanishNameSaved: { settingId: "s2", locationId: SHOP } }, menuView.shops);
    expect(unnamed).toContain(en["catalog.error.promote_not_done"]);
    expect(menuRefusalText(tEs, { code: "version_changed", spanishNameSaved: { settingId: "s2", locationId: SHOP } }, menuView.shops))
      .toContain("El nombre en español propio de P Street se guardó (lo ves en el Historial), pero la promoción no se hizo.");
  });
  it("a plain refusal is its own message, never generic", () => {
    expect(menuRefusalText(tEn, { code: "global_changed" }, menuView.shops)).toBe(en["catalog.menu.error.global_changed"]);
    expect(menuRefusalText(tEn, { code: "invalid_price" }, menuView.shops)).toBe(en["catalog.error.invalid_price"]);
  });
});

describe("chunk-5 review (CC note 8)", () => {
  it("P2: a read-only view still SHOWS the current settings — price, sold here, both names — with only the edit controls withheld", () => {
    const other: MenuView = { ...menuView, scope: OTHER, scopeName: "Capitol Hill", can: { editShop: false, promote: false, shopsToEdit: [{ id: SHOP, name: "P Street" }] },
      here: { ...menuView.here, nameOverride: "Big Italian", nameOverrideEs: "Italiano grande", name: "Big Italian", nameEs: "Italiano grande" } };
    const html = render(jsx(MenuItemClient, { view: other }));
    expect(html).toContain(en["catalog.menu.now.title"]);
    expect(html).toContain("Price: $13.50");
    expect(html).toContain("Sold here: yes");
    expect(html).toContain("Name: Big Italian");
    expect(html).toContain("Spanish name: Italiano grande");
    // the way forward stays, and nothing here can be typed into or saved
    expect(html).toContain(html_(en["catalog.menu.pick_shop_hint"]));
    expect(html).toContain("Change it for P Street");
    expect(html).not.toMatch(/<input/);
    expect(html).not.toContain(en["catalog.menu.see_changes"]);
    // a level-6 reader (no shop to change) and the global view read the settings too
    const reader = render(jsx(MenuItemClient, { view: { ...other, can: { editShop: false, promote: false, shopsToEdit: [] } } }));
    expect(reader).toContain("Price: $13.50");
    expect(reader).toContain(en["catalog.menu.view_only"]);
    const global = render(jsx(MenuItemClient, { view: { ...menuView, scope: null, scopeName: null, history: [],
      here: { ...menuView.here, settingId: null, price: null, typedPrice: 12.5 }, can: { editShop: false, promote: false, shopsToEdit: [{ id: SHOP, name: "P Street" }] } } }));
    expect(global).toContain("Price: $12.50");
    expect(global).not.toContain("Sold here:");
    expect(global).toContain(en["catalog.menu.global_view_hint"]);
    expect(render(jsx(MenuItemClient, { view: other }), "es")).toContain("Precio: $13.50");
  });
  it("P2: a shop riding the global price says so", () => {
    const riding: MenuView = { ...menuView, scope: OTHER, scopeName: "Capitol Hill", can: { editShop: false, promote: false, shopsToEdit: [] },
      here: { ...menuView.here, settingId: null, price: null, typedPrice: 12.5 } };
    expect(render(jsx(MenuItemClient, { view: riding }))).toContain(html_(`Price: $12.50 ${en["catalog.menu.now.global"]}`));
  });
  it("P3: History shows each row's Spanish name, so a Spanish-only change is visible (en + es)", () => {
    const v: MenuView = { ...menuView, history: [
      menuView.history[0]!,
      { id: "ms1", active: false, validFrom: "2026-10-05T15:00:00Z", validTo: "2026-10-10T00:00:00Z", who: "Ana", price: 13.5, soldHere: true, nameOverride: null, nameOverrideEs: "Italiano grande" },
    ] };
    expect(render(jsx(MenuHistoryList, { view: v, busy: false, onRestore: noop }))).toContain("Spanish name “Italiano grande”");
    expect(render(jsx(MenuHistoryList, { view: v, busy: false, onRestore: noop }), "es")).toContain("Nombre en español “Italiano grande”");
  });
  it("P3: History dates are the operational (ET) day, never the UTC date — menu and recipe", () => {
    const late = "2026-10-15T01:30:00Z"; // 9:30 PM on Oct 14 in DC
    const m: MenuView = { ...menuView, history: [{ ...menuView.history[0]!, validFrom: late }] };
    const mh = render(jsx(MenuHistoryList, { view: m, busy: false, onRestore: noop }));
    expect(mh).toContain("Oct 14");
    expect(mh).not.toContain("Oct 15");
    const r = { ...view, history: view.history.map((h) => ({ ...h, validFrom: late })) };
    const rh = render(jsx(RecipeHistoryList, { view: r, target: { kind: "shop", shopId: SHOP }, busy: false, onRestore: () => {} }));
    expect(rh).toContain("Oct 14");
    expect(rh).not.toContain("Oct 15");
  });
  it("P3: no p3b screen slices an ISO timestamp for its date", () => {
    for (const f of ["components/catalog/MenuItemClient.tsx", "components/catalog/RecipeItemClient.tsx", "components/catalog/ShopChangesClient.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toContain("iso.slice(0, 10)");
      expect(src, f).toContain("etDisplayDate(");
    }
  });
});

// ── The Shop changes list (plan Task 10, with the lead decisions) ─────────────
const { ShopChangesClient, ShopChangeRecipeCard, ShopChangeMenuCard } = await import("@/components/catalog/ShopChangesClient");
type ChangesView = import("@/lib/catalog/recipe-item-shared").ShopChangesView;
const RID = "7d0c1f2e-0000-4000-8000-000000000001";
const MID = "7d0c1f2e-0000-4000-8000-0000000000e1";
const changes: ChangesView = {
  recipes: [{ recipeId: RID, recipeName: "Italian", versionId: "7d0c1f2e-0000-4000-8000-0000000000aa",
    shopId: SHOP, shopName: "P Street", validFrom: "2026-10-14T00:00:00Z", createdByName: "Ana", adoptedFromShopName: null,
    changes: [{ kind: "changed", key: "sku:sku-t", before: { ...turkey, quantity: 4 }, after: turkey }], sameAsDefault: false }],
  menu: [{ menuItemId: MID, menuItemName: "Italian", settingId: "7d0c1f2e-0000-4000-8000-0000000000bb",
    shopId: SHOP, shopName: "P Street", validFrom: "2026-10-14T00:00:00Z", createdByName: "Ana", price: 13.5, soldHere: true,
    nameOverride: "Big Italian", nameOverrideEs: null, global: { price: 12.5, name: "Italian", nameEs: "Italiano" } }],
  names: { "sku:sku-t": "Turkey" },
};
const recipeRow = changes.recipes[0]!;
const menuRow = changes.menu[0]!;
const idle = { preview: null, retry: null, dropped: false, message: null };
const recipePromote: RecipePreview = {
  ...preview, kind: "promote", target: { kind: "global" }, dropsLinkTo: null, flagged: [], returnedShop: { shopId: SHOP, shopName: "P Street" },
};
const recipeCard = (flow: Record<string, unknown> | null, language: Language = "en") => render(jsx(ShopChangeRecipeCard, {
  row: recipeRow, names: changes.names, busy: false, flow, onPromote: noop, onLeave: noop, onSave: noop, onDiscard: noop, onRepreview: noop,
} as never), language);
const menuCard = (flow: Record<string, unknown> | null, extra: Record<string, unknown> = {}, language: Language = "en") => render(jsx(ShopChangeMenuCard, {
  row: menuRow, busy: false, flow, onPromote: noop, onLeave: noop, onSave: noop, onDiscard: noop, onRepreview: noop, ...extra,
} as never), language);

describe("ShopChangesClient — every shop version, what / where / who, Promote or Leave", () => {
  it("lists each shop version with who and where, and offers Promote or Leave; 44px", () => {
    const html = render(jsx(ShopChangesClient, { view: changes }));
    expect(html).toContain("P Street · Ana");
    expect(html).toContain(en["catalog.changes.promote"]);
    expect(html).toContain(en["catalog.changes.leave"]);
    expect(html).toContain("Price here: $13.50 (everyone: $12.50)");
    expect(html).toContain("Name here: Big Italian");
    expect(html).toContain(html_("Make $13.50 everyone's price"));
    expect(html).toContain(html_("Make “Big Italian” everyone's name"));
    expect44(html);
  });
  it("lead decision: a shop item deep-links to THAT shop's view, never the default's", () => {
    const html = render(jsx(ShopChangesClient, { view: changes }));
    expect(html).toContain(`href="/admin/catalog/recipe/${RID}?location=${SHOP}"`);
    expect(html).toContain(`href="/admin/catalog/menu-item/${MID}?location=${SHOP}"`);
  });
  it("lead decision: Promote says, before the preview, that the source shop goes back to the default", () => {
    expect(recipeCard(null)).toContain(html_("Every shop on the default gets it, and P Street goes back to the default. Its food stays the same."));
    expect(menuCard(null)).toContain(html_("Every shop on the global menu gets P Street's own price or name. P Street then follows the global menu for it."));
  });
  it("a version that matches the default offers no Promote (nothing to make the default) — but a way forward to that shop's page", () => {
    const html = render(jsx(ShopChangeRecipeCard, {
      row: { ...recipeRow, changes: [], sameAsDefault: true }, names: changes.names, busy: false, flow: null,
      onPromote: noop, onLeave: noop, onSave: noop, onDiscard: noop, onRepreview: noop,
    }));
    expect(html).toContain(en["catalog.changes.same_as_default"]);
    expect(html).not.toContain(`>${en["catalog.changes.promote"]}<`);
    expect(html).toContain(html_("There's nothing to make the default. Open it to send P Street back to the default."));
    expect(html).toContain(`href="/admin/catalog/recipe/${RID}?location=${SHOP}"`);
    expect(html).toContain(en["catalog.changes.leave"]);
  });
  it("a shop's own Spanish name is shown as it is", () => {
    expect(menuCard(null, { row: { ...menuRow, nameOverrideEs: "Italiano grande" } })).toContain("Spanish name here: Italiano grande");
  });
  it("Spanish (tú) throughout", () => {
    const html = render(jsx(ShopChangesClient, { view: changes }), "es");
    expect(html).toContain(es["catalog.changes.intro"]);
    expect(html).toContain(es["catalog.changes.promote"]);
    expect(html).toContain(es["catalog.changes.leave"]);
    expect(html).toContain("Precio aquí: $13.50 (todos: $12.50)");
    expect(recipeCard(null, "es")).toContain("Todas las tiendas en el predeterminado lo reciben, y P Street vuelve al predeterminado. Su comida sigue igual.");
  });
  it("375px: rows and button rows wrap, long names break, nothing scrolls sideways or clips", () => {
    const long: ChangesView = { ...changes, recipes: [{ ...recipeRow, shopName: "Navy Yard Catering Kitchen", recipeName: "The Extremely Long Italian Combination Sub" }] };
    const html = render(jsx(ShopChangesClient, { view: long }));
    expect(html).toContain("Navy Yard Catering Kitchen");
    expect(html).toContain("break-words");
    expect(html).not.toMatch(/overflow-x-auto|whitespace-nowrap|\btruncate\b|shrink-0/);
  });
  it("an empty list says so in both sections", () => {
    const html = render(jsx(ShopChangesClient, { view: { recipes: [], menu: [], names: {} } }));
    expect(html.split(en["catalog.changes.none"]).length - 1).toBe(2);
  });
});

describe("a Shop changes promote — the preview, its save, and what happens when something moves", () => {
  it("a recipe promote shows What this changes with the returned shop and ONE save: Make it the default", () => {
    const html = recipeCard({ ...idle, preview: recipePromote });
    expect(html).toContain(en["catalog.recipe.preview.title"]);
    expect(html).toContain("P Street goes back to the default. Its food stays the same.");
    expect(html).toContain(en["catalog.recipe.preview.save.promote"]);
    expect44(html);
  });
  it("lead decision: a NAME promote shows the Spanish name truthfully, the English fallback, and the optional Spanish name field", () => {
    const html = menuCard({ ...idle, preview: menuPromote }, { promoteNameEs: { value: "", previewed: "", onChange: noop, onRepreview: noop } });
    expect(html).toContain("Spanish name: Italiano → —");
    expect(html).toContain(en["catalog.menu.preview.name_es_fallback"]);
    expect(html).toContain(en["catalog.menu.promote.name_es_field"]);
    expect(html).toContain("P Street goes back to the default for what you share.");
    expect(html).toContain(html_(en["catalog.menu.preview.save_promote"]));
    expect44(html);
  });
  it("a Spanish name typed after the preview hides Save until it is looked at again (the preview binds the complete change)", () => {
    const html = menuCard({ ...idle, preview: menuPromote }, { promoteNameEs: { value: "Italiano grande", previewed: "", onChange: noop, onRepreview: noop } });
    expect(html).toContain(en["catalog.menu.promote.name_es_unpreviewed"]);
    expect(html).not.toContain(html_(en["catalog.menu.preview.save_promote"]));
  });
  it("the row changed after its preview: the preview and its Save are gone — Preview again (en + es)", () => {
    for (const html of [recipeCard({ ...idle, dropped: true }), menuCard({ ...idle, dropped: true })]) {
      expect(html).toContain(html_(en["catalog.changes.list_changed"]));
      expect(html).toContain(en["catalog.recipe.preview_again"]);
      // no panel, so no Save (the promote button shares the save's words, so look for the panel itself)
      expect(html).not.toContain(en["catalog.recipe.preview.title"]);
      expect(html).not.toContain(en["catalog.menu.preview.title"]);
      expect44(html);
    }
    expect(recipeCard({ ...idle, dropped: true }, "es")).toContain(es["catalog.changes.list_changed"]);
  });
  it("a stale preview offers to look at the same change again, or not now", () => {
    const html = recipeCard({ ...idle, retry: en["catalog.recipe.error.preview_stale"] });
    expect(html).toContain(html_(en["catalog.recipe.error.preview_stale"]));
    expect(html).toContain(en["catalog.recipe.see_changes"]);
    expect(html).toContain(en["catalog.recipe.preview.discard"]);
    expect44(html);
  });
  it("a refusal is shown on its own row, by name", () => {
    expect(menuCard({ ...idle, message: en["catalog.menu.error.global_changed"] })).toContain(html_(en["catalog.menu.error.global_changed"]));
  });
});
