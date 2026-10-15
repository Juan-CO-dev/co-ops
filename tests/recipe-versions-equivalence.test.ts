/**
 * Catalog Phase 3a — THE RECIPE / MENU EQUIVALENCE PIN (spec §3 precondition, §8).
 *
 * With NO shop recipe versions and NO menu overlays present, every live recipe number — depletion oz
 * per menu item and prep item, cost per oz, the menu and prep cost rollups — the dated depletion of
 * three business dates, and every menu costing board row and total, for the global scope and each
 * shop, must be BYTE-IDENTICAL to what today's code produced on this fixture. The golden was written
 * by Task 1 with today's loaders, before any resolver change; later tasks change the loaders, never
 * the golden.
 *
 * Regenerate ONLY in Task 1 (or with a written reason in the PR):
 *   UPDATE_RECIPE_VERSIONS_GOLDEN=1 npx vitest run tests/recipe-versions-equivalence.test.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildRecipeVersionsFixture, EARLY_DAY, LOC, MID_DAY, OTHER, QUIET_DAY } from "./fixtures/recipe-versions-fixture";
import { computeLineReaderOutputs, computeRecipeOutputs, liveRecipeApi, type LineReaderOutputs, type RecipeEquivalenceOutputs } from "./fixtures/recipe-versions-harness";

const GOLDEN = "tests/fixtures/recipe-versions-golden.json";
const DAYS = [EARLY_DAY, MID_DAY, QUIET_DAY];

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));

beforeEach(() => { current = createFakeDb(buildRecipeVersionsFixture()); });
afterEach(() => { current = null; });

describe("no shop recipe versions and no menu overlays ⇒ every number is identical to today (the golden)", () => {
  it("matches the frozen golden for global, shop one and shop two", async () => {
    const got = await computeRecipeOutputs(liveRecipeApi, buildRecipeVersionsFixture(), [LOC, OTHER], DAYS);
    if (process.env.UPDATE_RECIPE_VERSIONS_GOLDEN === "1") writeFileSync(GOLDEN, `${JSON.stringify(got, null, 2)}\n`);
    expect(existsSync(GOLDEN), "golden missing — run Task 1 Step 4").toBe(true);
    expect(got).toEqual(JSON.parse(readFileSync(GOLDEN, "utf8")) as RecipeEquivalenceOutputs);
  });
});

describe("the fixture is not trivial — hand-checked anchors inside the golden", () => {
  const golden = (): RecipeEquivalenceOutputs => JSON.parse(readFileSync(GOLDEN, "utf8")) as RecipeEquivalenceOutputs;

  it("the Italian depletes 4 oz of turkey through the chain label and 9 oz of tomato through the avg", () => {
    const italian = golden().global!.menuOz["m-italian"]!;
    expect(italian["s-turkey"]).toBeCloseTo(4, 10);
    expect(italian["s-tomato"]).toBeCloseTo(9, 10);
  });

  it("the slaw makes 2: 24 oz lettuce and 8 oz mayo per unit", () => {
    const slaw = golden().global!.itemOz["i-slaw"]!;
    expect(slaw["s-lettuce"]).toBeCloseTo(24, 10);
    expect(slaw["s-mayo"]).toBeCloseTo(8, 10);
  });

  it("the quiet day's dated depletion equals live, for every scope", () => {
    for (const scope of ["global", LOC, OTHER]) {
      const g = golden()[scope]!;
      expect(g.datedMenuOz[QUIET_DAY]).toEqual(g.menuOz);
    }
  });

  it("the board prices the lunch Italian through 'same as' and leaves the retired sub off", () => {
    const rows = golden().global!.board.rows as Array<{ id: string; menuPrice: number | null; priceSource: string | null }>;
    expect(rows.find((r) => r.id === "m-italian")!.menuPrice).toBe(12.5);
    expect(rows.find((r) => r.id === "m-italian-lunch")).toMatchObject({ menuPrice: 12.5, priceSource: "same_as" });
    expect(rows.some((r) => r.id === "m-old")).toBe(false);
  });

  it("every shop board names and prices the menu exactly as global (no overlays exist)", () => {
    const pick = (rows: unknown[]) => (rows as Array<{ id: string; name: string; menuPrice: number | null }>).map((r) => [r.id, r.name, r.menuPrice]);
    const g = golden();
    expect(pick(g[LOC]!.board.rows)).toEqual(pick(g.global!.board.rows));
    expect(pick(g[OTHER]!.board.rows)).toEqual(pick(g.global!.board.rows));
  });
});

// ── THE DIRECT LINE READERS (chunk-1 review P2-2) ─────────────────────────────────────────────────────────
// Frozen BEFORE Task 6b reroutes them through the one resolver. Their code was untouched between Task 1
// (a7175de0) and this pin, and the golden was generated from a7175de0's tree (the readers' pre-change code).
// Regenerate ONLY with a written reason: UPDATE_RECIPE_LINE_READERS_GOLDEN=1 npx vitest run tests/recipe-versions-equivalence.test.ts
const LINE_GOLDEN = "tests/fixtures/recipe-line-readers-golden.json";

describe("no shop versions ⇒ every direct recipe-line reader answers exactly as before 6b (the line-reader golden)", () => {
  it("readiness, SKU 'used in', product links, product pins, par demand sources, the production picker and the conversion check", async () => {
    const got = await computeLineReaderOutputs(buildRecipeVersionsFixture(), [LOC, OTHER]);
    if (process.env.UPDATE_RECIPE_LINE_READERS_GOLDEN === "1") writeFileSync(LINE_GOLDEN, `${JSON.stringify(got, null, 2)}\n`);
    expect(existsSync(LINE_GOLDEN), "line-reader golden missing").toBe(true);
    expect(got).toEqual(JSON.parse(readFileSync(LINE_GOLDEN, "utf8")) as LineReaderOutputs);
  });

  it("the line-reader golden is not trivial — hand-checked anchors", () => {
    const g = JSON.parse(readFileSync(LINE_GOLDEN, "utf8")) as LineReaderOutputs;
    // The slaw is made from lettuce and mayo: the picker offers it, the check accepts it; turkey makes no slaw.
    expect(JSON.stringify((g.productionPicker[LOC] as Record<string, unknown>)["s-lettuce"])).toContain("i-slaw");
    expect(g.conversions[LOC]!["s-lettuce>i-slaw"]).toBe("accepted");
    expect(g.conversions[LOC]!["s-turkey>i-slaw"]).toBe("invalid_conversion");
    // Lettuce is used (via the slaw recipe); the retired Old sub's onion is a lost demand source by NAME.
    expect(g.skuUsage["s-lettuce"]).toBeDefined();
    expect(g.demandSources.activeRefsBySku["s-lettuce"]).toBe(1);
    expect(Object.keys(g.readiness.recipes).length).toBeGreaterThan(0);
  });
});
