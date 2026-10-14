import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

import {
  PIN_RETRY_FALLBACK_SECONDS,
  pinErrorFromResponse,
} from "@/lib/auth-pin-errors";

// B3 / #55: a per-source 429 on PIN login was shown as "Wrong PIN". This table
// pins what each server answer becomes. It describes the answer only - the
// throttle and lockout rules themselves are untouched (see
// auth-pin-source-throttle.test.ts).
describe("pinErrorFromResponse", () => {
  it("429 rate_limited is throttled, with the server's retry hint", () => {
    expect(pinErrorFromResponse(429, "rate_limited", 412)).toEqual({
      kind: "throttled",
      retryAfterSeconds: 412,
    });
  });

  it("any 429 is throttled, never invalid, even without a code or hint", () => {
    expect(pinErrorFromResponse(429, undefined)).toEqual({
      kind: "throttled",
      retryAfterSeconds: PIN_RETRY_FALLBACK_SECONDS,
    });
  });

  it("falls back to 60 s for an unusable retry hint (zero, negative, NaN)", () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
      expect(pinErrorFromResponse(429, "rate_limited", bad)).toEqual({
        kind: "throttled",
        retryAfterSeconds: 60,
      });
    }
  });

  it("rounds a fractional hint up so the countdown never ends early", () => {
    expect(pinErrorFromResponse(429, "rate_limited", 12.2)).toEqual({
      kind: "throttled",
      retryAfterSeconds: 13,
    });
  });

  it("423 account_locked stays locked (per-account lockout unchanged)", () => {
    expect(pinErrorFromResponse(423, "account_locked", 900)).toEqual({
      kind: "locked",
      retryAfterSeconds: 900,
    });
    expect(pinErrorFromResponse(423, "account_locked")).toEqual({
      kind: "locked",
      retryAfterSeconds: 60,
    });
  });

  it("403 account_inactive stays inactive", () => {
    expect(pinErrorFromResponse(403, "account_inactive")).toEqual({ kind: "inactive" });
  });

  it("403 bad_origin is NOT inactive (code must match)", () => {
    expect(pinErrorFromResponse(403, "bad_origin")).toEqual({ kind: "invalid" });
  });

  it("5xx is a network error, not a wrong PIN", () => {
    for (const s of [500, 502, 503]) {
      expect(pinErrorFromResponse(s, "internal_error")).toEqual({ kind: "network" });
    }
  });

  it("401 invalid_credentials (and other 4xx) are a wrong PIN", () => {
    expect(pinErrorFromResponse(401, "invalid_credentials")).toEqual({ kind: "invalid" });
    expect(pinErrorFromResponse(400, "invalid_payload")).toEqual({ kind: "invalid" });
  });
});

describe("throttled copy exists in en and es", () => {
  const en = JSON.parse(readFileSync("lib/i18n/en.json", "utf8")) as Record<string, string>;
  const es = JSON.parse(readFileSync("lib/i18n/es.json", "utf8")) as Record<string, string>;
  for (const key of ["auth.pin.throttled_title", "auth.pin.throttled_body"]) {
    it(key, () => {
      expect(en[key]).toBeTruthy();
      expect(es[key]).toBeTruthy();
      expect(es[key]).not.toBe(en[key]);
    });
  }
  it("the body carries the {time} placeholder in both languages", () => {
    expect(en["auth.pin.throttled_body"]).toContain("{time}");
    expect(es["auth.pin.throttled_body"]).toContain("{time}");
  });
});

describe("the throttle itself was not touched", () => {
  const throttle = readFileSync("lib/auth-throttle.ts", "utf8");
  it("still allows 30 attempts per 15 minutes per source", () => {
    expect(throttle).toMatch(/PIN_SOURCE_MAX_ATTEMPTS\s*=\s*30/);
    expect(throttle).toMatch(/PIN_SOURCE_WINDOW_SECONDS\s*=\s*15\s*\*\s*60/);
  });
});
