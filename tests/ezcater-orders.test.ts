/**
 * Unit spine — lib/ezcater/orders-shared.ts normalizeEzcaterOrder, pinned to
 * the SAME fixture the client serves in fixture mode (shape source: the
 * orderByID example in ezCater's Public API User Guide May 2024 v5).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { normalizeEzcaterOrder } from "@/lib/ezcater/orders-shared";

const fixture = JSON.parse(
  readFileSync(path.join(process.cwd(), "tests", "fixtures", "ezcater", "orderByID.json"), "utf-8"),
) as unknown;

describe("normalizeEzcaterOrder", () => {
  const o = normalizeEzcaterOrder(fixture);

  it("extracts header, event, caterer, and money (subunits = cents)", () => {
    expect(o.orderNumber).toBe("ABC-123");
    expect(o.orderType).toBe("DELIVERY");
    expect(o.headcount).toBe(25);
    expect(o.handoffTime).toBe("2026-07-25T14:45:00Z");
    expect(o.catererUuid).toBe("cat-1111-2222-3333");
    expect(o.totalDueCents).toBe(41250);
  });

  it("normalizes items with PLU/customizations and null-tolerant optionals", () => {
    expect(o.items).toHaveLength(2);
    expect(o.items[0]).toMatchObject({
      name: "Italian Sub Box Lunch", quantity: 12, posItemId: "CO-SUB-ITALIAN",
      specialInstructions: "3 no onions",
    });
    expect(o.items[0]!.customizations[0]).toEqual({ name: "Add Hot Peppers", quantity: 3, typeName: "Add-ons" });
    expect(o.items[1]!.posItemId).toBeNull();
    expect(o.items[1]!.customizations).toEqual([]);
  });

  it("accepts both GraphQL envelope and bare order object", () => {
    const bare = (fixture as { data: { order: unknown } }).data.order;
    expect(normalizeEzcaterOrder(bare).orderNumber).toBe("ABC-123");
  });

  it("poisons on malformed payloads", () => {
    expect(() => normalizeEzcaterOrder(null)).toThrow();
    expect(() => normalizeEzcaterOrder({ data: { order: { event: {} } } })).toThrow(/orderNumber/);
    expect(() => normalizeEzcaterOrder({ data: { order: { orderNumber: "X", catererCart: { orderItems: [{ name: "A" }] } } } })).toThrow(/quantity/);
  });
});
