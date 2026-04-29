/**
 * Edge proxy — Phase 2.
 *
 * Renamed from `middleware.ts` per Next 16. Same export shape, same role.
 *
 * Responsibilities (edge runtime — no DB access):
 *   1. Read session JWT from the httpOnly cookie.
 *   2. Validate signature + exp via lib/auth verifyJwt.
 *   3. On any failure → 302 redirect to / with `?next=<orig>` for return-to-origin.
 *   4. On success → attach x-co-{user-id,app-role,role-level,session-id}
 *      headers to the forwarded request and pass through.
 *
 * NOT this proxy's job (handled in lib/session.ts requireSession on the
 * Node-runtime side):
 *   - sessions row lookup, revoked/expired/idle checks
 *   - token_hash dual verification
 *   - last_activity_at touch
 *   - step-up clearing on URL transition out of /admin/*
 *
 * Public-path exclusion is implemented via:
 *   (a) the matcher's negative-lookahead regex (so the proxy fn never runs
 *       for explicitly-public paths), AND
 *   (b) a defensive isPublicPath() check at the top of the proxy fn.
 * (a) is the production fast path; (b) is defense-in-depth — if the matcher
 * misses an edge case (or someone adds a new public route without updating
 * the matcher), the function still bypasses correctly.
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyJwt } from "./lib/auth";

const COOKIE_NAME = "co_ops_session";

const PUBLIC_PATHS = new Set<string>([
  "/",
  "/verify",
  "/reset-password",
  "/api/auth/pin",
  "/api/auth/password",
  "/api/auth/verify",
  "/api/auth/password-reset-request",
  "/api/auth/password-reset",
]);

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const pathname = req.nextUrl.pathname;

  // Defensive bypass — matcher should already exclude these.
  if (isPublicPath(pathname)) return NextResponse.next();

  const rawJwt = req.cookies.get(COOKIE_NAME)?.value;
  if (!rawJwt) return redirectToLogin(req);

  let claims;
  try {
    claims = await verifyJwt(rawJwt);
  } catch {
    return redirectToLogin(req);
  }

  // Forward identity headers to the downstream Node-runtime handler.
  // requireSession() will still run there — these are convenience hints,
  // not authorization. The handler must call requireSession() for the real
  // session check (sessions row, token_hash, idle, revoked, etc.).
  const headers = new Headers(req.headers);
  headers.set("x-co-user-id", claims.user_id);
  headers.set("x-co-app-role", claims.app_role);
  headers.set("x-co-role-level", String(claims.role_level));
  headers.set("x-co-session-id", claims.session_id);

  return NextResponse.next({ request: { headers } });
}

function redirectToLogin(req: NextRequest): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = "/";
  url.search = "";
  if (req.nextUrl.pathname !== "/") {
    url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  }
  return NextResponse.redirect(url);
}

export const config = {
  // Match every path EXCEPT:
  //   - Next infrastructure (_next/static, _next/image, favicon.ico)
  //   - Public auth endpoints (verify, reset-password, /api/auth/{pin,password,verify,password-reset-request,password-reset})
  //   - The root login page (the `.+` quantifier requires ≥ 1 char after `/`,
  //     so `/` alone is excluded).
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|verify$|reset-password$|api/auth/(pin|password|verify|password-reset-request|password-reset)$).+)",
  ],
};
