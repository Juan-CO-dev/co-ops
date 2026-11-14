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
 *
 * Stripe's contract (docs.stripe.com/api/checkout/sessions/expire): "A Checkout Session can
 * be expired when it is in one of these statuses: open" and "Returns an error if the
 * Checkout Session has already expired or isn't in an expireable state" — the error does
 * not say WHICH, which is why a refusal is followed by a read of the session's `status`
 * (`open`, `complete` or `expired`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { retireCheckoutSession, StripeError } from "@/lib/stripe/client";

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

  it("a session this account does not know cannot be paid through it: `expired`", async () => {
    fetchMock.mockResolvedValueOnce(reply(404, { error: { code: "resource_missing", message: "No such checkout.session" } }));
    expect(await retireCheckoutSession("sk_test_fake", "cs_test_gone")).toBe("expired");
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    const err = await retireCheckoutSession("sk_test_fake", "cs_test_1").catch((e) => e as StripeError);
    expect(String(err.message)).not.toContain("sk_test_fake");
  });
});
