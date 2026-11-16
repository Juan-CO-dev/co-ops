/**
 * Unit spine — `retireCheckoutSession` (lib/stripe/client.ts), audit wave W02/B035.
 *
 * "Make this Checkout Session unpayable, or tell me it is too late." The whole of B035's
 * prevention rests on that answer being honest, so the three shapes Stripe can give are
 * pinned against a stubbed `fetch` (no network, no key — every value here is a fake):
 *
 *   expire succeeds                      → "expired"  (nobody can pay it now)
 *   expire refused, session is expired   → "expired"  (it lapsed on its own)
 *   expire refused, session is complete  → "complete" (the money is already in flight)
 *   404: this key cannot see the session → THROWS `session_not_found` (review r4): the
 *                                           session may be open in another account, so a
 *                                           404 is never a retirement
 *
 * Stripe's contract (docs.stripe.com/api/checkout/sessions/expire): "A Checkout Session can
 * be expired when it is in one of these statuses: open" and "Returns an error if the
 * Checkout Session has already expired or isn't in an expireable state" — the error does
 * not say WHICH, which is why a refusal is followed by a read of the session's `status`
 * (`open`, `complete` or `expired`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCheckoutSession, isSessionNotFound, retireCheckoutSession, retrieveCheckoutSession, StripeError } from "@/lib/stripe/client";

const fetchMock = vi.fn();

const reply = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const MISSING = { error: { type: "invalid_request_error", code: "resource_missing", message: "No such checkout.session: cs_test_elsewhere" } };
const NOT_EXPIRABLE = { error: { type: "invalid_request_error", message: "Only Checkout Sessions with a status in [\"open\"] can be expired." } };

describe("W02/B035 — retireCheckoutSession", () => {
  it("POSTs the expire endpoint with the shop's key and reports `expired`", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { id: "cs_test_1", status: "expired" }));

    expect(await retireCheckoutSession("sk_test_fake", "cs_test_1")).toBe("expired");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions/cs_test_1/expire");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer sk_test_fake");
  });

  it("a refused expire on a session that already EXPIRED is still `expired`", async () => {
    fetchMock.mockResolvedValueOnce(reply(400, NOT_EXPIRABLE));
    fetchMock.mockResolvedValueOnce(reply(200, { id: "cs_test_1", status: "expired" }));

    expect(await retireCheckoutSession("sk_test_fake", "cs_test_1")).toBe("expired");

    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions/cs_test_1");
    expect(init.method).toBe("GET");
  });

  it("a refused expire on a COMPLETE session reports `complete` — the money is in flight", async () => {
    fetchMock.mockResolvedValueOnce(reply(400, NOT_EXPIRABLE));
    fetchMock.mockResolvedValueOnce(reply(200, { id: "cs_test_1", status: "complete", payment_status: "paid" }));

    expect(await retireCheckoutSession("sk_test_fake", "cs_test_1")).toBe("complete");
  });

  it("a 404 is NOT a retirement: this key cannot see the session, which says nothing about whether it can still be paid — THROWS `session_not_found`", async () => {
    // Review r4 (P2). This test used to pin "a session this account does not know cannot be
    // paid through it: `expired`". It can still be paid through the account that minted it.
    fetchMock.mockResolvedValueOnce(reply(404, MISSING));

    const err: unknown = await retireCheckoutSession("sk_test_fake", "cs_test_elsewhere").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(StripeError);
    expect(err).toMatchObject({ status: 404, code: "session_not_found" });
    expect(isSessionNotFound(err)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("…and so is a 404 on the status read that follows a refused expire", async () => {
    fetchMock.mockResolvedValueOnce(reply(400, NOT_EXPIRABLE));
    fetchMock.mockResolvedValueOnce(reply(404, MISSING));
    await expect(retireCheckoutSession("sk_test_fake", "cs_test_elsewhere")).rejects.toMatchObject({ code: "session_not_found" });
  });

  it("`isSessionNotFound` is true for that error and nothing else", () => {
    expect(isSessionNotFound(new StripeError(404, "session_not_found"))).toBe(true);
    expect(isSessionNotFound(new StripeError(404, "resource_missing"))).toBe(false);
    expect(isSessionNotFound(new StripeError(502, "network_error"))).toBe(false);
    expect(isSessionNotFound(new Error("session_not_found"))).toBe(false);
    expect(isSessionNotFound(null)).toBe(false);
  });

  it("FAILS CLOSED when it cannot tell: a still-open session after a refused expire throws", async () => {
    fetchMock.mockResolvedValueOnce(reply(400, NOT_EXPIRABLE));
    fetchMock.mockResolvedValueOnce(reply(200, { id: "cs_test_1", status: "open" }));
    await expect(retireCheckoutSession("sk_test_fake", "cs_test_1")).rejects.toBeInstanceOf(StripeError);
  });

  it("FAILS CLOSED on a transport failure and on a Stripe 5xx — never `expired` by assumption", async () => {
    fetchMock.mockRejectedValueOnce(new Error("socket hang up"));
    await expect(retireCheckoutSession("sk_test_fake", "cs_test_1")).rejects.toMatchObject({ code: "network_error" });

    fetchMock.mockResolvedValueOnce(reply(500, { error: { type: "api_error", message: "boom" } }));
    await expect(retireCheckoutSession("sk_test_fake", "cs_test_1")).rejects.toBeInstanceOf(StripeError);
    // A 5xx is not "not expirable": it must not fall through to the status read.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("an auth failure or a rate limit says nothing about the session — it throws without the status read", async () => {
    for (const status of [401, 403, 429]) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(reply(status, { error: { type: "invalid_request_error", message: "no" } }));
      await expect(retireCheckoutSession("sk_test_fake", "cs_test_1")).rejects.toBeInstanceOf(StripeError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("refuses an id that could not be a Checkout Session id, without calling Stripe", async () => {
    for (const bad of ["", "pi_123", "cs_test_1/../../v1/refunds", "cs_ test"]) {
      await expect(retireCheckoutSession("sk_test_fake", bad)).rejects.toMatchObject({ code: "bad_session_id" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never puts the key in an error", async () => {
    fetchMock.mockResolvedValueOnce(reply(401, { error: { type: "invalid_request_error", message: "Invalid API Key provided" } }));
    const err: unknown = await retireCheckoutSession("sk_test_fake", "cs_test_1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StripeError);
    expect(String((err as StripeError).message)).not.toContain("sk_test_fake");
  });
});

describe("W02/B035 review r1 — retrieveCheckoutSession", () => {
  const OPEN = {
    id: "cs_test_1",
    status: "open",
    url: "https://checkout.stripe.com/c/pay/cs_test_1",
    amount_total: 20000,
    metadata: { quote_id: "q-1", payment_id: "p-1", kind: "deposit" },
  };

  it("GETs the session with the shop's key and reports what a payment decision needs", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { ...OPEN, expires_at: 1795183200 }));

    expect(await retrieveCheckoutSession("sk_test_fake", "cs_test_1")).toEqual({
      status: "open",
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
      amountTotal: 20000,
      quoteId: "q-1",
      paymentId: "p-1",
      // When the session stops being payable (review r2: it must not outlive the offer).
      expiresAt: 1795183200,
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions/cs_test_1");
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe("Bearer sk_test_fake");
  });

  it("a session that is not open has no URL to send anyone to, whatever the payload carries", async () => {
    for (const status of ["complete", "expired"]) {
      fetchMock.mockResolvedValueOnce(reply(200, { ...OPEN, status }));
      expect(await retrieveCheckoutSession("sk_test_fake", "cs_test_1")).toMatchObject({ status, url: null });
    }
  });

  it("a session this account does not know (404) is `not_found` — NOT `gone`: it may be open in another account", async () => {
    // Review r4 (P2): this used to answer `gone`, which the pay path read as "clear it and
    // mint another".
    fetchMock.mockResolvedValueOnce(reply(404, MISSING));
    expect(await retrieveCheckoutSession("sk_test_fake", "cs_test_1")).toEqual({ status: "not_found", url: null, amountTotal: null, quoteId: null, paymentId: null });
  });

  it("a stored value that could not be a session id is `gone`, without calling Stripe — decided from its shape, not from a 404", async () => {
    expect((await retrieveCheckoutSession("sk_test_fake", "cs_test_1/../../v1/refunds")).status).toBe("gone");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("anything it cannot read THROWS — a 5xx, an auth failure, a transport failure, an unknown status", async () => {
    fetchMock.mockResolvedValueOnce(reply(500, { error: { type: "api_error", message: "boom" } }));
    await expect(retrieveCheckoutSession("sk_test_fake", "cs_test_1")).rejects.toBeInstanceOf(StripeError);
    fetchMock.mockResolvedValueOnce(reply(401, { error: { type: "invalid_request_error", message: "Invalid API Key provided" } }));
    await expect(retrieveCheckoutSession("sk_test_fake", "cs_test_1")).rejects.toBeInstanceOf(StripeError);
    fetchMock.mockRejectedValueOnce(new Error("socket hang up"));
    await expect(retrieveCheckoutSession("sk_test_fake", "cs_test_1")).rejects.toMatchObject({ code: "network_error" });
    fetchMock.mockResolvedValueOnce(reply(200, { ...OPEN, status: "something_new" }));
    await expect(retrieveCheckoutSession("sk_test_fake", "cs_test_1")).rejects.toMatchObject({ code: "bad_payload" });
  });

  it("metadata that is missing or not text reads as null — such a session is simply never reused", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { ...OPEN, metadata: { quote_id: 7 }, amount_total: "20000" }));
    expect(await retrieveCheckoutSession("sk_test_fake", "cs_test_1")).toMatchObject({ quoteId: null, paymentId: null, amountTotal: null });
  });
});

describe("W02/B035 review r1 — createCheckoutSession sends the caller's idempotency key verbatim", () => {
  it("the key is the caller's alone: this client neither derives nor rewrites it", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { id: "cs_test_9", url: "https://checkout.stripe.com/c/pay/cs_test_9" }));

    await createCheckoutSession(
      "sk_test_fake",
      {
        quoteId: "q-1",
        paymentId: "p-1",
        kind: "deposit",
        amountCents: 20000,
        currency: "usd",
        productName: "Deposit",
        description: "Deposit",
        customerEmail: "customer@example.com",
        successUrl: "https://portal.example.com/ok",
        cancelUrl: "https://portal.example.com/cancel",
      },
      "p-1:11111111-1111-4111-8111-111111111111",
    );

    expect(fetchMock.mock.calls[0]![1].headers["Idempotency-Key"]).toBe("p-1:11111111-1111-4111-8111-111111111111");
  });
});
