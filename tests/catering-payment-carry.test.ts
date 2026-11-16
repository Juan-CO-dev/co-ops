/**
 * Unit spine — `carryPaymentsToRevision` (lib/catering/payment-carry.ts), audit wave
 * W02/B006: when a quote is revised, the family's payments follow it onto the live
 * revision.
 *
 * Runs against tests/payments-fake-client.ts (predicate-aware, in memory, with the payment
 * unique indexes emulated). `retire` — the one Stripe call — is injected. No DB, no network.
 *
 * The END-TO-END reproduction of the bug (a customer who paid a deposit is asked to pay
 * again after a revise) is tests/catering-quote-revise-payments.test.ts; this file pins
 * what happens to each KIND of row, because that is where the money rules are.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  getServiceRoleClient: () => {
    throw new Error("carryPaymentsToRevision takes its client as a parameter");
  },
}));

import { carryPaymentsToRevision, retireSessionFor } from "@/lib/catering/payment-carry";
import { paymentsFake, type PaymentsFake, type Row } from "./payments-fake-client";

const V1 = "a0000000-0000-4000-8000-000000000001"; // the root
const V2 = "a0000000-0000-4000-8000-000000000002";
const V3 = "a0000000-0000-4000-8000-000000000003";
const OTHER = "a0000000-0000-4000-8000-0000000000ff"; // another family

let db: PaymentsFake;
let n = 0;

function pay(over: Row): Row {
  n += 1;
  return {
    id: `p${n}`,
    quote_id: V1,
    kind: "deposit",
    amount_cents: 20000,
    status: "due",
    provider: null,
    provider_ref: null,
    provider_session_id: null,
    created_at: new Date(Date.UTC(2026, 10, 1, 0, 0, n)).toISOString(),
    ...over,
  };
}
const row = (id: string) => db.tables.catering_payments!.find((r) => r.id === id)!;
const retireOk = vi.fn(async () => "expired" as const);

/** v1 superseded by v2 (the revision just created): deposit $250, total $1,200. */
const toV2 = { rootId: V1, newQuoteId: V2, depositCents: 25000, totalCents: 120000 };

beforeEach(() => {
  n = 0;
  retireOk.mockClear();
  db = paymentsFake({
    catering_quotes: [
      { id: V1, root_id: null, superseded_at: "2026-11-10T00:00:00.000Z" },
      { id: V2, root_id: V1, superseded_at: null },
      { id: OTHER, root_id: null, superseded_at: null },
    ],
    catering_payments: [],
    locations: [],
  });
});

describe("W02/B006 — money that was paid follows the quote", () => {
  it("a PAID deposit is re-pointed at the new revision, untouched otherwise", async () => {
    db.tables.catering_payments!.push(pay({ id: "dep", status: "paid", provider: "stripe", provider_ref: "pi_1", paid_at: "2026-11-02T00:00:00.000Z" }));

    const out = await carryPaymentsToRevision(db.client, toV2, retireOk);

    expect(row("dep")).toMatchObject({ quote_id: V2, status: "paid", amount_cents: 20000, provider_ref: "pi_1" });
    expect(out.moved).toEqual([{ paymentId: "dep", fromQuoteId: V1 }]);
    expect(out.voided).toEqual([]);
  });

  it("REFUNDED and VOID rows move too — the whole history lives on the live revision", async () => {
    db.tables.catering_payments!.push(pay({ id: "ref", status: "refunded" }), pay({ id: "void", kind: "full", status: "void" }));

    await carryPaymentsToRevision(db.client, toV2, retireOk);

    expect(row("ref")).toMatchObject({ quote_id: V2, status: "refunded" });
    expect(row("void")).toMatchObject({ quote_id: V2, status: "void" });
  });

  it("another FAMILY's payments are never touched", async () => {
    db.tables.catering_payments!.push(pay({ id: "mine", status: "paid" }), pay({ id: "theirs", quote_id: OTHER, status: "paid" }));

    await carryPaymentsToRevision(db.client, toV2, retireOk);

    expect(row("mine").quote_id).toBe(V2);
    expect(row("theirs").quote_id).toBe(OTHER);
  });

  it("a family with no payments writes nothing", async () => {
    const out = await carryPaymentsToRevision(db.client, toV2, retireOk);
    expect(out.moved).toEqual([]);
    expect(db.ops.filter((o) => o.kind === "update")).toEqual([]);
  });
});

describe("W02/B006 — an UNPAID intent is carried at the new price, or closed", () => {
  it("the due deposit of an unpaid order moves and is RE-PRICED to the new revision's deposit", async () => {
    db.tables.catering_payments!.push(pay({ id: "dep" }));

    const out = await carryPaymentsToRevision(db.client, toV2, retireOk);

    // Still `due` on the live revision, so the staff "Mark paid" seam and the customer's pay
    // button both find it — at what is owed NOW.
    expect(row("dep")).toMatchObject({ quote_id: V2, status: "due", amount_cents: 25000 });
    expect(out.carriedDue).toEqual([{ paymentId: "dep", kind: "deposit", fromCents: 20000, toCents: 25000 }]);
  });

  it("a due `full` intent is re-priced to the new TOTAL", async () => {
    db.tables.catering_payments!.push(pay({ id: "full", kind: "full", amount_cents: 100000 }));
    await carryPaymentsToRevision(db.client, toV2, retireOk);
    expect(row("full")).toMatchObject({ quote_id: V2, status: "due", amount_cents: 120000 });
  });

  it("once ANYTHING is paid, a stale due deposit/full intent is VOIDED — both are priced for an unpaid quote", async () => {
    db.tables.catering_payments!.push(
      pay({ id: "dep", status: "paid" }),
      pay({ id: "full", kind: "full", amount_cents: 100000 }),
    );

    const out = await carryPaymentsToRevision(db.client, toV2, retireOk);

    expect(row("dep")).toMatchObject({ quote_id: V2, status: "paid" });
    expect(row("full")).toMatchObject({ quote_id: V2, status: "void" });
    expect(out.voided).toEqual(["full"]);
    expect(out.carriedDue).toEqual([]);
  });

  it("a due BALANCE intent is voided: its amount was total − paid at the OLD total", async () => {
    db.tables.catering_payments!.push(pay({ id: "dep", status: "paid" }), pay({ id: "bal", kind: "balance", amount_cents: 80000 }));
    await carryPaymentsToRevision(db.client, toV2, retireOk);
    expect(row("bal")).toMatchObject({ quote_id: V2, status: "void" });
  });

  it("a deposit intent is voided when the new revision asks for NO deposit", async () => {
    db.tables.catering_payments!.push(pay({ id: "dep" }));
    await carryPaymentsToRevision(db.client, { ...toV2, depositCents: 0 }, retireOk);
    expect(row("dep")).toMatchObject({ quote_id: V2, status: "void" });
  });
});

describe("W02/B006 — the Checkout Session at the old amount is retired", () => {
  it("an open session is retired at Stripe and its id cleared from the carried intent", async () => {
    db.tables.catering_payments!.push(pay({ id: "dep", provider: "stripe", provider_session_id: "cs_old" }));

    const out = await carryPaymentsToRevision(db.client, toV2, retireOk);

    expect(retireOk).toHaveBeenCalledWith("cs_old");
    expect(row("dep")).toMatchObject({ quote_id: V2, status: "due", amount_cents: 25000, provider_session_id: null });
    expect(out.sessionsRetired).toBe(1);
    expect(out.sessionsNotRetired).toEqual([]);
  });

  it("if the session CANNOT be retired, the intent moves with the id AND ITS AMOUNT — an open checkout is never re-priced (review r1)", async () => {
    db.tables.catering_payments!.push(pay({ id: "dep", provider: "stripe", provider_session_id: "cs_old" }));
    const retireDown = vi.fn(async () => {
      throw new Error("stripe is down");
    });

    const out = await carryPaymentsToRevision(db.client, toV2, retireDown);

    // `cs_old` can still be paid at $200. The row must go on saying $200 — re-pricing it to
    // the revision's $250 is how a charge and its row came to disagree. The next pay tap
    // retires the session and only then re-prices (tests/catering-reprice-late-payment.test.ts).
    expect(row("dep")).toMatchObject({ quote_id: V2, status: "due", amount_cents: 20000, provider_session_id: "cs_old" });
    expect(out.moved).toEqual([{ paymentId: "dep", fromQuoteId: V1 }]);
    expect(out.carriedDue).toEqual([]);
    expect(out.sessionsNotRetired).toEqual(["dep"]);
  });

  it("a shop that cannot reach Stripe at all (retire = null) behaves the same way", async () => {
    db.tables.catering_payments!.push(pay({ id: "dep", provider: "stripe", provider_session_id: "cs_old" }));
    const out = await carryPaymentsToRevision(db.client, toV2, null);
    expect(row("dep")).toMatchObject({ quote_id: V2, amount_cents: 20000, provider_session_id: "cs_old" });
    expect(out.sessionsNotRetired).toEqual(["dep"]);
  });

  it("an intent with NO session is still re-priced when Stripe is unreachable — there is no checkout to disagree with", async () => {
    db.tables.catering_payments!.push(pay({ id: "dep" }));
    const out = await carryPaymentsToRevision(db.client, toV2, null);
    expect(row("dep")).toMatchObject({ quote_id: V2, status: "due", amount_cents: 25000 });
    expect(out.carriedDue).toEqual([{ paymentId: "dep", kind: "deposit", fromCents: 20000, toCents: 25000 }]);
  });

  it("a checkout that is already COMPLETE is left exactly as it is, on the live revision", async () => {
    db.tables.catering_payments!.push(
      pay({ id: "full", kind: "full", amount_cents: 100000 }),
      pay({ id: "dep", provider: "stripe", provider_session_id: "cs_paying" }),
    );
    const retire = vi.fn(async () => "complete" as const);

    const out = await carryPaymentsToRevision(db.client, toV2, retire);

    // Not re-priced, not voided, session id kept: the webhook is about to flip THIS row for
    // what the customer was actually charged.
    expect(row("dep")).toMatchObject({ quote_id: V2, status: "due", amount_cents: 20000, provider_session_id: "cs_paying" });
    expect(out.inFlight).toEqual(["dep"]);
    // …and the OTHER intent is closed, whichever order they were created in: a payment is landing.
    expect(row("full")).toMatchObject({ quote_id: V2, status: "void" });
  });

  it("a voided intent whose session could not be retired keeps the id, so a late payment is still findable", async () => {
    db.tables.catering_payments!.push(
      pay({ id: "dep", status: "paid" }),
      pay({ id: "full", kind: "full", provider: "stripe", provider_session_id: "cs_full" }),
    );
    await carryPaymentsToRevision(db.client, toV2, null);
    expect(row("full")).toMatchObject({ quote_id: V2, status: "void", provider_session_id: "cs_full" });
  });
});

describe("W02/B006 — it heals a family orphaned BEFORE this fix", () => {
  beforeEach(() => {
    // v1 → v2 → v3, where the v1→v2 revise left its payments behind on v1.
    db.tables.catering_quotes = [
      { id: V1, root_id: null, superseded_at: "2026-11-01T00:00:00.000Z" },
      { id: V2, root_id: V1, superseded_at: "2026-11-10T00:00:00.000Z" },
      { id: V3, root_id: V1, superseded_at: null },
    ];
  });
  const toV3 = { rootId: V1, newQuoteId: V3, depositCents: 25000, totalCents: 120000 };

  it("payments on EVERY earlier revision end up on the live one", async () => {
    db.tables.catering_payments!.push(pay({ id: "old-paid", quote_id: V1, status: "paid" }), pay({ id: "newer", quote_id: V2, kind: "balance", status: "paid", amount_cents: 80000 }));

    await carryPaymentsToRevision(db.client, toV3, retireOk);

    expect(row("old-paid").quote_id).toBe(V3);
    expect(row("newer").quote_id).toBe(V3);
  });

  it("two due deposits (one stranded on v1, one on v2): the NEWEST is carried, the other voided — never a 23505", async () => {
    db.tables.catering_payments!.push(pay({ id: "stranded", quote_id: V1 }), pay({ id: "current", quote_id: V2, amount_cents: 22000 }));

    const out = await carryPaymentsToRevision(db.client, toV3, retireOk);

    expect(row("current")).toMatchObject({ quote_id: V3, status: "due", amount_cents: 25000 });
    expect(row("stranded")).toMatchObject({ quote_id: V3, status: "void" });
    expect(out.voided).toEqual(["stranded"]);
  });

  it("running it twice changes nothing the second time", async () => {
    db.tables.catering_payments!.push(pay({ id: "dep", quote_id: V1 }), pay({ id: "paid", quote_id: V2, kind: "full", status: "refunded" }));
    await carryPaymentsToRevision(db.client, toV3, retireOk);
    const after = JSON.stringify(db.tables.catering_payments);

    const again = await carryPaymentsToRevision(db.client, toV3, retireOk);

    expect(again.moved).toEqual([]);
    expect(JSON.stringify(db.tables.catering_payments)).toBe(after);
  });

  it("a payment that was PAID on the live revision in the meantime is respected by a later pass", async () => {
    // A stranded due deposit on v1, and a deposit already paid on v3.
    db.tables.catering_payments!.push(pay({ id: "stranded", quote_id: V1 }), pay({ id: "paid-on-live", quote_id: V3, status: "paid" }));

    await carryPaymentsToRevision(db.client, toV3, retireOk);

    expect(row("stranded")).toMatchObject({ quote_id: V3, status: "void" });
  });
});

describe("W02/B006 — a payment that lands WHILE the quote is being revised", () => {
  /** The next write to catering_payments is preceded by `mutate()` — the webhook winning the race. */
  function beforeNextPaymentWrite(mutate: () => void) {
    const client = db.client as unknown as { from: (t: string) => Record<string, unknown> };
    const realFrom = client.from;
    let armed = true;
    client.from = (table: string) => {
      const q = realFrom(table);
      if (table === "catering_payments" && armed) {
        const update = q.update as (p: unknown, o?: unknown) => unknown;
        q.update = (p: unknown, o?: unknown) => {
          armed = false;
          mutate();
          return update(p, o);
        };
      }
      return q;
    };
  }

  it("a due intent the webhook PAID between our read and our write is not voided — and still MOVES", async () => {
    const r = pay({ id: "dep" });
    db.tables.catering_payments!.push(pay({ id: "anchor", kind: "full", status: "paid" }), r);
    // "anchor" is paid, so "dep" is headed for a void — but the webhook pays it first.
    beforeNextPaymentWrite(() => {
      r.status = "paid";
    });

    const out = await carryPaymentsToRevision(db.client, toV2, retireOk);

    // Left behind on v1 this would be the bug itself: money taken, nothing shown on the live quote.
    expect(row("dep")).toMatchObject({ quote_id: V2, status: "paid", amount_cents: 20000 });
    expect(out.voided).toEqual([]);
    expect(out.moved).toContainEqual({ paymentId: "dep", fromQuoteId: V1 });
  });

  it("an unpaid intent about to be RE-PRICED that gets paid first keeps the amount that was charged", async () => {
    const r = pay({ id: "dep" });
    db.tables.catering_payments!.push(r);
    beforeNextPaymentWrite(() => {
      r.status = "paid";
    });

    const out = await carryPaymentsToRevision(db.client, toV2, retireOk);

    expect(row("dep")).toMatchObject({ quote_id: V2, status: "paid", amount_cents: 20000 });
    expect(out.carriedDue).toEqual([]);
  });

  it("a COMPLETE checkout whose webhook lands mid-carry moves as the paid row it now is", async () => {
    const r = pay({ id: "dep", provider: "stripe", provider_session_id: "cs_paying" });
    db.tables.catering_payments!.push(r);
    beforeNextPaymentWrite(() => {
      r.status = "paid";
    });

    const out = await carryPaymentsToRevision(db.client, toV2, vi.fn(async () => "complete" as const));

    expect(row("dep")).toMatchObject({ quote_id: V2, status: "paid", provider_session_id: "cs_paying" });
    expect(out.inFlight).toEqual([]);
    expect(out.leftBehind).toEqual([]);
  });

  it("a PAID row that is refunded mid-carry still moves — a settled row moves whatever it has become", async () => {
    const r = pay({ id: "dep", status: "paid" });
    db.tables.catering_payments!.push(r);
    beforeNextPaymentWrite(() => {
      r.status = "refunded";
    });

    await carryPaymentsToRevision(db.client, toV2, retireOk);

    expect(row("dep")).toMatchObject({ quote_id: V2, status: "refunded" });
  });

  it("two COMPLETE checkouts of one kind (a double payment): one moves, the other is REPORTED, nothing throws", async () => {
    db.tables.catering_quotes = [
      { id: V1, root_id: null, superseded_at: "2026-11-01T00:00:00.000Z" },
      { id: V2, root_id: V1, superseded_at: "2026-11-10T00:00:00.000Z" },
      { id: V3, root_id: V1, superseded_at: null },
    ];
    db.tables.catering_payments!.push(
      pay({ id: "older", quote_id: V1, provider: "stripe", provider_session_id: "cs_a" }),
      pay({ id: "newer", quote_id: V2, provider: "stripe", provider_session_id: "cs_b" }),
    );

    const out = await carryPaymentsToRevision(
      db.client,
      { rootId: V1, newQuoteId: V3, depositCents: 25000, totalCents: 120000 },
      vi.fn(async () => "complete" as const),
    );

    // 0130 allows one due deposit per quote, so the second cannot join the first. It is not
    // voided or re-priced (the customer is paying it); the webhook flags it when it lands.
    expect(row("newer")).toMatchObject({ quote_id: V3, status: "due" });
    expect(row("older")).toMatchObject({ quote_id: V1, status: "due", provider_session_id: "cs_a" });
    expect(out.inFlight).toEqual(["newer"]);
    expect(out.leftBehind).toEqual(["older"]);
  });
});

describe("W02/B006 — retireSessionFor never guesses an account (W02/B146)", () => {
  it("an unreadable shop, a missing shop and a shop with no credentials all resolve to null", async () => {
    db.failSelect.push("locations");
    expect(await retireSessionFor(db.client, "loc-1")).toBeNull();
    expect(await retireSessionFor(db.client, "loc-1")).toBeNull(); // no such row
    db.tables.locations = [{ id: "loc-1", code: "EM" }];
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    vi.stubEnv("STRIPE_SECRET_KEY__EM", "");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET__EM", "");
    expect(await retireSessionFor(db.client, "loc-1")).toBeNull();
    vi.unstubAllEnvs();
  });

  it("a configured shop gets a function", async () => {
    db.tables.locations = [{ id: "loc-1", code: "EM" }];
    vi.stubEnv("STRIPE_SECRET_KEY__EM", "sk_test_fake");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET__EM", "whsec_test");
    expect(typeof (await retireSessionFor(db.client, "loc-1"))).toBe("function");
    vi.unstubAllEnvs();
  });
});
