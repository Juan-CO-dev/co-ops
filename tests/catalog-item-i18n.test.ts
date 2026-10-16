/** Catalog Phase 2b — every new string ships en AND es (AGENTS.md translate-from-day-one), by NAME. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { CATALOG_ITEM_ERROR_CODES } from "@/lib/catalog/sku-item-shared";
import { RECIPE_VERSION_ERROR_CODES } from "@/lib/recipe-versions-shared";
import { MENU_ITEM_SHOP_ERROR_CODES } from "@/lib/menu-item-shop-shared";
import { MENU_PROMOTE_NAME_KEYS } from "@/lib/catalog/recipe-preview-shared";
import { RECIPE_PAGE_ERROR_CODES } from "@/lib/catalog/recipe-item-shared";
import { PHASE3B_KEYS } from "./catalog-phase3b-keys";

import { SHOP_OWNED_ERROR_CODES } from "@/lib/catalog/shop-owned-shared";

import { NEW_ITEM_ERROR_CODES } from "@/lib/catalog/new-item-shared";

import { SWAP_ERROR_CODES } from "@/lib/catalog/swap-shared";

const REQUIRED = [
  // Phase 4b review fixes and Swap / Share / Back.
  "catalog.jobs.new_item.summary",
  "catalog.jobs.new_item.created",
  "catalog.jobs.new_item.arrives",
  "catalog.jobs.swap.title",
  "catalog.jobs.swap.replacement",
  "catalog.jobs.swap.add",
  "catalog.jobs.swap.for_now",
  "catalog.jobs.swap.for_good",
  "catalog.jobs.swap.preview",
  "catalog.jobs.swap.confirm",
  "catalog.jobs.swap.cancel",
  "catalog.jobs.swap.summary",
  "catalog.jobs.swap.recipe_lines",
  "catalog.jobs.swap.refused",
  "catalog.jobs.swap.follows_primary",
  "catalog.jobs.swap.untouched",
  "catalog.jobs.swap.costs",
  "catalog.jobs.swap.product",
  "catalog.jobs.swap.no_changes",
  "catalog.jobs.swap.saved",
  "catalog.jobs.swap.uncertain",
  "catalog.jobs.swap.note",
  "catalog.jobs.swap.line",
  "catalog.jobs.swap.converted",
  "catalog.jobs.swap.item",
  "catalog.jobs.swap.unknown_cost",
  "catalog.jobs.swap.return",
  "catalog.jobs.share.title",
  "catalog.jobs.share.producing_recipes",
  "catalog.jobs.share.menu_price",
  "catalog.jobs.share.preview",
  "catalog.jobs.share.confirm",
  "catalog.jobs.share.dependencies",
  "catalog.jobs.share.item_dependency",
  "catalog.jobs.share.sku_dependency",
  "catalog.jobs.share.kept_pack",
  "catalog.jobs.share.kept_price",
  "catalog.jobs.share.used_in",
  "catalog.jobs.share.blocked",
  "catalog.jobs.share.open_recipe",
  "catalog.jobs.share.open_sandwich",
  "catalog.jobs.share.success",
  "catalog.jobs.share.owner",
  "catalog.jobs.back.title",
  "catalog.jobs.back.preview",
  "catalog.jobs.back.confirm",
  "catalog.jobs.back.going_back",
  "catalog.jobs.back.kept",
  "catalog.jobs.back.primary_restore",
  "catalog.jobs.back.primary_kept",
  "catalog.jobs.back.saved",
  "catalog.jobs.back.restored",
  "catalog.jobs.back.primary_result",
  "catalog.jobs.back.grouping_result",
  "catalog.jobs.back.reload",
  "catalog.jobs.back.load_error",
  "catalog.jobs.back.outcome_restored",
  "catalog.jobs.back.outcome_changed_since",
  "catalog.jobs.back.outcome_kept",
  "catalog.jobs.back.outcome_retired",
  "catalog.jobs.back.outcome_none",
  "catalog.jobs.back.outcome_unknown",
  "catalog.jobs.sandwich.unpriced",
  // Phase 4b chunk 4 sandwich job.
  "catalog.jobs.sandwich.title",
  "catalog.jobs.sandwich.intro",
  "catalog.jobs.sandwich.price",
  "catalog.jobs.sandwich.global",
  "catalog.jobs.sandwich.link_shop",
  "catalog.jobs.sandwich.choose_shop",
  "catalog.jobs.sandwich.directions",
  "catalog.jobs.sandwich.edit",
  "catalog.jobs.sandwich.remove",
  "catalog.jobs.sandwich.remove_aria",
  "catalog.jobs.sandwich.costed",
  "catalog.jobs.sandwich.inconsistent",
  "catalog.jobs.sandwich.unweighed",
  "catalog.jobs.sandwich.unresolved",
  "catalog.jobs.sandwich.no_recipe",
  "catalog.jobs.sandwich.cost_pending",
  "catalog.jobs.sandwich.cost_error",
  "catalog.jobs.sandwich.margin",
  "catalog.jobs.sandwich.summary",
  "catalog.jobs.sandwich.confirm",
  "catalog.jobs.sandwich.create",
  "catalog.jobs.sandwich.created",
  "catalog.jobs.sandwich.already_created",
  "catalog.jobs.sandwich.recovery",
  "catalog.jobs.sandwich.open",
  "catalog.jobs.sandwich.uncertain",
  "catalog.jobs.sandwich.read_error",
  "catalog.jobs.sandwich.reread",
  "catalog.jobs.sandwich.start_again",

  // Phase 4b chunk 3: explicit New item inventory.
  "catalog.jobs.new_item.title",
  "catalog.jobs.new_item.intro",
  "catalog.jobs.new_item.shop",
  "catalog.jobs.new_item.vendor",
  "catalog.jobs.new_item.vendor_none",
  "catalog.jobs.new_item.vendor_add",
  "catalog.jobs.new_item.name",
  "catalog.jobs.new_item.number",
  "catalog.jobs.new_item.class",
  "catalog.jobs.new_item.avg_weight",
  "catalog.jobs.new_item.price",
  "catalog.jobs.new_item.price_date",
  "catalog.jobs.new_item.create",
  "catalog.jobs.new_item.uncertain",
  "catalog.jobs.new_item.replayed",
  "catalog.jobs.new_item.open",
  "catalog.jobs.new_item.vendor_name",
  "catalog.jobs.new_item.vendor_contact",
  "catalog.jobs.new_item.vendor_ordering",
  "catalog.jobs.new_item.vendor_save",
  "catalog.jobs.new_item.vendor_cancel",
  "catalog.jobs.new_item.setup.title",
  "catalog.jobs.new_item.setup.par",
  "catalog.jobs.new_item.setup.order_days",
  "catalog.jobs.new_item.setup.guide_line",
  "catalog.jobs.new_item.setup.use_in",
  "catalog.jobs.new_item.setup.barcode",
  "catalog.jobs.new_item.setup.saved",
  "catalog.jobs.new_item.setup.unconfirmed",
  "catalog.jobs.new_item.setup.resume",
  "catalog.jobs.new_item.setup.skip",
  "catalog.jobs.new_item.setup.save",
  "catalog.jobs.new_item.setup.vendor_needed",
  "catalog.jobs.new_item.setup.weekday_par",
  "catalog.jobs.new_item.setup.weekend_par",
  "catalog.jobs.new_item.setup.days",
  "catalog.jobs.new_item.setup.lead",
  "catalog.jobs.new_item.setup.section",
  "catalog.jobs.new_item.setup.recipe",
  "catalog.jobs.new_item.setup.quantity",
  "catalog.jobs.new_item.setup.unit",
  "catalog.jobs.new_item.setup.code",
  "catalog.jobs.new_item.setup.level",
  "catalog.jobs.new_item.setup.day.0",
  "catalog.jobs.new_item.setup.day.1",
  "catalog.jobs.new_item.setup.day.2",
  "catalog.jobs.new_item.setup.day.3",
  "catalog.jobs.new_item.setup.day.4",
  "catalog.jobs.new_item.setup.day.5",
  "catalog.jobs.new_item.setup.day.6",
  "catalog.jobs.new_item.setup.new_section",
  "catalog.jobs.new_item.setup.refresh",
  "catalog.jobs.new_item.setup.resume_step",
  "catalog.jobs.new_item.setup.ordering",
  "catalog.jobs.new_item.setup.case",
  "catalog.jobs.new_item.setup.inner",
  "catalog.jobs.new_item.vendor_method",
  "catalog.jobs.new_item.vendor_uncertain",

  // Catalog Phase 4b chunk 2: explicit job/Toast contract strings, including ARIA.
  "catalog.jobs.toast.title", "catalog.jobs.toast.unavailable", "catalog.jobs.toast.empty",
  "catalog.jobs.toast.choices", "catalog.jobs.toast.suggested", "catalog.jobs.toast.linked",
  "catalog.jobs.toast.search", "catalog.jobs.toast.search_aria", "catalog.jobs.toast.select",
  "catalog.jobs.toast.confirm", "catalog.jobs.toast.loading", "catalog.jobs.toast.load_error",
  "catalog.jobs.toast.save_error", "catalog.jobs.toast.refresh", "catalog.jobs.toast.confirmation",
  "catalog.jobs.setup.day_result_aria", "catalog.jobs.setup.saved", "catalog.jobs.setup.incomplete",
  "catalog.jobs.setup.skipped", "catalog.jobs.setup.unconfirmed", "catalog.jobs.cost.partial",
  ...["exists", "section_name_taken", "sku_already_placed", "guide_stale", "section_not_found", "foreign_section", "foreign_line", "foreign_sku", "guide_not_found", "invalid_code", "vendor_mismatch", "level_differs", "teach_failed", "open_item_guid", "invalid_json"].map(code => `catalog.error.${code}`),
  "catalog.new_item.replayed",
  "catalog.swap.ordering_consequence", "catalog.setup.guide_unconfirmed",
  ...SWAP_ERROR_CODES.map(c => `catalog.error.${c}`),
  ...NEW_ITEM_ERROR_CODES.map(c => `catalog.error.${c}`),
  "catalog.only_at_shop",
  ...SHOP_OWNED_ERROR_CODES.map((c) => `catalog.error.${c}`),
  "customers.catering.sort.quiet", "catalog.item.kind_bought", "catalog.item.version_global",
  "catalog.item.version_shop_default", "catalog.item.version_shop", "catalog.item.based_on_global",
  "catalog.item.shop_switcher", "catalog.item.shop_global", "catalog.item.inactive", "catalog.item.item_number",
  "catalog.item.connections", "catalog.item.comes_from", "catalog.item.no_vendor", "catalog.item.used_in",
  "catalog.item.used_in_none", "catalog.item.menu_count", "catalog.item.menu_none", "catalog.item.part_of_product",
  "catalog.item.buys_this_one", "catalog.item.buys_other", "catalog.item.off_here", "catalog.item.section.arrives",
  "catalog.item.section.price", "catalog.item.section.ordering", "catalog.item.section.counting",
  "catalog.item.section.barcodes", "catalog.item.section.history", "catalog.item.missing",
  "catalog.item.missing_none", "catalog.item.fix", "catalog.item.no_pack", "catalog.item.order_unit",
  "catalog.item.job_pack", "catalog.item.job_price", "catalog.item.back_to_default",
  "catalog.item.back_to_default_confirm", "catalog.item.cancel", "catalog.item.see_changes",
  "catalog.item.see_changes_everyone", "catalog.item.saved", "catalog.item.change_for_shop", "catalog.item.pick_shop", "catalog.price.current", "catalog.price.none",
  "catalog.price.shop_own", "catalog.price.global_is", "catalog.price.cost_per_oz", "catalog.price.new",
  "catalog.price.date", "catalog.price.basis", "catalog.price.basis.unset", "catalog.price.basis.per_case",
  "catalog.price.basis.per_each", "catalog.price.basis.per_lb", "catalog.price.basis.per_dozen",
  "catalog.price.basis.per_bundle", "catalog.price.history", "catalog.price.history_shop",
  "catalog.price.history_global", "catalog.ordering.par", "catalog.ordering.par_none", "catalog.ordering.lane.human",
  "catalog.ordering.lane.global", "catalog.ordering.lane.auto", "catalog.ordering.order_days",
  "catalog.ordering.no_days", "catalog.ordering.change_pars", "catalog.counting.unit", "catalog.counting.open",
  "catalog.barcodes.none", "catalog.barcodes.level.case", "catalog.barcodes.level.inner", "catalog.history.live",
  "catalog.history.retired", "catalog.history.restore", "catalog.history.scope_global", "catalog.history.scope_shop",
  "catalog.history.empty", "catalog.requests.title", "catalog.requests.by", "catalog.requests.proposal_count",
  "catalog.requests.proposal_weight", "catalog.requests.review", "catalog.requests.dismiss",
  "catalog.requests.photo_alt", "catalog.requests.photo_open", "catalog.requests.added_by",
  "catalog.pack.sentence_aria", "catalog.pack.container_label", "catalog.pack.inner_label", "catalog.pack.holds",
  "catalog.pack.qty_aria", "catalog.pack.remove_level", "catalog.pack.remove_level_aria", "catalog.pack.each_weighs",
  "catalog.pack.each_holds", "catalog.pack.amount", "catalog.pack.unit", "catalog.pack.leaf_uses_avg",
  "catalog.pack.add_level", "catalog.pack.error.empty_label", "catalog.pack.error.duplicate_label",
  "catalog.pack.error.label_is_measure_unit", "catalog.pack.error.bad_qty", "catalog.pack.error.no_leaf_unit",
  // chunk-1 review P3c: the sentence model refuses an unregistered leaf unit, as the writer does.
  "catalog.pack.error.unknown_measure",
  "catalog.preview.title", "catalog.preview.target_shop", "catalog.preview.target_global",
  "catalog.preview.no_shops", "catalog.preview.unaffected", "catalog.preview.no_change", "catalog.preview.price_not_current",
  "catalog.preview.order_unit", "catalog.preview.cost_per_oz", "catalog.preview.price", "catalog.preview.menu_items",
  "catalog.preview.menu_none", "catalog.preview.par_question_shop", "catalog.preview.par_question_global",
  "catalog.preview.par_question_inherited", "catalog.preview.par_keep_inherited", "catalog.preview.par_set_shop",
  "catalog.preview.par_status.global_par_shared",
  // chunk-1 review P2-1 / P2-2 (lead decision): the count change and the machine par's real outcome.
  "catalog.preview.par_count_changed", "catalog.preview.par_machine_restarts", "catalog.preview.par_machine_no_default",
  "catalog.preview.par_own_from_auto", "catalog.preview.par_let_restart",
  "catalog.preview.par_keep", "catalog.preview.par_convert",
  "catalog.preview.par_cant_convert", "catalog.preview.par_gm_only", "catalog.preview.slot.weekday",
  "catalog.preview.slot.weekend", "catalog.preview.broken_lines", "catalog.preview.open_orders",
  "catalog.preview.save_shop", "catalog.preview.save_everyone", "catalog.error.generic",
  // EVERY named refusal the item page can get back has its OWN message (lesson 4 of the 2a reviews).
  ...CATALOG_ITEM_ERROR_CODES.map((c) => `catalog.error.${c}`),
  // Catalog Phase 3a: every named recipe-version refusal (0262 + the line ops / gate) has its own message too.
  ...RECIPE_VERSION_ERROR_CODES.map((c) => `catalog.error.${c}`),
  ...MENU_ITEM_SHOP_ERROR_CODES.map((c) => `catalog.error.${c}`),
  // Catalog Phase 3b (CC note 1 #2): the promote's Spanish-name fallback and its optional field.
  ...MENU_PROMOTE_NAME_KEYS,
  // Catalog Phase 3b Task 5: the page libs' own named refusals (preview_stale, nothing_changed).
  ...RECIPE_PAGE_ERROR_CODES.map((c) => `catalog.error.${c}`),
  // Catalog Phase 3b Task 7: every string the recipe / menu / Shop changes / notices screens use (tests/catalog-recipe-i18n.test.ts).
  ...PHASE3B_KEYS,
  "receiving.case_different.button", "receiving.case_different.title",
  "receiving.case_different.note", "receiving.case_different.inner_count", "receiving.case_different.each_weight",
  "receiving.case_different.unit", "receiving.case_different.send", "receiving.case_different.sent",
  "receiving.case_different.already", "receiving.case_different.error", "receiving.case_different.close",
  "notif.pack_change_request.title", "notif.pack_change_request.body", "admin.skus.open_item",
  "admin.skus.pack_requests.title", "admin.skus.pack_requests.review", "admin.skus.cost.use_item_page",
  "admin.skus.error.sku_owned_by_other_shop",
] as const;
const E = en as Record<string, string>;
const S = es as Record<string, string>;

describe("catalog Phase 2b strings", () => {
  it("every required string exists in both languages", () => {
    for (const k of REQUIRED) {
      expect(E[k], `en missing ${k}`).toBeTruthy();
      expect(S[k], `es missing ${k}`).toBeTruthy();
    }
  });
  it("placeholders match between languages", () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    for (const k of REQUIRED) expect(ph(S[k]!), k).toBe(ph(E[k]!));
  });
  it("no stray catalog.* key outside the list, in either language", () => {
    const req = new Set<string>(REQUIRED);
    for (const k of [...Object.keys(E), ...Object.keys(S)].filter((k) => k.startsWith("catalog."))) expect(req.has(k), k).toBe(true);
  });
  it("the readiness errand keys the page reuses, and 2a's two SKU-screen refusals, already exist", () => {
    for (const code of ["no_price", "price_stale", "no_countable_chain", "raw_pack_contents_missing", "weight_estimate", "no_par", "no_rhythm", "no_vendor", "no_order_unit", "recipe_unresolved"]) {
      expect(E[`admin.skus.data.errand.${code}`]).toBeTruthy();
      expect(S[`admin.skus.data.errand.${code}`]).toBeTruthy();
    }
    for (const k of ["admin.skus.error.global_requires_moo", "admin.skus.error.version_changed"]) {
      expect(E[k]).toBeTruthy();
      expect(S[k]).toBeTruthy();
    }
  });
  it("no key appears twice in either file (JSON.parse would silently keep the last)", () => {
    for (const f of ["lib/i18n/en.json", "lib/i18n/es.json"]) {
      const keys = [...readFileSync(f, "utf8").matchAll(/^\s*"([^"]+)":/gm)].map((m) => m[1]);
      expect(keys.length - new Set(keys).size, f).toBe(0);
    }
  });
});

it("plainly discloses replayed creation and unapplied latest edits in both languages", () => {
  expect(E["catalog.new_item.replayed"]).toBe("This item was already created by your earlier submit; your latest changes were not applied. Open it to edit.");
  expect(S["catalog.new_item.replayed"]).toBe("Este artículo ya se creó con tu envío anterior; tus últimos cambios no se aplicaron. Ábrelo para editarlo.");
});

it("discloses ordering, unchanged pars, uncertain saves and the producing recipe", () => {
  expect(E["catalog.swap.ordering_consequence"]).toMatch(/Ordering follows the replacement item/);
  expect(E["catalog.swap.ordering_consequence"]).toMatch(/Par values are unchanged/);
  expect(S["catalog.swap.ordering_consequence"]).toMatch(/valores par no cambian/);
  expect(E["catalog.setup.guide_unconfirmed"]).toMatch(/may have been saved.*Refresh/);
  expect(S["catalog.setup.guide_unconfirmed"]).toMatch(/puede haberse guardado/);
  expect(E["catalog.error.uses_shop_only_item"]).toMatch(/recipe that produces/);
  expect(S["catalog.error.uses_shop_only_item"]).toMatch(/receta que produce/);
});
