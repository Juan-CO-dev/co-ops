/**
 * Unit spine — safeNextPath (P2-5, open redirect on the login page).
 *
 * app/page.tsx's post-login hop read `?next=` and accepted ANY value starting
 * with a single "/" — which `//evil.com` and `/\evil.com` both satisfy while
 * being PROTOCOL-RELATIVE URLs every browser resolves to a third-party origin.
 * A staff member phished onto `/?next=//evil.com` therefore signed in against
 * the real app and was then handed to the attacker's page, with the login
 * ceremony's trust already spent.
 *
 * The sanitizer is a pure predicate over a string, so it is unit-testable —
 * and it MUST be, because the only other place this behaviour is visible is a
 * browser address bar after a successful login.
 *
 * WHY DECODE-ONCE MATTERS EVEN THOUGH useSearchParams() ALREADY DECODES:
 * `searchParams.get("next")` percent-decodes once, so `%2F%2Fevil.com` in the
 * URL arrives here as `//evil.com` and the primary check catches it. A
 * DOUBLE-encoded `%252F%252Fevil.com` arrives as the literal `%2F%2Fevil.com`,
 * which no primary check rejects — it starts with a single "/" and contains no
 * backslash. Any consumer that decodes once more (a router, a proxy hop, a log
 * replay) resolves it to `//evil.com`. The second pass closes that.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";
import { safeNextPath, DEFAULT_NEXT_PATH } from "@/lib/nav-redirect";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("safeNextPath — accepts genuine same-origin relative paths", () => {
  it("passes an ordinary app path through unchanged", () => {
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
  });

  it("preserves the query string the proxy attaches (pathname + search)", () => {
    // proxy.ts builds `next` as `req.nextUrl.pathname + req.nextUrl.search`.
    expect(safeNextPath("/admin/skus?x=1")).toBe("/admin/skus?x=1");
    expect(safeNextPath("/mid-shift?location=abc&tab=sales")).toBe(
      "/mid-shift?location=abc&tab=sales",
    );
  });

  it("keeps a fragment, and an encoded space inside the QUERY", () => {
    // The origin cannot be changed from the query/fragment, so the decode-once
    // re-check deliberately covers the PATH portion only.
    expect(safeNextPath("/reports#top")).toBe("/reports#top");
    expect(safeNextPath("/admin/skus?q=sliced%20ham")).toBe("/admin/skus?q=sliced%20ham");
  });

  it("accepts the bare root", () => {
    expect(safeNextPath("/")).toBe("/");
  });
});

describe("safeNextPath — refuses everything that can leave the origin", () => {
  const rejected: Array<[string, string | null]> = [
    ["null (no ?next= at all)", null],
    ["empty string", ""],
    ["protocol-relative //", "//evil.com"],
    ["protocol-relative // with a path", "//evil.com/login"],
    ["backslash protocol-relative", "/\\evil.com"],
    ["backslash anywhere in the path", "/dashboard\\@evil.com"],
    ["leading double backslash", "\\\\evil.com"],
    ["absolute https URL", "https://evil.com"],
    ["absolute http URL", "http://evil.com"],
    ["javascript: scheme", "javascript:alert(document.cookie)"],
    ["data: scheme", "data:text/html,payload"],
    ["relative with no leading slash", "dashboard"],
    ["double-encoded protocol-relative", "/%2F%2Fevil.com"],
    ["double-encoded backslash", "/%5Cevil.com"],
    ["encoded newline in the path", "/%0A//evil.com"],
    ["encoded tab in the path", "/%09/evil.com"],
    ["raw newline", "/dash\nboard"],
    ["raw tab", "/dash\tboard"],
    ["raw space in the path", "/dash board"],
    ["NUL control char", "/dash\u0000board"],
    ["DEL control char", "/dash\u007Fboard"],
    ["malformed percent escape", "/%E0%A4%A"],
  ];

  for (const [label, value] of rejected) {
    it(`falls back to ${DEFAULT_NEXT_PATH} for ${label}`, () => {
      expect(safeNextPath(value)).toBe(DEFAULT_NEXT_PATH);
    });
  }

  it("the fallback IS the dashboard — the destination login has always meant", () => {
    expect(DEFAULT_NEXT_PATH).toBe("/dashboard");
  });
});

/**
 * THE WIRING, PINNED AT THE SOURCE. `safeNextPath` being correct is worth
 * nothing if the login page still does its own `startsWith("/")` check — which
 * is exactly the shape of the bug. app/page.tsx is a client component whose
 * behaviour here is a `router.push` inside a callback, so there is no export
 * this spine can call; the house fallback for that is a source assertion
 * (tests/auth-step-up-hardening.test.ts, tests/catering-authz.test.ts).
 */
describe("app/page.tsx delegates the post-login hop to the sanitizer", () => {
  const src = readFileSync(join(repoRoot, "app", "page.tsx"), "utf8");

  it("imports safeNextPath from the pure module", () => {
    expect(src).toMatch(/import\s*\{\s*safeNextPath\s*\}\s*from\s*"@\/lib\/nav-redirect"/);
  });

  it("routes the post-login push through safeNextPath", () => {
    expect(src).toMatch(/router\.push\(\s*safeNextPath\(/);
  });

  it("no longer carries its own startsWith(\"/\") next check — the bug's exact shape", () => {
    expect(src).not.toMatch(/next\s*&&\s*next\.startsWith\("\/"\)/);
  });
});
