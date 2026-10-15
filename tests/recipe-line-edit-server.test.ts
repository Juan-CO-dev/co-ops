/**
 * Catalog Phase 1 — editing a recipe line in place, over the PREDICATE-AWARE fake (Astra r1
 * P2-4 + P2-5): the write really is scoped to (id, recipe_id, expected values); a concurrent
 * change is a 409 with nothing written; the product-unit rule and the item cycle guard refuse
 * through BOTH add and update; the audit's before/after are the matched and returned rows.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type Row } from "./fake-supabase";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./fake-supabase").FakeDb,
  audit: vi.fn(),
  session: vi.fn(),
  step: vi.fn(),
}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db.client }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/session", () => ({ requireSession: h.session }));
vi.mock("@/lib/admin/step-up", () => ({ assertStepUp: h.step }));

import { addRecipeInput, updateRecipeInput } from "@/lib/recipes";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/admin/recipes/[id]/inputs/[inputId]/route";
import { isDestructive } from "@/lib/destructive-actions";
import { NON_DESTRUCTIVE_ACTIONS } from "@/lib/audit-actions";
import { beginLineEdit, type RecipeLineFields } from "@/lib/recipe-line-shared";
import type { AuthContext } from "@/lib/session";

const R = "recipe-1";
const R2 = "recipe-2";
const LINE = "line-1";
const gm = { user: { id: "u-gm", role: "gm" } } as unknown as AuthContext;
const agm = { user: { id: "u-agm", role: "agm" } } as unknown as AuthContext;

beforeEach(() => {
  vi.clearAllMocks();
  h.step.mockReturnValue({ ok: true });
  // R outputs item-x. R2 outputs item-y and CONSUMES item-x — so item-y (and item-x itself)
  // inside R would close a loop.
  h.db = fakeSupabase({
    recipe_inputs: [
      { id: LINE, recipe_id: R, component_sku_id: "sku-ham", component_item_id: null, component_product_id: null, quantity: 4, unit: "oz", each_container_label: null, portioned: false, display_order: 1 },
      { id: "line-r2", recipe_id: R2, component_sku_id: "sku-salt", component_item_id: null, component_product_id: null, quantity: 1, unit: "oz", each_container_label: null, portioned: false, display_order: 1 },
      { id: "line-r2-x", recipe_id: R2, component_sku_id: null, component_item_id: "item-x", component_product_id: null, quantity: 1, unit: "qt", each_container_label: null, portioned: false, display_order: 2 },
    ],
    recipe_outputs: [
      { id: "out-1", recipe_id: R, output_item_id: "item-x", output_menu_item_id: null },
      { id: "out-2", recipe_id: R2, output_item_id: "item-y", output_menu_item_id: null },
    ],
    products: [{ id: "p-ham", active: true }, { id: "p-old", active: false }],
    measure_units: [{ label: "oz", active: true }, { label: "each", active: true }],
  });
});

const line = (over: Partial<RecipeLineFields> = {}): RecipeLineFields => ({
  componentSkuId: "sku-ham", componentItemId: null, componentProductId: null,
  quantity: 4, unit: "oz", eachContainerLabel: null, portioned: false, ...over,
});
const edit = (actor: AuthContext, next: RecipeLineFields, expected = line(), recipeId = R, inputId = LINE) =>
  updateRecipeInput(actor, { recipeId, inputId, line: next, expected });
const add = (over: Record<string, unknown>) =>
  addRecipeInput(gm, { recipeId: R, quantity: 1, ...over } as Parameters<typeof addRecipeInput>[1]);
const rowOf = (id: string) => (h.db.tables.recipe_inputs as Row[]).find((r) => r.id === id)!;
const updates = () => h.db.writes.filter((w) => w.op === "update");

describe("updateRecipeInput — the lib is the authority", () => {
  it("refuses below GM, two targets, or a zero quantity before any database work", async () => {
    await expect(edit(agm, line({ quantity: 5 }))).rejects.toMatchObject({ status: 403, code: "forbidden" });
    await expect(edit(gm, line({ componentItemId: "item-1" }))).rejects.toMatchObject({ code: "invalid_component" });
    await expect(edit(gm, line({ quantity: 0 }))).rejects.toMatchObject({ code: "invalid_quantity" });
    expect(h.db.writes).toEqual([]);
  });

  it("an edit that changes nothing writes nothing and audits nothing (whitespace is not a change)", async () => {
    await expect(edit(gm, line(), line({ unit: " oz " }))).resolves.toEqual({ changed: false });
    expect(h.db.writes).toEqual([]);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("updates IN PLACE only while the row still equals what the client saw, and audits the true before/after", async () => {
    await expect(edit(gm, line({ quantity: 5 }))).resolves.toEqual({ changed: true });
    expect(updates()).toHaveLength(1);
    expect(updates()[0]!.matched).toBe(1);
    expect(rowOf(LINE).quantity).toBe(5);
    expect(h.audit).toHaveBeenCalledTimes(1);
    expect(h.audit.mock.calls[0]![0]).toMatchObject({
      actorId: "u-gm", action: "recipe_input.update", resourceTable: "recipe_inputs", resourceId: LINE,
      metadata: {
        recipe_id: R, changed_fields: ["quantity"],
        before: { component_sku_id: "sku-ham", quantity: 4, unit: "oz" },
        after: { component_sku_id: "sku-ham", quantity: 5, unit: "oz" },
      },
    });
  });

  it("someone else changed the line first → 409 line_changed, nothing overwritten, nothing audited", async () => {
    rowOf(LINE).quantity = 6;
    await expect(edit(gm, line({ quantity: 5 }))).rejects.toMatchObject({ status: 409, code: "line_changed" });
    expect(rowOf(LINE).quantity).toBe(6);
    expect(updates()[0]!.matched).toBe(0);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("refresh while editing (Astra r2 #1): another manager swaps the ingredient, the page refreshes, the stale save is a 409", async () => {
    // Editing began on the line as it stood: Ham, 4 oz.
    const started = beginLineEdit({
      id: LINE, componentSkuId: "sku-ham", componentItemId: null, componentProductId: null, componentName: "Ham",
      kind: "sku", componentRetired: false, quantity: 4, unit: "oz", eachContainerLabel: null, portioned: false, displayOrder: 1,
    });
    rowOf(LINE).component_sku_id = "sku-turkey"; // the other manager's save; the refreshed view now says Turkey
    await expect(edit(gm, { ...started.initial, quantity: 5 }, started.expected)).rejects.toMatchObject({ status: 409, code: "line_changed" });
    expect(rowOf(LINE)).toMatchObject({ component_sku_id: "sku-turkey", quantity: 4 });
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("a line id from ANOTHER recipe is a 404 and the row is untouched (the recipe bind is real)", async () => {
    const otherSeen = line({ componentSkuId: "sku-salt", unit: "oz", quantity: 1 });
    await expect(edit(gm, { ...otherSeen, quantity: 2 }, otherSeen, R, "line-r2")).rejects.toMatchObject({ status: 404, code: "edge_not_found" });
    expect(rowOf("line-r2").quantity).toBe(1);
    expect(updates()[0]!.matched).toBe(0);
  });

  it("swapping the ingredient is ONE update that sets the new target and clears the others", async () => {
    await expect(edit(gm, line({ componentSkuId: null, componentProductId: "p-ham", unit: "each" }))).resolves.toEqual({ changed: true });
    expect(rowOf(LINE)).toMatchObject({ component_sku_id: null, component_item_id: null, component_product_id: "p-ham", unit: "each" });
  });
});

describe("the SAME rules refuse through add AND update", () => {
  it("a product line measured in a vendor's pack label", async () => {
    await expect(add({ componentProductId: "p-ham", unit: "case" })).rejects.toMatchObject({ code: "product_line_needs_measure_unit" });
    await expect(edit(gm, line({ componentSkuId: null, componentProductId: "p-ham", unit: "case" }))).rejects.toMatchObject({ code: "product_line_needs_measure_unit" });
    expect(h.db.writes).toEqual([]);
  });

  it("a retired product", async () => {
    await expect(add({ componentProductId: "p-old", unit: "oz" })).rejects.toMatchObject({ code: "invalid_component_product" });
    await expect(edit(gm, line({ componentSkuId: null, componentProductId: "p-old", unit: "oz" }))).rejects.toMatchObject({ code: "invalid_component_product" });
    expect(h.db.writes).toEqual([]);
  });

  it("an item line that would make the recipe consume its own output (directly or through another recipe)", async () => {
    await expect(add({ componentItemId: "item-x", unit: "qt" })).rejects.toMatchObject({ code: "would_create_cycle" });
    await expect(add({ componentItemId: "item-y", unit: "qt" })).rejects.toMatchObject({ code: "would_create_cycle" });
    await expect(edit(gm, line({ componentSkuId: null, componentItemId: "item-y", unit: "qt" }))).rejects.toMatchObject({ code: "would_create_cycle" });
    expect(h.db.writes).toEqual([]);
  });

  it("…and a harmless item line goes through both", async () => {
    await expect(add({ componentItemId: "item-z", unit: "qt" })).resolves.toEqual({ id: expect.any(String) });
    await expect(edit(gm, line({ componentSkuId: null, componentItemId: "item-z", unit: "qt" }))).resolves.toEqual({ changed: true });
  });
});

describe("recipe_input.update is a human change to the kitchen", () => {
  it("is registered destructive, like its add and remove siblings", () => {
    expect(isDestructive("recipe_input.add")).toBe(true);
    expect(isDestructive("recipe_input.remove")).toBe(true);
    expect(isDestructive("recipe_input.update")).toBe(true);
    expect((NON_DESTRUCTIVE_ACTIONS as readonly string[]).includes("recipe_input.update")).toBe(false);
  });
});

describe("PATCH /api/admin/recipes/[id]/inputs/[inputId]", () => {
  const call = (body: unknown) =>
    PATCH(
      new NextRequest(`http://localhost/api/admin/recipes/${R}/inputs/${LINE}`, { method: "PATCH", body: JSON.stringify(body) }),
      { params: Promise.resolve({ id: R, inputId: LINE }) },
    );
  const body = { line: { componentSkuId: "sku-ham", quantity: 5, unit: "oz" }, expected: { componentSkuId: "sku-ham", quantity: 4, unit: "oz", eachContainerLabel: null, portioned: false } };

  it("401 without a session", async () => {
    h.session.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await call(body)).status).toBe(401);
  });

  it("403 below GM, before the step-up check", async () => {
    h.session.mockResolvedValue(agm);
    expect((await call(body)).status).toBe(403);
    expect(h.step).not.toHaveBeenCalled();
  });

  it("asks for the Tier E edit window and stops on a stale unlock", async () => {
    h.session.mockResolvedValue(gm);
    h.step.mockReturnValue({ ok: false, code: "step_up_stale" });
    const res = await call(body);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("step_up_stale");
    expect(h.step).toHaveBeenCalledWith(gm, "E");
    expect(h.db.writes).toEqual([]);
  });

  it("400 on a malformed line or a missing expected line, before any database work", async () => {
    h.session.mockResolvedValue(gm);
    expect((await (await call({ ...body, line: { componentSkuId: "sku-ham", quantity: 0 } })).json()).code).toBe("invalid_quantity");
    expect((await call({ line: body.line })).status).toBe(400);
    expect(h.db.writes).toEqual([]);
  });

  it("200 { changed: true } on a real edit; 409 line_changed when the line moved underneath", async () => {
    h.session.mockResolvedValue(gm);
    const ok = await call(body);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, changed: true });
    const stale = await call({ ...body, line: { ...body.line, quantity: 7 } }); // expected still says 4; the row is 5 now
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe("line_changed");
  });
});
