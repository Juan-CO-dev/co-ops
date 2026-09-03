/**
 * Web security response headers (P2-7) — the pure half.
 *
 * next.config.ts set NOT ONE of these, and `poweredByHeader` defaults true, so
 * every response also announced the stack. This module owns the decisions; the
 * config file owns only the wiring, which is why the policy is testable at all.
 *
 * ── THE CSP IS REPORT-ONLY, ON PURPOSE ──────────────────────────────────────
 * A strict policy has three plausible ways to break this app: Next's own inline
 * bootstrap/flight scripts, the Leaflet + OpenStreetMap tiles on the two maps,
 * and the Vercel preview toolbar. Shipping an ENFORCING policy built from a
 * grep would mean discovering the gaps as a production outage. Report-Only is
 * the reconnaissance pass — violations are reported, nothing is blocked — and
 * the flip to enforcing is a later decision made against real violation data,
 * not against this file's confidence. `SECURITY_HEADERS` therefore emits the
 * Report-Only header ONLY, and a test pins that.
 *
 * ── HOW THE ORIGIN INVENTORY WAS BUILT ──────────────────────────────────────
 * Every `https://` literal under app/, components/ and lib/ was enumerated and
 * then split by WHO fetches it. Only browser-initiated loads belong in a CSP:
 *
 *   BROWSER (in the policy)
 *     *.tile.openstreetmap.org   Leaflet raster tiles — components/order/
 *                                DeliveryRouteMap.tsx and components/admin/
 *                                catering/fulfillment/ZoneMap.tsx both request
 *                                "https://{s}.tile.openstreetmap.org/...", and
 *                                the {s} subdomain shard is why this is a
 *                                wildcard host.
 *     s3.amazonaws.com           Toast menu photography — components/portal/
 *                                storefront-images.ts, app/order/page.tsx.
 *     static.spotapps.co         SpotHopper photography — same two files.
 *     nominatim.openstreetmap.org  Address geocode, fetched FROM THE BROWSER in
 *                                app/order/start/start-client.tsx.
 *     vercel.live                The preview-deployment toolbar. Included so a
 *                                preview smoke run is not drowned in violations
 *                                that say nothing about our own code.
 *
 *   SERVER-ONLY (deliberately absent)
 *     ws-api.toasttab.com, api.ezcater.com, api.anthropic.com — route handlers
 *     and crons. A CSP governs the PAGE; listing them would imply the browser
 *     talks to them, which it does not.
 *
 *   NOT A RESOURCE LOAD
 *     www.openstreetmap.org — the tile attribution LINK's href. A CSP does not
 *     govern navigation targets, so it needs no entry.
 *
 *   SELF-HOSTED, SO NO ENTRY NEEDED
 *     Fonts. app/layout.tsx uses next/font/google (DM Sans), which downloads
 *     the faces AT BUILD TIME and serves them from /_next/static — there is no
 *     runtime fonts.gstatic.com request, so `font-src 'self'` is not a
 *     restriction, it is the truth. Leaflet's marker PNGs are bundled asset
 *     imports and are 'self' for the same reason.
 */

export interface CspOrigins {
  script: string[];
  style: string[];
  img: string[];
  connect: string[];
  font: string[];
  frame: string[];
}

/** The browser-facing external origins this app actually loads from. */
export const CSP_ORIGINS: CspOrigins = {
  // The Vercel preview toolbar. Harmless in production, where it is not served.
  script: ["https://vercel.live"],
  style: [],
  img: [
    "https://*.tile.openstreetmap.org",
    "https://s3.amazonaws.com",
    "https://static.spotapps.co",
  ],
  connect: ["https://nominatim.openstreetmap.org", "https://vercel.live", "wss://vercel.live"],
  font: [],
  frame: ["https://vercel.live"],
};

/**
 * Build the policy string.
 *
 * `'unsafe-inline'` on script-src and style-src is not an aspiration being
 * abandoned — it is what Next 16 + Tailwind v4 currently require (the inline
 * bootstrap and flight payload; Leaflet's inline element styles). Recording it
 * in a REPORT-ONLY policy is precisely how we find out whether a nonce-based
 * policy is reachable, without betting the app on the answer today.
 */
export function buildContentSecurityPolicy(origins: CspOrigins): string {
  const directive = (name: string, ...sources: string[]) =>
    `${name} ${sources.filter(Boolean).join(" ")}`;

  return [
    directive("default-src", "'self'"),
    directive("base-uri", "'self'"),
    directive("form-action", "'self'"),
    // Belt and braces with X-Frame-Options: DENY — modern browsers prefer this
    // one, and older ones only understand the header.
    directive("frame-ancestors", "'none'"),
    directive("object-src", "'none'"),
    directive("script-src", "'self'", "'unsafe-inline'", ...origins.script),
    directive("style-src", "'self'", "'unsafe-inline'", ...origins.style),
    // data: for inline SVG/icons, blob: for client-generated object URLs.
    directive("img-src", "'self'", "data:", "blob:", ...origins.img),
    directive("font-src", "'self'", "data:", ...origins.font),
    directive("connect-src", "'self'", ...origins.connect),
    directive("frame-src", "'self'", ...origins.frame),
    directive("worker-src", "'self'", "blob:"),
    directive("manifest-src", "'self'"),
  ].join("; ");
}

export interface SecurityHeader {
  key: string;
  value: string;
}

/**
 * The header set applied to every path.
 *
 * HSTS is two years with includeSubDomains and preload — the app is
 * HTTPS-only on Vercel and has no plaintext host to strand.
 * Permissions-Policy denies camera, microphone and geolocation outright:
 * verified by grep that the app calls none of them (the delivery map takes a
 * DRAGGED pin, never the device's position), so this costs nothing and closes
 * the surface for any embedded third party.
 */
export const SECURITY_HEADERS: readonly SecurityHeader[] = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    // REPORT-ONLY. See the module header — do not rename this to the enforcing
    // header without violation data to back the flip.
    key: "Content-Security-Policy-Report-Only",
    value: buildContentSecurityPolicy(CSP_ORIGINS),
  },
];
