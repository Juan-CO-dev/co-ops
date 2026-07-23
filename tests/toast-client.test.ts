/**
 * Unit spine — lib/toast/client-shared.ts (pure half of the Toast client).
 * Pins the token expiry-buffer math and the fixture-mode path routing that
 * makes the whole read track buildable before credentials exist.
 */
import { describe, it, expect } from "vitest";
import { tokenIsFresh, resolveFixtureKey, TOKEN_EXPIRY_BUFFER_MS } from "@/lib/toast/client-shared";

describe("tokenIsFresh", () => {
  const now = 1_000_000_000;
  it("fresh well before expiry", () => {
    expect(tokenIsFresh(now + 10 * 60_000, now)).toBe(true);
  });
  it("stale inside the buffer window (proactive refresh)", () => {
    expect(tokenIsFresh(now + TOKEN_EXPIRY_BUFFER_MS - 1, now)).toBe(false);
  });
  it("stale after expiry and when never fetched", () => {
    expect(tokenIsFresh(now - 1, now)).toBe(false);
    expect(tokenIsFresh(null, now)).toBe(false);
  });
});

describe("resolveFixtureKey", () => {
  it("routes the menus path to the sample fixture", () => {
    expect(resolveFixtureKey("/menus/v2/menus")).toBe("menus-v2-sample");
    expect(resolveFixtureKey("/menus/v2/menus?x=1")).toBe("menus-v2-sample");
  });
  it("unknown paths have no fixture", () => {
    expect(resolveFixtureKey("/orders/v2/orders")).toBeNull();
  });
});
