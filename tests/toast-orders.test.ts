/**
 * Unit spine — lib/toast/orders-shared.ts (flatten + version diff), pinned to
 * the SAME fixture the client serves in fixture mode (real ordersBulk shape:
 * top-level array, checks[].selections[] with nested modifiers).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { flattenToastOrders, selectionChanged } from "@/lib/toast/orders-shared";

const fixture = JSON.parse(
  readFileSync(path.join(process.cwd(), "tests", "fixtures", "toast", "orders-v2-sample.json"), "utf-8"),
) as unknown;

describe("flattenToastOrders", () => {
  const lines = flattenToastOrders(fixture);

  it("flattens orders→checks→selections incl. nested modifiers with parent threading", () => {
    expect(lines).toHaveLength(7); // sel-1, sel-1m1, sel-2, sel-3, sel-4, sel-5, sel-6
    const mod = lines.find((l) => l.selectionGuid === "sel-1m1");
    expect(mod?.parentSelectionGuid).toBe("sel-1");
    expect(mod?.itemGuid).toBe("tg-hotpeppers");
    expect(lines.find((l) => l.selectionGuid === "sel-1")?.parentSelectionGuid).toBeNull();
  });

  it("propagates voids from selection AND check level", () => {
    expect(lines.find((l) => l.selectionGuid === "sel-4")?.voided).toBe(true);  // selection-level
    expect(lines.find((l) => l.selectionGuid === "sel-6")?.voided).toBe(true);  // check-level (check-4)
    expect(lines.find((l) => l.selectionGuid === "sel-5")?.voided).toBe(false);
  });

  it("carries the dining-option GUID (bare ToastReference — no name) and converts prices to cents", () => {
    expect(lines.find((l) => l.selectionGuid === "sel-3")?.diningOptionGuid).toBe("do-catering");
    expect(lines.find((l) => l.selectionGuid === "sel-1")?.priceCents).toBe(2400);
  });

  it("poisons on malformed payloads", () => {
    expect(() => flattenToastOrders({ orders: [] })).toThrow(/array of orders/);
    expect(() => flattenToastOrders([{ checks: [{ guid: "c", selections: [{ guid: "s", quantity: 1 }] }] }])).toThrow(/without item guid/);
    expect(() => flattenToastOrders([{ checks: [{ guid: "c", selections: [{ guid: "s", item: { guid: "i" } }] }] }])).toThrow(/without quantity/);
  });
});

describe("selectionChanged", () => {
  const base = { quantity: 2, voided: false, priceCents: 2400, itemName: "Italian Sub" };
  const line = flattenToastOrders(fixture).find((l) => l.selectionGuid === "sel-1")!;
  it("unchanged state is not re-appended", () => {
    expect(selectionChanged(base, line)).toBe(false);
  });
  it("void / quantity / price changes append a new version", () => {
    expect(selectionChanged({ ...base, voided: true }, line)).toBe(true);
    expect(selectionChanged({ ...base, quantity: 1 }, line)).toBe(true);
    expect(selectionChanged({ ...base, priceCents: 2300 }, line)).toBe(true);
  });
});
