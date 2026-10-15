/**
 * Catalog Phase 2a — THE EQUIVALENCE PIN (spec §3 precondition, §8).
 *
 * With NO shop versions present, every LIVE number — pack chains, prices + PO cents, depletion oz,
 * cost per oz, menu/prep cost rollups, order-unit oz, the flat content production and surplus
 * divide by — and the depletion of a business date after every pack boundary must be
 * BYTE-IDENTICAL to what today's code produced on this fixture matrix. The golden was written by
 * Task 1 with today's loaders, before any resolver change; later tasks may change the loaders,
 * never the golden.
 *
 * Regenerate ONLY in Task 1 (or with a written reason in the PR):
 *   UPDATE_SHOP_VERSIONS_GOLDEN=1 npx vitest run tests/shop-versions-equivalence.test.ts
 *
 * On-hand is pinned separately by tests/counts-onhand-equivalence.test.ts (frozen v0 oracle).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildShopVersionsFixture, LOC, OLD_VERSION_DAY, OTHER, QUIET_DAY } from "./fixtures/shop-versions-fixture";
import { computeOutputs, liveApi, type EquivalenceOutputs } from "./fixtures/shop-versions-harness";

const GOLDEN = "tests/fixtures/shop-versions-golden.json";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));

beforeEach(() => { current = createFakeDb(buildShopVersionsFixture()); });
afterEach(() => { current = null; });

describe("no shop versions ⇒ every number is identical to today (the golden)", () => {
  it("matches the frozen golden for global, shop one and shop two", async () => {
    const got = await computeOutputs(liveApi, buildShopVersionsFixture(), [LOC, OTHER], QUIET_DAY, OLD_VERSION_DAY);
    if (process.env.UPDATE_SHOP_VERSIONS_GOLDEN === "1") {
      writeFileSync(GOLDEN, `${JSON.stringify(got, null, 2)}\n`);
    }
    expect(existsSync(GOLDEN), "golden missing — run Task 1 Step 4").toBe(true);
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as EquivalenceOutputs;
    expect(got).toEqual(golden);
  });
});

describe("the fixture is not trivial — hand-checked anchors inside the golden", () => {
  const golden = (): EquivalenceOutputs => JSON.parse(readFileSync(GOLDEN, "utf8")) as EquivalenceOutputs;

  it("chained, count-leaf and flat order units resolve to the right ounces", () => {
    const g = golden().global!;
    expect(g.orderUnitOz["s-turkey"]).toBe(320); // case → 4 bag → 80 oz
    expect(g.orderUnitOz["s-tomato"]).toBe(90); // case → 20 each × avg 4.5
    expect(g.orderUnitOz["s-lettuce"]).toBe(384); // flat: 24 × 1 lb
    expect(g.orderUnitOz["s-cheese"]).toBeNull(); // no pack basis
  });

  it("the flat content production and surplus read: flat SKUs resolve, chain-only SKUs stay null exactly as today", () => {
    const g = golden().global!;
    expect(g.flatContentOz["s-lettuce"]).toBe(384);
    expect(g.flatContentOz["s-turkey"]).toBeNull(); // no flat mirror in the fixture → today's null
  });

  it("the later-recorded price wins a same-date tie and cents round exactly", () => {
    const g = golden().global!;
    expect(g.prices["s-cheese"]).toBe(46.2);
    expect(g.priceCents["s-pickle"]).toBe(999);
  });

  it("the Italian depletes 4 oz of turkey through the chain label and 9 oz of tomato through the avg", () => {
    const italian = golden().global!.graph.menuOz["m-italian"]!;
    expect(italian["s-turkey"]).toBeCloseTo(4, 10);
    expect(italian["s-tomato"]).toBeCloseTo(9, 10);
  });

  it("cost per oz rides the chain: turkey $128 / 320 oz; the quiet day's dated depletion equals live", () => {
    const g = golden().global!;
    expect(g.graph.costPerOz["s-turkey"]).toBeCloseTo(0.4, 12);
    expect(g.datedMenuOz).toEqual(g.graph.menuOz);
  });

  it("the superseded turkey chain is invisible to every LIVE read (inactive levels), and to the after-boundary day", () => {
    const g = golden().global!;
    expect(g.chains["s-turkey"]!.map((l) => l.id).sort()).toEqual(["pl-t-bag", "pl-t-case"]);
    expect(g.allChains["s-turkey"]!.map((l) => l.id).sort()).toEqual(["pl-t-bag", "pl-t-case"]);
    expect(g.datedMenuOz["m-italian"]!["s-turkey"]).toBeCloseTo(4, 10);
  });

  it("D1: the probe INSIDE the superseded version resolves THAT version's chain (6 oz: case of 6 bags), never the live one (4 oz)", () => {
    // Task 1 froze 4 oz (today's loaders were date-blind); Task 5's as-of resolver moved exactly
    // these three values (global, shop one, shop two) to 6 oz — the deliberate D1 correction.
    for (const scope of ["global", LOC, OTHER]) {
      const g = golden()[scope]!;
      expect(g.datedProbe!.day).toBe(OLD_VERSION_DAY);
      expect(g.datedProbe!.menuOz["m-italian"]!["s-turkey"]).toBeCloseTo(6, 10);
      expect(g.graph.menuOz["m-italian"]!["s-turkey"]).toBeCloseTo(4, 10);
    }
  });

  it("a FUTURE-dated price is today's current price (frozen as-is): tomato $27, not the $25 in force today", () => {
    const g = golden().global!;
    expect(g.prices["s-tomato"]).toBe(27);
    expect(g.graph.costPerOz["s-tomato"]).toBeCloseTo(0.3, 12); // $27 / 90 oz
  });

  it("every shop reads the global pack and price (no shop versions exist)", () => {
    const g = golden();
    expect(g[LOC]!.chains).toEqual(g.global!.chains);
    expect(g[OTHER]!.prices).toEqual(g.global!.prices);
  });
});
