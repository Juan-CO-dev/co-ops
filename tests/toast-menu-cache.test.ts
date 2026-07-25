/**
 * Unit spine — lib/toast/menus-cache-shared.ts (menu-cache freshness decision).
 * Unknown/missing lastUpdated on EITHER side must force a re-pull (never serve
 * stale on ambiguity), matching Toast's recommended metadata-probe pattern.
 */
import { describe, it, expect } from "vitest";
import { isCacheFresh, extractLastUpdated } from "@/lib/toast/menus-cache-shared";

describe("isCacheFresh", () => {
  it("fresh only on exact lastUpdated agreement", () => {
    expect(isCacheFresh("2026-07-24T12:00:00.000+0000", "2026-07-24T12:00:00.000+0000")).toBe(true);
    expect(isCacheFresh("2026-07-24T12:00:00.000+0000", "2026-07-24T13:00:00.000+0000")).toBe(false);
  });
  it("ambiguity forces re-pull", () => {
    expect(isCacheFresh(null, "x")).toBe(false);
    expect(isCacheFresh("x", null)).toBe(false);
    expect(isCacheFresh("", "")).toBe(false);
  });
});

describe("extractLastUpdated", () => {
  it("reads the root lastUpdated; null on absence or odd shapes", () => {
    expect(extractLastUpdated({ lastUpdated: "t1", menus: [] })).toBe("t1");
    expect(extractLastUpdated({ menus: [] })).toBeNull();
    expect(extractLastUpdated(null)).toBeNull();
    expect(extractLastUpdated({ lastUpdated: 42 })).toBeNull();
  });
});
