// Board two views PR 1: THE overtime counter, extracted from the labor week builder so the board's projection
// counts the 40 h exactly as the facts do (one rule, two callers). The builder's own goldens
// (tests/fact-labor-builder.test.ts, tests/fact-labor-ot-per-shop.test.ts) pin that its output did not move.
import { describe, expect, it } from "vitest";
import { createOtCounter, otCounterKey } from "@/lib/facts/labor-week-shared";
import { LABOR_OT_THRESHOLD_MINUTES } from "@/lib/facts/labor-config-shared";

describe("createOtCounter", () => {
  it("per minute: the first 2,400 minutes of a key are straight, every later one is overtime", () => {
    const add = createOtCounter();
    let ot = 0;
    for (let i = 0; i < LABOR_OT_THRESHOLD_MINUTES; i++) ot += add("a");
    expect(ot).toBe(0);
    expect(add("a")).toBe(1);
    expect(add("a")).toBe(1);
    expect(add("b")).toBe(0);
  });
  it("a block that crosses the line is split exactly (quarter grain = the same total as minute grain)", () => {
    const add = createOtCounter();
    expect(add("a", 2390)).toBe(0);
    expect(add("a", 15)).toBe(5);
    expect(add("a", 15)).toBe(15);
    const perMinute = createOtCounter();
    let n = 0;
    for (let i = 0; i < 2420; i++) n += perMinute("a");
    expect(n).toBe(20);
  });
  it("zero or negative minutes add nothing", () => {
    const add = createOtCounter();
    expect(add("a", 0)).toBe(0);
    expect(add("a", -5)).toBe(0);
    expect(add("a", 2400)).toBe(0);
    expect(add("a", 1)).toBe(1);
  });
  it("the key: per (person, shop) on a per_shop week, per person on a company week", () => {
    expect(otCounterKey("per_shop", "u:1", "A")).not.toBe(otCounterKey("per_shop", "u:1", "B"));
    expect(otCounterKey("company", "u:1", "A")).toBe(otCounterKey("company", "u:1", "B"));
  });
});
