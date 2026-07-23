/**
 * Unit spine — lib/toast/menus-shared.ts flattenToastMenus, run against the
 * SAME checked-in fixture the client serves in fixture mode — so what the
 * tests pin is literally what the dormant app renders. The fixture follows
 * Toast's REAL /menus/v2/menus contract: object root with `menus[]`,
 * `menuGroups[]` (recursively nestable), `menuItems[]` (review finding #1 —
 * the first draft pinned an invented shape and would have bad_payload-failed
 * on first live credentials).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { flattenToastMenus } from "@/lib/toast/menus-shared";

const fixture = JSON.parse(
  readFileSync(path.join(process.cwd(), "tests", "fixtures", "toast", "menus-v2-sample.json"), "utf-8"),
) as unknown;

describe("flattenToastMenus", () => {
  it("flattens menus→menuGroups→menuItems (incl. nested subgroups) with first-wins guid dedupe", () => {
    const items = flattenToastMenus(fixture);
    expect(items).toHaveLength(9); // 10 raw minus 1 duplicate guid
    const chips = items.find((i) => i.itemGuid === "tg-chips");
    expect(chips?.name).toBe("Kettle Chips"); // first occurrence wins, not the dup
    expect(chips?.groupName).toBe("Sides");
    // Nested subgroup item surfaces with its subgroup's name.
    const market = items.find((i) => i.itemGuid === "tg-market");
    expect(market?.groupName).toBe("Rotating Sides");
  });

  it("converts prices to cents and passes missing prices through as null", () => {
    const items = flattenToastMenus(fixture);
    expect(items.find((i) => i.itemGuid === "tg-italian")?.priceCents).toBe(1200);
    expect(items.find((i) => i.itemGuid === "tg-soda")?.priceCents).toBe(275);
    expect(items.find((i) => i.itemGuid === "tg-market")?.priceCents).toBeNull();
  });

  it("poisons the whole pull on malformed payloads", () => {
    expect(() => flattenToastMenus([])).toThrow(/menus array/); // old array-root shape is malformed now
    expect(() => flattenToastMenus({ not: "menus" })).toThrow(/menus array/);
    expect(() => flattenToastMenus({ menus: [{ menuGroups: [{ menuItems: [{ name: "no guid", price: 1 }] }] }] })).toThrow(/without guid/);
    expect(() => flattenToastMenus({ menus: [{ menuGroups: [{ menuItems: [{ guid: "g1", price: 1 }] }] }] })).toThrow(/without name/);
  });

  it("tolerates empty menus/groups", () => {
    expect(flattenToastMenus({ menus: [] })).toEqual([]);
    expect(flattenToastMenus({ menus: [{ name: "Empty", menuGroups: [] }] })).toEqual([]);
  });
});
