/**
 * Unit spine — lib/portal/payability-shared.ts (audit wave W02, B037 + B038).
 *
 * "May the customer still pay this quote?" is ONE pure rule read by three surfaces: the
 * server gate (`loadPayableQuote`), the quote page's pay panel, and the account list's
 * call to action. These tests pin the rule itself; tests/portal-quote-payments.test.ts
 * pins that the server gate obeys it, and the source pins below prove the page and the
 * account status read the same function rather than a private copy.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { paidOnLapsedOffer, payPanelState, quotePayability, quoteTimeExpired } from "@/lib/portal/payability-shared";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const NOW = Date.parse("2026-11-14T12:00:00.000Z");
const PAST = "2026-11-13T12:00:00.000Z";
const FUTURE = "2026-11-15T12:00:00.000Z";

/** The panel's two payment facts, as the page passes them: the offer's deadline and the rows. */
const unpaid = { expiresAt: PAST, payments: [] as Array<{ status: string; paidAt: string | null }> };
/** Paid the day BEFORE the deadline (`PAST`): the offer was taken up in time. */
const paidInTime = { expiresAt: PAST, payments: [{ status: "paid", paidAt: "2026-11-12T12:00:00.000Z" }] };
/** Paid an hour AFTER the deadline: money received on an offer that had already lapsed. */
const paidLate = { expiresAt: PAST, payments: [{ status: "paid", paidAt: "2026-11-13T13:00:00.000Z" }] };

const live = (over: Partial<{ status: string; supersededAt: string | null; expiresAt: string | null }> = {}) => ({
  status: "sent",
  supersededAt: null,
  expiresAt: FUTURE,
  ...over,
});

describe("W02/B037 — expiry is a clock, not only a status", () => {
  it("an open offer past its expires_at is expired, whatever its status column still says", () => {
    expect(quoteTimeExpired("sent", PAST, NOW)).toBe(true);
    // A self-serve order carries the same 14-day window (submitDraft stamps it).
    expect(quoteTimeExpired("submitted", PAST, NOW)).toBe(true);
  });

  it("an offer inside its window, or with no window at all, is not expired", () => {
    expect(quoteTimeExpired("sent", FUTURE, NOW)).toBe(false);
    expect(quoteTimeExpired("sent", null, NOW)).toBe(false);
    expect(quoteTimeExpired("sent", "not a date", NOW)).toBe(false);
  });

  it("a confirmed order and an unsent draft are NOT judged by the clock", () => {
    expect(quoteTimeExpired("accepted", PAST, NOW)).toBe(false);
    expect(quoteTimeExpired("draft", PAST, NOW)).toBe(false);
  });

  it("quotePayability refuses an expired quote by status AND by clock", () => {
    expect(quotePayability(live({ status: "expired" }), NOW)).toEqual({ payable: false, reason: "expired" });
    expect(quotePayability(live({ expiresAt: PAST }), NOW)).toEqual({ payable: false, reason: "expired" });
    expect(quotePayability(live({ status: "submitted", expiresAt: PAST }), NOW)).toEqual({ payable: false, reason: "expired" });
    expect(quotePayability(live(), NOW)).toEqual({ payable: true });
    expect(quotePayability(live({ status: "accepted", expiresAt: PAST }), NOW)).toEqual({ payable: true });
  });

  it("the existing refusals are unchanged: a superseded revision and a declined quote", () => {
    expect(quotePayability(live({ supersededAt: PAST }), NOW)).toEqual({ payable: false, reason: "superseded" });
    expect(quotePayability(live({ status: "declined" }), NOW)).toEqual({ payable: false, reason: "declined" });
  });
});

describe("W02/B038 — a draft is not payable", () => {
  it("a draft (not offered yet) is refused, with its own reason", () => {
    expect(quotePayability(live({ status: "draft", expiresAt: null }), NOW)).toEqual({ payable: false, reason: "draft" });
  });

  it("only submitted / sent / accepted are payable — an unknown status is not", () => {
    for (const status of ["submitted", "sent", "accepted"]) {
      expect(quotePayability(live({ status }), NOW), status).toEqual({ payable: true });
    }
    expect(quotePayability(live({ status: "something_new" }), NOW)).toEqual({ payable: false, reason: "draft" });
  });

  it("the pay panel shows no buttons on a draft and says why", () => {
    expect(payPanelState({ payability: { payable: false, reason: "draft" }, ...unpaid })).toEqual({
      showOptions: false,
      notice: "draft",
    });
  });

  it("the draft notice exists in English and Spanish, and the page maps every reason to a sentence", () => {
    const en = JSON.parse(read("lib/i18n/en.json")) as Record<string, string>;
    const es = JSON.parse(read("lib/i18n/es.json")) as Record<string, string>;
    expect(en["order.quote.notice_draft"]).toBeTruthy();
    expect(es["order.quote.notice_draft"]).toBeTruthy();
    expect(es["order.quote.notice_draft"]).not.toBe(en["order.quote.notice_draft"]);
    expect(read("app/order/quote/[id]/page.tsx")).toMatch(/draft: "order\.quote\.notice_draft"/);
  });
});

describe("W02/B037 — the pay panel follows the same rule", () => {
  it("draws buttons only for a payable quote with nothing paid", () => {
    expect(payPanelState({ payability: { payable: true }, ...unpaid })).toEqual({ showOptions: true, notice: null });
    expect(payPanelState({ payability: { payable: true }, ...paidInTime })).toEqual({ showOptions: false, notice: null });
  });

  it("an expired, unpaid quote shows NO buttons and says why", () => {
    expect(payPanelState({ payability: { payable: false, reason: "expired" }, ...unpaid })).toEqual({
      showOptions: false,
      notice: "expired",
    });
  });

  it("an expiry that passed AFTER a payment landed is not announced — the offer was taken up in time", () => {
    expect(payPanelState({ payability: { payable: false, reason: "expired" }, ...paidInTime })).toEqual({
      showOptions: false,
      notice: null,
    });
  });

  // Review r3 (P2): "a payment exists" is not "the offer was taken up in time". A checkout
  // opened before the date can be completed after it; the webhook flags that payment and the
  // staff accept refuses the lapsed offer — and the page used to stay silent about the expiry.
  it("a payment that settled AFTER the offer expired does NOT silence the expiry: the page says it is received and under review", () => {
    expect(payPanelState({ payability: { payable: false, reason: "expired" }, ...paidLate })).toEqual({
      showOptions: false,
      notice: "expired_paid_late",
    });
  });

  it("a paid row that cannot say when it was paid proves nothing: the expiry is still announced", () => {
    expect(
      payPanelState({ payability: { payable: false, reason: "expired" }, expiresAt: PAST, payments: [{ status: "paid", paidAt: null }] }).notice,
    ).toBe("expired_paid_late");
  });

  it("a late payment beside an in-time one keeps the in-time one's standing", () => {
    expect(
      payPanelState({
        payability: { payable: false, reason: "expired" },
        expiresAt: PAST,
        payments: [...paidLate.payments, ...paidInTime.payments],
      }).notice,
    ).toBeNull();
  });

  it("the one rule both customer surfaces read: paid, on an offer that had lapsed when the money settled", () => {
    expect(paidOnLapsedOffer({ expired: true, ...paidLate })).toBe(true);
    expect(paidOnLapsedOffer({ expired: true, ...paidInTime })).toBe(false);
    expect(paidOnLapsedOffer({ expired: true, ...unpaid })).toBe(false);
    // Not expired = not lapsed, whenever the money came in (a team-confirmed order is off the clock).
    expect(paidOnLapsedOffer({ expired: false, ...paidLate })).toBe(false);
    // A due, void or refunded row is not money received.
    expect(paidOnLapsedOffer({ expired: true, expiresAt: PAST, payments: [{ status: "refunded", paidAt: "2026-11-13T13:00:00.000Z" }] })).toBe(false);
  });

  it("a superseded or declined quote never shows buttons, paid or not", () => {
    for (const reason of ["superseded", "declined"] as const) {
      for (const facts of [unpaid, paidInTime, paidLate]) {
        expect(payPanelState({ payability: { payable: false, reason }, ...facts })).toEqual({ showOptions: false, notice: reason });
      }
    }
  });
});

describe("W02/B037 — every surface reads the ONE rule (no private copies)", () => {
  it("the quote page decides its panel through payPanelState(quotePayability(…))", () => {
    const page = read("app/order/quote/[id]/page.tsx");
    expect(page).toMatch(/from "@\/lib\/portal\/payability-shared"/);
    expect(page).toMatch(/payPanelState\(\{/);
    expect(page).toMatch(/quotePayability\(\{/);
    // The old decision — "anything paid? else every plan option" — is gone.
    expect(page).not.toMatch(/paid\.length > 0 \? \[\] : plan\.options/);
  });

  it("the page gives the panel the payments and the deadline — never a bare count (review r3)", () => {
    const page = read("app/order/quote/[id]/page.tsx");
    expect(page).toMatch(/payPanelState\(\{[\s\S]{0,400}expiresAt: quote\.expiresAt,[\s\S]{0,200}payments: detail\.payments/);
    expect(page).not.toMatch(/paidCount/);
    // The late notice has its own sentence, and "nothing left to pay" is not said under it.
    expect(page).toMatch(/expired_paid_late: "order\.quote\.notice_expired_paid_late"/);
    expect(page).toMatch(/panel\.notice !== "expired_paid_late"/);
  });

  it("the account list reads the same late-payment rule (review r3)", () => {
    const lib = read("lib/portal/account.ts");
    expect(lib).toMatch(/paidOnLapsedOffer\(\{/);
    const page = read("app/order/account/page.tsx");
    expect(page).toMatch(/order\.account\.late_payment/);
    expect(page).toMatch(/status\.labelKey/);
  });

  it("the portal loaders derive isExpired from quoteTimeExpired, not a `sent`-only inline copy", () => {
    for (const rel of ["lib/portal/quotes.ts", "lib/portal/account.ts"]) {
      const src = read(rel);
      expect(src, rel).toMatch(/quoteTimeExpired\(status, r\.expires_at, now\)/);
      expect(src, rel).not.toMatch(/status === "sent" && r\.expires_at != null/);
    }
  });

  it("every notice the page can show has an English AND a Spanish sentence", () => {
    const en = JSON.parse(read("lib/i18n/en.json")) as Record<string, string>;
    const es = JSON.parse(read("lib/i18n/es.json")) as Record<string, string>;
    for (const key of [
      "order.quote.notice_expired",
      "order.quote.notice_superseded",
      "order.quote.notice_declined",
      "order.quote.error_expired",
      // Review r3: the late-payment sentences on both customer surfaces.
      "order.quote.notice_expired_paid_late",
      "order.account.status_late_payment",
      "order.account.late_payment",
    ]) {
      expect(en[key], `en ${key}`).toBeTruthy();
      expect(es[key], `es ${key}`).toBeTruthy();
      expect(es[key], `es ${key} is translated`).not.toBe(en[key]);
    }
  });
});
