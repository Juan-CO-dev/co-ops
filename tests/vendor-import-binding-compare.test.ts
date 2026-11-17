import { describe, expect, it } from "vitest";
import { sameBinding } from "@/lib/vendor-import";

describe("sameBinding (review r3: canonical comparison across the JSONB boundary)", () => {
  it("ignores key order", () => {
    expect(sameBinding({ "002": "a", "01": null }, { "01": null, "002": "a" })).toBe(true);
  });
  it("survives a JSONB-style reorder (length order) round trip", () => {
    const staged = { "002": "shop-a", "01": "shop-b" };
    const fromDb = JSON.parse('{"01":"shop-b","002":"shop-a"}');
    expect(sameBinding(fromDb, staged)).toBe(true);
  });
  it("still detects differing values, extra keys and missing keys", () => {
    expect(sameBinding({ a: "x" }, { a: "y" })).toBe(false);
    expect(sameBinding({ a: "x" }, { a: "x", b: null })).toBe(false);
    expect(sameBinding({ a: "x", b: null }, { a: "x" })).toBe(false);
    expect(sameBinding({ a: null }, { a: "x" })).toBe(false);
    expect(sameBinding(undefined, {})).toBe(false);
  });
});
