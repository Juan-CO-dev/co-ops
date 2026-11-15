/**
 * Unit spine — `createPaymentDue` (lib/catering/payments.ts): the one insert both the
 * customer submit flow and the pay route use to raise a `due` intent (audit wave W02/B038).
 *
 * `catering_payments_one_due` (0130) allows ONE due intent per (quote, kind), and a second
 * insert is treated as idempotent: re-read the winner and return it. It returned the winner
 * AT ITS OLD AMOUNT — so an intent raised while an order was still being built was reused
 * at submit with a stale deposit, and that is what the customer was then charged.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  getServiceRoleClient: () => {
    throw new Error("createPaymentDue takes its client as a parameter");
  },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

import { createPaymentDue, syncDuePaymentAmount } from "@/lib/catering/payments";
import { paymentsFake } from "./payments-fake-client";

const QUOTE = "a0000000-0000-4000-8000-000000000001";
const CUSTOMER = "c0000000-0000-4000-8000-000000000001";

const input = (amountCents: number) => ({
  quoteId: QUOTE,
  customerId: CUSTOMER,
  kind: "deposit" as const,
  amountCents,
  createdBy: CUSTOMER,
});

describe("W02/B038 — createPaymentDue never hands back a due intent at a stale amount", () => {
  it("inserts a fresh due intent when there is none", async () => {
    const db = paymentsFake({ catering_payments: [] });
    const { id } = await createPaymentDue(db.client, input(20000));
    expect(db.tables.catering_payments).toEqual([
      expect.objectContaining({ id, quote_id: QUOTE, kind: "deposit", amount_cents: 20000, status: "due" }),
    ]);
  });

  it("the idempotent 23505 path re-prices the existing intent to the amount being asked for NOW", async () => {
    const db = paymentsFake({
      catering_payments: [{ id: "old", quote_id: QUOTE, kind: "deposit", amount_cents: 15000, status: "due" }],
    });

    const { id } = await createPaymentDue(db.client, input(20000));

    expect(id).toBe("old");
    expect(db.tables.catering_payments).toHaveLength(1);
    expect(db.tables.catering_payments![0]).toMatchObject({ amount_cents: 20000, status: "due" });
  });

  it("an existing intent already at that amount is returned untouched", async () => {
    const db = paymentsFake({
      catering_payments: [{ id: "old", quote_id: QUOTE, kind: "deposit", amount_cents: 20000, status: "due" }],
    });

    expect((await createPaymentDue(db.client, input(20000))).id).toBe("old");
    expect(db.ops.filter((o) => o.kind === "update")).toEqual([]);
  });

  it("a failed re-price throws — it does not return an intent it knows is wrong", async () => {
    const db = paymentsFake({
      catering_payments: [{ id: "old", quote_id: QUOTE, kind: "deposit", amount_cents: 15000, status: "due" }],
    });
    db.failUpdate.push("catering_payments");

    await expect(createPaymentDue(db.client, input(20000))).rejects.toThrow(/createPaymentDue/);
  });
});

describe("W02 review r1 — a due intent is never re-priced under an open checkout", () => {
  const open = () =>
    paymentsFake({
      catering_payments: [{ id: "old", quote_id: QUOTE, kind: "deposit", amount_cents: 30000, status: "due", provider_session_id: "cs_old" }],
    });

  it("syncDuePaymentAmount refuses a row that still points at a session, and writes nothing", async () => {
    const db = open();

    expect(await syncDuePaymentAmount(db.client, "old", 20000)).toBe(false);

    expect(db.tables.catering_payments![0]).toMatchObject({ amount_cents: 30000, provider_session_id: "cs_old" });
  });

  it("told which session the caller RETIRED, it writes the amount and clears the id in ONE update", async () => {
    const db = open();

    expect(await syncDuePaymentAmount(db.client, "old", 20000, "cs_old")).toBe(true);

    expect(db.tables.catering_payments![0]).toMatchObject({ amount_cents: 20000, provider_session_id: null });
    const writes = db.ops.filter((o) => o.kind === "update");
    expect(writes).toHaveLength(1);
    expect(writes[0]!.payload).toEqual({ amount_cents: 20000, provider_session_id: null });
  });

  it("…and refuses when the row now names a DIFFERENT session than the one retired", async () => {
    const db = open();
    db.tables.catering_payments![0]!.provider_session_id = "cs_newer";

    expect(await syncDuePaymentAmount(db.client, "old", 20000, "cs_old")).toBe(false);

    expect(db.tables.catering_payments![0]).toMatchObject({ amount_cents: 30000, provider_session_id: "cs_newer" });
  });

  it("createPaymentDue's idempotent path returns such an intent AS IT IS (the pay path retires, then re-prices)", async () => {
    const db = open();

    const out = await createPaymentDue(db.client, input(20000));

    expect(out.id).toBe("old");
    expect(db.tables.catering_payments![0]).toMatchObject({ amount_cents: 30000, provider_session_id: "cs_old" });
  });
});
