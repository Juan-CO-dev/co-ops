/**
 * Unit spine — the web security response headers (P2-7).
 *
 * next.config.ts was 14 lines and set NOT ONE security header: no HSTS, no
 * nosniff, no framing refusal, no referrer policy, no permissions policy, no
 * CSP — and `poweredByHeader` defaults TRUE, so every response announced the
 * stack. A 6 AM operational app served over HTTPS to shared tablets is exactly
 * the deployment where a downgrade or a clickjacked frame costs a session.
 *
 * WHY THE CSP SHIPS REPORT-ONLY. A strict policy can break Next's inline
 * runtime, the Leaflet/OpenStreetMap tiles on the zone map, and the Vercel
 * preview toolbar. Enforcing one blind would take the app down to fix a header.
 * Report-Only is the reconnaissance pass: violations surface, nothing breaks,
 * and the enforcing flip is a later, evidenced decision. A test therefore pins
 * REPORT-ONLY specifically — a well-meaning rename to the enforcing header is
 * the failure mode this file exists to catch.
 *
 * THE ORIGIN INVENTORY IS THE PRODUCT. The policy is only as good as the list
 * of origins it was built from, so the list is asserted here rather than
 * trusted: each entry was found by grepping the browser-facing tree, and each
 * has a named consumer.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";
import {
  CSP_ORIGINS,
  SECURITY_HEADERS,
  buildContentSecurityPolicy,
} from "@/lib/security-headers";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = readFileSync(join(repoRoot, "next.config.ts"), "utf8");

/** Parse a policy string back into directive -> sources. */
function directivesOf(policy: string): Map<string, string[]> {
  return new Map(
    policy
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [name, ...sources] = d.split(/\s+/);
        return [name!, sources] as const;
      }),
  );
}

describe("buildContentSecurityPolicy — structure", () => {
  const policy = buildContentSecurityPolicy(CSP_ORIGINS);
  const d = directivesOf(policy);

  it("locks the framing, base and object surfaces outright", () => {
    expect(d.get("frame-ancestors")).toEqual(["'none'"]);
    expect(d.get("object-src")).toEqual(["'none'"]);
    expect(d.get("base-uri")).toEqual(["'self'"]);
    expect(d.get("form-action")).toEqual(["'self'"]);
  });

  it("defaults to self, and every fetch directive keeps self", () => {
    expect(d.get("default-src")).toEqual(["'self'"]);
    for (const name of ["script-src", "style-src", "img-src", "connect-src", "font-src"]) {
      expect(d.get(name), name).toContain("'self'");
    }
  });

  it("emits no empty directive and no duplicate directive name", () => {
    const names = [...d.keys()];
    expect(new Set(names).size).toBe(names.length);
    for (const [name, sources] of d) expect(sources.length, name).toBeGreaterThan(0);
  });

  it("keeps each origin in the bucket it was declared in", () => {
    // A tile host in connect-src, or the geocoder in img-src, would be a
    // policy that permits more than the app actually does.
    expect(d.get("img-src")).toContain("https://*.tile.openstreetmap.org");
    expect(d.get("connect-src")).not.toContain("https://*.tile.openstreetmap.org");
    expect(d.get("connect-src")).toContain("https://nominatim.openstreetmap.org");
    expect(d.get("img-src")).not.toContain("https://nominatim.openstreetmap.org");
  });

  it("is a pure function of its input — an empty inventory still yields a valid policy", () => {
    const bare = buildContentSecurityPolicy({
      script: [],
      style: [],
      img: [],
      connect: [],
      font: [],
      frame: [],
    });
    expect(directivesOf(bare).get("frame-ancestors")).toEqual(["'none'"]);
    expect(bare).not.toContain("https://");
  });
});

describe("the CSP origin inventory — every entry has a named consumer in the repo", () => {
  const d = directivesOf(buildContentSecurityPolicy(CSP_ORIGINS));

  it("img-src covers the OpenStreetMap tiles both Leaflet maps request", () => {
    // components/order/DeliveryRouteMap.tsx + components/admin/catering/
    // fulfillment/ZoneMap.tsx both use "https://{s}.tile.openstreetmap.org/...".
    expect(d.get("img-src")).toContain("https://*.tile.openstreetmap.org");
  });

  it("img-src covers the two storefront photo hosts", () => {
    // components/portal/storefront-images.ts + app/order/page.tsx.
    expect(d.get("img-src")).toContain("https://s3.amazonaws.com");
    expect(d.get("img-src")).toContain("https://static.spotapps.co");
  });

  it("img-src allows data: and blob: — Leaflet and bundled assets need both", () => {
    expect(d.get("img-src")).toContain("data:");
    expect(d.get("img-src")).toContain("blob:");
  });

  it("connect-src covers the client-side Nominatim geocode", () => {
    // app/order/start/start-client.tsx fetches it from the BROWSER.
    expect(d.get("connect-src")).toContain("https://nominatim.openstreetmap.org");
  });

  it("font-src is self-only — next/font self-hosts DM Sans at build time", () => {
    // app/layout.tsx uses next/font/google, which downloads the faces at build
    // and serves them from /_next/static. There is NO fonts.gstatic.com request
    // at runtime, so granting one would be permission the app never uses.
    expect(d.get("font-src")).not.toContain("https://fonts.gstatic.com");
    expect(d.get("font-src")).toContain("'self'");
  });

  it("does NOT grant the server-only APIs — they are never fetched from a browser", () => {
    // Toast, ezCater and Anthropic are called from route handlers and crons.
    // A CSP governs the PAGE, so listing them would be noise that implies the
    // browser talks to them.
    const policy = buildContentSecurityPolicy(CSP_ORIGINS);
    expect(policy).not.toContain("toasttab.com");
    expect(policy).not.toContain("ezcater.com");
    expect(policy).not.toContain("anthropic.com");
  });
});

describe("next.config.ts ships the header set", () => {
  it("sets an async headers() over every path", () => {
    expect(config).toMatch(/async headers\(\)/);
    expect(config).toMatch(/source:\s*"\/\(\.\*\)"/);
  });

  it("stops advertising the stack", () => {
    expect(config).toMatch(/poweredByHeader:\s*false/);
  });

  it("keeps the dev LAN allowlist that was already there", () => {
    // Pre-existing behaviour: phones on the LAN need this in dev.
    expect(config).toMatch(/allowedDevOrigins/);
  });

  const expected: Array<[string, RegExp]> = [
    ["Strict-Transport-Security", /max-age=63072000; includeSubDomains; preload/],
    ["X-Content-Type-Options", /nosniff/],
    ["X-Frame-Options", /DENY/],
    ["Referrer-Policy", /strict-origin-when-cross-origin/],
    ["Permissions-Policy", /camera=\(\), microphone=\(\), geolocation=\(\)/],
  ];

  for (const [key, value] of expected) {
    it(`emits ${key}`, () => {
      const header = SECURITY_HEADERS.find((h) => h.key === key);
      expect(header, `${key} missing from SECURITY_HEADERS`).toBeDefined();
      expect(header!.value).toMatch(value);
    });
  }

  it("grants no camera, no microphone and no geolocation — the app uses none", () => {
    // Verified by grep: no getUserMedia, no navigator.geolocation anywhere.
    // The delivery map takes a dragged PIN, never the device's location.
    const pp = SECURITY_HEADERS.find((h) => h.key === "Permissions-Policy")!;
    expect(pp.value).toBe("camera=(), microphone=(), geolocation=()");
  });

  it("ships the CSP as REPORT-ONLY and never as the enforcing header", () => {
    const keys = SECURITY_HEADERS.map((h) => h.key);
    expect(keys).toContain("Content-Security-Policy-Report-Only");
    expect(keys).not.toContain("Content-Security-Policy");
    // And the config file itself must not name the enforcing header either.
    expect(config).not.toMatch(/"Content-Security-Policy"/);
  });

  it("the report-only header carries the built policy", () => {
    const csp = SECURITY_HEADERS.find((h) => h.key === "Content-Security-Policy-Report-Only")!;
    expect(csp.value).toBe(buildContentSecurityPolicy(CSP_ORIGINS));
  });

  it("every SECURITY_HEADERS entry is a non-empty key/value pair", () => {
    for (const h of SECURITY_HEADERS) {
      expect(h.key.length, JSON.stringify(h)).toBeGreaterThan(0);
      expect(h.value.length, h.key).toBeGreaterThan(0);
    }
  });
});
