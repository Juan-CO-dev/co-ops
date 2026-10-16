import { beforeEach, expect, it, vi } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const state = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, unknown>[]>, reads: [] as string[] }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({ from(table: string) {
  state.reads.push(table);
  let rows = state.rows[table] ?? [];
  let columns: string[] | null = null;
  const q = {
    select(value: string) { columns = value.split(",").map(x => x.trim()); return q; },
    in(key: string, values: unknown[]) { rows = rows.filter(row => values.includes(row[key])); return q; },
    eq(key: string, value: unknown) { rows = rows.filter(row => row[key] === value); return q; },
    order() { return q; }, range() { return q; }, returns() { return q; },
    then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: rows.map(row => columns ? Object.fromEntries(columns.map(key => [key, row[key]])) : row), error: null }).then(resolve); },
  };
  return q;
} }) }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/prep-consumption", () => ({ loadRecipeGraph: vi.fn() }));
import { preflightQuoteLines } from "@/lib/catering/quotes";
import { resolveErrorKey } from "@/components/catering/quotes/shared";
import { loadBatchContextForItems } from "@/lib/batch-prep";
import { buildRecipeGraph } from "@/lib/prep-consumption-graph";

beforeEach(() => { state.rows = {}; state.reads = []; });
it.each(["items", "menu_items"])("catering refuses owned %s, even when the reference was on the wrong FK side", async table => {
  state.rows[table] = [{ id: "owned", active: true, location_id: "shop-a" }];
  for (const ref of [{ itemId: "owned" }, { menuItemId: "owned" }]) {
    await expect(preflightQuoteLines([{ ...ref, quantity: 1, unitPriceCents: 100 }])).rejects.toMatchObject({ status: 400, code: "catering_owned_item_refused" });
  }
});
it("catering permits active global references and refuses inactive ones", async () => {
  state.rows.items = [{ id: "global", active: true, location_id: null }, { id: "retired", active: false, location_id: null }];
  await expect(preflightQuoteLines([{ itemId: "global", quantity: 1, unitPriceCents: 100 }])).resolves.toBeUndefined();
  await expect(preflightQuoteLines([{ itemId: "retired", quantity: 1, unitPriceCents: 100 }])).rejects.toMatchObject({ code: "unknown_item" });
});
it("the owned catering refusal has a friendly translation mapping", () => {
  expect(resolveErrorKey("catering_owned_item_refused")).toBe("catering.quotes.error.catering_owned_item_refused");
  for (const dictionary of [en, es]) expect(dictionary[resolveErrorKey("catering_owned_item_refused")]).toBeTruthy();
});
it.each([null, "shop-a", "shop-b"])("batch context hides producers outside scope %s", async scope => {
  state.rows.recipes = [null, "shop-a", "shop-b"].map((owner, i) => ({ id: `r${i}`, location_id: owner, name: `Recipe ${i}`, recipe_type: "production", active: true, batch_mode: false, shelf_life_days: 5, created_at: null }));
  state.rows.recipe_outputs = [0, 1, 2].map(i => ({ recipe_id: `r${i}`, output_item_id: `i${i}`, yield: 2 }));
  const contexts = await loadBatchContextForItems(["i0", "i1", "i2"], scope, buildRecipeGraph([], new Map(), new Map()));
  expect([...contexts.keys()]).toEqual(scope === null ? ["i0"] : scope === "shop-a" ? ["i0", "i1"] : ["i0", "i2"]);
});
