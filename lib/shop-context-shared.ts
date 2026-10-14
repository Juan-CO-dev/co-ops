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
 * Paths where `?location=` is NOT the working shop (a list FILTER, not a context switch), so
 * visiting them must not move the remembered shop.
 */
const NON_CONTEXT_PATHS: readonly string[] = ["/admin/users"];

/** The explicit shop a URL selects (`location` first, then the dashboard's `loc`), or null. */
export function shopParamFromUrl(pathname: string, params: { get(name: string): string | null }): string | null {
  if (NON_CONTEXT_PATHS.includes(pathname)) return null;
  const value = params.get("location") ?? params.get("loc");
  return isShopId(value) ? value : null;
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
