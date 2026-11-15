/**
 * Unit spine — lib/stripe/webhook.ts, the inbound money path.
 *
 * NO DB, NO NETWORK, NO MAIL: the service client is a recording stub (the
 * tests/opening-phase2-save-conflict.test.ts idiom), `audit` is mocked, and the paid
 * notification is injected through the `deps` seam. That is exactly the boundary the
 * vitest spine is allowed to reach, and it is enough to pin every decision that matters:
 *
 *   LEDGER-FIRST. A duplicate event id must produce ZERO further work. Stripe explicitly
 *   warns a delivery can repeat even after a 200, so "we already saw this" has to be the
 *   first branch, keyed on the event id's primary key, not a judgement made later.
 *   GUARDED FLIP. A second `completed` must not re-pay a row. The `.eq("status","due")`
 *   guard turns the replay into a reported no-op instead of a silent second write.
 *   CROSS-SHOP REFUSAL. In per-location mode an event signed by one shop's account may
 *   never advance another shop's money, however well-formed its metadata is.
 *   NOTHING MOVES ON A FAILURE. `expired` / `async_failed` leave the row's status, amount
 *   and money columns alone; the ONLY write is the guarded clear of the dead session's id.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/audit";
import { processStripeEvent, resolveWebhookLocation, type StripeWebhookContext } from "@/lib/stripe/webhook";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
const auditMock = vi.mocked(audit);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const QUOTE_ID = "11111111-2222-4333-8444-555555555555";
const PAYMENT_ID = "66666666-7777-4888-8999-000000000000";
const LOCATION_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_LOCATION_ID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

const DUE_ROW = { id: PAYMENT_ID, quote_id: QUOTE_ID, kind: "deposit", amount_cents: 2500, status: "due" };
const PAID_ROW = { ...DUE_ROW, status: "paid" };

/** One recorded query against the stub. */
interface Op {
  table: string;
  kind: "select" | "insert" | "update";
  filters: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

type Settled = { data?: unknown; error?: unknown; count?: number };

/**
 * Minimal Supabase double. `from(table)` returns a self-returning chainable thenable; the
 * test supplies one `handler` that sees the fully-built op and decides the settled result.
 * Every op is recorded so a test can assert what did NOT happen, which is most of the point.
 */
function stubClient(handler: (op: Op) => Settled) {
  const ops: Op[] = [];
  const from = (table: string) => {
    const op: Op = { table, kind: "select", filters: {} };
    const settle = () => {
      const r = handler(op);
      return { data: r.data ?? null, error: r.error ?? null, count: r.count ?? null };
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      insert: (payload: Record<string, unknown>) => {
        op.kind = "insert";
        op.payload = payload;
        ops.push(op);
        return builder;
      },
      update: (payload: Record<string, unknown>) => {
        op.kind = "update";
        op.payload = payload;
        ops.push(op);
        return builder;
      },
      eq: (k: string, v: unknown) => {
        op.filters[k] = v;
        return builder;
      },
      neq: (k: string, v: unknown) => {
        op.filters[`${k}:neq`] = v;
        return builder;
      },
      in: (k: string, v: unknown) => {
        op.filters[`${k}:in`] = v;
        return builder;
      },
      or: (expr: string) => {
        op.filters.or = expr;
        return builder;
      },
      limit: () => builder,
      order: () => builder,
      returns: () => builder,
      maybeSingle: () => {
        if (op.kind === "select") ops.push(op);
        return Promise.resolve(settle());
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        if (op.kind === "select") ops.push(op);
        return Promise.resolve(settle()).then(resolve, reject);
      },
    };
    return builder;
  };
  return { client: { from } as never, ops };
}

/** The common happy-path handler; `over` swaps individual answers per test. */
function handlerFor(over: {
  ledgerInsert?: Settled;
  /** The SELECT of an already-seen event's ledger row (the 23505 path). */
  ledgerRow?: Settled;
  paymentById?: Settled;
  paymentBySession?: Settled;
  paymentByRef?: Settled;
  quote?: Settled;
  paymentUpdate?: Settled;
} = {}) {
  return (op: Op): Settled => {
    if (op.table === "stripe_events") {
      if (op.kind === "insert") return over.ledgerInsert ?? {};
      if (op.kind === "select") return over.ledgerRow ?? { data: null };
      return {};
    }
    if (op.table === "catering_quotes") {
      // The family read (review r4): the revisions that name this quote as their root. None.
      if ("root_id" in op.filters) return { data: [] };
      return over.quote ?? { data: { id: QUOTE_ID, location_id: LOCATION_ID } };
    }
    if (op.table === "catering_payments") {
      // A guarded flip answers with the row it wrote (the paid flip reads it back — review
      // r4) and its rowcount (the refund flip). `{ count: 0 }` = it matched nothing.
      if (op.kind === "update") {
        return over.paymentUpdate ?? { count: 1, data: [{ id: PAYMENT_ID, quote_id: QUOTE_ID, provider_session_id: null }] };
      }
      if ("id" in op.filters) return over.paymentById ?? { data: DUE_ROW };
      if ("provider_session_id" in op.filters) return over.paymentBySession ?? { data: null };
      if ("provider_ref" in op.filters) return over.paymentByRef ?? { data: null };
    }
    return {};
  };
}

const SINGLE: StripeWebhookContext = { locationId: null, locationCode: null };
const PER_SHOP: StripeWebhookContext = { locationId: LOCATION_ID, locationCode: "EM" };

function sessionEvent(over: Record<string, unknown> = {}, type = "checkout.session.completed", id = "evt_1") {
  return {
    id,
    type,
    livemode: false,
    data: {
      object: {
        id: "cs_1",
        payment_status: "paid",
        payment_intent: "pi_1",
        amount_total: 2500,
        metadata: { quote_id: QUOTE_ID, payment_id: PAYMENT_ID, kind: "deposit" },
        ...over,
      },
    },
  };
}

const noNotify = { notifyPaid: vi.fn(async () => {}) };

beforeEach(() => {
  auditMock.mockClear();
  noNotify.notifyPaid.mockClear();
});

describe("ledger-first idempotency", () => {
  it("a DUPLICATE of a FINISHED event reads its verdict and does nothing else — no payment reads, no writes, no audit", async () => {
    const { client, ops } = stubClient(
      handlerFor({
        ledgerInsert: { error: { code: "23505" } },
        ledgerRow: { data: { id: "evt_1", outcome: "paid" } },
      }),
    );
    const out = await processStripeEvent(client, sessionEvent(), SINGLE, noNotify);

    expect(out.result).toBe("duplicate");
    expect(ops.filter((o) => o.table === "catering_payments")).toEqual([]);
    expect(ops.filter((o) => o.table === "stripe_events" && o.kind === "update")).toEqual([]);
    expect(auditMock).not.toHaveBeenCalled();
    expect(noNotify.notifyPaid).not.toHaveBeenCalled();
  });

  it("a FAILED ledger append throws, so the route can answer 500 and Stripe retries", async () => {
    const { client } = stubClient(handlerFor({ ledgerInsert: { error: { code: "08006", message: "boom" } } }));
    await expect(processStripeEvent(client, sessionEvent(), SINGLE, noNotify)).rejects.toThrow(/stripe_events append/);
  });

  it("appends the delivery VERBATIM, keyed on Stripe's own event id", async () => {
    const { client, ops } = stubClient(handlerFor());
    const event = sessionEvent();
    await processStripeEvent(client, event, SINGLE, noNotify);

    const insert = ops.find((o) => o.table === "stripe_events" && o.kind === "insert");
    expect(insert?.payload).toMatchObject({ id: "evt_1", type: "checkout.session.completed", livemode: false });
    expect(insert?.payload?.payload).toBe(event);
  });

  it("an event with no usable id is refused BEFORE the ledger — there is nothing to key on", async () => {
    const { client, ops } = stubClient(handlerFor());
    const out = await processStripeEvent(client, { type: "checkout.session.completed" }, SINGLE, noNotify);
    expect(out.result).toBe("invalid_payload");
    expect(ops).toEqual([]);
  });
});

describe("completed / async_succeeded — the paid flip", () => {
  it("marks the due row paid ONCE, with the PaymentIntent as provider_ref", async () => {
    const { client, ops } = stubClient(handlerFor());
    const out = await processStripeEvent(client, sessionEvent(), SINGLE, noNotify);

    expect(out.result).toBe("paid");
    const update = ops.find((o) => o.table === "catering_payments" && o.kind === "update");
    expect(update?.payload).toMatchObject({ status: "paid", provider: "stripe", provider_ref: "pi_1" });
    // The guard is the whole safety property: only a row still `due` may be advanced — or
    // one we had VOIDED, because a charge on a closed intent is still a charge (W02/B035;
    // tests/stripe-webhook-review.test.ts pins what happens then). Never `paid`/`refunded`.
    expect(update?.filters).toMatchObject({ id: PAYMENT_ID, "status:in": ["due", "void"] });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "catering.payment.provider_paid", actorId: null }));
    expect(noNotify.notifyPaid).toHaveBeenCalledOnce();
  });

  it("audits the ROW's amount as the authority and the event's amount only as evidence", async () => {
    const { client } = stubClient(handlerFor());
    await processStripeEvent(client, sessionEvent({ amount_total: 9999 }), SINGLE, noNotify);
    expect(auditMock.mock.calls[0]?.[0].metadata).toMatchObject({ amount_cents: 2500, event_amount_cents: 9999 });
  });

  it("a SECOND completed for the same payment reports `already_advanced` and writes nothing", async () => {
    // "The same payment" = the same CHARGE: the row already carries this PaymentIntent.
    const { client, ops } = stubClient(
      handlerFor({ paymentById: { data: { ...PAID_ROW, provider_ref: "pi_1" } }, paymentUpdate: { count: 0 } }),
    );
    const out = await processStripeEvent(client, sessionEvent({}, "checkout.session.completed", "evt_2"), SINGLE, noNotify);

    expect(out.result).toBe("already_advanced");
    expect(auditMock).not.toHaveBeenCalled();
    expect(noNotify.notifyPaid).not.toHaveBeenCalled();
    expect(ops.find((o) => o.table === "stripe_events" && o.kind === "update")?.payload).toMatchObject({
      outcome: "already_advanced",
    });
  });

  it("async_payment_succeeded takes the same path as completed", async () => {
    const { client } = stubClient(handlerFor());
    const out = await processStripeEvent(
      client,
      sessionEvent({ payment_status: "unpaid" }, "checkout.session.async_payment_succeeded", "evt_3"),
      SINGLE,
      noNotify,
    );
    expect(out.result).toBe("paid");
  });

  it("falls back to the Checkout Session id when metadata carries no usable payment id", async () => {
    const { client, ops } = stubClient(handlerFor({ paymentBySession: { data: DUE_ROW } }));
    const out = await processStripeEvent(client, sessionEvent({ metadata: {} }), SINGLE, noNotify);

    expect(out.result).toBe("paid");
    expect(ops.some((o) => "provider_session_id" in o.filters)).toBe(true);
  });

  it("reports `payment_not_found` when neither lookup finds a row", async () => {
    const { client, ops } = stubClient(handlerFor({ paymentById: { data: null } }));
    const out = await processStripeEvent(client, sessionEvent(), SINGLE, noNotify);

    expect(out.result).toBe("payment_not_found");
    expect(ops.find((o) => o.table === "catering_payments" && o.kind === "update")).toBeUndefined();
  });

  it("a mail failure NEVER fails the webhook — the money landed and the row says so", async () => {
    const { client } = stubClient(handlerFor());
    const out = await processStripeEvent(client, sessionEvent(), SINGLE, {
      notifyPaid: async () => {
        throw new Error("resend is down");
      },
    });
    expect(out.result).toBe("paid");
  });
});

describe("failures and expiries leave the row DUE", () => {
  // Review r5: a FAILED delayed payment is Stripe's own word that the attempt is over — its
  // session is `complete` and can never be expired, so its id used to stay on the row and
  // block every retry for good. The id is cleared exactly as an expiry's is; nothing else
  // about the intent is written, and the failed attempt is recorded.
  it("checkout.session.async_payment_failed → async_failed: the row's status is untouched; only the failed session's id is cleared, guarded on that id", async () => {
    const { client, ops } = stubClient(handlerFor());
    const out = await processStripeEvent(
      client,
      sessionEvent({ payment_status: "unpaid" }, "checkout.session.async_payment_failed", "evt_f"),
      SINGLE,
      noNotify,
    );

    expect(out.result).toBe("async_failed");
    const writes = ops.filter((o) => o.table === "catering_payments" && o.kind === "update");
    expect(writes).toHaveLength(1);
    expect(writes[0]!.payload).toEqual({ provider_session_id: null });
    expect(writes[0]!.filters).toMatchObject({ id: PAYMENT_ID, provider_session_id: "cs_1", "status:in": ["due", "void"] });
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock.mock.calls[0]![0]).toMatchObject({
      action: "catering.payment.provider_payment_failed",
      resourceId: PAYMENT_ID,
      metadata: { session_id: "cs_1", session_cleared: true, stripe_event_id: "evt_f", row_status: "due" },
    });
    expect(noNotify.notifyPaid).not.toHaveBeenCalled();
  });

  // Review r3: an expiry is Stripe's own confirmation that a checkout is closed, so the dead
  // session id is cleared (it would otherwise go on blocking new collection on the quote).
  // The intent's STATUS, amount and money columns are never written by it.
  it("checkout.session.expired → expired: the row's status is untouched; only the expired session's id is cleared, guarded on that id", async () => {
    const { client, ops } = stubClient(handlerFor());
    const out = await processStripeEvent(
      client,
      sessionEvent({ payment_status: "unpaid" }, "checkout.session.expired", "evt_f"),
      SINGLE,
      noNotify,
    );

    expect(out.result).toBe("expired");
    const writes = ops.filter((o) => o.table === "catering_payments" && o.kind === "update");
    expect(writes).toHaveLength(1);
    expect(writes[0]!.payload).toEqual({ provider_session_id: null });
    expect(writes[0]!.filters).toMatchObject({ id: PAYMENT_ID, provider_session_id: "cs_1", "status:in": ["due", "void"] });
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("a completed-but-UNPAID session is `ignored` and touches no payment row", async () => {
    const { client, ops } = stubClient(handlerFor());
    const out = await processStripeEvent(client, sessionEvent({ payment_status: "unpaid" }), SINGLE, noNotify);

    expect(out.result).toBe("ignored");
    expect(ops.filter((o) => o.table === "catering_payments")).toEqual([]);
  });

  it("an event type we do not handle is `ignored`, and still stamped on the ledger", async () => {
    const { client, ops } = stubClient(handlerFor());
    const out = await processStripeEvent(client, { id: "evt_x", type: "invoice.paid", livemode: false, data: { object: {} } }, SINGLE, noNotify);

    expect(out.result).toBe("ignored");
    expect(ops.find((o) => o.table === "stripe_events" && o.kind === "update")?.payload).toMatchObject({ outcome: "ignored" });
  });
});

describe("charge.refunded", () => {
  const refundEvent = (over: Record<string, unknown> = {}) => ({
    id: "evt_r",
    type: "charge.refunded",
    livemode: false,
    // A charge as Stripe sends it: what was captured, what has been refunded so far, and
    // Stripe's own "all of it" flag. The default is a FULL refund of a $25 charge.
    data: { object: { id: "ch_1", payment_intent: "pi_1", amount: 2500, amount_refunded: 2500, refunded: true, metadata: {}, ...over } },
  });

  it("finds the payment by provider_ref and moves paid → refunded", async () => {
    const { client, ops } = stubClient(handlerFor({ paymentByRef: { data: PAID_ROW } }));
    const out = await processStripeEvent(client, refundEvent(), SINGLE, noNotify);

    expect(out.result).toBe("refunded");
    const update = ops.find((o) => o.table === "catering_payments" && o.kind === "update");
    expect(update?.payload).toEqual({ status: "refunded" });
    expect(update?.filters).toMatchObject({ id: PAYMENT_ID, status: "paid" });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "catering.payment.provider_refunded" }));
  });

  it("W02/B036 — a PARTIAL refund leaves the row `paid` and audits the amount", async () => {
    const paid300 = { ...PAID_ROW, amount_cents: 30000 };
    const { client, ops } = stubClient(handlerFor({ paymentByRef: { data: paid300 } }));
    const out = await processStripeEvent(
      client,
      refundEvent({ amount: 30000, amount_refunded: 2000, refunded: false }),
      SINGLE,
      noNotify,
    );

    expect(out.result).toBe("partially_refunded");
    // The row is NOT touched: the customer has still paid, and the pay panel must stay shut.
    expect(ops.find((o) => o.table === "catering_payments" && o.kind === "update")).toBeUndefined();
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "catering.payment.provider_refunded",
        metadata: expect.objectContaining({
          partial: true,
          row_status: "paid",
          refunded_amount_cents: 2000,
          amount_cents: 30000,
        }),
      }),
    );
    expect(ops.find((o) => o.table === "stripe_events" && o.kind === "update")?.payload).toMatchObject({
      outcome: "partially_refunded",
    });
  });

  it("W02/B036 — Stripe's own `refunded: true` is a FULL refund and moves the row", async () => {
    const paid300 = { ...PAID_ROW, amount_cents: 30000 };
    const { client, ops } = stubClient(handlerFor({ paymentByRef: { data: paid300 } }));
    const out = await processStripeEvent(
      client,
      refundEvent({ amount: 30000, amount_refunded: 30000, refunded: true }),
      SINGLE,
      noNotify,
    );

    expect(out.result).toBe("refunded");
    expect(ops.find((o) => o.table === "catering_payments" && o.kind === "update")?.payload).toEqual({ status: "refunded" });
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ partial: false, row_status: "refunded" }) }),
    );
  });

  it("W02/B036 — partial refunds that TOGETHER cover the CHARGE read as full (amount_refunded is cumulative)", async () => {
    const paid300 = { ...PAID_ROW, amount_cents: 30000 };
    const { client } = stubClient(handlerFor({ paymentByRef: { data: paid300 } }));
    // No boolean on the payload: the cumulative amount, against the charge's own amount, decides.
    const out = await processStripeEvent(client, refundEvent({ amount: 30000, amount_refunded: 30000, refunded: undefined }), SINGLE, noNotify);
    expect(out.result).toBe("refunded");
  });

  it("review r1 — the ROW's amount never decides: a refund covering the row but not the charge is partial", async () => {
    // The row says $25; Stripe captured $300 and has refunded $25 of it.
    const { client, ops } = stubClient(handlerFor({ paymentByRef: { data: PAID_ROW } }));
    const out = await processStripeEvent(client, refundEvent({ amount: 30000, amount_refunded: 2500, refunded: undefined }), SINGLE, noNotify);
    expect(out.result).toBe("partially_refunded");
    expect(ops.find((o) => o.table === "catering_payments" && o.kind === "update")).toBeUndefined();
  });

  it("W02/B036 — a refund payload with NEITHER signal is treated as partial, never as a re-opened order", async () => {
    const { client, ops } = stubClient(handlerFor({ paymentByRef: { data: PAID_ROW } }));
    const out = await processStripeEvent(client, refundEvent({ amount: undefined, refunded: undefined }), SINGLE, noNotify);
    expect(out.result).toBe("partially_refunded");
    expect(ops.find((o) => o.table === "catering_payments" && o.kind === "update")).toBeUndefined();
  });

  it("W02/B036 — a partial refund against a row that is not `paid` reports `no_paid_row`", async () => {
    const { client } = stubClient(
      handlerFor({ paymentByRef: { data: { ...PAID_ROW, amount_cents: 30000, status: "refunded" } } }),
    );
    const out = await processStripeEvent(client, refundEvent({ amount_refunded: 2000, refunded: false }), SINGLE, noNotify);
    expect(out.result).toBe("no_paid_row");
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("reports `no_paid_row` when the guarded update matches nothing (already refunded)", async () => {
    const { client } = stubClient(handlerFor({ paymentByRef: { data: PAID_ROW }, paymentUpdate: { count: 0 } }));
    const out = await processStripeEvent(client, refundEvent(), SINGLE, noNotify);

    expect(out.result).toBe("no_paid_row");
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("reports `payment_not_found` for a charge we never took", async () => {
    const { client } = stubClient(handlerFor({ paymentByRef: { data: null } }));
    expect((await processStripeEvent(client, refundEvent(), SINGLE, noNotify)).result).toBe("payment_not_found");
  });

  it("a refund with no payment_intent cannot be matched and says so", async () => {
    const { client } = stubClient(handlerFor());
    expect((await processStripeEvent(client, refundEvent({ payment_intent: null }), SINGLE, noNotify)).result).toBe("payment_not_found");
  });
});

describe("the two deployment shapes", () => {
  it("SINGLE-ACCOUNT: the shop is learned from the payment's quote and stamped on the ledger", async () => {
    const { client, ops } = stubClient(handlerFor());
    const out = await processStripeEvent(client, sessionEvent(), SINGLE, noNotify);

    expect(out.locationId).toBe(LOCATION_ID);
    // The ledger row was inserted with a null location (we did not know it yet) and the
    // final stamp fills it in.
    expect(ops.find((o) => o.table === "stripe_events" && o.kind === "insert")?.payload).toMatchObject({ location_id: null });
    expect(ops.find((o) => o.table === "stripe_events" && o.kind === "update")?.payload).toMatchObject({
      outcome: "paid",
      location_id: LOCATION_ID,
    });
  });

  it("PER-LOCATION: a payment belonging to ANOTHER shop is refused with no write", async () => {
    const { client, ops } = stubClient(
      handlerFor({ quote: { data: { id: QUOTE_ID, location_id: OTHER_LOCATION_ID } } }),
    );
    const out = await processStripeEvent(client, sessionEvent(), PER_SHOP, noNotify);

    expect(out.result).toBe("location_mismatch");
    expect(ops.find((o) => o.table === "catering_payments" && o.kind === "update")).toBeUndefined();
    expect(auditMock).not.toHaveBeenCalled();
    expect(ops.find((o) => o.table === "stripe_events" && o.kind === "update")?.payload).toMatchObject({
      outcome: "location_mismatch",
    });
  });

  it("PER-LOCATION: the shop's OWN payment goes through, and the ledger knew the shop up front", async () => {
    const { client, ops } = stubClient(handlerFor());
    const out = await processStripeEvent(client, sessionEvent(), PER_SHOP, noNotify);

    expect(out.result).toBe("paid");
    expect(ops.find((o) => o.table === "stripe_events" && o.kind === "insert")?.payload).toMatchObject({
      location_id: LOCATION_ID,
    });
  });

  it("PER-LOCATION: a refund for another shop's charge is refused too", async () => {
    const { client, ops } = stubClient(
      handlerFor({
        paymentByRef: { data: PAID_ROW },
        quote: { data: { id: QUOTE_ID, location_id: OTHER_LOCATION_ID } },
      }),
    );
    const out = await processStripeEvent(
      client,
      { id: "evt_r2", type: "charge.refunded", livemode: false, data: { object: { id: "ch_2", payment_intent: "pi_1", amount_refunded: 100, metadata: {} } } },
      PER_SHOP,
      noNotify,
    );
    expect(out.result).toBe("location_mismatch");
    expect(ops.find((o) => o.table === "catering_payments" && o.kind === "update")).toBeUndefined();
  });
});

describe("W02/B005 — an event that was SEEN but never FINISHED is worked again", () => {
  const SEEN = { error: { code: "23505" } };

  it("a redelivery of an event stamped `processing_failed` runs the paid flip", async () => {
    const { client, ops } = stubClient(
      handlerFor({ ledgerInsert: SEEN, ledgerRow: { data: { id: "evt_1", outcome: "processing_failed" } } }),
    );
    const out = await processStripeEvent(client, sessionEvent(), SINGLE, noNotify);

    expect(out.result).toBe("paid");
    const update = ops.find((o) => o.table === "catering_payments" && o.kind === "update");
    expect(update?.payload).toMatchObject({ status: "paid", provider: "stripe", provider_ref: "pi_1" });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "catering.payment.provider_paid" }));
    expect(noNotify.notifyPaid).toHaveBeenCalledTimes(1);
    expect(ops.find((o) => o.table === "stripe_events" && o.kind === "update")?.payload).toMatchObject({ outcome: "paid" });
  });

  it("a redelivery of an event that died mid-flight (outcome NULL) runs the paid flip", async () => {
    const { client, ops } = stubClient(
      handlerFor({ ledgerInsert: SEEN, ledgerRow: { data: { id: "evt_1", outcome: null } } }),
    );
    const out = await processStripeEvent(client, sessionEvent(), SINGLE, noNotify);

    expect(out.result).toBe("paid");
    expect(ops.find((o) => o.table === "catering_payments" && o.kind === "update")?.filters).toMatchObject({
      id: PAYMENT_ID,
    });
  });

  // Review r5. This test used to read "the row is already paid by this charge" as "all the
  // work landed" and expect `already_advanced` with no audit and no email. The ROW cannot
  // say that: an earlier delivery cut off after its flip leaves exactly this state with the
  // order's other checkouts still open and nobody told. The LEDGER says whether the work is
  // done, and here it says it is not (outcome NULL) — so the settlement is resumed, and
  // because the report rides on the stamp, this is the delivery that makes it. Every cut
  // point is pinned in tests/stripe-webhook-resume.test.ts.
  it("a redelivery of an UNSTAMPED event whose charge is already on the row RESUMES the settlement: `paid`, reported once", async () => {
    const { client, ops } = stubClient(
      handlerFor({
        ledgerInsert: SEEN,
        ledgerRow: { data: { id: "evt_1", outcome: null } },
        paymentById: { data: { ...PAID_ROW, provider_ref: "pi_1" } },
        paymentUpdate: { count: 0, data: [] },
      }),
    );
    const out = await processStripeEvent(client, sessionEvent(), SINGLE, noNotify);

    expect(out.result).toBe("paid");
    expect(ops.find((o) => o.table === "stripe_events" && o.kind === "update")?.payload).toMatchObject({ outcome: "paid" });
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock.mock.calls[0]![0].metadata).toMatchObject({ resumed: true, row_moved: true, needs_review: [] });
    expect(noNotify.notifyPaid).toHaveBeenCalledTimes(1);
  });

  it("…while a FIRST-SEEN event about a charge already on the row is still the quiet `already_advanced`", async () => {
    const { client } = stubClient(
      handlerFor({ paymentById: { data: { ...PAID_ROW, provider_ref: "pi_1" } }, paymentUpdate: { count: 0, data: [] } }),
    );
    const out = await processStripeEvent(client, sessionEvent({}, "checkout.session.completed", "evt_other"), SINGLE, noNotify);

    expect(out.result).toBe("already_advanced");
    expect(auditMock).not.toHaveBeenCalled();
    expect(noNotify.notifyPaid).not.toHaveBeenCalled();
  });

  it("a redelivered REFUND that failed the first time is retried too", async () => {
    const { client, ops } = stubClient(
      handlerFor({
        ledgerInsert: SEEN,
        ledgerRow: { data: { id: "evt_r", outcome: "processing_failed" } },
        paymentByRef: { data: PAID_ROW },
      }),
    );
    const out = await processStripeEvent(
      client,
      { id: "evt_r", type: "charge.refunded", livemode: false, data: { object: { id: "ch_1", payment_intent: "pi_1", amount: 2500, amount_refunded: 2500, refunded: true, metadata: {} } } },
      SINGLE,
      noNotify,
    );
    expect(out.result).toBe("refunded");
    expect(ops.find((o) => o.table === "catering_payments" && o.kind === "update")?.payload).toMatchObject({ status: "refunded" });
  });

  it("a FAILED read of the seen event's verdict throws — 500, never a 200 for work that may not have landed", async () => {
    const { client, ops } = stubClient(
      handlerFor({ ledgerInsert: SEEN, ledgerRow: { error: { message: "connection reset" } } }),
    );
    await expect(processStripeEvent(client, sessionEvent(), SINGLE, noNotify)).rejects.toThrow(/stripe_events read/);
    expect(ops.filter((o) => o.table === "catering_payments")).toEqual([]);
  });

  it("the verdict stamp is guarded, so a concurrent retry cannot overwrite a terminal verdict", async () => {
    const { client, ops } = stubClient(handlerFor());
    await processStripeEvent(client, sessionEvent(), SINGLE, noNotify);

    const stamp = ops.find((o) => o.table === "stripe_events" && o.kind === "update");
    expect(stamp?.filters).toMatchObject({ id: "evt_1", or: "outcome.is.null,outcome.eq.processing_failed" });
  });

  it("the ROUTE answers 500 to `processing_failed`, so Stripe redelivers", () => {
    const src = readFileSync(join(ROOT, "app/api/webhooks/stripe/_handler.ts"), "utf8");
    expect(src).toMatch(/if \(result === "processing_failed"\) return jsonError\(500, "processing_failed"\)/);
    // …and the 500 sits BEFORE the catch-all 200.
    expect(src.indexOf('jsonError(500, "processing_failed")')).toBeLessThan(src.indexOf("return jsonOk({ result })"));
  });
});

describe("a processing failure is recorded AND reported as retryable", () => {
  it("stamps the ledger and returns `processing_failed` rather than throwing past the route", async () => {
    const { client, ops } = stubClient(
      handlerFor({ paymentById: { error: { message: "transport exploded" } } }),
    );
    const out = await processStripeEvent(client, sessionEvent(), SINGLE, noNotify);

    // `processing_failed`, NOT `invalid_payload`: the payload was fine, our side was not.
    expect(out.result).toBe("processing_failed");
    expect(ops.find((o) => o.table === "stripe_events" && o.kind === "update")?.payload).toMatchObject({
      outcome: "processing_failed",
    });
  });
});

describe("resolveWebhookLocation — the [locationCode] segment", () => {
  it("single-account mode claims no shop and spends no query", async () => {
    const { client, ops } = stubClient(() => ({}));
    expect(await resolveWebhookLocation(client, null)).toEqual({ ok: true, locationId: null, locationCode: null });
    expect(ops).toEqual([]);
  });

  it("resolves an ACTIVE shop by its code, normalised to the table's spelling", async () => {
    const { client, ops } = stubClient(() => ({ data: { id: LOCATION_ID, code: "EM" } }));
    expect(await resolveWebhookLocation(client, "em")).toEqual({
      ok: true,
      locationId: LOCATION_ID,
      locationCode: "EM",
    });
    expect(ops[0]?.filters).toMatchObject({ code: "EM", active: true });
  });

  it("refuses an unknown or inactive code — a mis-registered endpoint must not read as dormant", async () => {
    const { client } = stubClient(() => ({ data: null }));
    expect(await resolveWebhookLocation(client, "NOPE")).toEqual({ ok: false, reason: "unknown_location" });
  });

  it("refuses a code that could not name an env var, WITHOUT spending a query", async () => {
    const { client, ops } = stubClient(() => ({ data: null }));
    for (const bad of ["", "   ", "cap-hill", "../admin", "a b"]) {
      expect(await resolveWebhookLocation(client, bad)).toEqual({ ok: false, reason: "unknown_location" });
    }
    expect(ops).toEqual([]);
  });

  it("a DB error is `lookup_failed`, never `unknown_location` — 404 would stop Stripe retrying", async () => {
    const { client } = stubClient(() => ({ error: { message: "transport exploded" } }));
    expect(await resolveWebhookLocation(client, "EM")).toEqual({ ok: false, reason: "lookup_failed" });
  });
});
