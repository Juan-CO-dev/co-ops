/**
 * B2 · shop context (triage #30): the pure resolver, the URL/cookie helpers, and source-shape pins
 * that every shop-defaulting page goes through it instead of defaulting to "the first location".
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  SHOP_COOKIE,
  SHOP_COOKIE_MAX_AGE_SECONDS,
  isShopId,
  loginLandingPath,
  pickShop,
  pickShopId,
  readCookie,
  shopCookieAssignment,
  shopParamFromUrl,
  shouldRememberShop,
} from "@/lib/shop-context-shared";
import { resolvePulsePanels, resolveRequestedLocation } from "@/lib/pulse/page-shared";

// Fixture ids only — never real tenant data.
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // a shop the actor does NOT hold

describe("pickShopId — precedence: URL > remembered > first allowed", () => {
  it("an explicit URL shop wins when allowed", () => {
    expect(pickShopId({ allowed: [A, B], explicit: B, remembered: A })).toBe(B);
  });
  it("the remembered shop wins over the first when there is no explicit one", () => {
    expect(pickShopId({ allowed: [A, B], remembered: B })).toBe(B);
    expect(pickShopId({ allowed: [A, B], explicit: null, remembered: B })).toBe(B);
    expect(pickShopId({ allowed: [A, B], explicit: undefined, remembered: B })).toBe(B);
  });
  it("falls back to the first allowed shop (today's behaviour) with nothing else", () => {
    expect(pickShopId({ allowed: [A, B] })).toBe(A);
  });
  it("never returns a shop outside the allowed list — explicit or remembered", () => {
    expect(pickShopId({ allowed: [A, B], explicit: C })).toBe(A);
    expect(pickShopId({ allowed: [A, B], remembered: C })).toBe(A);
    expect(pickShopId({ allowed: [A, B], explicit: C, remembered: C })).toBe(A);
    expect(pickShopId({ allowed: [A], explicit: C, remembered: B })).toBe(A);
    // A disallowed explicit falls through to an allowed remembered shop, not past it.
    expect(pickShopId({ allowed: [A, B], explicit: C, remembered: B })).toBe(B);
  });
  it("an empty allowed list returns null whatever the candidates", () => {
    expect(pickShopId({ allowed: [], explicit: A, remembered: B })).toBeNull();
    expect(pickShopId({ allowed: [] })).toBeNull();
  });
  it("garbage candidates are ignored", () => {
    expect(pickShopId({ allowed: [A, B], explicit: "", remembered: "all" })).toBe(A);
  });
});

describe("pickShop — over location rows", () => {
  const rows = [{ id: A, name: "Shop A" }, { id: B, name: "Shop B" }];
  it("returns the allowed ROW (same object), never a fabricated one", () => {
    expect(pickShop({ allowed: rows, remembered: B })).toBe(rows[1]);
    expect(pickShop({ allowed: rows, explicit: A, remembered: B })).toBe(rows[0]);
    expect(pickShop({ allowed: rows, explicit: C, remembered: C })).toBe(rows[0]);
    expect(pickShop({ allowed: [] as typeof rows, remembered: A })).toBeNull();
  });
});

describe("pulse resolver threads the remembered shop through the same gate", () => {
  const SA = { id: A, code: "A", name: "Shop A" };
  const SB = { id: B, code: "B", name: "Shop B" };
  const gm = { role: "gm" as const, locations: [A, B], level: 7 };
  const moo = { role: "moo" as const, locations: [A], level: 8 };
  it("no ?location= → remembered when listed, else first", () => {
    expect(resolveRequestedLocation({ requested: undefined, accessible: [SA, SB], actor: gm, remembered: B })).toBe(B);
    expect(resolveRequestedLocation({ requested: undefined, accessible: [SA, SB], actor: gm, remembered: C })).toBe(A);
    expect(resolveRequestedLocation({ requested: undefined, accessible: [SA, SB], actor: gm })).toBe(A);
  });
  it("an explicit ?location= still wins and is still gated", () => {
    expect(resolveRequestedLocation({ requested: A, accessible: [SA, SB], actor: gm, remembered: B })).toBe(A);
    expect(resolveRequestedLocation({ requested: C, accessible: [SA, SB], actor: gm, remembered: B })).toBeNull();
  });
  it("8+ keep the both-shops default; a remembered shop does not collapse it", () => {
    expect(resolvePulsePanels({ requested: undefined, accessible: [SA, SB], actor: moo, remembered: B })).toEqual([SA, SB]);
    expect(resolvePulsePanels({ requested: undefined, accessible: [SA, SB], actor: gm, remembered: B })).toEqual([SB]);
  });
});

describe("shopParamFromUrl", () => {
  const q = (s: string) => new URLSearchParams(s);
  it("reads ?location= first, then the dashboard's ?loc=", () => {
    expect(shopParamFromUrl("/reports", q(`location=${A}`))).toBe(A);
    expect(shopParamFromUrl("/dashboard", q(`loc=${B}`))).toBe(B);
    expect(shopParamFromUrl("/my-feedback", q(`loc=${B}&location=${A}`))).toBe(A);
  });
  it("ignores non-shop values (all / both / junk) and absent params", () => {
    expect(shopParamFromUrl("/reports", q("location=all"))).toBeNull();
    expect(shopParamFromUrl("/mid-shift", q("location=both"))).toBeNull();
    expect(shopParamFromUrl("/dashboard", q("loc=not-a-uuid"))).toBeNull();
    expect(shopParamFromUrl("/dashboard", q(""))).toBeNull();
  });
  it("a list FILTER is not a context switch (/admin/users?location=)", () => {
    expect(shopParamFromUrl("/admin/users", q(`location=${A}`))).toBeNull();
  });
});

describe("shouldRememberShop — only a held shop, only on change", () => {
  it("remembers a membership shop that differs from the current one", () => {
    expect(shouldRememberShop({ candidate: B, allowed: [A, B], current: A })).toBe(true);
    expect(shouldRememberShop({ candidate: B, allowed: [A, B], current: null })).toBe(true);
  });
  it("no write when nothing changes", () => {
    expect(shouldRememberShop({ candidate: B, allowed: [A, B], current: B })).toBe(false);
  });
  it("a shop outside the memberships is looked at, not moved to (level-8 report reads)", () => {
    expect(shouldRememberShop({ candidate: C, allowed: [A, B], current: A })).toBe(false);
  });
  it("the 9+ all-locations grant may remember any shop id", () => {
    expect(shouldRememberShop({ candidate: C, allowed: "all", current: A })).toBe(true);
  });
  it("never remembers a non-shop value", () => {
    expect(shouldRememberShop({ candidate: null, allowed: "all", current: A })).toBe(false);
    expect(shouldRememberShop({ candidate: "all", allowed: "all", current: A })).toBe(false);
  });
});

describe("cookie helpers", () => {
  it("isShopId accepts UUIDs only", () => {
    expect(isShopId(A)).toBe(true);
    expect(isShopId(A.toUpperCase())).toBe(true);
    for (const bad of ["", "all", "both", `${A}x`, null, undefined, 7]) expect(isShopId(bad)).toBe(false);
  });
  it("readCookie finds the named cookie among others", () => {
    expect(readCookie(`a=1; ${SHOP_COOKIE}=${B}; co_ops_session=xyz`, SHOP_COOKIE)).toBe(B);
    expect(readCookie("a=1; b=2", SHOP_COOKIE)).toBeNull();
    expect(readCookie("", SHOP_COOKIE)).toBeNull();
    expect(readCookie(`x${SHOP_COOKIE}=${A}`, SHOP_COOKIE)).toBeNull();
  });
  it("the assignment is site-wide, Lax, 30 days, Secure on https only", () => {
    const secure = shopCookieAssignment(A, true);
    expect(secure).toBe(`${SHOP_COOKIE}=${A}; Path=/; Max-Age=${SHOP_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax; Secure`);
    expect(SHOP_COOKIE_MAX_AGE_SECONDS).toBe(2_592_000);
    expect(shopCookieAssignment(A, false)).not.toContain("Secure");
  });
});

describe("loginLandingPath — the tile login carries its shop", () => {
  it("the plain dashboard landing names the tile's shop", () => {
    expect(loginLandingPath("/dashboard", A)).toBe(`/dashboard?loc=${A}`);
  });
  it("a deep link keeps its own target (the remembered shop covers it)", () => {
    expect(loginLandingPath("/reports?location=all", A)).toBe("/reports?location=all");
    expect(loginLandingPath("/catering/quotes", A)).toBe("/catering/quotes");
  });
  it("no shop (manager login) or a junk id leaves the landing alone", () => {
    expect(loginLandingPath("/dashboard", undefined)).toBe("/dashboard");
    expect(loginLandingPath("/dashboard", "nope")).toBe("/dashboard");
  });
});

// ─── Source-shape pins ────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "..");
const src = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** Every page that defaulted to "the first location" (triage #30 + the two Pulse-era twins). */
const RESOLVER_PAGES: Record<string, RegExp> = {
  "app/(authed)/dashboard/page.tsx": /await resolveShop\(locations, loc\)/,
  "app/(authed)/reports/page.tsx": /params\.location \?\? \(await resolveShopId\(auth\.locations\)\)/,
  "app/(authed)/reports/sales/page.tsx": /params\.location \?\? \(await resolveShopId\(auth\.locations\)\)/,
  "app/(authed)/reports/sales/catering/page.tsx": /params\.location \?\? \(await resolveShopId\(auth\.locations\)\)/,
  "app/(authed)/reports/sales/checks/page.tsx": /params\.location \?\? \(await resolveShopId\(auth\.locations\)\)/,
  "app/(authed)/reports/written/page.tsx": /await resolveShopId\(auth\.locations\)/,
  "app/(authed)/my-feedback/page.tsx": /await resolveShop\(locations, selectedParam\)/,
  "app/(authed)/assignments/page.tsx": /await resolveShop\(locations, location \?\? loc\)/,
  "app/(authed)/stations/page.tsx": /await resolveShop\(locations, loc\)/,
  "app/(authed)/operations/opening/page.tsx": /await resolveShop\(locations, locParam\)/,
  "app/(authed)/catering/quotes/page.tsx": /await resolveShop\(locations\)/,
  "app/(authed)/mid-shift/page.tsx": /location \?\? \(await resolveShopId\(accessible\.map/,
  "app/(authed)/mid-shift/[section]/page.tsx": /remembered: await rememberedShopId\(\)/,
  "components/pulse/PulseHome.tsx": /remembered: await rememberedShopId\(\)/,
  "app/admin/catering/prep-demand/page.tsx": /await resolveShop\(locations, paramLocation\)/,
  "app/admin/catering/lto/page.tsx": /await resolveShop\(locations, paramLocation\)/,
  "app/admin/catering/fulfillment/page.tsx": /await resolveShopId\(nodes\.map/,
  "app/admin/stations/page.tsx": /await resolveShop\(locations, loc\)/,
  "app/admin/toast-employees/page.tsx": /await resolveShop\(locations, loc\)/,
  "app/ordering/page.tsx": /location \?\? \(await resolveShopId\(accessible\.map/,
};

describe("source shape — every shop-defaulting page uses the one resolver", () => {
  for (const [file, pattern] of Object.entries(RESOLVER_PAGES)) {
    it(file, () => {
      const text = src(file);
      expect(text).toMatch(/from "@\/lib\/shop-context"/);
      expect(text).toMatch(pattern);
    });
  }

  it("no page keeps a first-location DEFAULT (allow-list = display/storefront, not defaults)", () => {
    const FIRST = /\b(?:auth\.)?(?:locations|accessible)\[0\]/;
    const ALLOWED = new Map<string, RegExp>([
      // Single-shop chip LABEL (rendered only when locations.length === 1), not a default.
      ["app/(authed)/dashboard/page.tsx", /\{locations\[0\]!\.code\} · \{locations\[0\]!\.name\}/],
      // Public customer storefront (no staff session, no shop context).
      ["app/order/start/start-client.tsx", /locationId: locations\[0\]\?\.id \?\? ""/],
    ]);
    const files = [...Object.keys(RESOLVER_PAGES), ...ALLOWED.keys(), "components/catering/quotes/QuotesClient.tsx", "components/admin/catering/fulfillment/FulfillmentClient.tsx", "lib/pulse/page-shared.ts"];
    for (const file of new Set(files)) {
      const lines = src(file).split("\n").filter((line) => FIRST.test(line));
      const allowed = ALLOWED.get(file);
      const offenders = allowed ? lines.filter((line) => !allowed.test(line)) : lines;
      expect(offenders, file).toEqual([]);
    }
  });

  it("the new-quote Location and the fulfillment editor take the server-resolved default", () => {
    const quotes = src("components/catering/quotes/QuotesClient.tsx");
    expect(quotes).toMatch(/useState<string>\(editing\?\.locationId \?\? defaultLocationId \?\? ""\)/);
    expect(src("app/(authed)/catering/quotes/page.tsx")).toMatch(/defaultLocationId=\{defaultLocationId\}/);
    expect(src("components/admin/catering/fulfillment/FulfillmentClient.tsx")).toMatch(/nodes\.find\(\(n\) => n\.locationId === defaultLocationId\)/);
  });

  it("the tile login remembers its shop and lands on it", () => {
    const login = src("app/page.tsx");
    expect(login).toMatch(/navigateToDashboard\(step\.locationId\)/);
    expect(login).toMatch(/rememberShopOnDevice\(shopId\)/);
    expect(login).toMatch(/loginLandingPath\(safeNextPath\(searchParams\?\.get\("next"\)\), shopId\)/);
  });

  it("every authenticated shell mounts the URL→cookie sync (behind Suspense for useSearchParams)", () => {
    for (const file of ["app/(authed)/layout.tsx", "app/admin/layout.tsx", "app/ordering/page.tsx"]) {
      const text = src(file);
      expect(text, file).toMatch(/<Suspense fallback=\{null\}>\s*<ShopContextSync allowed=\{accessibleLocations\(/);
    }
  });

  it("the cookie is NOT written by proxy.ts (Next 16 hides prefetch headers there)", () => {
    expect(src("proxy.ts")).not.toMatch(/co_shop|SHOP_COOKIE|shop-context/);
  });

  it("the pure module stays import-free (client-, server- and edge-safe)", () => {
    expect(src("lib/shop-context-shared.ts")).not.toMatch(/^\s*import\s/m);
  });

  it("the server half re-validates on every read and never trusts the raw cookie", () => {
    const server = src("lib/shop-context.ts");
    expect(server).toMatch(/import "server-only"/);
    expect(server).toMatch(/return isShopId\(value\) \? value : null/);
  });
});
