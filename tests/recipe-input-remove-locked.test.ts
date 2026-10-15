/** Catalog Phase 3a — the legacy recipe-line delete runs under the recipe-graph lock (0262 remove_recipe_input_atomic). */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({ rpc, from: () => { throw new Error("no direct table write expected"); } }) }));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
import { removeRecipeEdge } from "@/lib/recipes";

// Catalog Phase 3b: deleting a GLOBAL recipe line is MoO+.
const gm = { user: { id: "u1", role: "moo" }, role: "moo", level: 8, locations: [] } as never;

describe("removeRecipeEdge(recipe_inputs)", () => {
  it("deletes through remove_recipe_input_atomic and never touches the table directly", async () => {
    rpc.mockResolvedValueOnce({ data: { id: "ri-1", recipe_id: "r" }, error: null });
    await removeRecipeEdge(gm, { table: "recipe_inputs", id: "ri-1" });
    expect(rpc).toHaveBeenCalledWith("remove_recipe_input_atomic", { p_input_id: "ri-1", p_actor: "u1" });
  });
  it("a missing line is the named 404", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "edge_not_found" } });
    await expect(removeRecipeEdge(gm, { table: "recipe_inputs", id: "ri-x" })).rejects.toMatchObject({ status: 404, code: "edge_not_found" });
  });
  it("the source holds no direct delete of a recipe line any more", () => {
    const src = readFileSync("lib/recipes.ts", "utf8");
    expect(src).not.toContain(".from(args.table).delete(");
  });
});
