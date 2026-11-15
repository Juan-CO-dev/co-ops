/**
 * Unit spine — the webhook's SECOND-PAYMENT handling (audit wave W02/B035).
 *
 * The paid flip used to ask one question — "is this row still due?" — and nothing about the
 * order around it. So when a customer completed BOTH the deposit checkout and the full
 * checkout for one quote, the second row was flipped to `paid` with the same quiet result
 * as the first, and nobody was told a refund was owed.
 *
 * What is pinned here:
 *   - THE MONEY IS ALWAYS RECORDED. A second payment is still marked paid (it happened, and
 *     the refund webhook finds its row by the PaymentIntent the flip writes).
 *   - …AND IT IS LOUD. The ledger outcome is `paid_needs_review`, the audit row carries the
 *     reasons, and the staff notification says a review is needed.
 *   - THE OTHER INTENT IS CLOSED. When a deposit or full payment lands, the quote's other
 *     due deposit/full intent is voided so the board stops showing it as collectable.
 *   - NOTHING AFTER THE FLIP MAY THROW. The event is retried when processing fails (B005),
 *     and a retry of a flip that DID land reports `already_advanced` with no audit and no
 *     email — so a failure in the review step must degrade to a reason, never an exception.
 *
 * Runs against tests/payments-fake-client.ts (predicate-aware, in memory). No DB, no mail.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { notifyPaymentPaid, processStripeEvent, type StripeWebhookContext } from "@/lib/stripe/webhook";

import { paymentsFake, type PaymentsFake, type Row } from "./payments-fake-client";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async () => ({ id: "email_1" })),
  teamFrom: () => "Team <team@example.com>",
}));
const auditMock = vi.mocked(audit);
const sendEmailMock = vi.mocked(sendEmail);

const QUOTE = "a0000000-0000-4000-8000-000000000001";
const LOCATION = "b0000000-0000-4000-8000-000000000001";
const DEPOSIT = "d0000000-0000-4000-8000-000000000001";
const FULL = "d0000000-0000-4000-8000-000000000002";
const BALANCE = "d0000000-0000-4000-8000-000000000003";

const SINGLE: StripeWebhookContext = { locationId: null, locationCode: null };

let db: PaymentsFake;
const notifyPaid = vi.fn(async () => {});
const deps = { notifyPaid };

function pay(over: Row): Row {
  return {
    quote_id: QUOTE,
    kind: "deposit",
    amount_cents: 20000,
    status: "due",
    provider: null,
    provider_ref: null,
    provider_session_id: null,
    ...over,
  };
}

/** `checkout.session.completed` (paid) for one of our intents. */
function completed(paymentId: string, over: Record<string, unknown> = {}, eventId = `evt_${paymentId.slice(-1)}`) {
  return {
    id: eventId,
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: `cs_${paymentId.slice(-1)}`,
        payment_status: "paid",
        payment_intent: `pi_${paymentId.slice(-1)}`,
        amount_total: 20000,
        metadata: { quote_id: QUOTE, payment_id: paymentId, kind: "deposit" },
        ...over,
      },
    },
  };
}

const row = (id: string) => db.tables.catering_payments!.find((r) => r.id === id)!;
const ledger = (id: string) => db.tables.stripe_events!.find((r) => r.id === id)!;
const lastAuditMeta = () => auditMock.mock.calls.at(-1)![0].metadata as Record<string, unknown>;

beforeEach(() => {
  auditMock.mockClear();
  sendEmailMock.mockClear();
  notifyPaid.mockClear();
  db = paymentsFake({
    stripe_events: [],
    catering_quotes: [{ id: QUOTE, location_id: LOCATION, status: "sent", superseded_at: null, pipeline_id: null, event_date: "2099-06-01" }],
    catering_payments: [],
  });
});

describe("W02/B035 — a second payment on one quote is recorded AND flagged", () => {
  it("the full payment landing after the deposit is marked paid, with `paid_needs_review`", async () => {
    db.tables.catering_payments!.push(
      pay({ id: DEPOSIT, status: "paid", provider: "stripe", provider_ref: "pi_1" }),
      pay({ id: FULL, kind: "full", amount_cents: 100000 }),
    );

    const out = await processStripeEvent(db.client, completed(FULL, { amount_total: 100000 }), SINGLE, deps);

    expect(out.result).toBe("paid_needs_review");
    // The money is real, so the row says so — and carries the PaymentIntent a refund will name.
    expect(row(FULL)).toMatchObject({ status: "paid", provider: "stripe", provider_ref: "pi_2" });
    expect(ledger("evt_2").outcome).toBe("paid_needs_review");
    expect(lastAuditMeta()).toMatchObject({ needs_review: ["another_payment_already_paid"], row_moved: true });
    expect(notifyPaid).toHaveBeenCalledWith(expect.objectContaining({ paymentId: FULL, reviewReasons: ["another_payment_already_paid"] }));
  });

  it("a BALANCE landing after a DEPOSIT is the designed sequence and is NOT flagged", async () => {
    db.tables.catering_payments!.push(
      pay({ id: DEPOSIT, status: "paid", provider: "stripe", provider_ref: "pi_1" }),
      pay({ id: BALANCE, kind: "balance", amount_cents: 80000 }),
    );

    const out = await processStripeEvent(db.client, completed(BALANCE, { amount_total: 80000 }), SINGLE, deps);

    expect(out.result).toBe("paid");
    expect(lastAuditMeta().needs_review).toEqual([]);
    expect(notifyPaid).toHaveBeenCalledWith(expect.objectContaining({ reviewReasons: [] }));
  });

  it("the ordinary first payment is still plain `paid`", async () => {
    db.tables.catering_payments!.push(pay({ id: DEPOSIT }));
    const out = await processStripeEvent(db.client, completed(DEPOSIT), SINGLE, deps);
    expect(out.result).toBe("paid");
    expect(row(DEPOSIT).status).toBe("paid");
  });

  it("a charge that does not match the intent's amount is flagged — the row's amount is still not overwritten", async () => {
    db.tables.catering_payments!.push(pay({ id: DEPOSIT }));

    const out = await processStripeEvent(db.client, completed(DEPOSIT, { amount_total: 15000 }), SINGLE, deps);

    expect(out.result).toBe("paid_needs_review");
    expect(row(DEPOSIT)).toMatchObject({ status: "paid", amount_cents: 20000 });
    expect(lastAuditMeta()).toMatchObject({ needs_review: ["amount_mismatch"], amount_cents: 20000, event_amount_cents: 15000 });
  });

  it("money for a quote that is no longer open (superseded / declined / expired) is flagged", async () => {
    for (const over of [{ superseded_at: "2026-11-01T00:00:00.000Z" }, { status: "declined" }, { status: "expired" }]) {
      db.tables.catering_quotes = [{ id: QUOTE, location_id: LOCATION, status: "sent", superseded_at: null, ...over }];
      db.tables.catering_payments = [pay({ id: DEPOSIT })];
      db.tables.stripe_events = [];
      const out = await processStripeEvent(db.client, completed(DEPOSIT), SINGLE, deps);
      expect(out.result, JSON.stringify(over)).toBe("paid_needs_review");
      expect(lastAuditMeta().needs_review).toEqual(["quote_not_payable"]);
    }
  });
});

describe("W02/B035 — a payment closes the quote's other open intent", () => {
  it("the deposit landing VOIDS the due `full` intent", async () => {
    db.tables.catering_payments!.push(pay({ id: DEPOSIT }), pay({ id: FULL, kind: "full", amount_cents: 100000 }));

    const out = await processStripeEvent(db.client, completed(DEPOSIT), SINGLE, deps);

    expect(out.result).toBe("paid");
    expect(row(FULL).status).toBe("void");
    expect(lastAuditMeta().voided_sibling_ids).toEqual([FULL]);
  });

  it("the full payment landing VOIDS the due `deposit` intent", async () => {
    db.tables.catering_payments!.push(pay({ id: DEPOSIT }), pay({ id: FULL, kind: "full", amount_cents: 100000 }));
    await processStripeEvent(db.client, completed(FULL, { amount_total: 100000 }), SINGLE, deps);
    expect(row(DEPOSIT).status).toBe("void");
  });

  it("a due BALANCE intent is never voided by a deposit — it is the next step, not a duplicate", async () => {
    db.tables.catering_payments!.push(pay({ id: DEPOSIT }), pay({ id: BALANCE, kind: "balance", amount_cents: 80000 }));
    await processStripeEvent(db.client, completed(DEPOSIT), SINGLE, deps);
    expect(row(BALANCE).status).toBe("due");
  });

  it("another QUOTE's intents are never touched", async () => {
    db.tables.catering_payments!.push(pay({ id: DEPOSIT }), pay({ id: FULL, kind: "full", quote_id: "other-quote" }));
    await processStripeEvent(db.client, completed(DEPOSIT), SINGLE, deps);
    expect(row(FULL).status).toBe("due");
  });

  it("money that arrives on an intent we had VOIDED is still recorded, and flagged", async () => {
    // The deposit landed and voided the full intent; the customer then completes the full
    // checkout anyway (its session could not be retired in time).
    db.tables.catering_payments!.push(
      pay({ id: DEPOSIT, status: "paid", provider: "stripe", provider_ref: "pi_1" }),
      pay({ id: FULL, kind: "full", amount_cents: 100000, status: "void" }),
    );

    const out = await processStripeEvent(db.client, completed(FULL, { amount_total: 100000 }), SINGLE, deps);

    expect(out.result).toBe("paid_needs_review");
    expect(row(FULL)).toMatchObject({ status: "paid", provider_ref: "pi_2" });
    expect(lastAuditMeta().needs_review).toEqual(["intent_was_void", "another_payment_already_paid"]);
  });
});

describe("W02/B035 — a charge for an intent that was ALREADY settled another way", () => {
  it("staff marked the deposit paid by hand, then the customer paid it through Stripe: nothing to flip, loudly flagged", async () => {
    db.tables.catering_payments!.push(pay({ id: DEPOSIT, status: "paid", provider: "manual", provider_ref: null }));

    const out = await processStripeEvent(db.client, completed(DEPOSIT), SINGLE, deps);

    expect(out.result).toBe("paid_needs_review");
    // The row is NOT rewritten — a manual payment is its own fact.
    expect(row(DEPOSIT)).toMatchObject({ status: "paid", provider: "manual", provider_ref: null });
    expect(lastAuditMeta()).toMatchObject({ needs_review: ["already_settled"], row_moved: false, payment_intent_id: "pi_1" });
    expect(notifyPaid).toHaveBeenCalledWith(expect.objectContaining({ reviewReasons: ["already_settled"] }));
  });

  it("a second delivery about the SAME charge is still just `already_advanced` — no audit, no email", async () => {
    db.tables.catering_payments!.push(pay({ id: DEPOSIT, status: "paid", provider: "stripe", provider_ref: "pi_1" }));

    const out = await processStripeEvent(db.client, completed(DEPOSIT), SINGLE, deps);

    expect(out.result).toBe("already_advanced");
    expect(auditMock).not.toHaveBeenCalled();
    expect(notifyPaid).not.toHaveBeenCalled();
  });

  it("two deliveries racing on one charge: the loser re-reads the row and reports `already_advanced`", async () => {
    const r = pay({ id: DEPOSIT });
    db.tables.catering_payments!.push(r);
    // The loser read the row as `due`; the winner lands before the loser's guarded flip.
    const client = db.client as unknown as { from: (t: string) => Record<string, unknown> };
    const realFrom = client.from;
    let armed = true;
    client.from = (table: string) => {
      const q = realFrom(table);
      if (table === "catering_payments" && armed) {
        const update = q.update as (p: unknown, o?: unknown) => unknown;
        q.update = (p: unknown, o?: unknown) => {
          armed = false;
          Object.assign(r, { status: "paid", provider: "stripe", provider_ref: "pi_1" });
          return update(p, o);
        };
      }
      return q;
    };

    const out = await processStripeEvent(db.client, completed(DEPOSIT), SINGLE, deps);

    expect(out.result).toBe("already_advanced");
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("a REFUNDED intent that is somehow charged again is flagged too", async () => {
    db.tables.catering_payments!.push(pay({ id: DEPOSIT, status: "refunded", provider: "stripe", provider_ref: "pi_old" }));
    const out = await processStripeEvent(db.client, completed(DEPOSIT), SINGLE, deps);
    expect(out.result).toBe("paid_needs_review");
    expect(row(DEPOSIT).status).toBe("refunded");
    expect(lastAuditMeta().needs_review).toEqual(["already_settled"]);
  });
});

describe("W02/B035 — nothing after the flip may throw", () => {
  it("a failed read of the quote's other payments degrades to a reason: still paid, audited and notified", async () => {
    db.tables.catering_payments!.push(pay({ id: DEPOSIT }));
    // Reads, in order: payment by id, [flip], the sibling read. Fail only the sibling read.
    const client = db.client as unknown as { from: (t: string) => Record<string, unknown> };
    const realFrom = client.from;
    let paymentReads = 0;
    client.from = (table: string) => {
      const q = realFrom(table);
      if (table === "catering_payments") {
        const neq = q.neq as (c: string, v: unknown) => unknown;
        q.neq = (c: string, v: unknown) => {
          paymentReads += 1;
          db.failSelect.push("catering_payments");
          return neq(c, v);
        };
      }
      return q;
    };

    const out = await processStripeEvent(db.client, completed(DEPOSIT), SINGLE, deps);

    expect(paymentReads).toBe(1);
    expect(out.result).toBe("paid_needs_review");
    expect(row(DEPOSIT).status).toBe("paid");
    expect(lastAuditMeta().needs_review).toEqual(["sibling_check_failed"]);
    expect(notifyPaid).toHaveBeenCalledTimes(1);
    // NOT `processing_failed`: a retry would find the row paid and tell nobody.
    expect(ledger("evt_1").outcome).toBe("paid_needs_review");
  });
});

describe("W02/B035 — the staff notification says when a payment needs a look", () => {
  const withAssignee = () => {
    db.tables.catering_quotes = [{ id: QUOTE, location_id: LOCATION, status: "sent", superseded_at: null, pipeline_id: "lead-1", event_date: "2099-06-01" }];
    db.tables.catering_pipeline = [{ id: "lead-1", assigned_to: "user-1" }];
    db.tables.users = [{ id: "user-1", email: "manager@example.com", active: true }];
  };

  it("an ordinary payment keeps the ordinary subject", async () => {
    withAssignee();
    await notifyPaymentPaid(db.client, { paymentId: DEPOSIT, quoteId: QUOTE, locationId: LOCATION, kind: "deposit", amountCents: 20000, reviewReasons: [] });

    const mail = sendEmailMock.mock.calls[0]![0];
    expect(mail.to).toBe("manager@example.com");
    expect(mail.subject).toMatch(/\$200\.00 deposit payment received$/);
    expect(mail.text).not.toMatch(/needs review/i);
  });

  it("a flagged payment says so in the subject and names each reason in the body", async () => {
    withAssignee();
    await notifyPaymentPaid(db.client, {
      paymentId: FULL,
      quoteId: QUOTE,
      locationId: LOCATION,
      kind: "full",
      amountCents: 100000,
      reviewReasons: ["another_payment_already_paid", "amount_mismatch"],
    });

    const mail = sendEmailMock.mock.calls[0]![0];
    expect(mail.subject).toMatch(/NEEDS REVIEW/);
    expect(mail.text).toMatch(/already marked paid/i);
    expect(mail.text).toMatch(/refund/i);
    expect(mail.text).toMatch(/does not match/i);
    expect(mail.html).toMatch(/already marked paid/i);
  });
});

describe("W02 review r1 — a payment at a price the quote no longer asks for is flagged `amount_not_current`", () => {
  // An intent whose checkout could not be retired when the quote was re-priced keeps the
  // amount that checkout charges, so the row and the charge AGREE (`amount_mismatch` is
  // silent). The quote's own snapshot is what says the customer paid an older price.
  const withSnapshot = (deposit: number, total: number) => {
    Object.assign(db.tables.catering_quotes![0]!, { deposit_cents: deposit, total_cents: total });
  };

  it("a deposit charged at the quote's CURRENT deposit is an ordinary payment", async () => {
    withSnapshot(20000, 100000);
    db.tables.catering_payments!.push(pay({ id: DEPOSIT }));

    const out = await processStripeEvent(db.client, completed(DEPOSIT), SINGLE, deps);

    expect(out.result).toBe("paid");
    expect(lastAuditMeta().needs_review).toEqual([]);
  });

  it("a deposit charged at an OLDER deposit amount is recorded as charged, and flagged", async () => {
    withSnapshot(15000, 75000); // the quote was re-priced down; the open checkout was for $200
    db.tables.catering_payments!.push(pay({ id: DEPOSIT }));

    const out = await processStripeEvent(db.client, completed(DEPOSIT), SINGLE, deps);

    expect(out.result).toBe("paid_needs_review");
    expect(row(DEPOSIT)).toMatchObject({ status: "paid", amount_cents: 20000 });
    expect(lastAuditMeta()).toMatchObject({ needs_review: ["amount_not_current"], amount_cents: 20000, event_amount_cents: 20000 });
  });

  it("a FULL payment is weighed against the quote's total", async () => {
    withSnapshot(20000, 90000);
    db.tables.catering_payments!.push(pay({ id: FULL, kind: "full", amount_cents: 100000 }));

    const out = await processStripeEvent(db.client, completed(FULL, { amount_total: 100000 }), SINGLE, deps);

    expect(out.result).toBe("paid_needs_review");
    expect(lastAuditMeta().needs_review).toEqual(["amount_not_current"]);
  });

  it("a BALANCE has no snapshot to be weighed against and is never flagged for it", async () => {
    withSnapshot(20000, 100000);
    db.tables.catering_payments!.push(
      pay({ id: DEPOSIT, status: "paid", provider: "stripe", provider_ref: "pi_1" }),
      pay({ id: BALANCE, kind: "balance", amount_cents: 80000 }),
    );

    const out = await processStripeEvent(db.client, completed(BALANCE, { amount_total: 80000 }), SINGLE, deps);

    expect(out.result).toBe("paid");
  });

  it("the staff email has a plain sentence for it", async () => {
    Object.assign(db.tables.catering_quotes![0]!, { pipeline_id: "lead-1" });
    db.tables.catering_pipeline = [{ id: "lead-1", assigned_to: "user-1" }];
    db.tables.users = [{ id: "user-1", email: "manager@example.com", active: true }];
    await notifyPaymentPaid(db.client, { paymentId: DEPOSIT, quoteId: QUOTE, locationId: LOCATION, kind: "deposit", amountCents: 20000, reviewReasons: ["amount_not_current"] });

    const mail = sendEmailMock.mock.calls.at(-1)![0];
    expect(mail.subject).toMatch(/NEEDS REVIEW/);
    expect(mail.text).toMatch(/earlier price/i);
  });
});
