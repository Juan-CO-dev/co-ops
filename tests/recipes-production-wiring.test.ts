/**
 * Unit spine — the recipes/production wiring-audit fixes (2026-08-29).
 *
 * All three guarantees live in DB-coupled writers (`lib/recipes.ts`, `lib/production.ts`
 * are service-role modules with no pure core to extract), so they are asserted AT THE
 * SOURCE — the house fallback posture, same as tests/vendor-order-minimum.test.ts and
 * tests/dynamic-pars-walker.test.ts § "loadWalkerData's row rules", and for the same
 * reason: every one of these is an ABSENCE or an ORDERING, and no test over the modules'
 * exports can observe either.
 *
 *   · menu_price VALIDATION — the two failure modes are both invisible at the call site:
 *     supabase-js JSON-serialises NaN to `null` (a 200 ok that CLEARS the price), and a
 *     value <= 0 trips a CHECK that this lib rethrows as a plain Error (an unhandled 500).
 *   · menu_price is written OUTSIDE the sold-directly branch — the assertion is that the
 *     assignment is not nested in it, which is a position, not a value.
 *   · rung ⓪ IN PRODUCTION — a retired product must stop authorising conversions, and the
 *     module must still NOT run the member ladder (the amplifier fix depends on it not).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

/** The body of a top-level `export async function <name>` / `async function <name>`. */
function fnBody(src: string, name: string): string {
  const at = src.indexOf(`function ${name}(`);
  expect(at, `${name} not found`).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport ", at + 1);
  return src.slice(at, next === -1 ? src.length : next);
}

describe("setItemSoldDirectly validates menu_price — the silent-null and the opaque-500", () => {
  const src = read("lib", "recipes.ts");
  const body = fnBody(src, "setItemSoldDirectly");

  it("carries the SAME predicate as the column's other writer, character for character", () => {
    // lib/admin/templates.ts updateRegistryItemDefinition already guards items.menu_price.
    // Two writers of one column with two opinions about what is valid is the drift this
    // asserts away: if either predicate is retuned, this fails until both are.
    const predicate =
      "!== undefined && args.menuPrice !== null && (!Number.isFinite(args.menuPrice) || args.menuPrice <= 0)";
    expect(body).toContain(predicate);
    expect(body).toContain('throw new RecipeError(400, "invalid_menu_price")');
    expect(read("lib", "admin", "templates.ts")).toContain(predicate);
  });

  it("refuses BEFORE the value can reach the update patch", () => {
    // NaN reaching `.update()` is not an error anywhere in the stack — it serialises to
    // null and the CHECK (`is null or > 0`, migration 0099) is satisfied by the null.
    expect(body.indexOf("invalid_menu_price")).toBeLessThan(body.indexOf("upd.menu_price"));
  });

  it("the 400 is resolvable to a real message in BOTH locales, not 'generic'", () => {
    // resolveErrorKey falls back to `generic` for any code outside its set, which would
    // turn a precise, actionable refusal into "something went wrong".
    expect(read("components", "admin", "templates", "shared.ts")).toContain('"invalid_menu_price"');
    const enKeys = en as Record<string, string>;
    const esKeys = es as Record<string, string>;
    expect(enKeys["admin.templates.error.invalid_menu_price"]).toBeTruthy();
    expect(esKeys["admin.templates.error.invalid_menu_price"]).toBeTruthy();
    expect(esKeys["admin.templates.error.invalid_menu_price"]).not.toBe(enKeys["admin.templates.error.invalid_menu_price"]);
  });

  it("createMenuItem guards its own table's CHECK — >= 0, not > 0", () => {
    // menu_items.menu_price is `is null or >= 0` (0103) while items.menu_price is `> 0`
    // (0099). Each writer validates the constraint it actually faces; copying one
    // predicate to the other table would refuse a legal 0 or admit an illegal one.
    const create = fnBody(src, "createMenuItem");
    expect(create).toContain("!Number.isFinite(input.menuPrice) || input.menuPrice < 0");
    expect(create).toContain('throw new RecipeError(400, "invalid_menu_price")');
  });
});

describe("menu_price is written whenever it is SUPPLIED, not only when sold_directly is on", () => {
  const body = fnBody(read("lib", "recipes.ts"), "setItemSoldDirectly");

  it("assigns the column exactly once, and OUTSIDE the sold-directly branch", () => {
    // The bug's exact shape: the assignment nested in the `if (args.soldDirectly)` arm, so
    // the else arm returned 200 ok having dropped the manager's edit. Position is the
    // whole guarantee — a second assignment, or one that moves back inside, fails here.
    expect((body.match(/upd\.menu_price\s*=/g) ?? []).length).toBe(1);
    // The else arm (`upd.sell_portion = null`) must come FIRST; the price write after it
    // is therefore outside both arms.
    expect(body.indexOf("upd.sell_portion = null")).toBeLessThan(body.indexOf("upd.menu_price ="));
    expect(body).toContain("if (args.menuPrice !== undefined) upd.menu_price = args.menuPrice;");
  });

  it("an omitted field still leaves the column alone", () => {
    // `!== undefined` and not `!= null`: a caller that does not name the field must not
    // have it cleared, while a caller that sends an explicit null is clearing it on purpose.
    expect(body).not.toMatch(/upd\.menu_price\s*=\s*args\.menuPrice\s*\?\?/);
    expect(body).not.toContain("if (args.menuPrice != null) upd.menu_price");
  });

  it("the audit row records the price only when the write touched it", () => {
    // An unconditional `menu_price: args.menuPrice ?? null` would assert a clear that
    // never happened on every ordinary sold-directly toggle.
    expect(body).toContain("...(args.menuPrice !== undefined ? { menu_price: args.menuPrice } : {})");
  });
});

describe("the one-active-producer guard is app-layer only — pin what actually holds", () => {
  const src = read("lib", "recipes.ts");

  it("both write paths still run the check and refuse with the same code", () => {
    // There is NO DB backstop: `active` lives on `recipes`, not `recipe_outputs`, so the
    // state cannot be expressed as a partial unique index (0103 creates plain indexes
    // only), and check-then-insert is not atomic. Closing the race needs a trigger or an
    // advisory lock inside create_recipe_full — a migration, filed separately. Until then
    // the app-layer guard is the ONLY guard, so losing it silently is the real hazard.
    expect((src.match(/activeProducerExists\(/g) ?? []).length).toBe(3); // 1 definition + 2 call sites
    expect(fnBody(src, "addRecipeOutput")).toContain('throw new RecipeError(409, "duplicate_active_producer")');
    expect(fnBody(src, "createRecipeFull")).toContain('throw new RecipeError(409, "duplicate_active_producer")');
  });

  it("the gap is documented at the guard rather than read as a settled guarantee", () => {
    expect(src).toContain("KNOWN GAP");
    expect(src).toContain("NOT atomic");
  });
});

describe("production honours rung ⓪ — a retired product stops authorising conversions", () => {
  const src = read("lib", "production.ts");

  it("reads products.active as a FACT, unfiltered, so the cause can be named", () => {
    // loadProductIndex's stated law: never `.eq("active", true)` the products select — a
    // filtered-away row poisons with no name. The flag rides into code and the refusal
    // names the identity.
    const body = fnBody(src, "loadRetiredProductIds");
    expect(body).toContain('.from("products").select("id, active")');
    expect(body).not.toContain('.eq("active", true)');
    expect(body).toContain("(p.active ?? true) === false");
  });

  it("NEVER runs the member ladder — the amplifier fix depends on it not", () => {
    // "Never resolve a product a second time in a consumer" (AGENTS.md). Production is not
    // choosing a vendor: the cook is holding one, and ANY active member of a LIVE product
    // is a valid thing to record. Only rung ⓪, the identity-level fact, belongs here.
    // Call-shaped, so the doc comment may still NAME the ladder it deliberately declines.
    expect(src).not.toMatch(/resolveProductMember\(/);
    expect(src).not.toMatch(/loadProductIndex\(/);
  });

  it("the dropdown drops a retired product's pins BEFORE the pins are read", () => {
    const body = fnBody(src, "loadSkuToItems");
    expect(body).toContain("const retiredProductIds = await loadRetiredProductIds(sb,");
    expect(body).toContain("filter((id) => !retiredProductIds.has(id))");
    // The exact spelling of the bug: every membership expanded, retirement never asked.
    expect(body).not.toContain("const productIds = [...membersByProduct.keys()];");
    expect(body.indexOf("retiredProductIds")).toBeLessThan(body.indexOf('.in("component_product_id"'));
  });

  it("the SKU-pin pass is untouched — a directly-named SKU still makes what it made", () => {
    // The refusal is scoped to the PRODUCT-expansion half. A recipe that names this SKU
    // itself has nothing to do with any product's retirement.
    const load = fnBody(src, "loadSkuToItems");
    expect(load).toContain('.in("component_sku_id", skuIds)');
    expect(fnBody(src, "recordProduction")).toContain('.eq("component_sku_id", input.inputSkuId)');
  });

  it("recordProduction refuses with a NAMED code, only when the retired pin was the sole authority", () => {
    const body = fnBody(src, "recordProduction");
    // Two authorities, tracked apart: merging them into one id set would make the refusal
    // unattributable and would wrongly refuse a valid direct-SKU conversion.
    expect(body).toContain("let validBySkuPin = false");
    expect(body).toContain("let validByProductPin = false");
    expect(body).toContain("if (!(validBySkuPin || (validByProductPin && !productRetired)))");
    expect(body).toContain('throw new ProductionError(409, "retired_product"');
    // …and the generic message stays for a genuine SKU/item mismatch — a wrong errand is
    // worse than a vague one.
    expect(body).toContain('throw new ProductionError(400, "invalid_conversion"');
    expect(body.indexOf("retired_product")).toBeLessThan(body.indexOf('"invalid_conversion"'));
  });

  it("the refusal renders as a message, in en AND es, per translate-from-day-one", () => {
    // ProductionForm.tsx renders `production.error.<code>` verbatim; a missing key would
    // surface the raw key string to a cook at the bench.
    const enKeys = en as Record<string, string>;
    const esKeys = es as Record<string, string>;
    expect(enKeys["production.error.retired_product"], "missing from en.json").toBeTruthy();
    expect(esKeys["production.error.retired_product"], "missing from es.json").toBeTruthy();
    expect(esKeys["production.error.retired_product"]).not.toBe(enKeys["production.error.retired_product"]);
  });
});
