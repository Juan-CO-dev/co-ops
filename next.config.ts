import type { NextConfig } from "next";

import { SECURITY_HEADERS } from "./lib/security-headers";
import { assertSimTarget } from "./lib/sim-isolation-shared";

if (process.env.SIM_MODE) assertSimTarget(process.env.NEXT_PUBLIC_SUPABASE_URL);

const nextConfig: NextConfig = {
  ...(process.env.SIM_MODE ? { distDir: ".next-sim-launch" } : {}),
  // Next 16 dev mode blocks cross-origin requests to /_next/* dev resources by
  // default. When loading the dev server from a phone on the LAN
  // (http://10.0.0.20:3000), the HTML loads but client bundles + HMR socket
  // get blocked → page renders but never hydrates ("looked like a screenshot").
  // Allowlist the LAN IP for dev.
  //
  // Dev-only. Production builds ignore it.
  allowedDevOrigins: ["10.0.0.20"],

  // /training renders the three written guides straight out of docs/guides, and
  // its image route streams the screenshots beside them. Neither is an import,
  // so Vercel's file tracing does not see them and the serverless bundle ships
  // without the .md files OR the PNGs — a page that works locally and 500s in
  // production. Naming them here is the fix; lib/guides/content.ts keeps its
  // paths literal for the same reason.
  // Both entries name both sets on purpose: Next unions these includes across
  // the entries, so splitting them would ship the PNGs into the page's bundle
  // and the Markdown into the route's anyway — saying it plainly keeps the
  // config true to what each function carries.
  //
  // MEASURED, not assumed (production build, 2026-09-15): exactly these two
  // .nft.json manifests carry docs/guides — 146 PNGs and 11 Markdown files —
  // and the other 283 routes carry none. The patterns resolve a little wider
  // than they read (the walk scripts beside the guides come along, ~40 KB);
  // that is Next's globbing, and it is cheap enough to leave alone.
  outputFileTracingIncludes: {
    "/training": ["./docs/guides/*-guide.md", "./docs/guides/img/**/*.png"],
    "/api/guides/img/[guide]/[file]": ["./docs/guides/*-guide.md", "./docs/guides/img/**/*.png"],
  },

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
