/**
 * Unit spine — lib/stripe/client.ts credential resolution. No network, no DB: this is the
 * pure decision at the front door of the whole Stripe leg, and it decides two things that
 * both matter more than they look.
 *
 *   DORMANCY. With nothing set, `stripeConfigured()` is false and the pay route's stub
 *   branch is taken — the historical behaviour, unchanged. That is the promise the whole
 *   feature is built on, so it is a test, not a comment.
 *
 *   WHICH ACCOUNT. A business whose shops are separate Stripe accounts sets
 *   STRIPE_SECRET_KEY__<CODE> / STRIPE_WEBHOOK_SECRET__<CODE>. The pair is ALL-OR-NOTHING:
 *   a half-configured shop must read as NOT configured rather than borrow the shared
 *   account's other half, because that mis-wiring is silent — the charge lands in one
 *   account and the webhook that marks it paid is signed by another.
 *
 * Every value here is a fake (`sk_test_fake`, `whsec_test`). No real key is ever committed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { stripeConfigured, stripeCredentialsFor, stripeReadiness } from "@/lib/stripe/client";

afterEach(() => vi.unstubAllEnvs());

/** Clear every variable this module reads so each case starts from the dormant state. */
function clearAll() {
  for (const k of [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_SECRET_KEY__EM",
    "STRIPE_WEBHOOK_SECRET__EM",
    "STRIPE_SECRET_KEY__MEP",
    "STRIPE_WEBHOOK_SECRET__MEP",
  ]) {
    vi.stubEnv(k, "");
  }
}

describe("dormant by default", () => {
  it("resolves to null with nothing set — which is what makes the pay button a stub", () => {
    clearAll();
    expect(stripeCredentialsFor(null)).toBeNull();
    expect(stripeCredentialsFor("EM")).toBeNull();
    expect(stripeConfigured()).toBe(false);
    expect(stripeConfigured("EM")).toBe(false);
  });

  it("a HALF-configured shared account is still dormant — both halves or nothing", () => {
    clearAll();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
    expect(stripeConfigured()).toBe(false);
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
    expect(stripeConfigured()).toBe(false);
  });

  it("treats whitespace as unset (a variable pasted empty is not configuration)", () => {
    clearAll();
    vi.stubEnv("STRIPE_SECRET_KEY", "   ");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "   ");
    expect(stripeConfigured()).toBe(false);
  });
});

describe("single-account mode (the default deployment)", () => {
  it("serves every shop from the shared pair", () => {
    clearAll();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_shared");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_shared");
    for (const code of [null, "EM", "MEP"]) {
      expect(stripeCredentialsFor(code)).toEqual({
        secretKey: "sk_test_shared",
        webhookSecret: "whsec_shared",
        source: "default",
      });
    }
  });

  it("falls back for a code that could not name an env var at all", () => {
    clearAll();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_shared");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_shared");
    expect(stripeCredentialsFor("cap-hill")?.source).toBe("default");
  });
});

describe("per-location override", () => {
  it("the shop's OWN pair beats the shared pair, and only for that shop", () => {
    clearAll();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_shared");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_shared");
    vi.stubEnv("STRIPE_SECRET_KEY__EM", "sk_test_em");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET__EM", "whsec_em");

    expect(stripeCredentialsFor("EM")).toEqual({
      secretKey: "sk_test_em",
      webhookSecret: "whsec_em",
      source: "location",
    });
    // Lower-case arrives from the DB as easily as upper-case; the suffix is normalised.
    expect(stripeCredentialsFor("em")?.source).toBe("location");
    // The other shop is untouched by its neighbour's override.
    expect(stripeCredentialsFor("MEP")?.source).toBe("default");
  });

  it("a HALF-configured shop is null — it never silently borrows the shared account's other half", () => {
    clearAll();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_shared");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_shared");
    vi.stubEnv("STRIPE_SECRET_KEY__EM", "sk_test_em"); // webhook half missing

    expect(stripeCredentialsFor("EM")).toBeNull();
    expect(stripeConfigured("EM")).toBe(false);
    // …and the shop that did NOT opt in still works.
    expect(stripeConfigured("MEP")).toBe(true);
  });
});

describe("stripeReadiness — presence only, never key material", () => {
  it("reports the shared pair and, per shop, configured + whose account", () => {
    clearAll();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_shared");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_shared");
    vi.stubEnv("STRIPE_SECRET_KEY__EM", "sk_test_em");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET__EM", "whsec_em");

    const r = stripeReadiness([
      { id: "loc-a", code: "EM" },
      { id: "loc-b", code: "MEP" },
    ]);
    expect(r.defaultConfigured).toBe(true);
    expect(r.locations).toEqual([
      { locationId: "loc-a", locationCode: "EM", configured: true, ownAccount: true },
      { locationId: "loc-b", locationCode: "MEP", configured: true, ownAccount: false },
    ]);
    // Nothing in the returned shape can narrow a secret.
    expect(JSON.stringify(r)).not.toContain("sk_test");
    expect(JSON.stringify(r)).not.toContain("whsec");
  });
});
