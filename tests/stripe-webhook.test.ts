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
 *   NOTHING MOVES ON A FAILURE. `expired` / `async_failed` leave the row `due` and write
 *   no payment row at all.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/audit";
import { processStripeEvent, resolveWebhookLocation, type StripeWebhookContext } from "@/lib/stripe/webhook";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
const auditMock = vi.mocked(audit);

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
  paymentById?: Settled;
  paymentBySession?: Settled;
  paymentByRef?: Settled;
  quote?: Settled;
  paymentUpdate?: Settled;
} = {}) {
  return (op: Op): Settled => {
    if (op.table === "stripe_events") {
      return op.kind === "insert" ? (over.ledgerInsert ?? {}) : {};
    }
    if (op.table === "catering_quotes") {
      return over.quote ?? { data: { id: QUOTE_ID, location_id: LOCATION_ID } };
    }
    if (op.table === "catering_payments") {
      if (op.kind === "update") return over.paymentUpdate ?? { count: 1 };
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
  it("a DUPLICATE event id does nothing at all — no reads, no writes, no audit", async () => {
    const { client, ops } = stubClient(handlerFor({ ledgerInsert: { error: { code: "23505" } } }));
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
    // The guard is the whole safety property: only a row still `due` may be advanced.
    expect(update?.filters).toMatchObject({ id: PAYMENT_ID, status: "due" });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "catering.payment.provider_paid", actorId: null }));
    expect(noNotify.notifyPaid).toHaveBeenCalledOnce();
  });

  it("audits the ROW's amount as the authority and the event's amount only as evidence", async () => {
    const { client } = stubClient(handlerFor());
    await processStripeEvent(client, sessionEvent({ amount_total: 9999 }), SINGLE, noNotify);
    expect(auditMock.mock.calls[0]?.[0].metadata).toMatchObject({ amount_cents: 2500, event_amount_cents: 9999 });
  });

  it("a SECOND completed for the same payment reports `already_advanced` and writes nothing", async () => {
    const { client, ops } = stubClient(
      handlerFor({ paymentById: { data: PAID_ROW }, paymentUpdate: { count: 0 } }),
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
  it.each([
    ["checkout.session.expired", "expired"],
    ["checkout.session.async_payment_failed", "async_failed"],
  ])("%s → %s, and no payment row is written", async (type, expected) => {
    const { client, ops } = stubClient(handlerFor());
    const out = await processStripeEvent(client, sessionEvent({ payment_status: "unpaid" }, type, "evt_f"), SINGLE, noNotify);

    expect(out.result).toBe(expected);
    expect(ops.find((o) => o.table === "catering_payments" && o.kind === "update")).toBeUndefined();
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
    data: { object: { id: "ch_1", payment_intent: "pi_1", amount_refunded: 2500, metadata: {}, ...over } },
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

describe("a processing failure is recorded, not retried forever", () => {
  it("stamps the ledger and returns rather than throwing past the route", async () => {
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
