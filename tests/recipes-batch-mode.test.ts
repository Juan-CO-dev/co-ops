/**
 * Unit spine — recipes admin, batch vs bottle (0215, plan S r4 Phase A, group 3).
 *
 * `lib/recipes.ts` is a service-role module with no pure core, so these are SOURCE
 * assertions (the tests/recipes-production-wiring.test.ts posture): each guarantee is an
 * ORDERING or an ABSENCE no export-level test can observe.
 *
 *   · the batch_mode flag never goes through a plain column write — it is the RPC
 *     set_recipe_batch_mode (the recipe row lock is the one-output rule's serialisation point);
 *   · outputs enter through add_recipe_output and leave through remove_recipe_output — never a
 *     direct insert/delete on recipe_outputs any more (Astra r2 #2: every output writer locks);
 *   · shelf life is validated BEFORE the update, like menu_price (a NaN would null the column);
 *   · the named raises map to named statuses, and every code the lib can answer has an en + es
 *     string behind the builder's resolver.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { isValidShelfLifeDays } from "@/lib/recipes-shared";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

function fnBody(src: string, name: string): string {
  const at = src.indexOf(`function ${name}(`);
  expect(at, `${name} not found`).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport ", at + 1);
  return src.slice(at, next === -1 ? src.length : next);
}

const lib = read("lib", "recipes.ts");

describe("isValidShelfLifeDays — whole days, at least one", () => {
  it("accepts 1 and 5, refuses 0, negatives, fractions, NaN and strings", () => {
    expect(isValidShelfLifeDays(1)).toBe(true);
    expect(isValidShelfLifeDays(5)).toBe(true);
    expect(isValidShelfLifeDays(0)).toBe(false);
    expect(isValidShelfLifeDays(-2)).toBe(false);
    expect(isValidShelfLifeDays(2.5)).toBe(false);
    expect(isValidShelfLifeDays(Number.NaN)).toBe(false);
    expect(isValidShelfLifeDays("5")).toBe(false);
  });
});

describe("updateRecipe — batch_mode goes through the RPC; shelf life is validated before the write", () => {
  const body = fnBody(lib, "updateRecipe");
  it("calls set_recipe_batch_mode and never writes batch_mode as a column", () => {
    expect(body).toMatch(/rpc\("set_recipe_batch_mode"/);
    expect(body).not.toMatch(/upd\.batch_mode/);
  });
  it("validates shelfLifeDays before `.update(`", () => {
    const validateAt = body.indexOf("invalid_shelf_life_days");
    const updateAt = body.indexOf(".update(upd");
    expect(validateAt).toBeGreaterThan(-1);
    expect(updateAt).toBeGreaterThan(-1);
    expect(validateAt).toBeLessThan(updateAt);
  });
  it("maps the RPC's named raises instead of throwing an opaque error", () => {
    expect(body).toMatch(/rpcRecipeError\(rpcErr, BATCH_MODE_RPC_ERRORS\)/);
  });
});

describe("outputs: every writer is an RPC under the recipe row lock", () => {
  it("addRecipeOutput inserts through add_recipe_output, not a direct insert", () => {
    const body = fnBody(lib, "addRecipeOutput");
    expect(body).toMatch(/rpc\("add_recipe_output"/);
    expect(body).not.toMatch(/from\("recipe_outputs"\)\.insert/);
  });
  it("removeRecipeEdge deletes an output through remove_recipe_output and keeps the direct path for inputs only", () => {
    const body = fnBody(lib, "removeRecipeEdge");
    expect(body).toMatch(/rpc\("remove_recipe_output"/);
    // The remaining `.delete(` is reached only after the outputs branch has returned.
    const rpcAt = body.indexOf('rpc("remove_recipe_output"');
    const returnAt = body.indexOf("return;", rpcAt);
    const deleteAt = body.indexOf(".delete(");
    expect(returnAt).toBeGreaterThan(rpcAt);
    expect(deleteAt).toBeGreaterThan(returnAt);
  });
  it("createRecipeFull refuses batch_mode with anything but one ITEM output before the RPC, and sends batch_mode in the header", () => {
    const body = fnBody(lib, "createRecipeFull");
    const checkAt = body.indexOf("batch_mode_single_output");
    const rpcAt = body.indexOf('rpc("create_recipe_full"');
    expect(checkAt).toBeGreaterThan(-1);
    expect(checkAt).toBeLessThan(rpcAt);
    expect(body).toMatch(/batch_mode: draft\.batchMode === true/);
  });
  it("createRecipe (header only) refuses batchMode true — a header has no output yet", () => {
    expect(fnBody(lib, "createRecipe")).toMatch(/batch_mode_requires_output/);
  });
});

describe("the named statuses have strings in both languages", () => {
  const codes = ["duplicate_active_producer", "batch_mode_single_output", "batch_mode_requires_output", "invalid_shelf_life_days", "edge_not_found", "recipe_not_found"];
  it.each(codes)("recipes.error.%s exists in en and es and the builder resolver knows it", (code) => {
    expect((en as Record<string, string>)[`recipes.error.${code}`]).toBeTruthy();
    expect((es as Record<string, string>)[`recipes.error.${code}`]).toBeTruthy();
    expect(read("components", "admin", "recipes", "shared.ts")).toContain(`"${code}"`);
  });
  it("the BATCH_MODE_RPC_ERRORS map carries exactly the statuses the app-layer checks return", () => {
    const at = lib.indexOf("const BATCH_MODE_RPC_ERRORS");
    const block = lib.slice(at, lib.indexOf("};", at));
    expect(block).toMatch(/duplicate_active_producer: 409/);
    expect(block).toMatch(/batch_mode_single_output: 422/);
    expect(block).toMatch(/recipe_not_found: 404/);
    expect(block).toMatch(/edge_not_found: 404/);
    expect(block).toMatch(/invalid_shelf_life_days: 400/);
  });
  it.each(["recipes.builder.shelf_life_days", "recipes.builder.shelf_life_hint", "recipes.builder.batch_mode", "recipes.builder.batch_mode_hint"])("%s exists in en and es", (key) => {
    expect((en as Record<string, string>)[key]).toBeTruthy();
    expect((es as Record<string, string>)[key]).toBeTruthy();
  });
});
