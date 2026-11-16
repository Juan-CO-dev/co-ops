// Audit W01/B031 r1: a saved package pick that is no longer an eligible option is dropped when the
// build page hydrates the cart (then the cart is re-saved), so the customer is never looped between a
// cart the server refuses to save and a review the server refuses to price.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isEligiblePackagePick } from "@/lib/portal/draft-shared";

const pkg = { slots: [{ packageItemId: "slot-1", options: [{ kind: "menu_item" as const, refId: "turkey" }, { kind: "item" as const, refId: "cookie" }] }] };

describe("isEligiblePackagePick (the rule resolveLines applies on save)", () => {
  it("accepts a pick its slot still lists, by kind and id", () => {
    expect(isEligiblePackagePick(pkg, { packageItemId: "slot-1", menuItemId: "turkey" })).toBe(true);
    expect(isEligiblePackagePick(pkg, { packageItemId: "slot-1", itemId: "cookie", menuItemId: null })).toBe(true);
  });
  it("refuses a deactivated (no longer listed) pick, a kind mismatch, and an unknown slot", () => {
    expect(isEligiblePackagePick(pkg, { packageItemId: "slot-1", menuItemId: "italian" })).toBe(false);
    expect(isEligiblePackagePick(pkg, { packageItemId: "slot-1", itemId: "turkey" })).toBe(false);
    expect(isEligiblePackagePick(pkg, { packageItemId: "slot-9", menuItemId: "turkey" })).toBe(false);
  });
});

describe("the build page uses it on hydration", () => {
  it("filters stored picks through the rule and re-saves the cart when one was dropped", () => {
    const page = readFileSync("app/order/build/page.tsx", "utf8");
    expect(page).toMatch(/const options = stored\.filter\(\(o\) => isEligiblePick\(pkg, o\)\);\s*if \(options\.length !== stored\.length\) stale = true;/);
  });
});
