/**
 * The Stripe REFUND calls in lib/stripe/client.ts, at the `fetch` boundary (never a network call: `fetch` is a stub and
 * every key is a fake string). Pins what Stripe documents and the client relies on:
 *   · POST /v1/refunds with payment_intent, amount, reason, metadata[...] and an Idempotency-Key header
 *     (docs.stripe.com/api/refunds/create, docs.stripe.com/api/idempotent_requests);
 *   · no response = StripeError status 0 (the caller keeps the row pending); a non-2xx carries its HTTP status;
 *   · GET /v1/refunds?payment_intent=…&limit=100 paged by starting_after; too many pages REFUSES, never "not found";
 *   · GET /v1/payment_intents/:id?expand[]=latest_charge; a 404 is `not_found` (another account may own it).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createRefund,
  listRefundsForPaymentIntent,
  retrievePaymentIntentCharge,
  retrieveRefund,
  StripeError,
} from "@/lib/stripe/client";

type Call = { url: string; method: string; headers: Record<string, string>; body: string | null };
let calls: Call[] = [];
let answer: (c: Call) => { status: number; body: unknown } | "throw";

beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const c: Call = { url: String(url), method: init.method, headers: init.headers, body: init.body ?? null };
    calls.push(c);
    const a = answer(c);
    if (a === "throw") throw new TypeError("fetch failed");
    return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.body };
  }));
});
afterEach(() => vi.unstubAllGlobals());

const INPUT = { paymentIntentId: "pi_123", amountCents: 2500, reason: "requested_by_customer" as const, metadata: { refund_request_id: "req-1", quote_id: "q-1", payment_id: "p-1" } };

describe("createRefund", () => {
  it("posts the documented form with the idempotency key and the pinned version", async () => {
    answer = () => ({ status: 200, body: { id: "re_1", status: "succeeded", amount: 2500, metadata: { refund_request_id: "req-1" } } });
    const r = await createRefund("sk_test_x", INPUT, "catering-refund:req-1");
    expect(r).toEqual({ id: "re_1", status: "succeeded", amountCents: 2500, requestId: "req-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.stripe.com/v1/refunds");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers["Idempotency-Key"]).toBe("catering-refund:req-1");
    expect(calls[0]!.headers["Stripe-Version"]).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(calls[0]!.body).toBe("payment_intent=pi_123&amount=2500&reason=requested_by_customer&metadata%5Brefund_request_id%5D=req-1&metadata%5Bquote_id%5D=q-1&metadata%5Bpayment_id%5D=p-1");
  });
  it("no reason is omitted, not sent empty", async () => {
    answer = () => ({ status: 200, body: { id: "re_2", status: "pending", amount: 1 } });
    await createRefund("sk_test_x", { ...INPUT, reason: null }, "k");
    expect(calls[0]!.body).not.toContain("reason=");
  });
  it("no response is status 0 (unknown outcome); a refusal carries Stripe's status and code", async () => {
    answer = () => "throw";
    await expect(createRefund("sk_test_x", INPUT, "k")).rejects.toMatchObject({ status: 0, code: "network_error" });
    answer = () => ({ status: 400, body: { error: { code: "charge_already_refunded", message: "Charge has already been refunded." } } });
    await expect(createRefund("sk_test_x", INPUT, "k")).rejects.toMatchObject({ status: 400, code: "charge_already_refunded" });
    answer = () => ({ status: 500, body: { error: { type: "api_error" } } });
    await expect(createRefund("sk_test_x", INPUT, "k")).rejects.toMatchObject({ status: 500, code: "api_error" });
  });
  it("refuses a bad id or amount before any request", async () => {
    answer = () => ({ status: 200, body: {} });
    await expect(createRefund("sk_test_x", { ...INPUT, paymentIntentId: "ch_1" }, "k")).rejects.toBeInstanceOf(StripeError);
    await expect(createRefund("sk_test_x", { ...INPUT, amountCents: 0 }, "k")).rejects.toBeInstanceOf(StripeError);
    await expect(createRefund("", INPUT, "k")).rejects.toMatchObject({ code: "not_configured" });
    expect(calls).toHaveLength(0);
  });
  it("a 2xx with no refund id is refused", async () => {
    answer = () => ({ status: 200, body: { object: "refund" } });
    await expect(createRefund("sk_test_x", INPUT, "k")).rejects.toMatchObject({ code: "bad_payload" });
  });
});

describe("listRefundsForPaymentIntent", () => {
  it("pages by starting_after and reads our request id from metadata", async () => {
    answer = (c) => c.url.includes("starting_after=re_b")
      ? { status: 200, body: { data: [{ id: "re_c", status: "succeeded", amount: 3, metadata: { refund_request_id: "req-9" } }], has_more: false } }
      : { status: 200, body: { data: [{ id: "re_a", status: "succeeded", amount: 1, metadata: {} }, { id: "re_b", status: "pending", amount: 2, metadata: {} }], has_more: true } };
    const out = await listRefundsForPaymentIntent("sk_test_x", "pi_123");
    expect(out.map((r) => [r.id, r.requestId])).toEqual([["re_a", null], ["re_b", null], ["re_c", "req-9"]]);
    expect(calls[0]!.url).toBe("https://api.stripe.com/v1/refunds?payment_intent=pi_123&limit=100");
    expect(calls.every((c) => c.method === "GET" && !("Idempotency-Key" in c.headers))).toBe(true);
  });
  it("more pages than it reads is a refusal, never a partial answer", async () => {
    answer = (c) => ({ status: 200, body: { data: [{ id: `re_${calls.length}`, status: "succeeded", amount: 1 }], has_more: true } });
    await expect(listRefundsForPaymentIntent("sk_test_x", "pi_123", 2)).rejects.toMatchObject({ code: "refund_list_incomplete" });
    void answer;
  });
});

describe("retrievePaymentIntentCharge / retrieveRefund", () => {
  it("expands the latest charge; a 404 is not_found (another account may own it)", async () => {
    answer = () => ({ status: 200, body: { id: "pi_123", latest_charge: { id: "ch_1", amount_captured: 30000, amount_refunded: 500 } } });
    expect(await retrievePaymentIntentCharge("sk_test_x", "pi_123")).toEqual({ status: "found", amountCapturedCents: 30000, amountRefundedCents: 500 });
    expect(calls[0]!.url).toBe("https://api.stripe.com/v1/payment_intents/pi_123?expand%5B%5D=latest_charge");
    answer = () => ({ status: 404, body: { error: { code: "resource_missing" } } });
    expect((await retrievePaymentIntentCharge("sk_test_x", "pi_123")).status).toBe("not_found");
    answer = () => ({ status: 503, body: {} });
    await expect(retrievePaymentIntentCharge("sk_test_x", "pi_123")).rejects.toMatchObject({ status: 503 });
  });
  it("reads one refund by id", async () => {
    answer = () => ({ status: 200, body: { id: "re_1", status: "succeeded", amount: 7 } });
    expect(await retrieveRefund("sk_test_x", "re_1")).toMatchObject({ id: "re_1", status: "succeeded" });
    await expect(retrieveRefund("sk_test_x", "../etc")).rejects.toMatchObject({ code: "bad_refund_id" });
  });
});
