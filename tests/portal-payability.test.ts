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

import { payPanelState, quotePayability, quoteTimeExpired } from "@/lib/portal/payability-shared";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const NOW = Date.parse("2026-11-14T12:00:00.000Z");
const PAST = "2026-11-13T12:00:00.000Z";
const FUTURE = "2026-11-15T12:00:00.000Z";

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
    expect(payPanelState({ payability: { payable: false, reason: "draft" }, paidCount: 0 })).toEqual({
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
    expect(payPanelState({ payability: { payable: true }, paidCount: 0 })).toEqual({ showOptions: true, notice: null });
    expect(payPanelState({ payability: { payable: true }, paidCount: 1 })).toEqual({ showOptions: false, notice: null });
  });

  it("an expired, unpaid quote shows NO buttons and says why", () => {
    expect(payPanelState({ payability: { payable: false, reason: "expired" }, paidCount: 0 })).toEqual({
      showOptions: false,
      notice: "expired",
    });
  });

  it("an expiry that passed AFTER a payment landed is not announced — the offer was taken up in time", () => {
    expect(payPanelState({ payability: { payable: false, reason: "expired" }, paidCount: 1 })).toEqual({
      showOptions: false,
      notice: null,
    });
  });

  it("a superseded or declined quote never shows buttons, paid or not", () => {
    for (const reason of ["superseded", "declined"] as const) {
      for (const paidCount of [0, 1]) {
        expect(payPanelState({ payability: { payable: false, reason }, paidCount })).toEqual({ showOptions: false, notice: reason });
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
    for (const key of ["order.quote.notice_expired", "order.quote.notice_superseded", "order.quote.notice_declined", "order.quote.error_expired"]) {
      expect(en[key], `en ${key}`).toBeTruthy();
      expect(es[key], `es ${key}`).toBeTruthy();
      expect(es[key], `es ${key} is translated`).not.toBe(en[key]);
    }
  });
});
