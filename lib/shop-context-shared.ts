/**
 * Shop context — the ONE answer to "which shop am I working in?" (B2, triage #30).
 *
 * A GM with both shops logged in on the P Street tile and landed on the other shop on the
 * dashboard, the Reports Hub, Catering sales, Prep Demand, the new-quote Location and the
 * fulfillment editor: login never carried the chosen shop forward, and ~15 pages each defaulted
 * to "the first location" on their own.
 *
 * THE RULE (every shop-defaulting page goes through `pickShop` / `pickShopId`):
 *   1. an explicit `?loc=` / `?location=` in the URL wins — when the page allows it;
 *   2. else the REMEMBERED shop (the `co_shop` cookie: written at tile login and on every
 *      explicit shop pick in the URL), when the page allows it;
 *   3. else the first allowed shop (today's behaviour);
 *   4. else null.
 * "Allowed" is ALWAYS the list the page already computed from the actor's grant
 * (memberships / lockLocationContext / the page's level rule). The resolver only CHOOSES among
 * those; it never adds one. A stale or forged cookie therefore falls through to rule 3 — the
 * cookie is a preference, never an authorization (AGENTS.md § Auth & sessions: preferences are
 * read per-request and never ride in the JWT).
 *
 * WHY THE COOKIE IS WRITTEN BY THE CLIENT, NOT BY proxy.ts. The triage plan set it in the proxy on
 * any request carrying `?loc=`. Next 16 strips `next-router-prefetch` (and every Flight header)
 * from `request.headers` inside the proxy, so a proxy cannot tell a Link PREFETCH from a real
 * navigation: the dashboard's switcher prefetches every chip, and the cookie would flip to
 * whichever shop was prefetched last. The client writes it after a real navigation commits
 * (`components/ShopContextSync.tsx`) and at tile login (`app/page.tsx`), which a prefetch never
 * does.
 *
 * Zero imports, no I/O: importable from client components, server pages and tests alike.
 */

/** Cookie holding the remembered shop id. Not httpOnly: the client writes it (see above). */
export const SHOP_COOKIE = "co_shop";

/** 30 days — a shop tablet keeps its shop across the 12 h session expiry. */
export const SHOP_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A shop id is a UUID. `"all"`, `"both"` and anything else are not shop ids. */
export function isShopId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export interface PickShopArgs<T> {
  /** The shops this page already allows this actor, in the page's display order. */
  allowed: readonly T[];
  /** The URL's explicit shop, when the page reads one. */
  explicit?: string | null;
  /** The remembered shop (the `co_shop` cookie). */
  remembered?: string | null;
}

/** Explicit → remembered → first allowed → null; a candidate outside `allowed` never wins. */
export function pickShopId(args: PickShopArgs<string>): string | null {
  for (const candidate of [args.explicit, args.remembered]) {
    if (candidate && args.allowed.includes(candidate)) return candidate;
  }
  return args.allowed[0] ?? null;
}

/** `pickShopId` over location rows: returns the allowed ROW, never a fabricated one. */
export function pickShop<T extends { id: string }>(args: PickShopArgs<T>): T | null {
  const id = pickShopId({ allowed: args.allowed.map((shop) => shop.id), explicit: args.explicit, remembered: args.remembered });
  return id === null ? null : (args.allowed.find((shop) => shop.id === id) ?? null);
}

/**
 * THE ROUTE PARAMETER CONTRACT: which query parameter(s) select the shop on each page, in
 * precedence order. OPT-IN: a route that is not declared here reads NO shop from its URL, and the
 * sync never remembers a shop from it (review 2: `/admin/catering/fulfillment?location=B` and
 * `/catering/quotes?location=B` ignore the parameter and show the remembered shop, so remembering B
 * there would move the working shop to one the page never displayed; `/admin/users?location=` is a
 * list FILTER). Every declared page reads its explicit shop THROUGH `shopParamFor`, and so does the
 * sync — so the shop the sync remembers is the shop the page displays (review 1: `/dashboard?loc=A&location=B` shows
 * A, so it remembers A). `tests/shop-context.test.ts` audits every resolver page's SOURCE against
 * this table, both ways.
 */
const SHOP_PARAMS_BY_PATH: Readonly<Record<string, readonly string[]>> = {
  "/admin/catalog/new/item": ["location"],
  "/admin/catalog/new/sandwich": ["location"],
  "/dashboard": ["loc"],
  "/stations": ["loc"],
  "/admin/stations": ["loc"],
  "/admin/toast-employees": ["loc"],
  "/admin/sevenshifts": ["loc"], // Scheduling Phase 1 — the 7shifts links, per shop
  "/admin/pm-criteria": ["loc"], // Scheduling Phase 1 — the PM v2 criteria editor, per shop
  "/assignments": ["location", "loc"],
  "/my-feedback": ["location", "loc"], // old ?loc= links keep working; the shared tabs use ?location=
  "/reports": ["location"],
  // Catalog Phase 3a — readiness AT a shop (the hub's attributed counts link here; ?location=<shop>|global).
  "/admin/recipes": ["location"],
  "/admin/items": ["location"],
  "/reports/sales": ["location"],
  "/reports/sales/catering": ["location"],
  "/reports/sales/checks": ["location"],
  "/reports/written": ["location"],
  "/operations/opening": ["location"],
  "/operations/production": ["location"],
  "/mid-shift": ["location"],
  "/ordering": ["location"],
  "/admin/catering/prep-demand": ["location"],
  "/admin/catering/lto": ["location"],
  "/admin/menu-costing": ["location"], // catalog Phase 2a — the costing board's shop switcher
  "/admin/skus": ["location"], // hub SKU readiness scope; editor baselines remain global
  "/admin/catalog/notices": ["location"], // catalog Phase 3b — a GM's recipe updates for one shop
};

/** Dynamic routes, matched by prefix (`/mid-shift/[section]`). */
const SHOP_PARAMS_BY_PREFIX: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["/mid-shift/", ["location"]],
  // Catalog Phase 2b — the item page's shop switcher (?location=<shop> | global). "global" is not a
  // shop id, so the sync never remembers it (shopParamFromUrl / shouldRememberShop).
  ["/admin/catalog/sku/", ["location"]],
  // Catalog Phase 3b — the recipe and menu-item pages' shop switcher (?location=<shop> | global).
  // (The notices list is an exact route, "/admin/catalog/notices", declared in SHOP_PARAMS_BY_PATH with its page.)
  ["/admin/catalog/recipe/", ["location"]],
  ["/admin/recipes/", ["location"]],
  ["/admin/catalog/menu-item/", ["location"]],
];

const NO_SHOP_PARAMS: readonly string[] = [];

/** The shop-selecting query parameters of `pathname`, in precedence order; [] = reads none. */
export function shopParamNames(pathname: string): readonly string[] {
  const exact = SHOP_PARAMS_BY_PATH[pathname];
  if (exact) return exact;
  return SHOP_PARAMS_BY_PREFIX.find(([prefix]) => pathname.startsWith(prefix) && pathname.length > prefix.length)?.[1] ?? NO_SHOP_PARAMS;
}

/** Every declared exact route (the test audits each against its page source). */
export function declaredShopRoutes(): string[] {
  return Object.keys(SHOP_PARAMS_BY_PATH);
}

/** Every value a query parameter carries, in order (`[]` = absent). */
export type ShopParamValues = (name: string) => readonly string[];

/**
 * Values over a Next `searchParams` RECORD (a repeated parameter arrives as an array). Every
 * declared page reads its explicit shop as `shopParamFor("<route>", searchParamValues(<the awaited
 * searchParams>))`; `tests/shop-context.test.ts` pins that exact form.
 */
export function searchParamValues(record: object): ShopParamValues {
  return (name) => {
    const value = (record as Record<string, unknown>)[name];
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
    return [];
  };
}

/** Values over a `URLSearchParams` (the sync's `useSearchParams()`). */
export function urlParamValues(params: { getAll(name: string): string[] }): ShopParamValues {
  return (name) => params.getAll(name);
}

/**
 * The RAW explicit shop value `pathname` reads: the first PRESENT parameter of its contract, or
 * undefined. Raw on purpose: a page may give a non-shop value meaning (`"all"`). A REPEATED
 * parameter (`?location=B&location=A`) is no selection at all (review 3): the page shows its
 * default and the sync writes nothing — the precedence stops there, it does not fall through to
 * the next parameter. Page and sync both run this one function, so they cannot disagree.
 */
export function shopParamFor(pathname: string, values: ShopParamValues): string | undefined {
  for (const name of shopParamNames(pathname)) {
    const all = values(name);
    if (all.length === 0) continue;
    return all.length === 1 ? all[0] : undefined;
  }
  return undefined;
}

/** The explicit shop a URL selects on this page (per the contract above), or null. */
export function shopParamFromUrl(pathname: string, params: { getAll(name: string): string[] }): string | null {
  const value = shopParamFor(pathname, urlParamValues(params));
  return isShopId(value) ? value : null;
}

/**
 * The shops a REPORT page may default to, in fallback order (review P2). Below
 * `reportAllLevel` that is the actor's memberships (the read gate is membership). At or above
 * it the read gate admits every active shop, so a remembered shop outside the memberships (a
 * level-9 who picked it on the dashboard) is a valid default too; memberships still come first so
 * the no-cookie default is unchanged.
 */
export function reportShopCandidates(args: {
  level: number;
  memberships: readonly string[];
  activeShopIds: readonly string[];
  reportAllLevel: number;
}): string[] {
  if (args.level < args.reportAllLevel) return [...args.memberships];
  return [...args.memberships, ...args.activeShopIds.filter((id) => !args.memberships.includes(id))];
}

/**
 * Whether an explicit pick should become the remembered shop. Only a shop the actor holds
 * operationally (`"all"` = the 9+ grant; otherwise their memberships): a level-8 reader opening
 * another shop's report is looking, not moving shops. No write when nothing would change.
 */
export function shouldRememberShop(args: {
  candidate: string | null;
  allowed: readonly string[] | "all";
  current: string | null;
}): boolean {
  if (!isShopId(args.candidate) || args.candidate === args.current) return false;
  return args.allowed === "all" || args.allowed.includes(args.candidate);
}

/**
 * Where a tile login lands. `safeNext` is the ALREADY-SANITIZED `?next=` (lib/nav-redirect
 * `safeNextPath`). A deep link keeps its own target (the remembered shop covers it); the plain
 * dashboard landing names the tile's shop so the first paint is that shop even if the cookie
 * write was blocked.
 */
export function loginLandingPath(safeNext: string, shopId: string | null | undefined): string {
  return safeNext === "/dashboard" && isShopId(shopId) ? `/dashboard?loc=${encodeURIComponent(shopId)}` : safeNext;
}

/** Read one cookie's value out of a `Cookie` header / `document.cookie` string. */
export function readCookie(cookieString: string, name: string): string | null {
  for (const part of cookieString.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/** The `document.cookie` assignment that remembers `shopId` (Secure on https). */
export function shopCookieAssignment(shopId: string, secure: boolean): string {
  return `${SHOP_COOKIE}=${encodeURIComponent(shopId)}; Path=/; Max-Age=${SHOP_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure ? "; Secure" : ""}`;
}
