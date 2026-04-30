import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16 dev mode blocks cross-origin requests to /_next/* dev resources by
  // default. When loading the dev server from a phone on the LAN
  // (http://10.0.0.20:3000), the HTML loads but client bundles + HMR socket
  // get blocked → page renders but never hydrates ("looked like a screenshot").
  // Allowlist the LAN IP for dev.
  //
  // Dev-only. Production builds ignore it.
  allowedDevOrigins: ["10.0.0.20"],
};

export default nextConfig;
