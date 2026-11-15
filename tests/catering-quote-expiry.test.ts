/**
 * Unit spine — `setQuoteStatus` and the clock (audit wave W02, B037).
 *
 * The staff board already hides Accept on a sent quote whose date has passed (`decidable`
 * in components/catering/quotes/QuotesClient.tsx reads `isExpired`). The SERVER did not:
 * a PATCH with `status: "accepted"` went through, so a lapsed offer could still be accepted
 * at its old price. This pins the server to the rule the board already shows.
 *
 * `setQuoteStatus` reaches for the service client itself, so that one import is replaced
 * with tests/payments-fake-client.ts and `audit` is mocked. No database, no network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { paymentsFake, type PaymentsFake, type Row } from "./payments-fake-client";

let db: PaymentsFake;

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => db.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

import { CateringQuoteError, setQuoteStatus } from "@/lib/catering/quotes";
import type { AuthContext } from "@/lib/session";

const QUOTE = "a0000000-0000-4000-8000-000000000001";
const LOCATION = "b0000000-0000-4000-8000-000000000001";
const PAST = "2020-01-01T00:00:00.000Z";
const FUTURE = "2099-01-01T00:00:00.000Z";

const owner = { user: { id: "u1", role: "owner" }, locations: [LOCATION] } as unknown as AuthContext;

const quote = (over: Row = {}): Row => ({
  id: QUOTE,
  location_id: LOCATION,
  status: "sent",
  superseded_at: null,
  expires_at: FUTURE,
  ...over,
});

async function refusal(p: Promise<unknown>): Promise<CateringQuoteError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CateringQuoteError) return e;
    throw e;
  }
  throw new Error("expected a CateringQuoteError, but the call succeeded");
}

beforeEach(() => {
  db = paymentsFake({ catering_quotes: [quote()] });
});

describe("W02/B037 — a quote past its date cannot be accepted", () => {
  it("accepting a SENT quote whose expires_at has passed is refused 409 quote_expired, and nothing is written", async () => {
    db.tables.catering_quotes = [quote({ expires_at: PAST })];

    const err = await refusal(setQuoteStatus(owner, QUOTE, "accepted"));

    expect(err.status).toBe(409);
    expect(err.code).toBe("quote_expired");
    expect(db.tables.catering_quotes![0]!.status).toBe("sent");
    expect(db.ops.filter((o) => o.kind === "update")).toEqual([]);
  });

  it("a sent quote inside its window is accepted as before", async () => {
    await setQuoteStatus(owner, QUOTE, "accepted");
    expect(db.tables.catering_quotes![0]!.status).toBe("accepted");
  });

  it("a quote with no expiry at all is accepted as before", async () => {
    db.tables.catering_quotes = [quote({ expires_at: null })];
    await setQuoteStatus(owner, QUOTE, "accepted");
    expect(db.tables.catering_quotes![0]!.status).toBe("accepted");
  });

  it("a lapsed quote can still be DECLINED or marked expired — only the accept is closed", async () => {
    db.tables.catering_quotes = [quote({ expires_at: PAST })];
    await setQuoteStatus(owner, QUOTE, "expired");
    expect(db.tables.catering_quotes![0]!.status).toBe("expired");

    db.tables.catering_quotes = [quote({ expires_at: PAST })];
    await setQuoteStatus(owner, QUOTE, "declined");
    expect(db.tables.catering_quotes![0]!.status).toBe("declined");
  });

  it("the manual `expired` → accepted block is unchanged", async () => {
    db.tables.catering_quotes = [quote({ status: "expired" })];
    expect((await refusal(setQuoteStatus(owner, QUOTE, "accepted"))).code).toBe("quote_expired");
  });
});

describe("W02/B037 (review r1) — a self-serve SUBMITTED order is an open offer on the same clock", () => {
  // `submitDraft` stamps the same 14-day `expires_at` on a submitted order that a sent quote
  // gets. The accept gate only read the clock for `sent`, so an expired submitted order could
  // be accepted — and `accepted` is not judged by the clock, so the portal then took payment
  // at the lapsed price. The gate now reads the ONE shared predicate (`quoteTimeExpired`).
  it("accepting a SUBMITTED order whose expires_at has passed is refused 409 quote_expired, and nothing is written", async () => {
    db.tables.catering_quotes = [quote({ status: "submitted", expires_at: PAST })];

    const err = await refusal(setQuoteStatus(owner, QUOTE, "accepted"));

    expect(err.status).toBe(409);
    expect(err.code).toBe("quote_expired");
    expect(db.tables.catering_quotes![0]!.status).toBe("submitted");
    expect(db.ops.filter((o) => o.kind === "update")).toEqual([]);
  });

  it("a submitted order inside its window is accepted as before", async () => {
    db.tables.catering_quotes = [quote({ status: "submitted" })];
    await setQuoteStatus(owner, QUOTE, "accepted");
    expect(db.tables.catering_quotes![0]!.status).toBe("accepted");
  });

  it("an offer the customer PAID toward is taken up, not expired: it can still be confirmed after its date", async () => {
    // The same reading the customer's own order list makes (lib/portal/account.ts rule 6):
    // a deposit paid inside the window took the offer up in time. The portal cannot take a
    // second payment on it (the already-paid gate), so confirming it re-opens nothing.
    db.tables.catering_quotes = [quote({ status: "submitted", expires_at: PAST })];
    db.tables.catering_payments = [{ id: "p1", quote_id: QUOTE, kind: "deposit", status: "paid", amount_cents: 20000 }];

    await setQuoteStatus(owner, QUOTE, "accepted");

    expect(db.tables.catering_quotes![0]!.status).toBe("accepted");
  });

  it("…but a payment that is only DUE, void or refunded took nothing up — the lapsed order stays closed", async () => {
    for (const status of ["due", "void", "refunded"]) {
      db.tables.catering_quotes = [quote({ status: "submitted", expires_at: PAST })];
      db.tables.catering_payments = [{ id: "p1", quote_id: QUOTE, kind: "deposit", status, amount_cents: 20000 }];
      expect((await refusal(setQuoteStatus(owner, QUOTE, "accepted"))).code, status).toBe("quote_expired");
    }
  });

  it("a failed read of the payments refuses the accept rather than guessing", async () => {
    db.tables.catering_quotes = [quote({ status: "submitted", expires_at: PAST })];
    db.tables.catering_payments = [];
    db.failSelect.push("catering_payments");

    await expect(setQuoteStatus(owner, QUOTE, "accepted")).rejects.toThrow(/setQuoteStatus payments/);
    expect(db.tables.catering_quotes![0]!.status).toBe("submitted");
  });
});
