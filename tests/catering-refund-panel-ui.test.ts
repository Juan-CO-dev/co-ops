// @vitest-environment jsdom
/**
 * The refund panel and the pipeline banner (catering refunds, 0357), rendered. A failed read is NOT "nothing to refund"
 * (Astra r4): both say they could not check and offer Try again; a successful empty read renders nothing. The panel
 * sends the CONFIRMED number for a Full refund (Astra r1). `fetch` is a stub; nothing leaves the test.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { jsx } from "react/jsx-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TranslationProvider } from "@/lib/i18n/provider";
import { RefundPanel } from "@/components/catering/quotes/RefundPanel";
import { LeadRefundBanner, RefundsSwitch } from "@/components/catering/LeadRefundBanner";
import { refundFigures, summarizeTotals, type RefundSummary } from "@/lib/catering/refunds-shared";
import en from "@/lib/i18n/en.json";

const Q = "00000000-0000-4000-8000-0000000000b1";
const L = "00000000-0000-4000-8000-0000000000d1";
const wrap = (child: unknown) => jsx(TranslationProvider, { initialLanguage: "en", children: child });
const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function summary(): RefundSummary {
  const payments = [{
    id: "p1", kind: "deposit" as const, status: "paid", provider: "stripe", amountCents: 30000, paidAt: null,
    figures: refundFigures({ amountCents: 30000, status: "paid", provider: "stripe", providerRef: "pi_1" }, [], []),
  }];
  return { quoteId: Q, locationId: "s", canRefund: true, installed: true, payments, requests: [], totals: summarizeTotals(payments) };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RefundPanel", () => {
  it("a failed read shows the unavailable state with Try again, and Try again reloads", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(500, { code: "generic" })).mockResolvedValueOnce(reply(200, { summary: summary() }));
    vi.stubGlobal("fetch", fetchMock);
    render(wrap(jsx(RefundPanel, { quoteId: Q, openTrigger: null, onTriggerHandled: () => {}, onChanged: () => {} })));
    expect(await screen.findByText(en["catering.refunds.unavailable"])).toBeTruthy();
    fireEvent.click(screen.getByText(en["catering.refunds.try_again"]));
    expect(await screen.findByText(en["catering.refunds.refundable"])).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("Full sends the confirmed number, never 'everything'", async () => {
    const fetchMock = vi.fn(async (url: string, init?: { method?: string; body?: string }) =>
      init?.method === "POST" ? reply(200, { ok: true, results: [{ status: "succeeded", errorCode: null }], summary: summary() }) : reply(200, { summary: summary() }));
    vi.stubGlobal("fetch", fetchMock);
    render(wrap(jsx(RefundPanel, { quoteId: Q, openTrigger: "declined", onTriggerHandled: () => {}, onChanged: () => {} })));
    fireEvent.click(await screen.findByText(en["catering.refunds.review"]));
    fireEvent.click(await screen.findByText(en["catering.refunds.confirm_button"].replace("{amount}", "$300.00")));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === "POST")).toBe(true));
    const post = fetchMock.mock.calls.find(([, i]) => i?.method === "POST")!;
    expect(JSON.parse(post[1]!.body!)).toMatchObject({ amountCents: 30000, reasonCode: "quote_declined", trigger: "declined" });
  });
});

describe("LeadRefundBanner", () => {
  it("a failed read says it could not check (with Try again); an empty read renders nothing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(503, { code: "generic" })).mockResolvedValueOnce(reply(200, { quotes: [] })));
    const { container } = render(wrap(jsx(RefundsSwitch, { on: true, children: jsx(LeadRefundBanner, { leadId: L, phase: "lost" }) })));
    expect(await screen.findByText(en["catering.refunds.lead.unavailable"])).toBeTruthy();
    fireEvent.click(screen.getByText(en["catering.refunds.try_again"]));
    await waitFor(() => expect(screen.queryByText(en["catering.refunds.lead.unavailable"])).toBeNull());
    expect(container.querySelector("[data-testid='lead-refund-banner']")).toBeNull();
  });

  it("switch off: nothing renders and nothing is fetched", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(wrap(jsx(RefundsSwitch, { on: false, children: jsx(LeadRefundBanner, { leadId: L, phase: "lost" }) })));
    expect(container.textContent).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
