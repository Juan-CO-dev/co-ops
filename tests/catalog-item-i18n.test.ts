/** Catalog Phase 2b — every new string ships en AND es (AGENTS.md translate-from-day-one), by NAME. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { CATALOG_ITEM_ERROR_CODES } from "@/lib/catalog/sku-item-shared";

const REQUIRED = [
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
  "catalog.item.see_changes_everyone", "catalog.item.saved", "catalog.price.current", "catalog.price.none",
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
