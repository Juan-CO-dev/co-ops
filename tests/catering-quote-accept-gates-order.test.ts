/**
 * Unit spine — the ORDER of `setQuoteStatus`'s accept gates after audit waves W01 and W02
 * were merged (the header of `setQuoteStatus` in lib/catering/quotes.ts states the order).
 *
 * W02 added two gates to Accept: the family's payments must be on this revision
 * (`payments_unreconciled`, B006) and the offer must not have lapsed (`quote_expired`, B037).
 * W01 added a third: a self-serve delivery order is re-checked against the shop's current
 * zones (`delivery_unavailable` / `below_delivery_minimum` / `delivery_fee_changed`).
 * Each wave pinned its own gate alone. This file pins them TOGETHER, on one order that
 * trips several at once: which refusal the team sees, that every refusal still fires, and
 * that none of them writes the quote.
 *
 * `setQuoteStatus` reaches for the service client itself, so that one import is replaced
 * with tests/payments-fake-client.ts; `audit` and the Stripe client are mocked. No database,
 * no network, no Stripe.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { paymentsFake, type PaymentsFake, type Row } from "./payments-fake-client";

let db: PaymentsFake;

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => db.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/stripe/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe/client")>();
  return { ...actual, stripeCredentialsFor: vi.fn(() => null), retireCheckoutSession: vi.fn(async () => "expired") };
});

import { CateringQuoteError, setQuoteStatus } from "@/lib/catering/quotes";
import type { AuthContext } from "@/lib/session";

const V1 = "a0000000-0000-4000-8000-000000000001";
const V2 = "a0000000-0000-4000-8000-000000000002";
const LOCATION = "b0000000-0000-4000-8000-000000000001";
const ZONE = "d0000000-0000-4000-8000-000000000001";
const OTHER_ZONE = "d0000000-0000-4000-8000-000000000002";
const PAST = "2020-01-01T00:00:00.000Z";
const FUTURE = "2099-01-01T00:00:00.000Z";

const owner = { user: { id: "u1", role: "owner" }, locations: [LOCATION] } as unknown as AuthContext;

/** A self-serve DELIVERY order, in its window, carrying today's zone and fee: acceptable. */
const order = (over: Row = {}): Row => ({
  id: V2,
  root_id: null,
  location_id: LOCATION,
  status: "submitted",
  origin: "self_serve",
  superseded_at: null,
  expires_at: FUTURE,
  is_delivery: true,
  delivery_zone_id: ZONE,
  delivery_fee_cents: 2500,
  subtotal_cents: 100000,
  total_cents: 102500,
  deposit_cents: 25000,
  ...over,
});
const zone = (over: Row = {}): Row => ({ id: ZONE, location_id: LOCATION, active: true, fee_cents: 2500, min_order_cents: 50000, ...over });

/** The three ways the shop's zones can refuse this order today (W01), by the code each one names. */
const DELIVERY_REFUSALS: Array<{ code: string; zones: Row[] }> = [
  { code: "delivery_unavailable", zones: [] },
  { code: "delivery_unavailable", zones: [zone({ active: false })] },
  { code: "below_delivery_minimum", zones: [zone({ min_order_cents: 100001 })] },
  { code: "delivery_fee_changed", zones: [zone({ fee_cents: 3000 })] },
  { code: "delivery_fee_changed", zones: [zone({ id: OTHER_ZONE })] },
];

/**
 * A revision (V2) whose family still has a PAID deposit on the superseded V1 — what a failed
 * carry leaves behind (W02/B006). `stuck` makes the retry at the door fail too.
 */
function strandFamilyPayment(opts: { stuck: boolean }, v2: Row = {}): void {
  db.tables.catering_quotes = [
    order({ id: V1, superseded_at: "2026-01-01T00:00:00.000Z" }),
    order({ id: V2, root_id: V1, ...v2 }),
  ];
  db.tables.catering_payments = [
    { id: "p1", quote_id: V1, kind: "deposit", status: "paid", amount_cents: 25000, paid_at: "2019-12-31T00:00:00.000Z" },
  ];
  if (opts.stuck) db.failUpdate.push("catering_payments");
}

async function refusal(p: Promise<unknown>): Promise<CateringQuoteError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CateringQuoteError) return e;
    throw e;
  }
  throw new Error("expected a CateringQuoteError, but the call succeeded");
}
const quoteRow = (id: string = V2): Row => db.tables.catering_quotes!.find((q) => q.id === id)!;
const quoteWrites = () => db.ops.filter((o) => o.table === "catering_quotes" && o.kind === "update");

beforeEach(() => {
  db = paymentsFake({ catering_quotes: [order()], catering_delivery_zones: [zone()], catering_payments: [] });
});

describe("the baseline: an order every gate passes", () => {
  it("a self-serve delivery order in its window, on today's zone and fee, is accepted", async () => {
    await setQuoteStatus(owner, V2, "accepted");
    expect(quoteRow().status).toBe("accepted");
  });

  it("exactly AT the zone's minimum is accepted", async () => {
    db.tables.catering_delivery_zones = [zone({ min_order_cents: 100000 })];
    await setQuoteStatus(owner, V2, "accepted");
    expect(quoteRow().status).toBe("accepted");
  });
});

describe("gate 4 (W01) — every delivery refusal still fires on an otherwise acceptable order", () => {
  for (const { code, zones } of DELIVERY_REFUSALS) {
    it(`${code} (${JSON.stringify(zones.map((z) => ({ id: z.id === ZONE ? "same" : "other", active: z.active, fee: z.fee_cents, min: z.min_order_cents })))}): 409, and the order is not written`, async () => {
      db.tables.catering_delivery_zones = zones;

      const err = await refusal(setQuoteStatus(owner, V2, "accepted"));

      expect(err.status).toBe(409);
      expect(err.code).toBe(code);
      expect(quoteRow().status).toBe("submitted");
      expect(quoteWrites()).toEqual([]);
    });
  }

  it("a failed read of the zones refuses the accept rather than guessing", async () => {
    db.failSelect.push("catering_delivery_zones");
    await expect(setQuoteStatus(owner, V2, "accepted")).rejects.toThrow(/setQuoteStatus zones/);
    expect(quoteRow().status).toBe("submitted");
  });

  it("a staff-built delivery quote and a self-serve PICKUP are not re-judged (staff chose the zone; a pickup has none)", async () => {
    db.tables.catering_delivery_zones = [];

    db.tables.catering_quotes = [order({ origin: "staff", status: "sent" })];
    await setQuoteStatus(owner, V2, "accepted");
    expect(quoteRow().status).toBe("accepted");

    db.tables.catering_quotes = [order({ is_delivery: false, delivery_zone_id: null, delivery_fee_cents: 0 })];
    await setQuoteStatus(owner, V2, "accepted");
    expect(quoteRow().status).toBe("accepted");
  });
});

describe("gate 3 (W02/B037) before gate 4 — a LAPSED delivery order is told it expired, whatever the zones say", () => {
  for (const { code, zones } of DELIVERY_REFUSALS) {
    it(`lapsed + ${code} → quote_expired, and the zones are never read`, async () => {
      db.tables.catering_quotes = [order({ expires_at: PAST })];
      db.tables.catering_delivery_zones = zones;

      const err = await refusal(setQuoteStatus(owner, V2, "accepted"));

      expect(err.status).toBe(409);
      expect(err.code).toBe("quote_expired");
      expect(db.ops.filter((o) => o.table === "catering_delivery_zones")).toEqual([]);
      expect(quoteWrites()).toEqual([]);
    });
  }

  it("the manual `expired` status is refused the same way, before the zones", async () => {
    db.tables.catering_quotes = [order({ status: "expired" })];
    db.tables.catering_delivery_zones = [];
    expect((await refusal(setQuoteStatus(owner, V2, "accepted"))).code).toBe("quote_expired");
  });

  it("a lapsed order PAID IN TIME passes the clock (W02) and is then STILL held to the delivery re-check (W01)", async () => {
    const paidInTime = { id: "p1", quote_id: V2, kind: "deposit", status: "paid", amount_cents: 25000, paid_at: "2019-12-31T00:00:00.000Z" };

    // Zones moved since the order was placed: taken up in time, but not acceptable as priced.
    db.tables.catering_quotes = [order({ expires_at: PAST })];
    db.tables.catering_payments = [paidInTime];
    db.tables.catering_delivery_zones = [zone({ fee_cents: 3000 })];
    const err = await refusal(setQuoteStatus(owner, V2, "accepted"));
    expect(err.code).toBe("delivery_fee_changed");
    expect(quoteRow().status).toBe("submitted");

    // Zones unchanged: both gates pass and the order is confirmed.
    db.tables.catering_delivery_zones = [zone()];
    await setQuoteStatus(owner, V2, "accepted");
    expect(quoteRow().status).toBe("accepted");
  });

  it("…and one paid LATE stays quote_expired — the late payment does not reach the delivery gate", async () => {
    db.tables.catering_quotes = [order({ expires_at: PAST })];
    db.tables.catering_payments = [{ id: "p1", quote_id: V2, kind: "deposit", status: "paid", amount_cents: 25000, paid_at: "2020-01-02T00:00:00.000Z" }];
    db.tables.catering_delivery_zones = [zone({ fee_cents: 3000 })];
    expect((await refusal(setQuoteStatus(owner, V2, "accepted"))).code).toBe("quote_expired");
  });
});

describe("gate 2 (W02/B006) before gates 3 and 4 — stranded payments are named first", () => {
  it("stranded + lapsed + a delivery refusal → payments_unreconciled; the quote and the zones are untouched", async () => {
    strandFamilyPayment({ stuck: true }, { expires_at: PAST });
    db.tables.catering_delivery_zones = [];

    const err = await refusal(setQuoteStatus(owner, V2, "accepted"));

    expect(err.status).toBe(409);
    expect(err.code).toBe("payments_unreconciled");
    expect(db.tables.catering_payments![0]!.quote_id).toBe(V1);
    expect(db.ops.filter((o) => o.table === "catering_delivery_zones")).toEqual([]);
    expect(quoteWrites()).toEqual([]);
  });

  it("stranded but movable, then a delivery refusal: the deposit is healed onto the revision AND the accept is still refused by the zones", async () => {
    strandFamilyPayment({ stuck: false });
    db.tables.catering_delivery_zones = [zone({ min_order_cents: 100001 })];

    const err = await refusal(setQuoteStatus(owner, V2, "accepted"));

    expect(err.code).toBe("below_delivery_minimum");
    // The heal is not undone by the later refusal: the payment is where every reader looks.
    expect(db.tables.catering_payments![0]).toMatchObject({ quote_id: V2, status: "paid" });
    expect(quoteRow().status).toBe("submitted");
  });

  it("stranded but movable, LAPSED, paid in time: the healed deposit is what takes the offer up — then the zones decide", async () => {
    // Why gate 2 runs before gate 3: the clock asks "was anything paid on THIS quote id".
    strandFamilyPayment({ stuck: false }, { expires_at: PAST });

    await setQuoteStatus(owner, V2, "accepted");

    expect(quoteRow().status).toBe("accepted");
    expect(db.tables.catering_payments![0]!.quote_id).toBe(V2);
  });
});

describe("gate 1 and the exits that take no gate", () => {
  it("a SUPERSEDED revision is not_current before anything else — stranded, lapsed and undeliverable all at once", async () => {
    strandFamilyPayment({ stuck: true }, { expires_at: PAST });
    db.tables.catering_delivery_zones = [];

    const err = await refusal(setQuoteStatus(owner, V1, "accepted"));

    expect(err.status).toBe(409);
    expect(err.code).toBe("not_current");
    expect(db.ops.filter((o) => o.table === "catering_payments")).toEqual([]);
    expect(db.failUpdate).toEqual(["catering_payments"]); // the door was never tried
  });

  it("DECLINE and MARK EXPIRED pass none of the accept gates: stranded, lapsed and undeliverable, both still go through", async () => {
    for (const to of ["declined", "expired"] as const) {
      db = paymentsFake({ catering_quotes: [], catering_delivery_zones: [], catering_payments: [] });
      strandFamilyPayment({ stuck: true }, { expires_at: PAST });

      await setQuoteStatus(owner, V2, to);

      expect(quoteRow().status, to).toBe(to);
      expect(db.ops.filter((o) => o.table === "catering_payments" || o.table === "catering_delivery_zones"), to).toEqual([]);
    }
  });

  it("gate 5: a status that moved between the read and the write is status_changed, after every gate passed", async () => {
    db.beforeOp = (op) => {
      if (op.table === "catering_quotes" && op.kind === "update") {
        db.beforeOp = null;
        quoteRow().status = "declined";
      }
    };

    const err = await refusal(setQuoteStatus(owner, V2, "accepted"));

    expect(err.status).toBe(409);
    expect(err.code).toBe("status_changed");
    expect(quoteRow().status).toBe("declined");
  });
});
