/**
 * Unit spine — the staff PIN login's SOURCE-side guards (P2-6).
 *
 * THE HOLE. /api/auth/pin carried exactly one brake: the per-ACCOUNT 5-per-15-min
 * lockout. That brake is per-target, and the target is free — `/api/users/
 * login-options` is unauthenticated and hands out real user ids (a documented,
 * accepted enumeration tradeoff for the tile-login UX). So an attacker never
 * needs to trip a lockout: they rotate. Twenty accounts x 4 guesses per 15-min
 * window x 96 windows is ~7,680 guesses a day against a 10,000-PIN space, from
 * one machine, with every single account's lockout counter left un-tripped.
 * Nothing anywhere counted the SOURCE.
 *
 * THE SECOND HOLE. The route had no origin check either, so any page on the
 * internet could POST a PIN guess with the browser's cookies attached — the
 * staff-side twin of the portal's A-H5 login-CSRF gap.
 *
 * WHY THESE ASSERTIONS ARE HALF PURE AND HALF SOURCE-LEVEL. The budget
 * arithmetic and the bucket-key decision are pure and are exercised directly.
 * "The guards run BEFORE the credential check" is a fact about statement ORDER
 * inside an I/O route handler, which no unit test over the module's exports can
 * see — so it is pinned at the source, the house fallback
 * (tests/auth-step-up-hardening.test.ts, tests/catering-authz.test.ts).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";
import {
  PIN_SOURCE_MAX_ATTEMPTS,
  PIN_SOURCE_WINDOW_SECONDS,
  fixedWindowRetryAfterSeconds,
  pinSourceBucketKey,
} from "@/lib/auth-throttle";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(repoRoot, "app", "api", "auth", "pin", "route.ts"), "utf8");

describe("the per-source budget", () => {
  it("is a 15-minute window, matching the per-account lockout's window", () => {
    expect(PIN_SOURCE_WINDOW_SECONDS).toBe(15 * 60);
  });

  it("leaves generous headroom over a whole shop behind one NAT", () => {
    // A shop shares ONE egress IP, so this cap is a per-LOCATION cap in
    // practice — the exact objection recorded against a sign-in source cap in
    // password-reset-request. It must sit well above a shift change's real
    // login volume and still well below a useful guessing rate.
    expect(PIN_SOURCE_MAX_ATTEMPTS).toBeGreaterThanOrEqual(30);
    expect(PIN_SOURCE_MAX_ATTEMPTS).toBeLessThanOrEqual(40);
  });
});

describe("pinSourceBucketKey", () => {
  it("namespaces the key by source IP", () => {
    expect(pinSourceBucketKey("203.0.113.9")).toBe("pin_src:203.0.113.9");
  });

  it("returns null with no trusted IP — the throttle is SKIPPED, never pooled", () => {
    // A shared `pin_src:noip` bucket would turn one missing platform header
    // into a global sign-in outage for every shop at once. The limiter is
    // fail-open by design (lib/portal/rate-limit.ts); this matches it.
    expect(pinSourceBucketKey(null)).toBeNull();
    expect(pinSourceBucketKey("")).toBeNull();
  });
});

describe("fixedWindowRetryAfterSeconds — an honest retry_after", () => {
  const W = 900;
  // The limiter's window start is floor(now / windowMs) * windowMs, so the
  // retry-after is the distance to the NEXT such boundary, not a flat guess.
  it("is the full window at the instant a window opens", () => {
    expect(fixedWindowRetryAfterSeconds(1_800_000, W)).toBe(W);
  });

  it("counts down to the boundary", () => {
    expect(fixedWindowRetryAfterSeconds(1_800_000 + 1_000, W)).toBe(W - 1);
    expect(fixedWindowRetryAfterSeconds(1_800_000 + 899_000, W)).toBe(1);
  });

  it("never returns zero or a negative — a client must always be told to wait", () => {
    expect(fixedWindowRetryAfterSeconds(1_800_000 + 899_999, W)).toBeGreaterThanOrEqual(1);
    for (let ms = 0; ms < 5_000; ms += 137) {
      expect(fixedWindowRetryAfterSeconds(ms, W)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("/api/auth/pin wires both guards, ahead of every credential decision", () => {
  it("imports the existing limiter and the existing CSRF guard", () => {
    expect(src).toMatch(/import\s*\{\s*assertSameOrigin\s*\}\s*from\s*"@\/lib\/portal\/csrf"/);
    expect(src).toMatch(/checkAndRecord/);
    expect(src).toMatch(/from\s*"@\/lib\/portal\/rate-limit"/);
  });

  it("checks the origin BEFORE spending a rate-limit slot", () => {
    // A cross-site POST must not be able to burn the shop's budget.
    expect(src.indexOf("assertSameOrigin(")).toBeGreaterThan(-1);
    expect(src.indexOf("assertSameOrigin(")).toBeLessThan(src.indexOf("checkAndRecord("));
  });

  it("runs BOTH guards before the users lookup — so neither can leak account existence", () => {
    const lookup = src.indexOf('.from("users")');
    const origin = src.indexOf("assertSameOrigin(");
    const limiter = src.indexOf("checkAndRecord(");
    // Assert PRESENCE first: indexOf returns -1 when absent, and -1 is less
    // than every real offset, so an ordering assertion alone passes vacuously
    // against a route that wires no guard at all.
    expect([lookup, origin, limiter].every((i) => i > -1)).toBe(true);
    expect(origin).toBeLessThan(lookup);
    expect(limiter).toBeLessThan(lookup);
  });

  it("runs BOTH guards before the PIN is ever verified", () => {
    const verify = src.lastIndexOf("verifyPin(");
    const origin = src.indexOf("assertSameOrigin(");
    const limiter = src.indexOf("checkAndRecord(");
    expect([verify, origin, limiter].every((i) => i > -1)).toBe(true);
    expect(origin).toBeLessThan(verify);
    expect(limiter).toBeLessThan(verify);
  });

  it("answers a throttled source with 429 rate_limited AND a retry_after", () => {
    // 429 rate_limited is the code lib/api-helpers.ts already reserves.
    expect(src).toMatch(/jsonError\(\s*429,\s*"rate_limited"/);
    expect(src).toMatch(/retry_after_seconds/);
  });
});

/**
 * THE OTHER TWO PUBLIC AUTH POSTS, ADJUDICATED RATHER THAN SWEPT.
 *
 * /api/auth/pin-confirm TAKES THE GUARD. It is a cookie-authenticated POST —
 * the textbook CSRF shape — and it has no live caller today (PinConfirmModal
 * says so in its own header: the modal attests in-place and never calls it).
 * A dormant route is the cheapest possible moment to close it, because there
 * is no traffic to regress.
 *
 * /api/auth/logout DELIBERATELY DOES NOT, and this test PINS that so the
 * absence reads as a decision instead of an oversight. Forced logout is a
 * nuisance-grade CSRF; a logout that can 403 is a worse outcome, because the
 * route's locked policy is that the user's intent to kill their own cookie is
 * honoured UNCONDITIONALLY — including when the session is already invalid.
 * The failure mode of guarding it is an operator stuck signed in on a shared
 * 6 AM tablet, which is a security problem of its own. Revisit only with a
 * ruling, not by pattern-matching the sibling routes.
 */
describe("the origin guard is applied by adjudication, not by sweep", () => {
  const read = (...seg: string[]) => readFileSync(join(repoRoot, ...seg), "utf8");
  const pinConfirm = read("app", "api", "auth", "pin-confirm", "route.ts");
  const logout = read("app", "api", "auth", "logout", "route.ts");

  it("pin-confirm asserts same-origin before verifying the actor's PIN", () => {
    const guard = pinConfirm.indexOf("assertSameOrigin(");
    const verify = pinConfirm.indexOf("verifyActorPin(");
    expect([guard, verify].every((i) => i > -1)).toBe(true);
    expect(guard).toBeLessThan(verify);
  });

  it("logout stays unguarded, and says why in its own header", () => {
    // Match the CALL and the IMPORT, not the mere word: the route's header
    // names the guard while explaining why it is absent, and an assertion
    // that forbade the name would forbid the explanation.
    expect(logout).not.toMatch(/assertSameOrigin\(/);
    expect(logout).not.toMatch(/from\s*"@\/lib\/portal\/csrf"/);
    // The reasoning must live next to the code, not only in this test.
    expect(logout).toMatch(/NO CSRF ORIGIN GUARD, DELIBERATELY/);
  });
});
