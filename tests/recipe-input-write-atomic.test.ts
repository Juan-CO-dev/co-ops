/**
 * Astra full-branch review #3 — recipe line writes are serialised in the database (0258). The
 * recursive CTE's cycle semantics are mirrored by itemLineWouldCycle and tested here; the
 * migration is pinned (lock, CTE, compare-and-set, refusals, grants); both lib writers call the
 * RPCs; and the advisory-lock key is ONE key shared by both RPCs and the TS constant.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { itemLineWouldCycle, outputItemWouldCycle, RECIPE_GRAPH_LOCK_KEY } from "@/lib/recipe-graph-shared";

const sql = readFileSync("supabase/migrations/0258_recipe_input_write_atomic.sql", "utf8");
const lib = readFileSync("lib/recipes.ts", "utf8");

// R1 makes X from (Y); R2 makes Y from (Z); R3 makes Z from a SKU only; R4 also makes Y (a
// second producer) from (W); R5 has no item output.
const outputs = [
  { recipe_id: "R1", output_item_id: "X" },
  { recipe_id: "R2", output_item_id: "Y" },
  { recipe_id: "R3", output_item_id: "Z" },
  { recipe_id: "R4", output_item_id: "Y" },
  { recipe_id: "R5", output_item_id: null },
];
const inputs = [
  { id: "l1", recipe_id: "R1", component_item_id: "Y" },
  { id: "l2", recipe_id: "R2", component_item_id: "Z" },
  { id: "l3", recipe_id: "R3", component_item_id: null },
  { id: "l4", recipe_id: "R4", component_item_id: "W" },
];

describe("itemLineWouldCycle — the 0258 CTE's semantics", () => {
  it("a recipe consuming its own output is a cycle", () => {
    expect(itemLineWouldCycle({ recipeId: "R1", itemId: "X" }, outputs, inputs)).toBe(true);
  });

  it("transitively: R3 consuming X (X ← Y ← Z, and Z is R3's own output) is a cycle", () => {
    expect(itemLineWouldCycle({ recipeId: "R3", itemId: "X" }, outputs, inputs)).toBe(true);
  });

  it("EVERY producer of an item is walked (Y has two: R2 and R4)", () => {
    // A recipe R6 making W that consumes Y: Y's producer R4 consumes W → loop through the SECOND producer.
    const o2 = [...outputs, { recipe_id: "R6", output_item_id: "W" }];
    expect(itemLineWouldCycle({ recipeId: "R6", itemId: "Y" }, o2, inputs)).toBe(true);
  });

  it("a harmless item, an unrelated item, and a recipe with no item outputs are not cycles", () => {
    expect(itemLineWouldCycle({ recipeId: "R1", itemId: "Q" }, outputs, inputs)).toBe(false);
    expect(itemLineWouldCycle({ recipeId: "R2", itemId: "W" }, outputs, inputs)).toBe(false);
    expect(itemLineWouldCycle({ recipeId: "R5", itemId: "X" }, outputs, inputs)).toBe(false);
  });

  it("an existing loop in the graph still terminates (UNION semantics)", () => {
    const loopOut = [{ recipe_id: "A", output_item_id: "a" }, { recipe_id: "B", output_item_id: "b" }];
    const loopIn = [{ id: "x", recipe_id: "A", component_item_id: "b" }, { id: "y", recipe_id: "B", component_item_id: "a" }];
    expect(itemLineWouldCycle({ recipeId: "C", itemId: "a" }, loopOut, loopIn)).toBe(false);
  });

  it("the line being edited is skipped (its old value is about to be replaced)", () => {
    // R2's line l2 (Z) is what makes R3 → X a loop; with l2 excluded the walk stops at Y.
    expect(itemLineWouldCycle({ recipeId: "R3", itemId: "X", excludeInputId: "l2" }, outputs, inputs)).toBe(false);
  });
});

describe("0258_recipe_input_write_atomic (authored SQL)", () => {
  it("carries the house gate line", () => {
    expect(sql).toContain("NOT YET APPLIED — apply via MCP after review");
  });

  it("ONE lock key, shared by all four writers and the TS constant, taken before the check and the write", () => {
    const keys = [...sql.matchAll(/pg_advisory_xact_lock\((\d+)\)/g)].map((m) => m[1]);
    expect(keys).toHaveLength(4);
    expect(new Set(keys)).toEqual(new Set([RECIPE_GRAPH_LOCK_KEY]));
    for (const fn of ["add_recipe_input_atomic", "update_recipe_input_atomic"]) {
      const body = sql.slice(sql.indexOf(`create or replace function public.${fn}(`));
      const end = body.indexOf("\n$$;");
      const lockAt = body.indexOf(`pg_advisory_xact_lock(${RECIPE_GRAPH_LOCK_KEY})`);
      expect(lockAt, fn).toBeGreaterThan(-1);
      expect(lockAt, fn).toBeLessThan(end);
      expect(lockAt, fn).toBeLessThan(body.indexOf("recipe_input_would_cycle("));
    }
  });

  it("the cycle check is a recursive CTE over recipe_outputs / recipe_inputs that terminates (UNION)", () => {
    expect(sql).toContain("with recursive targets as (");
    expect(sql).toMatch(/reach\(item_id\) as \(\s*select p_item_id\s*union\s*select ri\.component_item_id/);
    expect(sql).not.toMatch(/union all/i);
    expect(sql).toContain("(p_exclude_input_id is null or ri.id <> p_exclude_input_id)");
  });

  it("the update is a compare-and-set on the FULL expected snapshot, null-safe, and returns the row", () => {
    for (const col of ["component_sku_id", "component_item_id", "component_product_id", "unit", "each_container_label", "portioned"]) {
      expect(sql).toContain(`ri.${col} is not distinct from p_expected_${col}`);
    }
    expect(sql).toContain("ri.quantity = p_expected_quantity");
    expect(sql).toContain("return query\n  update public.recipe_inputs ri");
    expect(sql).toMatch(/returning ri\.component_sku_id, ri\.component_item_id, ri\.component_product_id,/);
  });

  it("named refusals", () => {
    for (const code of ["recipe_not_found", "would_create_cycle", "line_changed", "edge_not_found"]) {
      expect(sql).toContain(`raise exception '${code}' using errcode = 'P0001'`);
    }
  });

  it("SECURITY DEFINER with a pinned search_path; execute revoked from the PostgREST roles, granted to service_role", () => {
    expect(sql.match(/security definer set search_path = pg_catalog, public/g)).toHaveLength(6);
    for (const fn of ["recipe_input_would_cycle", "add_recipe_input_atomic", "update_recipe_input_atomic"]) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role;`));
    }
    expect(sql).toContain("raise exception '0258: unexpected recipe-input RPC execute grant'");
  });
});

describe("both lib writers go through the RPCs", () => {
  const fn = (name: string) => {
    const start = lib.indexOf(`export async function ${name}(`);
    return lib.slice(start, lib.indexOf("\nexport ", start + 10));
  };

  it("addRecipeInput calls add_recipe_input_atomic and writes no row itself", () => {
    const add = fn("addRecipeInput");
    expect(add).toContain('sb.rpc("add_recipe_input_atomic"');
    expect(add).not.toContain('.from("recipe_inputs")');
  });

  it("updateRecipeInput calls update_recipe_input_atomic and writes no row itself", () => {
    const upd = fn("updateRecipeInput");
    expect(upd).toContain('sb.rpc("update_recipe_input_atomic"');
    expect(upd).toContain("p_actor: actor.user.id"); // 0262 authorship overload
    expect(upd).not.toContain('.from("recipe_inputs")');
  });
});

// ── Astra r2 #1 — the OUTPUT writers serialise on the same lock and refuse in-transaction ──────
const src0215 = readFileSync("supabase/migrations/0215_batch_vs_bottle.sql", "utf8").replace(/\r\n/g, "\n");
const sqlLf = sql.replace(/\r\n/g, "\n");
const extract = (src: string, start: string, end: string) => {
  const a = src.indexOf(start);
  expect(a, start).toBeGreaterThan(-1);
  const b = src.indexOf(end, a);
  return src.slice(a, b + end.length);
};
/** Every line of `needle` appears, in order, in `hay` (right-trimmed, blank lines ignored). */
function isLineSubsequence(needle: string, hay: string): { ok: boolean; missing: string | null } {
  const n = needle.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() !== "");
  const h = hay.split("\n").map((l) => l.trimEnd());
  let j = 0;
  for (const line of n) {
    while (j < h.length && h[j] !== line) j++;
    if (j >= h.length) return { ok: false, missing: line };
    j++;
  }
  return { ok: true, missing: null };
}

describe("outputItemWouldCycle — the 0258 output-side CTE", () => {
  it("the reviewer's interleaving, serialised: once A consumes Y, B producing Y is refused", () => {
    // A produces X; B consumes X; A now consumes Y.
    const outs = [{ recipe_id: "A", output_item_id: "X" }];
    const ins = [{ id: "b1", recipe_id: "B", component_item_id: "X" }, { id: "a1", recipe_id: "A", component_item_id: "Y" }];
    expect(outputItemWouldCycle({ recipeId: "B", itemId: "Y" }, outs, ins)).toBe(true);
    // Before A's line edit, B producing Y was fine.
    expect(outputItemWouldCycle({ recipeId: "B", itemId: "Y" }, outs, ins.slice(0, 1))).toBe(false);
  });
  it("a recipe producing an item it consumes directly is a cycle; unrelated items are not; loops terminate", () => {
    expect(outputItemWouldCycle({ recipeId: "R", itemId: "Q" }, [], [{ id: "x", recipe_id: "R", component_item_id: "Q" }])).toBe(true);
    expect(outputItemWouldCycle({ recipeId: "R", itemId: "Z" }, [], [{ id: "x", recipe_id: "R", component_item_id: "Q" }])).toBe(false);
    const loopOut = [{ recipe_id: "A", output_item_id: "a" }, { recipe_id: "B", output_item_id: "b" }];
    const loopIn = [{ id: "1", recipe_id: "A", component_item_id: "b" }, { id: "2", recipe_id: "B", component_item_id: "a" }, { id: "3", recipe_id: "C", component_item_id: "a" }];
    expect(outputItemWouldCycle({ recipeId: "C", itemId: "z" }, loopOut, loopIn)).toBe(false);
  });
  it("the SQL walks the same edges", () => {
    const fn = extract(sqlLf, "create or replace function public.recipe_output_would_cycle(", "\n$$;");
    expect(fn).toMatch(/with recursive reach\(item_id\) as \(\s*select ri\.component_item_id\s*from public\.recipe_inputs ri\s*where ri\.recipe_id = p_recipe_id/);
    expect(fn).toContain("join public.recipe_outputs ro on ro.output_item_id = r.item_id");
    expect(fn).toContain("select exists (select 1 from reach where item_id = p_item_id);");
  });
});

describe("0258 re-emits create_recipe_full and add_recipe_output from 0215 — byte-faithful, additions only", () => {
  for (const name of ["create_recipe_full", "add_recipe_output"]) {
    const start = `create or replace function ${name}(`;
    it(`${name}: every 0215 line survives, in order`, () => {
      const source = extract(src0215, start, "end $$;");
      const emitted = extract(sqlLf, start, "end $$;");
      const check = isLineSubsequence(source, emitted);
      expect(check.ok, `${name}: 0215 line missing from 0258 → ${check.missing}`).toBe(true);
    });
    it(`${name}: the graph lock is the FIRST statement, and the cycle refusal is inside`, () => {
      const emitted = extract(sqlLf, start, "end $$;");
      const afterBegin = emitted.slice(emitted.indexOf("\nbegin\n") + "\nbegin\n".length);
      const firstStatement = afterBegin.split("\n").find((l) => l.trim() !== "" && !l.trim().startsWith("--"));
      expect(firstStatement).toBe(`  perform pg_advisory_xact_lock(${RECIPE_GRAPH_LOCK_KEY});`);
      expect(emitted).toContain("public.recipe_output_would_cycle(");
      expect(emitted).toContain("raise exception 'would_create_cycle' using errcode = 'P0001';");
      expect(emitted).toContain("language plpgsql security definer set search_path = pg_catalog, public as $$");
    });
  }
  it("grants identical to 0215 (and the output check is service_role only)", () => {
    for (const line of [
      "revoke execute on function create_recipe_full(jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;",
      "grant execute on function create_recipe_full(jsonb, jsonb, jsonb, uuid) to service_role;",
      "revoke execute on function add_recipe_output(uuid, uuid, uuid, numeric, text, uuid) from public, anon, authenticated;",
      "grant execute on function add_recipe_output(uuid, uuid, uuid, numeric, text, uuid) to service_role;",
    ]) {
      expect(src0215).toContain(line);
      expect(sqlLf).toContain(line);
    }
    expect(sqlLf).toContain("revoke all on function public.recipe_output_would_cycle(uuid, uuid) from public, anon, authenticated;");
  });
  it("the header says the sim got the first version and must re-apply", () => {
    expect(sqlLf).toContain("the SIM received the FIRST version of this file");
    expect(sqlLf).toContain("RE-APPLIED there");
  });
  it("the TS output writers map the in-transaction refusal (the precheck is only the friendly fast path)", () => {
    const errMap = lib.slice(lib.indexOf("const BATCH_MODE_RPC_ERRORS"), lib.indexOf("};", lib.indexOf("const BATCH_MODE_RPC_ERRORS")));
    expect(errMap).toContain("would_create_cycle: 400,");
  });
});
