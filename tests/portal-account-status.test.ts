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
