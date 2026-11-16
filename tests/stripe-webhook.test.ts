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
import { isRetryableResult, processStripeEvent, resolveWebhookLocation, type StripeWebhookContext } from "@/lib/stripe/webhook";
import { refundEventAmounts } from "@/lib/catering/refund-events-shared";

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
      // The settlement marker's compare-and-set (`settlement_cleanup_at IS NULL`). Review r7:
      // without it that write threw inside the stub, read as a FAILED marker write, and a
      // failed marker write is now `settlement_incomplete` instead of a quiet `paid`.
      is: (k: string, v: unknown) => {
        op.filters[`${k}:is`] = v;
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
  /** The write of `settlement_cleanup_at` (review r6 / r7). Default: it lands. */
  markerUpdate?: Settled;
} = {}) {
  return (op: Op): Settled => {
    if (op.table === "stripe_events") {
      if (op.kind === "insert") return over.ledgerInsert ?? {};
      // The look for refunds seen before their payment (review r6) filters on `type`: none here.
      if (op.kind === "select" && "type" in op.filters) return { data: [] };
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
        // The settlement marker's compare-and-set lands (NULL → now) unless a test says not.
        if (op.payload && "settlement_cleanup_at" in op.payload) return over.markerUpdate ?? { count: 1 };
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
  // Review r7: "no payment reads" became ONE read. A terminal verdict on the ledger used to
  // end the event by itself — including over a settlement whose marker was still NULL, which
  // then nothing ever read. The duplicate gate now asks the rows first: is a paid row
  // carrying this charge with its cleanup unrecorded? No → `duplicate`, and still no write.
  it("a DUPLICATE of a FINISHED event reads its verdict, asks the row ONCE whether its settlement is finished, and does nothing else — no writes, no audit", async () => {
    const { client, ops } = stubClient(
      handlerFor({
        ledgerInsert: { error: { code: "23505" } },
        ledgerRow: { data: { id: "evt_1", outcome: "paid" } },
        paymentByRef: { data: [{ id: PAYMENT_ID, status: "paid", provider_ref: "pi_1", settlement_cleanup_at: "2026-11-01T00:00:00.000Z" }] },
      }),
    );
    const out = await processStripeEvent(client, sessionEvent(), SINGLE, noNotify);

    expect(out.result).toBe("duplicate");
    const paymentOps = ops.filter((o) => o.table === "catering_payments");
    expect(paymentOps).toHaveLength(1);
    // Found by the CHARGE alone (review r8): the gate reads the row whatever its money status
    // and asks the marker — a `status = paid` filter here is how a refunded row whose cleanup
    // was unfinished read as "no such row", i.e. a duplicate.
    expect(paymentOps[0]).toMatchObject({ kind: "select", filters: { provider_ref: "pi_1" } });
    expect(paymentOps[0]!.filters).not.toHaveProperty("status");
    expect(ops.filter((o) => o.kind === "update")).toEqual([]);
    expect(auditMock).not.toHaveBeenCalled();
    expect(noNotify.notifyPaid).not.toHaveBeenCalled();
  });

  it("a duplicate of an event that is NOT about a payment (expired, ignored, …) reads no payment at all", async () => {
    const { client, ops } = stubClient(
      handlerFor({ ledgerInsert: { error: { code: "23505" } }, ledgerRow: { data: { id: "evt_1", outcome: "expired" } } }),
    );
    const out = await processStripeEvent(client, sessionEvent({}, "checkout.session.expired"), SINGLE, noNotify);

    expect(out.result).toBe("duplicate");
    expect(ops.filter((o) => o.table === "catering_payments")).toEqual([]);
  });

  it("a duplicate whose row says the settlement is NOT finished (marker NULL) is worked again, whatever verdict the ledger carries", async () => {
    const { client, ops } = stubClient((op) => {
      // The gate's question: a paid row carries pi_1 and its cleanup is unrecorded.
      if (op.table === "catering_payments" && op.kind === "select" && "provider_ref" in op.filters) {
        return { data: [{ id: PAYMENT_ID, status: "paid", provider_ref: "pi_1", settlement_cleanup_at: null }] };
      }
      return handlerFor({
        ledgerInsert: { error: { code: "23505" } },
        ledgerRow: { data: { id: "evt_1", outcome: "paid_needs_review" } },
        paymentById: { data: { ...PAID_ROW, provider_ref: "pi_1", settlement_cleanup_at: null } },
        paymentUpdate: { count: 0, data: [] },
      })(op);
    });
    const out = await processStripeEvent(client, sessionEvent(), SINGLE, noNotify);

    expect(out.result).toBe("paid"); // the bug: `duplicate`
    expect(ops.some((o) => o.table === "catering_payments" && o.kind === "update" && o.payload && "settlement_cleanup_at" in o.payload)).toBe(true);
    expect(noNotify.notifyPaid).toHaveBeenCalledTimes(1);
  });

  // Review r8: the same question, asked of a row a refund has since been applied to. Round r7
  // filtered the gate's read on `status = paid`, so this row was "no such row" → `duplicate`.
  it("…and so is one whose row has since been REFUNDED with the marker still NULL: worked again, the marker written, the money status never written", async () => {
    const { client, ops } = stubClient((op) => {
      if (op.table === "catering_payments" && op.kind === "select" && "provider_ref" in op.filters) {
        return { data: [{ id: PAYMENT_ID, status: "refunded", provider_ref: "pi_1", settlement_cleanup_at: null }] };
      }
      return handlerFor({
        ledgerInsert: { error: { code: "23505" } },
        ledgerRow: { data: { id: "evt_1", outcome: "already_advanced" } },
        paymentById: { data: { ...PAID_ROW, status: "refunded", provider_ref: "pi_1", settlement_cleanup_at: null } },
        paymentUpdate: { count: 0, data: [] },
      })(op);
    });
    const out = await processStripeEvent(client, sessionEvent(), SINGLE, noNotify);

    expect(out.result).not.toBe("duplicate"); // the bug
    expect(out.result).not.toBe("already_advanced");
    const updates = ops.filter((o) => o.table === "catering_payments" && o.kind === "update");
    // The marker write was attempted, guarded on "money was recorded on this row"…
    const marker = updates.find((o) => o.payload && "settlement_cleanup_at" in o.payload);
    expect(marker).toBeDefined();
    expect(Object.keys(marker!.payload ?? {})).toEqual(["settlement_cleanup_at"]);
    expect(marker!.filters["status:in"]).toEqual(["paid", "refunded"]);
    // …and nothing this run wrote could have moved a refunded row's money status: the only
    // status write is the paid flip, which is guarded on due / void.
    for (const u of updates) {
      if (u.payload && "status" in u.payload) expect(u.filters["status:in"]).toEqual(["due", "void"]);
    }
    // No "payment received" about a payment that was given back.
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
    // "The same payment" = the same CHARGE: the row already carries this PaymentIntent — and
    // its settlement cleanup is RECORDED AS DONE (review r6: that marker, not the ledger, is
    // what makes this the quiet answer).
    const { client, ops } = stubClient(
      handlerFor({
        paymentById: { data: { ...PAID_ROW, provider_ref: "pi_1", settlement_cleanup_at: "2026-11-01T00:00:00.000Z" } },
        paymentUpdate: { count: 0 },
      }),
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

  // W26/B140 (review r1): every refund EVENT is appended — partial ones included — with the
  // event's own time and the charge's cumulative figure; the digest derives each one's amount.
  const refundEventRows = (ops: Op[]) => ops.filter((o) => o.table === "catering_payment_refund_events" && o.kind === "insert").map((o) => o.payload);

  it("W26/B140 — $10 partial Tuesday, then the remaining $90 Wednesday: two event rows, read back as $10 and $90 on their days", async () => {
    const paid = { ...PAID_ROW, amount_cents: 10000 };
    const tue = stubClient(handlerFor({ paymentByRef: { data: paid } }));
    const tueSec = Math.floor(Date.parse("2026-11-10T15:00:00Z") / 1000);
    expect((await processStripeEvent(tue.client, { ...refundEvent({ amount: 10000, amount_refunded: 1000, refunded: false }), id: "evt_tue", created: tueSec }, SINGLE, noNotify)).result).toBe("partially_refunded");
    const wed = stubClient(handlerFor({ paymentByRef: { data: paid } }));
    const wedSec = Math.floor(Date.parse("2026-11-11T15:00:00Z") / 1000);
    expect((await processStripeEvent(wed.client, { ...refundEvent({ amount: 10000, amount_refunded: 10000, refunded: true }), id: "evt_wed", created: wedSec }, SINGLE, noNotify)).result).toBe("refunded");
    const rows = [...refundEventRows(tue.ops), ...refundEventRows(wed.ops)];
    expect(rows).toEqual([
      { stripe_event_id: "evt_tue", payment_id: PAYMENT_ID, refunded_at: "2026-11-10T15:00:00.000Z", cumulative_refunded_cents: 1000, charge_amount_cents: 10000 },
      { stripe_event_id: "evt_wed", payment_id: PAYMENT_ID, refunded_at: "2026-11-11T15:00:00.000Z", cumulative_refunded_cents: 10000, charge_amount_cents: 10000 },
    ]);
    // The money-status rules are unchanged: the partial moved nothing, the completion flipped paid → refunded.
    expect(tue.ops.find((o) => o.table === "catering_payments" && o.kind === "update")).toBeUndefined();
    expect(wed.ops.find((o) => o.table === "catering_payments" && o.kind === "update")?.payload).toEqual({ status: "refunded" });
    const amounts = refundEventAmounts(rows as never);
    expect(Object.fromEntries(amounts)).toEqual({ evt_tue: 1000, evt_wed: 9000 });
  });

  it("W26/B140 — the event's time is capped at now", async () => {
    const { client, ops } = stubClient(handlerFor({ paymentByRef: { data: PAID_ROW } }));
    const before = Date.now();
    await processStripeEvent(client, { ...refundEvent(), created: Math.floor(before / 1000) + 86400 }, SINGLE, noNotify);
    const stamped = Date.parse(String(refundEventRows(ops)[0]?.refunded_at));
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(Date.now());
  });

  it("W26/B140 — a partial refund delivered AFTER the completion (row already refunded) is still appended", async () => {
    const { client, ops } = stubClient(handlerFor({ paymentByRef: { data: { ...PAID_ROW, status: "refunded" } } }));
    const out = await processStripeEvent(client, { ...refundEvent({ amount: 2500, amount_refunded: 500, refunded: false }), id: "evt_early" }, SINGLE, noNotify);
    expect(out.result).toBe("no_paid_row");
    expect(refundEventRows(ops)).toEqual([expect.objectContaining({ stripe_event_id: "evt_early", cumulative_refunded_cents: 500 })]);
  });

  it.each(["23505", "42P01", "PGRST205"])("W26/B140 — append answering %s (redelivery / 0333 not applied) still flips", async (code) => {
    const base = handlerFor({ paymentByRef: { data: PAID_ROW } });
    const { client, ops } = stubClient((op) => op.table === "catering_payment_refund_events" ? { error: { code, message: "x" } } : base(op));
    expect((await processStripeEvent(client, refundEvent(), SINGLE, noNotify)).result).toBe("refunded");
    expect(ops.find((o) => o.table === "catering_payments" && o.kind === "update")?.payload).toEqual({ status: "refunded" });
  });

  it("W26/B140 — any other append error throws BEFORE the flip (retryable), never a flip without its event", async () => {
    const base = handlerFor({ paymentByRef: { data: PAID_ROW } });
    const { client, ops } = stubClient((op) => op.table === "catering_payment_refund_events" ? { error: { code: "57014", message: "timeout" } } : base(op));
    await processStripeEvent(client, refundEvent(), SINGLE, noNotify).catch(() => undefined);
    expect(ops.filter((o) => o.table === "catering_payments" && o.kind === "update")).toHaveLength(0);
  });

  it("a refund write error still throws (retryable)", async () => {
    const base = handlerFor({ paymentByRef: { data: PAID_ROW } });
    const { client, ops } = stubClient((op) => op.table === "catering_payments" && op.kind === "update" ? { error: { code: "57014", message: "timeout" } } : base(op));
    await processStripeEvent(client, refundEvent(), SINGLE, noNotify).catch(() => undefined);
    expect(ops.filter((o) => o.table === "catering_payments" && o.kind === "update")).toHaveLength(1);
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

  // Review r5, then r6. This test used to read "the row is already paid by this charge" as
  // "all the work landed" and expect `already_advanced` with no audit and no email. Paid is
  // not finished: an earlier delivery cut off after its flip leaves exactly this state with
  // the order's other checkouts still open and nobody told. What says the work is done is the
  // row's own settlement marker (`settlement_cleanup_at`, migration 0303) — NULL here — so
  // the settlement is run again, and because the report rides on that marker, this is the
  // delivery that makes it. Every cut point is pinned in tests/stripe-webhook-resume.test.ts.
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

  it("…while an event about a charge already on a row whose CLEANUP IS RECORDED AS DONE is the quiet `already_advanced`", async () => {
    const { client } = stubClient(
      handlerFor({
        paymentById: { data: { ...PAID_ROW, provider_ref: "pi_1", settlement_cleanup_at: "2026-11-01T00:00:00.000Z" } },
        paymentUpdate: { count: 0, data: [] },
      }),
    );
    const out = await processStripeEvent(client, sessionEvent({}, "checkout.session.completed", "evt_other"), SINGLE, noNotify);

    expect(out.result).toBe("already_advanced");
    expect(auditMock).not.toHaveBeenCalled();
    expect(noNotify.notifyPaid).not.toHaveBeenCalled();
  });

  // Review r6 (P1). "First seen" used to be the quiet answer whatever the row said. It is the
  // delivery that INSERTED the ledger row that the reviewer caught stamping an overlapping
  // delivery's unfinished settlement as done — so a first-seen event gets no pass either.
  it("a FIRST-SEEN event about a charge on a row whose cleanup is NOT recorded runs the settlement: never `already_advanced`", async () => {
    const { client, ops } = stubClient(
      handlerFor({ paymentById: { data: { ...PAID_ROW, provider_ref: "pi_1" } }, paymentUpdate: { count: 0, data: [] } }),
    );
    const out = await processStripeEvent(client, sessionEvent({}, "checkout.session.completed", "evt_other"), SINGLE, noNotify);

    expect(out.result).toBe("paid");
    expect(ops.find((o) => o.table === "stripe_events" && o.kind === "update")?.payload).toMatchObject({ outcome: "paid" });
    expect(auditMock.mock.calls[0]![0].metadata).toMatchObject({ resumed: true, stripe_event_id: "evt_other" });
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
    // Only an UNFINISHED row may be stamped: never stamped, `processing_failed`, or
    // `settlement_incomplete` (review r7 — retryable too, and replaceable by the run that finishes).
    expect(stamp?.filters).toMatchObject({
      id: "evt_1",
      or: "outcome.is.null,outcome.eq.processing_failed,outcome.eq.settlement_incomplete",
    });
  });

  it("the ROUTE answers 500 to every retryable result (`processing_failed`, `settlement_incomplete`), so Stripe redelivers the same event", () => {
    const src = readFileSync(join(ROOT, "app/api/webhooks/stripe/_handler.ts"), "utf8");
    expect(src).toMatch(/if \(isRetryableResult\(result\)\) return jsonError\(500, result\)/);
    // …and the 500 sits BEFORE the catch-all 200.
    expect(src.indexOf("jsonError(500, result)")).toBeGreaterThan(-1);
    expect(src.indexOf("jsonError(500, result)")).toBeLessThan(src.indexOf("return jsonOk({ result })"));
    // The one predicate the route reads is exactly those two results.
    expect(isRetryableResult("processing_failed")).toBe(true);
    expect(isRetryableResult("settlement_incomplete")).toBe(true);
    expect(isRetryableResult("paid_needs_review")).toBe(false);
    expect(isRetryableResult("paid")).toBe(false);
    expect(isRetryableResult("duplicate")).toBe(false);
  });

  it("a settlement whose marker write does not land is `settlement_incomplete` — stamped as such, never `paid`", async () => {
    const { client, ops } = stubClient(handlerFor({ markerUpdate: { error: { message: "connection reset" } } }));
    const out = await processStripeEvent(client, sessionEvent(), SINGLE, noNotify);

    expect(out.result).toBe("settlement_incomplete");
    expect(ops.find((o) => o.table === "stripe_events" && o.kind === "update")?.payload).toMatchObject({ outcome: "settlement_incomplete" });
    // The ordinary "payment received" waits for the run whose marker write lands.
    expect(noNotify.notifyPaid).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
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
