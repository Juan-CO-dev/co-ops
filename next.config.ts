import type { NextConfig } from "next";

import { SECURITY_HEADERS } from "./lib/security-headers";

const nextConfig: NextConfig = {
  // Next 16 dev mode blocks cross-origin requests to /_next/* dev resources by
  // default. When loading the dev server from a phone on the LAN
  // (http://10.0.0.20:3000), the HTML loads but client bundles + HMR socket
  // get blocked → page renders but never hydrates ("looked like a screenshot").
  // Allowlist the LAN IP for dev.
  //
  // Dev-only. Production builds ignore it.
  allowedDevOrigins: ["10.0.0.20"],

  // P2-7 — stop announcing the stack. `x-powered-by: Next.js` is free
  // reconnaissance and buys nothing.
  poweredByHeader: false,

  // P2-7 — the app shipped with zero security response headers. The set and
  // every value live in lib/security-headers.ts, which is unit-tested; this
  // file only wires it, so the policy cannot drift without a test noticing.
  //
  // The CSP in that set is REPORT-ONLY by deliberate choice — see the module
  // header. Nothing here blocks a request today.
  async headers() {
    return [
      {
        // Regex path match: every path, including the API routes.
        source: "/(.*)",
        headers: SECURITY_HEADERS.map((h) => ({ key: h.key, value: h.value })),
      },
    ];
  },
};

export default nextConfig;
