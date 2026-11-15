/**
 * Unit spine — A SETTLEMENT THAT WAS CUT OFF IS FINISHED BY ITS REDELIVERY (audit wave W02,
 * review r5 P1: "interrupted settlement cleanup is never retried").
 *
 * Recording a card payment is four steps: (1) flip the row to `paid`, (2) void the order's
 * other deposit / full intent, (3) close the order's other checkouts at Stripe, (4) stamp
 * the verdict on the event's ledger row. The function can die between any two. Stripe then
 * redelivers the event — and the redelivery used to find the row already paid by this same
 * charge, answer `already_advanced`, and stamp THAT. Steps 2 and 3 never ran: a full-amount
 * checkout stayed payable beside a paid deposit, and the ledger said the event was done.
 *
 * What is pinned here:
 *   - EVERY CUT POINT IS RESUMED. After the flip; after the sibling void; after Stripe
 *     retired a session but before its id was cleared; after the cleanup but before the
 *     stamp. In each, the redelivery ends with the sibling void, its checkout retired and
 *     its id cleared, and the ledger stamped `paid`.
 *   - …AS MANY TIMES AS IT TAKES. A redelivery that is itself cut off is resumed too.
 *   - NEVER STAMPED CLEAN WHILE SOMETHING IS OPEN. A resumed settlement that cannot confirm
 *     a checkout closed is `paid_needs_review` (`sibling_checkout_open`), the id stays on
 *     its row, and the staff email says so.
 *   - THE REPORT RIDES ON THE STAMP. The audit row and the staff email are written after the
 *     verdict, by the run whose stamp landed: a run that was cut off told nobody, the run
 *     that finishes tells them once, and a run that lost the stamp to a concurrent delivery
 *     stays quiet unless it found something to review.
 *   - A FIRST-SEEN EVENT IS NOT A RESUME. A different event about a charge that is already
 *     recorded is still the quiet `already_advanced`.
 *
 * "Cut off" is modelled as a statement that never answers (tests/payments-fake-client.ts
 * `beforeOp` → "cut"): the first delivery's promise stays pending for ever, exactly like a
 * function the platform killed. No DB, no network, no mail, no real Stripe.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/audit";
import { processStripeEvent, type StripeWebhookContext } from "@/lib/stripe/webhook";

import { paymentsFake, type PaymentsFake, type Row } from "./payments-fake-client";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async () => ({ id: "email_1" })),
  teamFrom: () => "Team <team@example.com>",
}));
const auditMock = vi.mocked(audit);

const QUOTE = "a0000000-0000-4000-8000-000000000001";
const LOCATION = "b0000000-0000-4000-8000-000000000001";
const DEPOSIT = "d0000000-0000-4000-8000-000000000001";
const FULL = "d0000000-0000-4000-8000-000000000002";

const SINGLE: StripeWebhookContext = { locationId: null, locationCode: null };

let db: PaymentsFake;
const notifyPaid = vi.fn(async () => {});
/** The shop's way to Stripe. Retiring an already-expired session answers `expired` again. */
const retireSession = vi.fn(async (): Promise<"expired" | "complete"> => "expired");
const deps = { notifyPaid, retireSession };

function pay(over: Row): Row {
  return {
    quote_id: QUOTE,
    kind: "deposit",
    amount_cents: 20000,
    status: "due",
    provider: null,
    provider_ref: null,
    provider_session_id: null,
    paid_at: null,
    ...over,
  };
}

/** `checkout.session.completed` (paid) for the DEPOSIT, through its own checkout `cs_dep`. */
const depositPaid = (eventId = "evt_1") => ({
  id: eventId,
  type: "checkout.session.completed",
  livemode: false,
  data: {
    object: {
      id: "cs_dep",
      payment_status: "paid",
      payment_intent: "pi_1",
      amount_total: 20000,
      metadata: { quote_id: QUOTE, payment_id: DEPOSIT, kind: "deposit" },
    },
  },
});

const row = (id: string) => db.tables.catering_payments!.find((r) => r.id === id)!;
const ledger = (id: string) => db.tables.stripe_events!.find((r) => r.id === id)!;
const auditMetas = () => auditMock.mock.calls.map((c) => c[0].metadata as Record<string, unknown>);

type Op = { table: string; kind: "select" | "insert" | "update"; payload: unknown };

/**
 * Start a delivery and KILL it at the first statement `at` matches: that statement never
 * answers, and the delivery's promise is left pending for ever. Resolves once the cut has
 * happened, with the hook removed so the next delivery runs free.
 */
function deliverAndCutOff(event: unknown, at: (op: Op) => boolean): Promise<void> {
  return new Promise<void>((cutHappened, failed) => {
    db.beforeOp = (op) => {
      if (!at(op)) return;
      db.beforeOp = null;
      cutHappened();
      return "cut";
    };
    processStripeEvent(db.client, event, SINGLE, deps).then(
      () => failed(new Error("the delivery finished — it was never cut off")),
      failed,
    );
  });
}

const isVoidWrite = (op: Op) => op.table === "catering_payments" && op.kind === "update" && (op.payload as Row).status === "void";
const isSessionClear = (op: Op) =>
  op.table === "catering_payments" && op.kind === "update" && (op.payload as Row).provider_session_id === null && !("status" in (op.payload as Row));
const isStamp = (op: Op) => op.table === "stripe_events" && op.kind === "update";
/** The first statement AFTER the sibling's void has landed. */
const afterSiblingVoid = () =>
  db.ops.some((o) => o.table === "catering_payments" && o.kind === "update" && (o.payload as Row | undefined)?.status === "void" && o.matched > 0);

/** The order is clean: the deposit is paid, the full intent is closed and so is its checkout. */
function expectSettledAndClean() {
  expect(row(DEPOSIT)).toMatchObject({ status: "paid", provider: "stripe", provider_ref: "pi_1" });
  expect(row(FULL)).toMatchObject({ status: "void", provider_session_id: null });
  expect(retireSession).toHaveBeenCalledWith("cs_full");
}

beforeEach(() => {
  auditMock.mockClear();
  notifyPaid.mockClear();
  retireSession.mockReset();
  retireSession.mockImplementation(async () => "expired");
  db = paymentsFake({
    stripe_events: [],
    catering_quotes: [
      {
        id: QUOTE,
        root_id: null,
        location_id: LOCATION,
        status: "sent",
        superseded_at: null,
        expires_at: "2099-01-01T00:00:00.000Z",
        deposit_cents: 20000,
        total_cents: 100000,
        pipeline_id: null,
        event_date: "2099-06-01",
      },
    ],
    // The customer has the deposit checkout open AND a full-amount checkout (attached in a
    // race, or left by a retire that failed). The deposit is what they pay.
    catering_payments: [
      pay({ id: DEPOSIT, provider: "stripe", provider_session_id: "cs_dep" }),
      pay({ id: FULL, kind: "full", amount_cents: 100000, provider: "stripe", provider_session_id: "cs_full" }),
    ],
  });
});

describe("W02 review r5 — a settlement cut off after the paid flip is finished by its redelivery", () => {
  it("cut off BETWEEN THE FLIP AND THE SIBLING VOID: the redelivery voids the full intent, retires its checkout and stamps `paid`", async () => {
    await deliverAndCutOff(depositPaid(), isVoidWrite);
    // What the dead delivery left: the money is recorded, and the full amount is still payable.
    expect(row(DEPOSIT)).toMatchObject({ status: "paid", provider_ref: "pi_1" });
    expect(row(FULL)).toMatchObject({ status: "due", provider_session_id: "cs_full" });
    expect(ledger("evt_1").outcome ?? null).toBeNull();
    expect(retireSession).not.toHaveBeenCalled();
    // …and nobody has been told anything yet.
    expect(auditMock).not.toHaveBeenCalled();
    expect(notifyPaid).not.toHaveBeenCalled();

    const out = await processStripeEvent(db.client, depositPaid(), SINGLE, deps);

    // The bug: `already_advanced`, stamped for good, with the full checkout still open.
    expect(out.result).toBe("paid");
    expectSettledAndClean();
    expect(ledger("evt_1").outcome).toBe("paid");
    // The redelivery is the run that tells people — once.
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMetas()[0]).toMatchObject({
      resumed: true,
      row_moved: true,
      stripe_event_id: "evt_1",
      needs_review: [],
      voided_sibling_ids: [FULL],
      closed_checkouts: { retired: [FULL], stillOpen: [], completing: [] },
    });
    expect(notifyPaid).toHaveBeenCalledTimes(1);
    expect(notifyPaid).toHaveBeenCalledWith(expect.objectContaining({ paymentId: DEPOSIT, amountCents: 20000, reviewReasons: [] }));
  });

  it("cut off BETWEEN THE SIBLING VOID AND THE CHECKOUT CLEANUP: the redelivery closes the voided intent's checkout", async () => {
    await deliverAndCutOff(depositPaid(), afterSiblingVoid);
    // Voiding is our bookkeeping: the hosted page is still payable, and its id says so.
    expect(row(FULL)).toMatchObject({ status: "void", provider_session_id: "cs_full" });
    expect(retireSession).not.toHaveBeenCalled();
    expect(ledger("evt_1").outcome ?? null).toBeNull();

    const out = await processStripeEvent(db.client, depositPaid(), SINGLE, deps);

    expect(out.result).toBe("paid");
    expectSettledAndClean();
    expect(ledger("evt_1").outcome).toBe("paid");
    expect(auditMetas()).toHaveLength(1);
    expect(auditMetas()[0]).toMatchObject({ resumed: true, closed_checkouts: { retired: [FULL], stillOpen: [], completing: [] } });
    expect(notifyPaid).toHaveBeenCalledTimes(1);
  });

  it("cut off MID-CLEANUP, after Stripe retired the checkout and before its id was cleared: the redelivery clears it", async () => {
    await deliverAndCutOff(depositPaid(), isSessionClear);
    expect(retireSession).toHaveBeenCalledTimes(1);
    expect(row(FULL)).toMatchObject({ status: "void", provider_session_id: "cs_full" });

    const out = await processStripeEvent(db.client, depositPaid(), SINGLE, deps);

    expect(out.result).toBe("paid");
    // Asked again — an expired session answers `expired` again — and this time cleared.
    expect(retireSession).toHaveBeenCalledTimes(2);
    expectSettledAndClean();
    expect(ledger("evt_1").outcome).toBe("paid");
  });

  it("cut off AFTER THE CLEANUP, BEFORE THE STAMP: nobody was told by the dead run, and the redelivery tells them exactly once", async () => {
    await deliverAndCutOff(depositPaid(), isStamp);
    expectSettledAndClean();
    expect(ledger("evt_1").outcome ?? null).toBeNull();
    // The report rides on the stamp: no stamp, no audit row, no email.
    expect(auditMock).not.toHaveBeenCalled();
    expect(notifyPaid).not.toHaveBeenCalled();

    const out = await processStripeEvent(db.client, depositPaid(), SINGLE, deps);

    expect(out.result).toBe("paid");
    expect(ledger("evt_1").outcome).toBe("paid");
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(notifyPaid).toHaveBeenCalledTimes(1);
    // Nothing was left to do, and nothing was done twice at Stripe's expense for nothing new.
    expect(auditMetas()[0]).toMatchObject({ resumed: true, voided_sibling_ids: [], closed_checkouts: { retired: [], stillOpen: [], completing: [] } });
  });

  it("a redelivery that is ITSELF cut off is resumed by the next one", async () => {
    await deliverAndCutOff(depositPaid(), isVoidWrite);
    await deliverAndCutOff(depositPaid(), isSessionClear);
    expect(row(FULL)).toMatchObject({ status: "void", provider_session_id: "cs_full" });
    expect(ledger("evt_1").outcome ?? null).toBeNull();
    expect(auditMock).not.toHaveBeenCalled();

    const out = await processStripeEvent(db.client, depositPaid(), SINGLE, deps);

    expect(out.result).toBe("paid");
    expectSettledAndClean();
    expect(ledger("evt_1").outcome).toBe("paid");
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(notifyPaid).toHaveBeenCalledTimes(1);
  });

  it("a redelivery after the event was stamped `processing_failed` resumes the same way", async () => {
    await deliverAndCutOff(depositPaid(), isVoidWrite);
    ledger("evt_1").outcome = "processing_failed";

    const out = await processStripeEvent(db.client, depositPaid(), SINGLE, deps);

    expect(out.result).toBe("paid");
    expectSettledAndClean();
    expect(ledger("evt_1").outcome).toBe("paid");
  });
});

describe("W02 review r5 — the ledger is never stamped clean over a checkout that may still be open", () => {
  it("a resumed settlement that CANNOT confirm the checkout closed is `paid_needs_review`, the id stays on its row, and the email says so", async () => {
    await deliverAndCutOff(depositPaid(), isVoidWrite);
    retireSession.mockRejectedValue(new Error("socket hang up"));

    const out = await processStripeEvent(db.client, depositPaid(), SINGLE, deps);

    expect(out.result).toBe("paid_needs_review");
    expect(ledger("evt_1").outcome).toBe("paid_needs_review");
    // Closed on our books, still an unresolved checkout: the pay path goes on refusing.
    expect(row(FULL)).toMatchObject({ status: "void", provider_session_id: "cs_full" });
    expect(auditMetas()[0]).toMatchObject({
      resumed: true,
      needs_review: ["sibling_checkout_open"],
      closed_checkouts: { retired: [], stillOpen: [FULL], completing: [] },
    });
    expect(notifyPaid).toHaveBeenCalledWith(expect.objectContaining({ reviewReasons: ["sibling_checkout_open"] }));
  });

  it("a resumed settlement judges the ORDER again: a second paid payment on it is still flagged", async () => {
    await deliverAndCutOff(depositPaid(), isVoidWrite);
    // While the first delivery was dead, the full amount was paid as well.
    Object.assign(row(FULL), { status: "paid", provider_ref: "pi_full" });

    const out = await processStripeEvent(db.client, depositPaid(), SINGLE, deps);

    expect(out.result).toBe("paid_needs_review");
    expect(auditMetas()[0]).toMatchObject({ resumed: true, needs_review: ["another_payment_already_paid"] });
  });

  it("a resumed settlement whose order could not be looked at is NOT stamped clean either", async () => {
    await deliverAndCutOff(depositPaid(), isStamp);
    // The redelivery reads the payment (1), re-reads it after its flip matched nothing (2),
    // reads the order's other payments (3) — and then CANNOT read them for the cleanup (4).
    let paymentReads = 0;
    db.beforeOp = (op) => {
      if (op.table === "catering_payments" && op.kind === "select" && ++paymentReads === 4) db.failSelect.push("catering_payments");
    };

    const out = await processStripeEvent(db.client, depositPaid(), SINGLE, deps);
    db.beforeOp = null;

    expect(out.result).toBe("paid_needs_review");
    expect(ledger("evt_1").outcome).toBe("paid_needs_review");
    expect(auditMetas()[0]).toMatchObject({ resumed: true, needs_review: ["sibling_checkout_open"], closed_checkouts: { stillOpen: [DEPOSIT] } });
  });
});

describe("W02 review r5 — the report rides on the stamp", () => {
  it("an UNINTERRUPTED delivery still audits and mails exactly once, after its verdict is on the ledger", async () => {
    let stampedWhenAudited: unknown = "never audited";
    auditMock.mockImplementationOnce(async () => {
      stampedWhenAudited = ledger("evt_1").outcome;
    });

    const out = await processStripeEvent(db.client, depositPaid(), SINGLE, deps);

    expect(out.result).toBe("paid");
    expect(stampedWhenAudited).toBe("paid");
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMetas()[0]).not.toHaveProperty("resumed");
    expect(notifyPaid).toHaveBeenCalledTimes(1);
  });

  it("two deliveries of one event at once: the run that LOSES the stamp, with nothing to review, stays quiet", async () => {
    // The other delivery flipped the row and is finishing; this one resumes beside it.
    await deliverAndCutOff(depositPaid(), isVoidWrite);
    db.beforeOp = (op) => {
      if (!isStamp(op)) return;
      db.beforeOp = null;
      ledger("evt_1").outcome = "paid"; // the other delivery's stamp lands first
    };

    const out = await processStripeEvent(db.client, depositPaid(), SINGLE, deps);

    expect(out.result).toBe("paid");
    expectSettledAndClean(); // the work is idempotent and was done
    expect(ledger("evt_1").outcome).toBe("paid");
    expect(auditMock).not.toHaveBeenCalled();
    expect(notifyPaid).not.toHaveBeenCalled();
  });

  it("…but a run that loses the stamp and FOUND SOMETHING TO REVIEW still says so", async () => {
    await deliverAndCutOff(depositPaid(), isVoidWrite);
    retireSession.mockRejectedValue(new Error("socket hang up"));
    db.beforeOp = (op) => {
      if (!isStamp(op)) return;
      db.beforeOp = null;
      ledger("evt_1").outcome = "paid";
    };

    const out = await processStripeEvent(db.client, depositPaid(), SINGLE, deps);

    expect(out.result).toBe("paid_needs_review");
    expect(auditMetas()[0]).toMatchObject({ needs_review: ["sibling_checkout_open"] });
    expect(notifyPaid).toHaveBeenCalledWith(expect.objectContaining({ reviewReasons: ["sibling_checkout_open"] }));
  });

  it("a stamp that FAILED is not a lost stamp: that run reports, because nobody else will", async () => {
    db.beforeOp = (op) => {
      if (!isStamp(op)) return;
      db.beforeOp = null;
      db.failUpdate.push("stripe_events");
    };

    const out = await processStripeEvent(db.client, depositPaid(), SINGLE, deps);

    expect(out.result).toBe("paid");
    expect(ledger("evt_1").outcome ?? null).toBeNull();
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(notifyPaid).toHaveBeenCalledTimes(1);
  });
});

describe("W02 review r5 — a first-seen event is not a resume", () => {
  it("a DIFFERENT event about a charge already on the row is the quiet `already_advanced`: its own event carries the settlement", async () => {
    await processStripeEvent(db.client, depositPaid("evt_1"), SINGLE, deps);
    auditMock.mockClear();
    notifyPaid.mockClear();
    retireSession.mockClear();

    const out = await processStripeEvent(db.client, depositPaid("evt_2"), SINGLE, deps);

    expect(out.result).toBe("already_advanced");
    expect(ledger("evt_2").outcome).toBe("already_advanced");
    expect(auditMock).not.toHaveBeenCalled();
    expect(notifyPaid).not.toHaveBeenCalled();
    expect(retireSession).not.toHaveBeenCalled();
  });

  it("a redelivery whose charge is on a row that has since been REFUNDED has nothing to resume", async () => {
    await deliverAndCutOff(depositPaid(), isStamp);
    row(DEPOSIT).status = "refunded";
    retireSession.mockClear();

    const out = await processStripeEvent(db.client, depositPaid(), SINGLE, deps);

    expect(out.result).toBe("already_advanced");
    expect(auditMock).not.toHaveBeenCalled();
    expect(retireSession).not.toHaveBeenCalled();
  });
});
