/**
 * Unit spine — A SETTLEMENT THAT WAS CUT OFF IS FINISHED BY WHOEVER FINDS IT (audit wave W02,
 * review r5 P1: "interrupted settlement cleanup is never retried"; review r6 P1: "concurrent
 * deliveries can permanently skip settlement cleanup").
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
 *   - "IS THE CLEANUP STILL OWED?" IS A FACT ON THE PAYMENT ROW (review r6):
 *     `settlement_cleanup_at`, written once, only over a cleanup that is confirmed complete.
 *     Round r5 inferred it from which delivery had inserted the event's ledger row, and two
 *     OVERLAPPING deliveries broke that: A inserts the ledger row and pauses, B (a retry)
 *     flips the payment and dies before the cleanup, A resumes, is "not a redelivery", and
 *     stamps `already_advanced` — for good. Pinned here for every point B can die at, and
 *     for three deliveries, and for a second event about the same charge: whoever finds the
 *     charge on a row whose marker is NULL runs the settlement.
 *   - `already_advanced` MEANS THE CLEANUP IS RECORDED AS DONE. Never anything weaker.
 *   - THE REPORT RIDES ON THE MARKER. An ordinary payment's audit row and staff email are
 *     written right after the marker, by the run whose write landed: a run that was cut off
 *     before it told nobody, the run that finishes tells them once, and a run that lost the
 *     write to a concurrent one stays quiet. A payment that NEEDS REVIEW is told BEFORE the
 *     marker, by every run that finds it — a finding is never the thing a cut-off loses.
 *
 * "Cut off" is modelled as a statement that never answers (tests/payments-fake-client.ts
 * `beforeOp` → "cut"): the first delivery's promise stays pending for ever, exactly like a
 * function the platform killed. No DB, no network, no mail, no real Stripe.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/audit";
import { processStripeEvent, type StripeWebhookContext } from "@/lib/stripe/webhook";

import { paymentsFake, sameMigrationState, type PaymentsFake, type Row } from "./payments-fake-client";

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

/** Another connection to the same database: its own statements, the same rows. */
const connection = (): PaymentsFake => sameMigrationState(paymentsFake(db.tables), db);

/**
 * Start a delivery and KILL it at the first statement `at` matches: that statement never
 * answers, and the delivery's promise is left pending for ever. Resolves once the cut has
 * happened, with the hook removed so the next delivery runs free. `conn` = the connection
 * the delivery runs on (two deliveries at once each need their own).
 */
function deliverAndCutOff(event: unknown, at: (op: Op) => boolean, conn: PaymentsFake = db): Promise<void> {
  return new Promise<void>((cutHappened, failed) => {
    conn.beforeOp = (op) => {
      if (!at(op)) return;
      conn.beforeOp = null;
      cutHappened();
      return "cut";
    };
    processStripeEvent(conn.client, event, SINGLE, deps).then(
      () => failed(new Error("the delivery finished — it was never cut off")),
      failed,
    );
  });
}

/**
 * Start a delivery on its OWN connection and HOLD it at the first statement `at` matches:
 * everything before that statement has run, the statement itself waits. `reached` resolves
 * when it has got that far; `release()` lets it, and everything after it, run; `done` is the
 * delivery's own answer.
 */
function deliverAndHold(event: unknown, at: (op: Op) => boolean) {
  const conn = connection();
  let release!: () => void;
  let signalReached!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const reached = new Promise<void>((r) => (signalReached = r));
  conn.beforeOp = async (op) => {
    if (!at(op)) return;
    conn.beforeOp = null;
    signalReached();
    await gate;
  };
  const done = processStripeEvent(conn.client, event, SINGLE, deps);
  return { reached, release, done };
}

const isVoidWrite = (op: Op) => op.table === "catering_payments" && op.kind === "update" && (op.payload as Row).status === "void";
const isSessionClear = (op: Op) =>
  op.table === "catering_payments" && op.kind === "update" && (op.payload as Row).provider_session_id === null && !("status" in (op.payload as Row));
const isMarkerWrite = (op: Op) => op.table === "catering_payments" && op.kind === "update" && "settlement_cleanup_at" in (op.payload as Row);
const isStamp = (op: Op) => op.table === "stripe_events" && op.kind === "update";
/** The first statement a delivery issues about a PAYMENT: its ledger row is already inserted. */
const isFirstPaymentRead = (op: Op) => op.table === "catering_payments" && op.kind === "select";
/** The first statement AFTER the sibling's void has landed. */
const afterSiblingVoid = () => row(FULL).status === "void";
const marker = (id: string) => row(id).settlement_cleanup_at ?? null;

/** The order is clean: the deposit is paid, the full intent is closed and so is its checkout. */
function expectSettledAndClean() {
  expect(row(DEPOSIT)).toMatchObject({ status: "paid", provider: "stripe", provider_ref: "pi_1" });
  expect(row(FULL)).toMatchObject({ status: "void", provider_session_id: null });
  expect(retireSession).toHaveBeenCalledWith("cs_full");
}
/** …and the row SAYS so (review r6): the settlement's cleanup is recorded as done. */
function expectRecordedAsDone() {
  expectSettledAndClean();
  expect(marker(DEPOSIT)).toEqual(expect.any(String));
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
    expectRecordedAsDone();
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

  it("cut off AFTER THE CLEANUP, BEFORE IT WAS RECORDED AS DONE: nobody was told by the dead run, and the redelivery tells them exactly once", async () => {
    await deliverAndCutOff(depositPaid(), isMarkerWrite);
    expectSettledAndClean();
    expect(marker(DEPOSIT)).toBeNull();
    expect(ledger("evt_1").outcome ?? null).toBeNull();
    // The report rides on the marker: no marker, no audit row, no email.
    expect(auditMock).not.toHaveBeenCalled();
    expect(notifyPaid).not.toHaveBeenCalled();

    const out = await processStripeEvent(db.client, depositPaid(), SINGLE, deps);

    expect(out.result).toBe("paid");
    expect(ledger("evt_1").outcome).toBe("paid");
    expect(marker(DEPOSIT)).toEqual(expect.any(String));
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(notifyPaid).toHaveBeenCalledTimes(1);
    // Nothing was left to do, and nothing was done twice at Stripe's expense for nothing new.
    expect(auditMetas()[0]).toMatchObject({ resumed: true, voided_sibling_ids: [], closed_checkouts: { retired: [], stillOpen: [], completing: [] } });
  });

  it("cut off AFTER EVERYTHING BUT THE STAMP: the dead run had recorded the cleanup and told people — once — so the redelivery has nothing to do but close the event", async () => {
    await deliverAndCutOff(depositPaid(), isStamp);
    expectRecordedAsDone();
    expect(ledger("evt_1").outcome ?? null).toBeNull();
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMetas()[0]).not.toHaveProperty("resumed");
    expect(notifyPaid).toHaveBeenCalledTimes(1);
    retireSession.mockClear();

    const out = await processStripeEvent(db.client, depositPaid(), SINGLE, deps);

    // `already_advanced` now means exactly this: the charge is on its row AND its cleanup is
    // recorded as done. It is never said about a settlement nobody finished.
    expect(out.result).toBe("already_advanced");
    expect(ledger("evt_1").outcome).toBe("already_advanced");
    expect(retireSession).not.toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(notifyPaid).toHaveBeenCalledTimes(1);
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
    // …and nothing on the row says the settlement is finished: the next look tries again.
    expect(marker(DEPOSIT)).toBeNull();
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
    await deliverAndCutOff(depositPaid(), isVoidWrite);
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
    expect(marker(DEPOSIT)).toBeNull();
  });

  it("a sibling void that FAILED is unfinished cleanup: flagged, not recorded as done — and the next delivery voids it", async () => {
    db.beforeOp = (op) => {
      if (!isVoidWrite(op)) return;
      db.beforeOp = null;
      db.failUpdate.push("catering_payments");
    };

    const out = await processStripeEvent(db.client, depositPaid(), SINGLE, deps);

    // The full intent is still DUE on a quote with a paid deposit. That is told to a person…
    expect(out.result).toBe("paid_needs_review");
    expect(row(FULL).status).toBe("due");
    expect(auditMetas()[0]).toMatchObject({ needs_review: ["sibling_check_failed"], voided_sibling_ids: [] });
    // …and nothing says the settlement is finished.
    expect(marker(DEPOSIT)).toBeNull();

    // Any later delivery about this charge finishes it (here: another event for the same charge).
    const again = await processStripeEvent(db.client, depositPaid("evt_2"), SINGLE, deps);
    expect(again.result).toBe("paid");
    expect(row(FULL)).toMatchObject({ status: "void", provider_session_id: null });
    expect(marker(DEPOSIT)).toEqual(expect.any(String));
  });
});

describe("W02 review r5 / r6 — the report rides on the marker", () => {
  it("an UNINTERRUPTED delivery still audits and mails exactly once, after its cleanup is recorded on the row and before its event is closed", async () => {
    let seen: unknown = "never audited";
    auditMock.mockImplementationOnce(async () => {
      seen = { marker: marker(DEPOSIT), ledger: ledger("evt_1").outcome ?? null };
    });

    const out = await processStripeEvent(db.client, depositPaid(), SINGLE, deps);

    expect(out.result).toBe("paid");
    expect(seen).toEqual({ marker: expect.any(String), ledger: null });
    expect(ledger("evt_1").outcome).toBe("paid");
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMetas()[0]).not.toHaveProperty("resumed");
    expect(notifyPaid).toHaveBeenCalledTimes(1);
  });

  it("two deliveries of one event at once: the run that LOSES the marker, with nothing to review, stays quiet", async () => {
    // The other delivery flipped the row and is finishing; this one runs the settlement beside it.
    await deliverAndCutOff(depositPaid(), isVoidWrite);
    db.beforeOp = (op) => {
      if (!isMarkerWrite(op)) return;
      db.beforeOp = null;
      row(DEPOSIT).settlement_cleanup_at = "2026-11-01T00:00:00.000Z"; // the other delivery's marker lands first
    };

    const out = await processStripeEvent(db.client, depositPaid(), SINGLE, deps);

    expect(out.result).toBe("paid");
    expectSettledAndClean(); // the work is idempotent and was done
    expect(marker(DEPOSIT)).toBe("2026-11-01T00:00:00.000Z"); // written once, never rewritten
    expect(auditMock).not.toHaveBeenCalled();
    expect(notifyPaid).not.toHaveBeenCalled();
  });

  it("…but a run that FOUND SOMETHING TO REVIEW says so whatever any other run is doing", async () => {
    await deliverAndCutOff(depositPaid(), isVoidWrite);
    retireSession.mockRejectedValue(new Error("socket hang up"));
    db.beforeOp = (op) => {
      if (!isStamp(op)) return;
      db.beforeOp = null;
      ledger("evt_1").outcome = "paid"; // another delivery closes the event first
    };

    const out = await processStripeEvent(db.client, depositPaid(), SINGLE, deps);

    expect(out.result).toBe("paid_needs_review");
    expect(auditMetas()[0]).toMatchObject({ needs_review: ["sibling_checkout_open"] });
    expect(notifyPaid).toHaveBeenCalledWith(expect.objectContaining({ reviewReasons: ["sibling_checkout_open"] }));
  });

  it("a FINDING is told before the event is closed: a delivery cut off at its stamp had already said so, and the redelivery says so again", async () => {
    retireSession.mockRejectedValue(new Error("socket hang up"));

    await deliverAndCutOff(depositPaid(), isStamp);
    // The checkout could not be confirmed closed. That was reported BEFORE the stamp…
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMetas()[0]).toMatchObject({ needs_review: ["sibling_checkout_open"] });
    expect(auditMetas()[0]).not.toHaveProperty("resumed");
    expect(notifyPaid).toHaveBeenCalledTimes(1);
    expect(ledger("evt_1").outcome ?? null).toBeNull();

    // …and the event is still open, so its redelivery looks again and tells again.
    const out = await processStripeEvent(db.client, depositPaid(), SINGLE, deps);

    expect(out.result).toBe("paid_needs_review");
    expect(ledger("evt_1").outcome).toBe("paid_needs_review");
    expect(auditMock).toHaveBeenCalledTimes(2);
    expect(auditMetas()[1]).toMatchObject({ resumed: true, needs_review: ["sibling_checkout_open"] });
    expect(notifyPaid).toHaveBeenCalledTimes(2);
  });

  it("a marker write that FAILED is not a lost one: that run reports, because nobody else is known to — and the next delivery finds the cleanup still unrecorded", async () => {
    db.beforeOp = (op) => {
      if (!isMarkerWrite(op)) return;
      db.beforeOp = null;
      db.failUpdate.push("catering_payments");
    };

    const out = await processStripeEvent(db.client, depositPaid(), SINGLE, deps);

    expect(out.result).toBe("paid");
    expect(marker(DEPOSIT)).toBeNull();
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(notifyPaid).toHaveBeenCalledTimes(1);
  });

  it("a stamp that FAILED costs nothing: the cleanup is recorded and reported, and the redelivery only closes the event", async () => {
    db.beforeOp = (op) => {
      if (!isStamp(op)) return;
      db.beforeOp = null;
      db.failUpdate.push("stripe_events");
    };

    const out = await processStripeEvent(db.client, depositPaid(), SINGLE, deps);

    expect(out.result).toBe("paid");
    expect(ledger("evt_1").outcome ?? null).toBeNull();
    expectRecordedAsDone();
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(notifyPaid).toHaveBeenCalledTimes(1);

    const again = await processStripeEvent(db.client, depositPaid(), SINGLE, deps);
    expect(again.result).toBe("already_advanced");
    expect(auditMock).toHaveBeenCalledTimes(1);
  });
});

describe("W02 review r6 (P1) — two OVERLAPPING deliveries of one event, and one of them dies", () => {
  /**
   * The reviewer's sequence, for any point the second delivery can die at:
   *   A   inserts the ledger row, then pauses (before it has read the payment)
   *   B   a retry of the same event: flips the payment — and is cut off at `dies`
   *   A   resumes
   */
  async function overlap(dies: (op: Op) => boolean) {
    const a = deliverAndHold(depositPaid(), isFirstPaymentRead);
    await a.reached;
    expect(ledger("evt_1").outcome ?? null).toBeNull(); // A's ledger row is in, unstamped
    await deliverAndCutOff(depositPaid(), dies, connection());
    expect(row(DEPOSIT)).toMatchObject({ status: "paid", provider_ref: "pi_1" }); // B's flip landed
    a.release();
    return a.done;
  }

  it("THE REPORTED INTERLEAVING: B dies between its flip and the sibling void — A does NOT stamp `already_advanced`; it finishes the settlement", async () => {
    const a = deliverAndHold(depositPaid(), isFirstPaymentRead);
    await a.reached;
    await deliverAndCutOff(depositPaid(), isVoidWrite, connection());
    // What B left: the money recorded, the full amount still payable, nobody told, no marker.
    expect(row(FULL)).toMatchObject({ status: "due", provider_session_id: "cs_full" });
    expect(retireSession).not.toHaveBeenCalled();
    expect(marker(DEPOSIT)).toBeNull();
    expect(auditMock).not.toHaveBeenCalled();

    a.release();
    const out = await a.done;

    // The bug: `already_advanced`, terminal, the sibling still due with its session attached,
    // zero retirement calls — and every later retry a `duplicate`.
    expect(out.result).toBe("paid");
    expectRecordedAsDone();
    expect(ledger("evt_1").outcome).toBe("paid");
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMetas()[0]).toMatchObject({
      resumed: true,
      needs_review: [],
      voided_sibling_ids: [FULL],
      closed_checkouts: { retired: [FULL], stillOpen: [], completing: [] },
    });
    expect(notifyPaid).toHaveBeenCalledTimes(1);

    // Only NOW is a later retry a duplicate — over a settlement that is finished.
    const retry = await processStripeEvent(db.client, depositPaid(), SINGLE, deps);
    expect(retry.result).toBe("duplicate");
  });

  it.each([
    ["between its flip and the sibling void", isVoidWrite],
    ["between the sibling void and the checkout cleanup", afterSiblingVoid],
    ["mid-cleanup, after Stripe retired the checkout and before its id was cleared", isSessionClear],
    ["after the cleanup, before it was recorded as done", isMarkerWrite],
  ] as const)("B dies %s: A finishes — the sibling is void, its checkout closed, the cleanup recorded, one report, ledger `paid`", async (_where, dies) => {
    const out = await overlap(dies);

    expect(out.result).toBe("paid");
    expectRecordedAsDone();
    expect(ledger("evt_1").outcome).toBe("paid");
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMetas()[0]).toMatchObject({ resumed: true, needs_review: [] });
    expect(notifyPaid).toHaveBeenCalledTimes(1);
  });

  it("B dies only at its STAMP (it had finished, recorded and reported): A's `already_advanced` is now TRUE — nothing is left open and nobody is told twice", async () => {
    const out = await overlap(isStamp);

    expect(out.result).toBe("already_advanced");
    expectRecordedAsDone(); // …because B really had finished
    expect(ledger("evt_1").outcome).toBe("already_advanced");
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMetas()[0]).not.toHaveProperty("resumed");
    expect(notifyPaid).toHaveBeenCalledTimes(1);
  });

  it("B dies before the cleanup AND Stripe will not confirm the checkout closed for A: `paid_needs_review`, told, NOT recorded as done — and the next delivery still tries", async () => {
    retireSession.mockRejectedValue(new Error("socket hang up"));

    const out = await overlap(isVoidWrite);

    expect(out.result).toBe("paid_needs_review");
    expect(ledger("evt_1").outcome).toBe("paid_needs_review");
    expect(row(FULL)).toMatchObject({ status: "void", provider_session_id: "cs_full" }); // unresolved, on the record
    expect(marker(DEPOSIT)).toBeNull();
    expect(notifyPaid).toHaveBeenCalledWith(expect.objectContaining({ reviewReasons: ["sibling_checkout_open"] }));

    // A second event about the same charge (or anything else that looks) finishes it once Stripe answers.
    retireSession.mockImplementation(async () => "expired");
    const later = await processStripeEvent(db.client, depositPaid("evt_2"), SINGLE, deps);
    expect(later.result).toBe("paid");
    expectRecordedAsDone();
  });

  it("neither dies: both run the idempotent cleanup side by side — one marker, ONE report, the sibling closed once", async () => {
    // A is held just before it records the cleanup as done; B runs start to finish meanwhile.
    const a = deliverAndHold(depositPaid(), isMarkerWrite);
    await a.reached;
    expectSettledAndClean();
    expect(auditMock).not.toHaveBeenCalled();

    const b = await processStripeEvent(connection().client, depositPaid(), SINGLE, deps);
    // B found the charge on the row with no marker: it ran the settlement (nothing left to do),
    // recorded it and reported it.
    expect(b.result).toBe("paid");
    expect(marker(DEPOSIT)).toEqual(expect.any(String));
    expect(auditMock).toHaveBeenCalledTimes(1);
    const recorded = marker(DEPOSIT);

    a.release();
    const out = await a.done;

    expect(out.result).toBe("paid");
    expect(marker(DEPOSIT)).toBe(recorded); // A's write matched nothing
    expect(auditMock).toHaveBeenCalledTimes(1); // …so A stayed quiet
    expect(notifyPaid).toHaveBeenCalledTimes(1);
    expect(ledger("evt_1").outcome).toBe("paid");
  });

  it("THREE deliveries: A paused, B dies after its flip, C (another retry) finishes — then A resumes and finds it done", async () => {
    const a = deliverAndHold(depositPaid(), isFirstPaymentRead);
    await a.reached;
    await deliverAndCutOff(depositPaid(), isVoidWrite, connection());

    const c = await processStripeEvent(connection().client, depositPaid(), SINGLE, deps);
    expect(c.result).toBe("paid");
    expectRecordedAsDone();
    expect(ledger("evt_1").outcome).toBe("paid");

    a.release();
    const out = await a.done;

    expect(out.result).toBe("already_advanced");
    expect(ledger("evt_1").outcome).toBe("paid"); // the first terminal verdict stands
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(notifyPaid).toHaveBeenCalledTimes(1);
    expect(retireSession).toHaveBeenCalledTimes(1);
  });

  it("A DIFFERENT EVENT about the same charge arrives while the first event's delivery lies dead after its flip: it finishes the settlement too", async () => {
    await deliverAndCutOff(depositPaid("evt_1"), isVoidWrite);

    const other = await processStripeEvent(db.client, depositPaid("evt_2"), SINGLE, deps);

    expect(other.result).toBe("paid");
    expectRecordedAsDone();
    expect(ledger("evt_2").outcome).toBe("paid");
    expect(auditMetas()[0]).toMatchObject({ resumed: true, stripe_event_id: "evt_2" });
    // …and evt_1's own redelivery has nothing left to do, and tells nobody again.
    const redelivery = await processStripeEvent(db.client, depositPaid("evt_1"), SINGLE, deps);
    expect(redelivery.result).toBe("already_advanced");
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(notifyPaid).toHaveBeenCalledTimes(1);
  });

  it("WITHOUT migration 0303 (no marker column): the paid flip still lands; a delivery that then finds the charge on the row cannot read the marker and is RETRYABLE — never `already_advanced`", async () => {
    db.settlementMarkerColumn = false;

    const first = await processStripeEvent(db.client, depositPaid(), SINGLE, deps);
    // Money is recorded and the cleanup ran; only the marker could not be written — reported, because nobody else is known to.
    expect(first.result).toBe("paid");
    expectSettledAndClean();
    expect(auditMock).toHaveBeenCalledTimes(1);

    const other = await processStripeEvent(db.client, depositPaid("evt_2"), SINGLE, deps);
    expect(other.result).toBe("processing_failed"); // 500: Stripe delivers it again once 0303 is applied
    expect(ledger("evt_2").outcome).toBe("processing_failed");
  });
});

describe("W02 review r5 / r6 — `already_advanced` is only ever said about a finished settlement", () => {
  it("a DIFFERENT event about a charge already on the row, its cleanup recorded: the quiet `already_advanced`", async () => {
    await processStripeEvent(db.client, depositPaid("evt_1"), SINGLE, deps);
    expect(marker(DEPOSIT)).toEqual(expect.any(String));
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
    await deliverAndCutOff(depositPaid(), isVoidWrite);
    row(DEPOSIT).status = "refunded";
    retireSession.mockClear();

    const out = await processStripeEvent(db.client, depositPaid(), SINGLE, deps);

    expect(out.result).toBe("already_advanced");
    expect(auditMock).not.toHaveBeenCalled();
    expect(retireSession).not.toHaveBeenCalled();
  });
});
