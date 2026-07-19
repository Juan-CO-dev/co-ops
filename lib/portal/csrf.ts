/**
 * Portal CSRF guard (A-H5).
 *
 * The customer session cookie is `sameSite=lax`, which is a heuristic — not a sufficient sole
 * control for money/order mutations. The prior per-route check only ran WHEN an `Origin` header was
 * present, so a cross-site request crafted to omit `Origin` slipped through with the customer's
 * cookie attached. This guard fails CLOSED: a state-changing portal request must be provably
 * same-origin.
 *
 * Browsers send `Origin` on every state-changing (POST) request — same-origin AND cross-origin — so
 * requiring a present, same-host `Origin` does not break the portal's own `fetch()` calls, while a
 * missing or cross-site `Origin` (or `Sec-Fetch-Site: cross-site`) is treated as a CSRF attempt.
 * Returns a 403 NextResponse to short-circuit the handler, or `null` when the request may proceed.
 */

import { NextResponse, type NextRequest } from "next/server";

export function assertSameOrigin(req: NextRequest): NextResponse | null {
  const deny = () => NextResponse.json({ error: "bad_origin" }, { status: 403 });

  // Sec-Fetch-Site is emitted by all modern browsers; a cross-site fetch is an outright reject.
  if (req.headers.get("sec-fetch-site") === "cross-site") return deny();

  // Require a present, same-host Origin (browsers always send it on a POST).
  const origin = req.headers.get("origin");
  if (!origin) return deny();
  try {
    if (new URL(origin).host !== req.nextUrl.host) return deny();
  } catch {
    return deny();
  }
  return null;
}
