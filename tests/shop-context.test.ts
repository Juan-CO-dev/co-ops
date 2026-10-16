/**
 * B2 · shop context (triage #30): the pure resolver, the URL/cookie helpers, and source-shape pins
 * that every shop-defaulting page goes through it instead of defaulting to "the first location".
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SHOP_COOKIE,
  SHOP_COOKIE_MAX_AGE_SECONDS,
  isShopId,
  loginLandingPath,
  pickShop,
  pickShopId,
  declaredShopRoutes,
  readCookie,
  reportShopCandidates,
  searchParamValues,
  shopParamFor,
  shopParamNames,
  shopCookieAssignment,
  shopParamFromUrl,
  shouldRememberShop,
} from "@/lib/shop-context-shared";
import { resolvePulsePanels, resolveRequestedLocation } from "@/lib/pulse/page-shared";
import { resolveReportShopId, resolveShopId } from "@/lib/shop-context";
import { REPORT_ALL_LOCATIONS_LEVEL } from "@/lib/locations";
import { canReadScopedReport } from "@/lib/report-scope";

// The server half reads the cookie through next/headers and (8+ only) the active-shop list through
// the service client; both are stubbed per test.
const server = vi.hoisted(() => ({ cookie: undefined as string | undefined, active: [] as string[], queries: 0 }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (server.cookie === undefined ? undefined : { value: server.cookie }) }) }));
vi.mock("@/lib/supabase-server", () => ({
  getServiceRoleClient: () => {
    server.queries += 1;
    const query = { select: () => query, eq: () => query, order: () => query, then: (resolve: (v: unknown) => unknown) => resolve({ data: server.active.map((id) => ({ id })), error: null }) };
    return { from: () => query };
  },
}));

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
  it("reads each page's own shop parameter (the route contract)", () => {
    expect(shopParamFromUrl("/reports", q(`location=${A}`))).toBe(A);
    expect(shopParamFromUrl("/dashboard", q(`loc=${B}`))).toBe(B);
    expect(shopParamFromUrl("/my-feedback", q(`loc=${B}&location=${A}`))).toBe(A);
    expect(shopParamFromUrl("/my-feedback", q(`loc=${B}`))).toBe(B);
  });
  it("review P2: the dashboard reads only ?loc=, so a stray ?location= never wins there", () => {
    expect(shopParamFromUrl("/dashboard", q(`loc=${A}&location=${B}`))).toBe(A);
    expect(shopParamFromUrl("/dashboard", q(`location=${B}`))).toBeNull();
    expect(shopParamFromUrl("/stations", q(`loc=${A}&location=${B}`))).toBe(A);
    // and a page that reads only ?location= ignores ?loc=
    expect(shopParamFromUrl("/reports", q(`loc=${A}`))).toBeNull();
    expect(shopParamFromUrl("/ordering", q(`loc=${A}&location=${B}`))).toBe(B);
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

/** A Next `searchParams` record built from a query string: a REPEATED key arrives as an array. */
function nextRecord(search: string): Record<string, string | string[]> {
  const params = new URLSearchParams(search);
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    out[key] = all.length === 1 ? all[0]! : all;
  }
  return out;
}

describe("page/sync agreement — the remembered shop is the shop the page displays (reviews 1–3)", () => {
  // Every declared route (+ a dynamic /mid-shift section and two routes that read no URL shop).
  const ROUTES = [...declaredShopRoutes(), "/mid-shift/sales", "/catering/quotes", "/admin/catering/fulfillment"];
  const URLS = [
    `loc=${A}`, `location=${B}`, // single
    `loc=${A}&location=${B}`, `location=${B}&loc=${A}`, // mixed
    `location=${B}&location=${A}`, `loc=${B}&loc=${A}`, // repeated (review 3)
    `loc=${B}&loc=${A}&location=${B}`, `location=${A}&location=${B}&loc=${B}`, // repeated + the other param
    `loc=${C}&location=${C}`, "", // not held / none
  ];
  for (const route of ROUTES) {
    it(route, () => {
      const allowed = [{ id: A }, { id: B }];
      for (const search of URLS) {
        for (const remembered of [null, A, B]) {
          const where = `${route}?${search} (co_shop=${remembered})`;
          // The page: its explicit shop through ITS getter over Next's record shape (the exact
          // `shopParamFor("<route>", searchParamValues(<awaited searchParams>))` form is pinned in
          // the source audit below), then the resolver.
          const explicit = shopParamFor(route, searchParamValues(nextRecord(search)));
          const shown = pickShop({ allowed, explicit, remembered });
          // The sync, over the browser's URLSearchParams.
          const candidate = shopParamFromUrl(route, new URLSearchParams(search));
          if (shouldRememberShop({ candidate, allowed: [A, B], current: remembered })) {
            expect(candidate, where).toBe(shown!.id); // a write names the shop on screen
          } else if (candidate === null) {
            // silence ⇔ the page showed what it would show with no URL shop at all
            expect(shown, where).toBe(pickShop({ allowed, remembered }));
          }
        }
      }
    });
  }

  it("review 3: a repeated contracted parameter is no pick — page default shown, nothing written", () => {
    for (const route of [...declaredShopRoutes(), "/mid-shift/sales"]) {
      for (const name of shopParamNames(route)) {
        const search = `${name}=${B}&${name}=${A}`;
        expect(shopParamFromUrl(route, new URLSearchParams(search)), `${route}?${search}`).toBeNull();
        expect(shopParamFor(route, searchParamValues(nextRecord(search))), `${route}?${search}`).toBeUndefined();
        expect(pickShop({ allowed: [{ id: A }, { id: B }], explicit: shopParamFor(route, searchParamValues(nextRecord(search))), remembered: A })!.id).toBe(A);
      }
    }
  });

  it("contract spot-checks", () => {
    expect(shopParamNames("/dashboard")).toEqual(["loc"]);
    expect(shopParamNames("/my-feedback")).toEqual(["location", "loc"]);
    expect(shopParamNames("/catering/quotes")).toEqual([]);
    expect(shopParamNames("/admin/catering/fulfillment")).toEqual([]);
    expect(shopParamNames("/mid-shift/sales")).toEqual(["location"]);
    expect(shopParamNames("/mid-shift/")).toEqual([]);
    expect(shopParamFor("/my-feedback", searchParamValues({ location: "all", loc: A }))).toBe("all");
    // a repeated FIRST parameter stops the precedence; it never falls through to ?loc=
    expect(shopParamFor("/my-feedback", searchParamValues({ location: [A, B], loc: A }))).toBeUndefined();
    expect(shopParamFor("/my-feedback", searchParamValues({ location: undefined, loc: B }))).toBe(B);
  });
});

describe("report default — resolved against the page's AUTHORIZED shops (review P2)", () => {
  beforeEach(() => { server.cookie = undefined; server.active = [A, B, C]; server.queries = 0; });

  it("candidates: memberships below level 8; memberships first, then every active shop at 8+", () => {
    const base = { memberships: [A], activeShopIds: [B, A, C], reportAllLevel: REPORT_ALL_LOCATIONS_LEVEL };
    expect(reportShopCandidates({ ...base, level: 7 })).toEqual([A]);
    expect(reportShopCandidates({ ...base, level: 8 })).toEqual([A, B, C]);
    expect(reportShopCandidates({ ...base, level: 9 })).toEqual([A, B, C]);
  });

  it("REGRESSION: a level-9 with membership [A] who picked B on the dashboard opens /reports on B", async () => {
    server.cookie = B;
    const viewer = { userId: "u", level: 9, locations: [A] };
    const shop = await resolveReportShopId(viewer);
    expect(shop).toBe(B);
    expect(canReadScopedReport(viewer, shop!)).toBe(true); // and the page's own gate admits it
  });

  it("level 8 likewise (the report all-shop grant starts at 8)", async () => {
    server.cookie = B;
    expect(await resolveReportShopId({ level: 8, locations: [A] })).toBe(B);
  });

  it("below 8 a non-membership remembered shop is ignored (the gate would refuse it)", async () => {
    server.cookie = B;
    const viewer = { userId: "u", level: 7, locations: [A] };
    expect(await resolveReportShopId(viewer)).toBe(A);
    expect(canReadScopedReport(viewer, B)).toBe(false);
    expect(server.queries).toBe(0);
  });

  it("an inactive / unknown remembered shop falls back to the first membership even at 9", async () => {
    server.cookie = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    expect(await resolveReportShopId({ level: 9, locations: [A] })).toBe(A);
  });

  it("no cookie: the old default (first membership), and no extra query", async () => {
    expect(await resolveReportShopId({ level: 9, locations: [B, A] })).toBe(B);
    expect(server.queries).toBe(0);
  });

  it("a remembered membership needs no query", async () => {
    server.cookie = A;
    expect(await resolveReportShopId({ level: 9, locations: [B, A] })).toBe(A);
    expect(server.queries).toBe(0);
  });

  it("an 8+ with no memberships defaults to the first active shop instead of bouncing", async () => {
    expect(await resolveReportShopId({ level: 9, locations: [] })).toBe(A);
  });
});

describe("review 2: a route that ignores the URL shop never moves the remembered shop", () => {
  beforeEach(() => { server.cookie = A; server.queries = 0; });
  const q = (s: string) => new URLSearchParams(s);
  for (const route of ["/admin/catering/fulfillment", "/catering/quotes", "/admin/users", "/admin/catering/zones", "/operations/closing"]) {
    it(`${route}?location=B shows the remembered shop and writes nothing`, async () => {
      // The page's own selection code (fulfillment: resolveShopId over its nodes; quotes:
      // resolveShop over its locations) takes no explicit shop, so with co_shop=A it shows A…
      expect(await resolveShopId([A, B])).toBe(A);
      // …and the sync must not remember B from a parameter the page never read.
      const candidate = shopParamFromUrl(route, q(`location=${B}&loc=${B}`));
      expect(candidate).toBeNull();
      expect(shouldRememberShop({ candidate, allowed: [A, B], current: A })).toBe(false);
    });
  }
});

// ─── Route-contract audit against the ACTUAL page sources ─────────────────────

const ROOT_FOR_AUDIT = path.resolve(__dirname, "..");
const PAGE_ROUTES: Record<string, string> = {
  "app/admin/catalog/new/item/page.tsx": "/admin/catalog/new/item",
  "app/admin/catalog/new/sandwich/page.tsx": "/admin/catalog/new/sandwich",
  "app/(authed)/dashboard/page.tsx": "/dashboard",
  "app/(authed)/stations/page.tsx": "/stations",
  "app/admin/stations/page.tsx": "/admin/stations",
  "app/admin/toast-employees/page.tsx": "/admin/toast-employees",
  "app/admin/sevenshifts/page.tsx": "/admin/sevenshifts",
  "app/admin/pm-criteria/page.tsx": "/admin/pm-criteria",
  "app/(authed)/assignments/page.tsx": "/assignments",
  "app/(authed)/my-feedback/page.tsx": "/my-feedback",
  "app/(authed)/reports/page.tsx": "/reports",
  "app/(authed)/reports/sales/page.tsx": "/reports/sales",
  "app/(authed)/reports/sales/catering/page.tsx": "/reports/sales/catering",
  "app/(authed)/reports/sales/checks/page.tsx": "/reports/sales/checks",
  "app/(authed)/reports/written/page.tsx": "/reports/written",
  "app/(authed)/operations/opening/page.tsx": "/operations/opening",
  "app/(authed)/operations/production/page.tsx": "/operations/production",
  "app/(authed)/mid-shift/page.tsx": "/mid-shift",
  "app/(authed)/mid-shift/[section]/page.tsx": "/mid-shift/sales",
  "app/ordering/page.tsx": "/ordering",
  "app/admin/catering/prep-demand/page.tsx": "/admin/catering/prep-demand",
  "app/admin/catering/lto/page.tsx": "/admin/catering/lto",
  "app/admin/catering/fulfillment/page.tsx": "/admin/catering/fulfillment",
  "app/(authed)/catering/quotes/page.tsx": "/catering/quotes",
  "app/(authed)/catering/pipeline/page.tsx": "/catering/pipeline", // B8 #3 — add-lead default shop
  "app/admin/menu-costing/page.tsx": "/admin/menu-costing", // catalog Phase 2a — the costing board's shop switcher
  // catalog Phase 2b — the item page's shop switcher (a prefix route: /admin/catalog/sku/[id]).
  "app/admin/catalog/sku/[id]/page.tsx": "/admin/catalog/sku/7d0c1f2e-0000-4000-8000-000000000001",
  // catalog Phase 3b — the recipe page's shop switcher (a prefix route: /admin/catalog/recipe/[id]).
  "app/admin/catalog/recipe/[id]/page.tsx": "/admin/catalog/recipe/7d0c1f2e-0000-4000-8000-000000000001",
  // catalog Phase 3b — the menu item page's shop switcher (a prefix route: /admin/catalog/menu-item/[id]).
  "app/admin/catalog/menu-item/[id]/page.tsx": "/admin/catalog/menu-item/7d0c1f2e-0000-4000-8000-000000000001",
  // catalog Phase 3b — a GM's recipe updates for one shop (an exact route; ?location=<shop>).
  "app/admin/catalog/notices/page.tsx": "/admin/catalog/notices",
  // catalog Phase 2b (sim QA) — the SKU catalog and the vendor page resolve the shop their item-page
  // links land on; they read no shop parameter of their own.
  "app/admin/skus/page.tsx": "/admin/skus",
  "app/admin/vendors/[id]/page.tsx": "/admin/vendors/v",
  // catalog Phase 3a — readiness at a shop (the hub's attributed counts deep-link ?location=<shop>).
  "app/admin/recipes/page.tsx": "/admin/recipes",
  "app/admin/items/page.tsx": "/admin/items",
};

/** Where each audited page binds the awaited `searchParams` its getter reads. */
const BINDINGS: Record<string, RegExp> = {
  sp: /const sp = await searchParams;/,
  raw: /const raw = await searchParams;/,
  params: /const params = await searchParams;/,
  rawParams: /const rawParams = await searchParams;/,
  query: /renderPage\(await searchParams\)[\s\S]*async function renderPage\(query: /,
  "await searchParams": /./,
};
/** Direct reads of a shop parameter that bypass the contract getter. */
const BYPASS = [
  /\b(?:params|sp|query|rawParams)\.(?:location|loc)\b/,
  /\bsp\[["'](?:location|loc)["']\]/,
  /const \{[^}]*\b(?:location|loc)\b[^}]*\} = (?:await )?(?:searchParams|sp|query|params)\b/,
];

/**
 * The shop parameters a page's SOURCE reads: the contract of its route when (and only when) it reads
 * through the canonical getter over its OWN awaited searchParams; [] when it reads none. Anything
 * else (a hand-written getter, a direct read) fails here — review 3 P3: `() => undefined` as
 * /stations' getter must not pass.
 */
function shopParamsReadBySource(text: string, route: string): readonly string[] {
  for (const re of BYPASS) expect(re.test(text), `${route} reads a shop param outside the getter: ${re}`).toBe(false);
  const calls = [...text.matchAll(/shopParamFor\(/g)].length;
  const canonical = [...text.matchAll(/shopParamFor\((`[^`]+`|"[^"]+"), searchParamValues\(([^()]*(?:\(\))?)\)\)/g)];
  expect(canonical.length, `${route}: every shopParamFor call uses the canonical getter`).toBe(calls);
  if (calls === 0) return [];
  for (const [, literal, arg] of canonical) {
    const routeLiteral = literal!.slice(1, -1);
    if (routeLiteral.includes("${")) expect(route.startsWith(routeLiteral.split("${")[0]!), `${route}: ${routeLiteral}`).toBe(true);
    else expect(routeLiteral).toBe(route);
    const binding = BINDINGS[arg!];
    expect(binding, `${route}: getter reads ${arg}, which is not a known searchParams binding`).toBeDefined();
    expect(text, `${route}: ${arg} is the page's awaited searchParams`).toMatch(binding!);
  }
  return shopParamNames(route);
}

describe("route contract = what each resolver page's source actually reads (reviews 2–3)", () => {
  it("every page that imports the resolver is audited (and every audited page imports it)", () => {
    const pages: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(path.join(ROOT_FOR_AUDIT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (entry.name === "page.tsx") {
          const source = readFileSync(path.join(ROOT_FOR_AUDIT, rel), "utf8");
          // Job loaders perform the authorized shop resolution on the page's behalf.
          if (/from "@\/lib\/shop-context"/.test(source)
            || /import \{ loadNew(?:Item|Sandwich)JobView \} from "@\/lib\/catalog\/jobs"/.test(source)) pages.push(rel);
        }
      }
    };
    walk("app");
    expect(pages.sort()).toEqual(Object.keys(PAGE_ROUTES).sort());
  });
  it("every declared route is backed by an audited page", () => {
    const audited = new Set(Object.values(PAGE_ROUTES));
    for (const route of declaredShopRoutes()) expect(audited.has(route), route).toBe(true);
  });
  for (const [file, route] of Object.entries(PAGE_ROUTES)) {
    it(`${route} (${file})`, () => {
      const text = readFileSync(path.join(ROOT_FOR_AUDIT, file), "utf8");
      expect(shopParamNames(route)).toEqual(shopParamsReadBySource(text, route));
    });
  }
});

// ─── Source-shape pins ────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "..");
const src = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** Every page that defaulted to "the first location" (triage #30 + the two Pulse-era twins). */
const RESOLVER_PAGES: Record<string, RegExp> = {
  "app/(authed)/dashboard/page.tsx": /await resolveShop\(locations, shopParamFor\("\/dashboard", /,
  "app/(authed)/reports/page.tsx": /shopParamFor\("\/reports", searchParamValues\(raw\)\) \?\? \(await resolveReportShopId\(auth\)\)/,
  "app/(authed)/reports/sales/page.tsx": /shopParamFor\("\/reports\/sales", searchParamValues\(params\)\) \?\? \(await resolveReportShopId\(auth\)\)/,
  "app/(authed)/reports/sales/catering/page.tsx": /shopParamFor\("\/reports\/sales\/catering", searchParamValues\(params\)\) \?\? \(await resolveReportShopId\(auth\)\)/,
  "app/(authed)/reports/sales/checks/page.tsx": /shopParamFor\("\/reports\/sales\/checks", searchParamValues\(params\)\) \?\? \(await resolveReportShopId\(auth\)\)/,
  "app/(authed)/reports/written/page.tsx": /await resolveShopId\(auth\.locations\)/,
  "app/(authed)/my-feedback/page.tsx": /selectedParam = shopParamFor\("\/my-feedback", [\s\S]*await resolveShop\(locations, selectedParam\)/,
  "app/(authed)/assignments/page.tsx": /await resolveShop\(locations, shopParamFor\("\/assignments", /,
  "app/(authed)/stations/page.tsx": /await resolveShop\(locations, shopParamFor\("\/stations", /,
  "app/(authed)/operations/opening/page.tsx": /await resolveShop\(locations, locParam\)/,
  // B3's Production default (D-64): memberships, then every active shop for the 9+ grant; the bind follows.
  "app/(authed)/operations/production/page.tsx": /const location = requested \?\? \(await resolveShopId\(isAllLocationsAccess\(locActor\)\s*\? \[\.\.\.auth\.locations, \.\.\.\(await activeLocationIds\(\)\)\.filter\(\(id\) => !auth\.locations\.includes\(id\)\)\]\s*: auth\.locations\)\);\s*if \(!location\) redirect\("\/dashboard"\);\s*if \(!lockLocationContext\(locActor, location\)\) redirect\("\/dashboard"\);/,
  "app/(authed)/catering/quotes/page.tsx": /await resolveShop\(locations\)/,
  "app/(authed)/catering/pipeline/page.tsx": /await resolveShop\(createLocations\)/,
  "app/(authed)/mid-shift/page.tsx": /location \?\? \(await resolveShopId\(accessible\.map/,
  "app/(authed)/mid-shift/[section]/page.tsx": /remembered: await rememberedShopId\(\)/,
  "components/pulse/PulseHome.tsx": /remembered: await rememberedShopId\(\)/,
  "app/admin/catering/prep-demand/page.tsx": /await resolveShop\(locations, paramLocation\)/,
  "app/admin/catering/lto/page.tsx": /await resolveShop\(locations, paramLocation\)/,
  "app/admin/catering/fulfillment/page.tsx": /await resolveShopId\(nodes\.map/,
  "app/admin/stations/page.tsx": /await resolveShop\(locations, shopParamFor\("\/admin\/stations", /,
  "app/admin/toast-employees/page.tsx": /await resolveShop\(locations, shopParamFor\("\/admin\/toast-employees", /,
  "app/admin/sevenshifts/page.tsx": /await resolveShop\(locations, shopParamFor\("\/admin\/sevenshifts", /,
  "app/admin/pm-criteria/page.tsx": /await resolveShop\(locations, shopParamFor\("\/admin\/pm-criteria", /,
  "app/ordering/page.tsx": /location \?\? \(await resolveShopId\(accessible\.map/,
  // Catalog Phase 2a: "global" is the explicit All-shops view; otherwise the one resolver over the readable shops.
  "app/admin/menu-costing/page.tsx": /explicit === "global" \? null : await resolveShopId\(shops\.map\(\(s\) => s\.id\), explicit \?\? null\)/,
  // Catalog Phase 3a: an explicit shop goes through the one resolver; absent / "global" is the default (not remembered).
  "app/admin/recipes/page.tsx": /explicit && explicit !== "global" && shops\.some\(\(s\) => s\.id === explicit\)\s*\? await resolveShopId\(shops\.map\(\(s\) => s\.id\), explicit\) : null/,
  "app/admin/items/page.tsx": /explicit && explicit !== "global" && shops\.some\(\(s\) => s\.id === explicit\)\s*\? await resolveShopId\(shops\.map\(\(s\) => s\.id\), explicit\) : null/,
  // Catalog Phase 3b: "global" is the default; a shop the viewer works in goes through the one resolver; another active
  // shop reads (read-only); absent → the one resolver over the viewer's shops.
  "app/admin/catalog/recipe/[id]/page.tsx": /explicit === "global" \? null\s*: explicit && mine\.includes\(explicit\) \? await resolveShopId\(mine, explicit\)[\s\S]*: mine\.length > 0 \? await resolveShopId\(mine, null\) : null/,
  // …and the menu item page, the same way.
  "app/admin/catalog/menu-item/[id]/page.tsx": /explicit === "global" \? null\s*: explicit && mine\.includes\(explicit\) \? await resolveShopId\(mine, explicit\)[\s\S]*: mine\.length > 0 \? await resolveShopId\(mine, null\) : null/,
  // …and the recipe updates (notices) page: the one resolver over the shops the viewer works in.
  "app/admin/catalog/notices/page.tsx": /const explicit = shopParamFor\("\/admin\/catalog\/notices", searchParamValues\(sp\)\);\s*const shopId = mine\.length === 0 \? null : await resolveShopId\(mine, explicit \?\? null\);/,
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

  it("Production's all-shop lookup still fails LOUD (a lookup error is a fault, not 'no shop')", () => {
    const production = src("app/(authed)/operations/production/page.tsx");
    expect(production).toMatch(/if \(error\) throw new Error\(`production: default shop lookup failed: \$\{error\.message\}`\);/);
    expect(production).not.toMatch(/firstActiveLocationId/);
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

// API scopes are explicit: this mixed Toast route is not a page/cookie preference resolver.
it("catalog Toast GET declares the selected-shop location contract", () => {
  const source = readFileSync("app/api/admin/catalog/menu-item/[id]/toast/route.ts", "utf8");
  expect(source).toContain('export async function GET');
  expect(source).toContain('req.nextUrl.searchParams.get("location")');
  expect(source).toContain('if (!uuid(locationId))');
  expect(source).toContain('loadToastLinkChoices(ctx, id, locationId)');
});
