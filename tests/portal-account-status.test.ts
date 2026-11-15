/**
 * Unit spine — `customerOrderStatus` (lib/portal/account.ts): what the customer's account
 * list tells them to do next (audit wave W02, B037 + B039).
 *
 * `customerOrderStatus` is pure; the module around it is not (it imports the service
 * client), so that one import is replaced and nothing here ever reaches a database.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  getServiceRoleClient: () => {
    throw new Error("customerOrderStatus must not touch the database");
  },
}));

import { customerOrderStatus, type PortalQuote } from "@/lib/portal/account";
import type { Payment } from "@/lib/catering/payments";
import { quoteSettlement } from "@/lib/portal/payability-shared";

function quote(over: Partial<PortalQuote> = {}): PortalQuote {
  return {
    origin: "staff",
    id: "q1",
    status: "sent",
    isExpired: false,
    supersededAt: null,
    expiresAt: null,
    totalCents: 100000,
    depositCents: 20000,
    ...over,
  } as PortalQuote;
}

function payment(kind: Payment["kind"], status: Payment["status"], amountCents = 20000): Payment {
  return {
    id: `${kind}-${status}`,
    quoteId: "q1",
    customerId: null,
    kind,
    amountCents,
    currency: "usd",
    status,
    provider: null,
    providerRef: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    paidAt: status === "paid" ? "2026-11-02T00:00:00.000Z" : null,
    createdBy: null,
  };
}

describe("W02/B037 — an offer past its date is not presented as payable", () => {
  it("a sent quote past its expires_at reads `expired`, with no pay call to action", () => {
    const s = customerOrderStatus(quote({ status: "sent", isExpired: true }), []);
    expect(s.key).toBe("expired");
    expect(s.payable).toBe(false);
  });

  it("a self-serve order past its window reads `expired` too", () => {
    const s = customerOrderStatus(quote({ origin: "self_serve", status: "submitted", isExpired: true }), [payment("deposit", "due")]);
    expect(s.key).toBe("expired");
    expect(s.payable).toBe(false);
  });

  it("a deposit paid inside the window keeps the order `pending` after the date passes — it was taken up in time", () => {
    const s = customerOrderStatus(quote({ status: "sent", isExpired: true }), [payment("deposit", "paid")]);
    expect(s.key).toBe("pending");
  });

  it("an offer still inside its window is unchanged", () => {
    expect(customerOrderStatus(quote({ origin: "self_serve", status: "submitted" }), []).key).toBe("reserve");
    expect(customerOrderStatus(quote({ status: "sent" }), []).key).toBe("review");
    expect(customerOrderStatus(quote({ status: "sent" }), []).payable).toBe(true);
  });

  it("the manual `expired` and `declined` statuses are unchanged", () => {
    expect(customerOrderStatus(quote({ status: "expired" }), []).key).toBe("expired");
    expect(customerOrderStatus(quote({ status: "declined" }), []).key).toBe("declined");
  });
});

describe("W02/B039 — `balance due` never offers a pay button the portal cannot honour", () => {
  // Nothing in the codebase raises a `balance` intent, and the pay route accepts only
  // `deposit` and `full`. Once a deposit is paid, "Review & pay" led to a page with no pay
  // panel, and a hand-rolled POST was refused (`invalid_kind` / `already_paid`).
  it("confirmed with the deposit paid: still `balance_due`, but NOT payable from the portal", () => {
    const s = customerOrderStatus(quote({ status: "accepted" }), [payment("deposit", "paid")]);
    expect(s.key).toBe("balance_due");
    expect(s.payable).toBe(false);
    // Not an "action" badge either: there is no action the customer can take here.
    expect(s.tone).toBe("pending");
  });

  it("confirmed with NOTHING paid: the portal can still take the deposit or the full amount, so it stays payable", () => {
    const s = customerOrderStatus(quote({ status: "accepted" }), []);
    expect(s.key).toBe("balance_due");
    expect(s.payable).toBe(true);
    expect(s.tone).toBe("action");
  });

  it("a due (unpaid) intent does not count as a payment", () => {
    expect(customerOrderStatus(quote({ status: "accepted" }), [payment("deposit", "due")]).payable).toBe(true);
  });

  it("a refunded deposit re-opens the portal's own options", () => {
    expect(customerOrderStatus(quote({ status: "accepted" }), [payment("deposit", "refunded")]).payable).toBe(true);
  });

  it("fully paid orders are unchanged", () => {
    expect(customerOrderStatus(quote({ status: "accepted" }), [payment("full", "paid", 100000)]).key).toBe("paid");
    expect(
      customerOrderStatus(quote({ status: "accepted" }), [payment("deposit", "paid"), payment("balance", "paid", 80000)]).key,
    ).toBe("paid");
  });
});

describe("W02 review r2 (P2) — settled means the MONEY covers the current total, not that a row is called `full`", () => {
  // A quote paid in full at $1,000 is revised to $1,200. The payment follows the order onto
  // the new revision (B006) and keeps its history: kind `full`, $1,000. "A paid `full` row
  // exists" then read as "All set" with $200 outstanding.
  const revised = (over: Partial<PortalQuote> = {}) => quote({ totalCents: 120000, depositCents: 30000, ...over });
  const carriedFull = payment("full", "paid", 100000);

  it("the pure rule: paid is the sum of PAID rows, outstanding is what the current total still asks for", () => {
    expect(quoteSettlement(120000, [carriedFull])).toEqual({ paidCents: 100000, outstandingCents: 20000, settled: false });
    expect(quoteSettlement(100000, [carriedFull])).toEqual({ paidCents: 100000, outstandingCents: 0, settled: true });
    // Due, void and refunded rows are not money held.
    expect(
      quoteSettlement(100000, [payment("deposit", "due"), payment("full", "void", 100000), payment("balance", "refunded", 80000)]),
    ).toEqual({ paidCents: 0, outstandingCents: 100000, settled: false });
    // Nothing paid is never "settled" — not even on a zero-total quote.
    expect(quoteSettlement(0, []).settled).toBe(false);
    // A total that came DOWN after payment is covered (any refund is the team's call).
    expect(quoteSettlement(90000, [carriedFull])).toEqual({ paidCents: 100000, outstandingCents: 0, settled: true });
  });

  it("revise-after-full-payment: the order is NOT `paid` — $200 is still owed", () => {
    const s = customerOrderStatus(revised({ status: "sent" }), [carriedFull]);
    expect(s.key).not.toBe("paid");
    expect(s.key).toBe("pending");
    expect(s.balanceDueCents).toBe(20000);
  });

  it("…and it does not offer a second full charge: no pay call to action, before or after the team confirms", () => {
    const sent = customerOrderStatus(revised({ status: "sent" }), [carriedFull]);
    expect(sent.payable).toBe(false);
    const accepted = customerOrderStatus(revised({ status: "accepted" }), [carriedFull]);
    expect(accepted.key).toBe("balance_due");
    expect(accepted.payable).toBe(false);
    expect(accepted.tone).toBe("pending");
    expect(accepted.balanceDueCents).toBe(20000);
  });

  it("the badge does not call a part-payment a deposit when it was a full payment at the old total", () => {
    expect(customerOrderStatus(revised({ status: "sent" }), [carriedFull]).label).not.toMatch(/deposit/i);
    // A real deposit still reads as one.
    expect(customerOrderStatus(revised({ status: "sent" }), [payment("deposit", "paid", 30000)]).label).toMatch(/deposit/i);
  });

  it("a deposit + balance that no longer add up to the total is not `paid` either", () => {
    const s = customerOrderStatus(revised({ status: "accepted" }), [payment("deposit", "paid", 20000), payment("balance", "paid", 80000)]);
    expect(s.key).toBe("balance_due");
    expect(s.balanceDueCents).toBe(20000);
  });

  it("a full payment that covers the current total is still `paid`, with nothing owed", () => {
    const s = customerOrderStatus(revised({ status: "accepted" }), [payment("full", "paid", 120000)]);
    expect(s.key).toBe("paid");
    expect(s.balanceDueCents).toBe(0);
  });

  it("an order nobody has paid toward reports no balance line — the card already shows its total", () => {
    expect(customerOrderStatus(revised({ status: "sent" }), []).balanceDueCents).toBe(0);
    expect(customerOrderStatus(revised({ status: "declined" }), [carriedFull]).balanceDueCents).toBe(0);
  });
});

describe("W02 review r3 (P2) — a payment settled AFTER the offer expired is not `All set`", () => {
  // A full-payment checkout opened before the offer's date and completed after it. The
  // webhook records the money and flags it (`paid_after_expiry`); the staff accept refuses
  // the lapsed offer (`offerTakenUpInTime`). The customer's list said "All set 🎉".
  const DEADLINE = "2026-11-10T12:00:00.000Z";
  const lapsed = (over: Partial<PortalQuote> = {}) => quote({ status: "sent", isExpired: true, expiresAt: DEADLINE, ...over });
  const paidAt = (kind: Payment["kind"], amountCents: number, at: string | null): Payment => ({
    ...payment(kind, "paid", amountCents),
    paidAt: at,
  });
  const LATE = "2026-11-10T12:05:00.000Z";
  const IN_TIME = "2026-11-10T11:55:00.000Z";

  it("a full payment that landed five minutes late: received, awaiting our review — never `paid`", () => {
    const s = customerOrderStatus(lapsed(), [paidAt("full", 100000, LATE)]);
    expect(s.key).toBe("late_payment");
    expect(s.label).not.toMatch(/all set/i);
    expect(s.label).toMatch(/received/i);
    expect(s.label).toMatch(/review/i);
    expect(s.labelKey).toBe("order.account.status_late_payment");
    expect(s.tone).toBe("pending");
    expect(s.payable).toBe(false);
  });

  it("a late DEPOSIT is not `pending our confirmation` either — the team cannot confirm a lapsed offer on it", () => {
    const s = customerOrderStatus(lapsed(), [paidAt("deposit", 20000, LATE)]);
    expect(s.key).toBe("late_payment");
    expect(s.payable).toBe(false);
  });

  it("a self-serve SUBMITTED order is on the same clock", () => {
    const s = customerOrderStatus(lapsed({ origin: "self_serve", status: "submitted" }), [paidAt("deposit", 20000, LATE)]);
    expect(s.key).toBe("late_payment");
  });

  it("a payment that cannot say when it was paid proves nothing: late", () => {
    expect(customerOrderStatus(lapsed(), [paidAt("full", 100000, null)]).key).toBe("late_payment");
  });

  it("the SAME payment settled in time is unchanged: all set, or pending our confirmation", () => {
    expect(customerOrderStatus(lapsed(), [paidAt("full", 100000, IN_TIME)]).key).toBe("paid");
    expect(customerOrderStatus(lapsed(), [paidAt("deposit", 20000, IN_TIME)]).key).toBe("pending");
  });

  it("an in-time deposit keeps its standing when a second payment lands late", () => {
    const s = customerOrderStatus(lapsed(), [paidAt("deposit", 20000, IN_TIME), paidAt("balance", 80000, LATE)]);
    expect(s.key).toBe("paid");
  });

  it("an order the team CONFIRMED is off the offer's clock: a payment after the old date is an ordinary one", () => {
    const s = customerOrderStatus(quote({ status: "accepted", isExpired: false, expiresAt: DEADLINE }), [paidAt("full", 100000, LATE)]);
    expect(s.key).toBe("paid");
  });

  it("a quote marked expired BY HAND that was then paid is received-and-under-review too, not a bare `Expired`", () => {
    const s = customerOrderStatus(quote({ status: "expired", expiresAt: DEADLINE }), [paidAt("full", 100000, LATE)]);
    expect(s.key).toBe("late_payment");
    // …while one nobody paid, or one paid before its date, is still just expired.
    expect(customerOrderStatus(quote({ status: "expired", expiresAt: DEADLINE }), []).key).toBe("expired");
    expect(customerOrderStatus(quote({ status: "expired", expiresAt: DEADLINE }), [paidAt("deposit", 20000, IN_TIME)]).key).toBe("expired");
  });

  it("no balance is promised on a lapsed offer: what was received is shown, the rest is the team's decision", () => {
    expect(customerOrderStatus(lapsed(), [paidAt("deposit", 20000, LATE)]).balanceDueCents).toBe(0);
  });

  it("a declined quote is still `declined`", () => {
    expect(customerOrderStatus(lapsed({ status: "declined" }), [paidAt("full", 100000, LATE)]).key).toBe("declined");
  });
});
