/**
 * Unit spine — lib/toast/client-shared.ts (pure half of the Toast client).
 * Pins the token expiry-buffer math and the fixture-mode path routing that
 * makes the whole read track buildable before credentials exist.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  tokenIsFresh,
  resolveFixtureKey,
  isExhaustedFixturePage,
  PAGED_FIXTURE_PREFIXES,
  TOKEN_EXPIRY_BUFFER_MS,
} from "@/lib/toast/client-shared";

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

// ── Fixture pagination (wiring audit 2026-08-29) ─────────────────────────────
//
// resolveFixtureKey matches on the PATH PREFIX and ignores the query string, so every
// page of `/orders/v2/ordersBulk?...&page=N` resolved to the same file — contradicting
// orders.ts's own doc comment ("page 1 and [] afterwards"). It was harmless only by
// luck: the checked-in fixture holds 3 orders, so fetchToastOrders' `rawCount <
// PAGE_SIZE` break fires after page 1 by accident rather than by design. A ≥100-order
// fixture — exactly what testing the pagination loop needs — would have made the SAME
// page count up to 50 times before the hard cap stopped it.

describe("isExhaustedFixturePage — a single-page fixture goes empty past page 1", () => {
  const ORDERS = "/orders/v2/ordersBulk?businessDate=20260808";

  it("serves the fixture on page 1, and on a path with no page at all", () => {
    expect(isExhaustedFixturePage(`${ORDERS}&page=1&pageSize=100`)).toBe(false);
    expect(isExhaustedFixturePage(ORDERS)).toBe(false);
    expect(isExhaustedFixturePage("/orders/v2/ordersBulk")).toBe(false);
  });

  it("goes EMPTY from page 2 on — which is what terminates the caller's loop", () => {
    for (const page of [2, 3, 50]) {
      expect(isExhaustedFixturePage(`${ORDERS}&page=${page}&pageSize=100`)).toBe(true);
    }
  });

  it("an unparseable page is page 1 — never a silent empty result", () => {
    // Serving [] on a malformed path would turn a bug into "the day had no sales".
    expect(isExhaustedFixturePage(`${ORDERS}&page=abc`)).toBe(false);
    expect(isExhaustedFixturePage(`${ORDERS}&page=`)).toBe(false);
  });

  it("only PAGED endpoints are affected — menus and dining options are single reads", () => {
    // These carry no `page` param, and a stray one must not blank a whole menu pull.
    expect(isExhaustedFixturePage("/menus/v2/menus?page=2")).toBe(false);
    expect(isExhaustedFixturePage("/config/v2/diningOptions?page=2")).toBe(false);
    expect(PAGED_FIXTURE_PREFIXES).toEqual(["/orders/v2/ordersBulk"]);
  });

  it("every paged prefix still resolves to a real fixture key", () => {
    // A prefix listed here but unknown to resolveFixtureKey would 500 before it could
    // ever page — the two lists have to agree.
    for (const p of PAGED_FIXTURE_PREFIXES) expect(resolveFixtureKey(p)).not.toBeNull();
  });
});

describe("the fixture branch of toastGet actually consumes the guard", () => {
  // The guarantee lives in lib/toast/client.ts's I/O path, where a unit test cannot see
  // it (server-only fetch + fs). Pinned at the source, the house posture.
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "toast", "client.ts"),
    "utf8",
  );

  it("returns [] for an exhausted page BEFORE reading the fixture file", () => {
    const at = src.indexOf("if (fixtureMode())");
    const body = src.slice(at, src.indexOf("readFixture(key)", at));
    expect(at).toBeGreaterThan(-1);
    expect(body).toContain("if (isExhaustedFixturePage(apiPath)) return [] as T;");
  });

  it("still fails loudly on an UNKNOWN path — the key check comes first", () => {
    const at = src.indexOf("if (fixtureMode())");
    const body = src.slice(at, src.indexOf("readFixture(key)", at));
    expect(body.indexOf("if (!key)")).toBeLessThan(body.indexOf("isExhaustedFixturePage"));
  });
});
