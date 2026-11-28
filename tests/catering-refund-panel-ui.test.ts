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
import { REFUND_ERROR_CODES, refundFigures, summarizeTotals, type RefundSummary } from "@/lib/catering/refunds-shared";
import { REFUND_DISPOSITION_ACTIONS, REFUND_ISSUE_CODES, REFUND_EPOCH_STATES, type StoredRequestState } from "@/lib/catering/refund-outcomes-shared";
import { formatDateLabel, formatTime } from "@/lib/i18n/format";
import { etCalendarDate } from "@/lib/operational-day";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { B1_ISSUE, B1_REQUEST, B1_VERIFIED_AT, b1Issue, b1Payment, b1Request, b1Summary, epoch, heldPayment } from "./fixtures/refund-b1-panel";

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

describe("RefundPanel, review r5", () => {
  it("a refund made, then the reload fails: the warning comes with Try again, and Try again brings the panel back current", async () => {
    let gets = 0;
    const fetchMock = vi.fn(async (_url: string, init?: { method?: string }) => {
      if (init?.method === "POST") return reply(200, { ok: true, results: [{ status: "succeeded", errorCode: null }], summary: null });
      gets += 1;
      return gets === 2 ? reply(500, { code: "generic" }) : reply(200, { summary: summary() });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(wrap(jsx(RefundPanel, { quoteId: Q, openTrigger: "declined", onTriggerHandled: () => {}, onChanged: () => {} })));
    fireEvent.click(await screen.findByText(en["catering.refunds.review"]));
    fireEvent.click(await screen.findByText(en["catering.refunds.confirm_button"].replace("{amount}", "$300.00")));
    const stale = await screen.findByTestId("refund-panel-stale");
    fireEvent.click(stale.querySelector("button")!);
    await waitFor(() => expect(screen.queryByTestId("refund-panel-stale")).toBeNull());
    expect(gets).toBe(3);
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

  it("review r8: Stripe could not be asked for an order: the warning shows even at $0 refundable, and a refund prompt the figures support still shows", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(reply(200, { quotes: [{ quoteId: Q, refundableCents: 0, paidCents: 30000, stripeUnchecked: true }] }))
      .mockResolvedValueOnce(reply(200, { quotes: [{ quoteId: Q, refundableCents: 5000, paidCents: 30000, stripeUnchecked: true }] })));
    render(wrap(jsx(RefundsSwitch, { on: true, children: jsx(LeadRefundBanner, { leadId: L, phase: "lost" }) })));
    expect(await screen.findByText(en["catering.refunds.lead.unavailable"])).toBeTruthy();
    expect(screen.queryByTestId("lead-refund-banner")).toBeNull();
    fireEvent.click(screen.getByText(en["catering.refunds.try_again"]));
    expect(await screen.findByTestId("lead-refund-banner")).toBeTruthy();
    expect(screen.getByText(en["catering.refunds.lead.unavailable"])).toBeTruthy();
  });

  it("switch off: nothing renders and nothing is fetched", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(wrap(jsx(RefundsSwitch, { on: false, children: jsx(LeadRefundBanner, { leadId: L, phase: "lost" }) })));
    expect(container.textContent).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── Part B1: the panel and banner draw STORED state (typed fixtures: tests/fixtures/refund-b1-panel.ts) ──────────
type Call = [string, { method?: string; body?: string } | undefined];
const E = en as Record<string, string>;
const S = es as Record<string, string>;

function panelWith(s: RefundSummary, onPost?: (url: string, body: unknown) => { status: number; body: unknown }, openTrigger: "declined" | "lost" | null = null) {
  const fetchMock = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "POST") {
      const r = onPost ? onPost(url, init.body ? JSON.parse(init.body) : null) : { status: 500, body: { code: "generic" } };
      return reply(r.status, r.body);
    }
    return reply(200, { summary: s });
  });
  vi.stubGlobal("fetch", fetchMock);
  render(wrap(jsx(RefundPanel, { quoteId: Q, openTrigger, onTriggerHandled: () => {}, onChanged: () => {} })));
  return fetchMock;
}
const posts = (m: ReturnType<typeof vi.fn>) => (m.mock.calls as Call[]).filter(([, i]) => i?.method === "POST");

describe("RefundPanel, Part B1: the epoch line", () => {
  const cases: Array<[string, ReturnType<typeof epoch>, string]> = [
    ["none", epoch("none"), "catering.refunds.epoch.refunds_no_epoch"],
    ["sealed", epoch("sealed"), "catering.refunds.epoch.refunds_no_epoch"],
    ["recovering", epoch("recovering"), "catering.refunds.epoch.refunds_recovering"],
    ["draining", epoch("draining"), "catering.refunds.epoch.refunds_draining"],
    ["live but caller incompatible", epoch("live", false), "catering.refunds.epoch.refunds_unavailable"],
  ];
  it.each(cases)("%s: the line shows and no Confirm form is offered, even on a decline prompt", async (_n, ep, key) => {
    // canRefund true on purpose: the panel itself refuses to offer the form outside a live, compatible epoch.
    panelWith(b1Summary({ epoch: ep }), undefined, "declined");
    expect((await screen.findByTestId("refund-epoch")).textContent).toBe(E[key]);
    expect(screen.queryByText(en["catering.refunds.start"])).toBeNull();
    expect(screen.queryByTestId("refund-form")).toBeNull();
    expect(screen.queryByText(en["catering.refunds.review"])).toBeNull();
  });

  it("live: no epoch line, today's form", async () => {
    panelWith(b1Summary({ epoch: epoch("live") }));
    expect(await screen.findByText(en["catering.refunds.start"])).toBeTruthy();
    expect(screen.queryByTestId("refund-epoch")).toBeNull();
  });

  it("every epoch state is covered by the cases above", () => {
    expect(new Set(cases.map(([, ep]) => ep.state))).toEqual(new Set(REFUND_EPOCH_STATES));
  });
});

describe("RefundPanel, Part B1: per payment", () => {
  it("an unchecked payment is LABELLED (never shown as certain), with its last verified time through the format helpers", async () => {
    panelWith(b1Summary({ payments: [b1Payment({ verified: false })] }));
    const row = await screen.findByTestId("refund-payment");
    expect(row.textContent).toContain(en["catering.refunds.payment.unverified"]);
    expect(screen.getByText(en["catering.refunds.unchecked"])).toBeTruthy();
    expect(screen.queryByText(en["catering.refunds.stripe_unchecked"])).toBeNull();
    const date = `${formatDateLabel(etCalendarDate(B1_VERIFIED_AT), "en")} ${formatTime(B1_VERIFIED_AT, "en")}`;
    expect(row.textContent).toContain(en["catering.refunds.payment.last_verified"].replace("{date}", date));
  });

  it("a verified payment carries no unchecked label", async () => {
    panelWith(b1Summary());
    const row = await screen.findByTestId("refund-payment");
    expect(row.textContent).not.toContain(en["catering.refunds.payment.unverified"]);
    expect(screen.queryByText(en["catering.refunds.unchecked"])).toBeNull();
  });

  it("a held payment shows 0 refundable and says why; no refund is offered", async () => {
    panelWith(b1Summary({ payments: [heldPayment()] }));
    const row = await screen.findByTestId("refund-payment");
    expect(row.textContent).toContain(en["catering.refunds.payment.refundable"].replace("{amount}", "$0.00"));
    expect(row.textContent).toContain(en["catering.refunds.payment.held"]);
    expect(screen.queryByText(en["catering.refunds.start"])).toBeNull();
  });

  it("returned / pending / unexplained-floor figures show when present", async () => {
    panelWith(b1Summary({ payments: [b1Payment({ returnedCents: 1000, reservedCents: 2000, floorCents: 3000, cleanupOwed: true })] }));
    const row = await screen.findByTestId("refund-payment");
    expect(row.textContent).toContain(en["catering.refunds.payment.returned"].replace("{amount}", "$10.00"));
    expect(row.textContent).toContain(en["catering.refunds.payment.reserved"].replace("{amount}", "$20.00"));
    expect(row.textContent).toContain(en["catering.refunds.payment.floor"].replace("{amount}", "$30.00"));
    expect(row.textContent).toContain(en["catering.refunds.payment.cleanup_owed"]);
  });

  it("a pre-0359 summary (no Part B1 fields) renders no payment rows, no epoch line, no issues", async () => {
    panelWith(summary());
    expect(await screen.findByText(en["catering.refunds.refundable"])).toBeTruthy();
    expect(screen.queryByTestId("refund-payment")).toBeNull();
    expect(screen.queryByTestId("refund-epoch")).toBeNull();
    expect(screen.queryByTestId("refund-issues")).toBeNull();
  });
});

describe("RefundPanel, Part B1: each request by its stored state", () => {
  const states: StoredRequestState[] = ["reserved_not_sent", "submission_unconfirmed", "in_progress", "submitted", "succeeded", "failed", "released", "held"];
  it("reserved_not_sent reads EXACTLY the plan's wording (en and es)", () => {
    expect(en["catering.refunds.state.reserved_not_sent"]).toBe("Reserved, not sent. Review this payment and use Retry if it should go ahead.");
    expect(es["catering.refunds.state.reserved_not_sent"]).toBe("Reservado, no enviado. Revisa este pago y usa Reintentar si debe seguir adelante.");
  });
  it.each(states)("%s", async (state) => {
    panelWith(b1Summary({ requests: [b1Request(state)] }));
    const row = await screen.findByTestId("refund-row");
    expect(row.querySelector("[data-testid='refund-state']")!.textContent).toBe(E[`catering.refunds.state.${state}`]);
    // Only a never-armed reservation may say that no create was sent.
    if (state !== "reserved_not_sent") expect(row.textContent).not.toContain("not sent");
    if (state === "submission_unconfirmed") {
      expect(row.textContent).toContain("Submission unconfirmed.");
      expect(row.textContent).toContain(en["catering.refunds.state.submission_unconfirmed_detail"]);
      expect(en["catering.refunds.state.submission_unconfirmed_detail"]).toContain("may already have been sent");
    } else {
      expect(row.textContent).not.toContain(en["catering.refunds.state.submission_unconfirmed_detail"]);
    }
  });
});

describe("RefundPanel, Part B1: ordinary Release asks 'I checked this charge in Stripe' first", () => {
  it("the Yes button is disabled until the box is ticked; the body is { release: true, staffVerified: true }", async () => {
    const m = panelWith(
      b1Summary({ requests: [b1Request("reserved_not_sent", { needsReconcile: true })] }),
      () => ({ status: 200, body: { ok: true, result: { status: "failed", errorCode: "released_no_refund" }, summary: b1Summary() } }),
    );
    fireEvent.click(await screen.findByText(en["catering.refunds.release"]));
    const yes = screen.getByText(en["catering.refunds.release_yes"]).closest("button")!;
    expect(yes.disabled).toBe(true);
    fireEvent.click(yes);
    expect(posts(m)).toHaveLength(0);
    fireEvent.click(screen.getByLabelText(en["catering.refunds.release_staff_verified"]));
    expect(yes.disabled).toBe(false);
    fireEvent.click(yes);
    await waitFor(() => expect(posts(m)).toHaveLength(1));
    const [url, init] = posts(m)[0]!;
    expect(url).toBe(`/api/catering/quotes/${Q}/refunds/${B1_REQUEST}/retry`);
    expect(JSON.parse(init!.body!)).toEqual({ release: true, staffVerified: true });
    expect(await screen.findByText(en["catering.refunds.result.released"])).toBeTruthy();
  });

  it("Cancel clears the tick: reopening asks again", async () => {
    panelWith(b1Summary({ requests: [b1Request("reserved_not_sent", { needsReconcile: true })] }));
    fireEvent.click(await screen.findByText(en["catering.refunds.release"]));
    fireEvent.click(screen.getByLabelText(en["catering.refunds.release_staff_verified"]));
    const row = screen.getByTestId("refund-row");
    fireEvent.click([...row.querySelectorAll("button")].find((b) => b.textContent === en["catering.refunds.cancel"])!);
    fireEvent.click(screen.getByText(en["catering.refunds.release"]));
    expect((screen.getByLabelText(en["catering.refunds.release_staff_verified"]) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(en["catering.refunds.release_yes"]).closest("button")!.disabled).toBe(true);
  });
});

describe("RefundPanel, Part B1: the issues list", () => {
  const actionLabels = REFUND_DISPOSITION_ACTIONS.map((a) => E[`catering.refunds.action.${a}`]!);

  it("a viewer without authority sees the issue and NO action button", async () => {
    panelWith(b1Summary({ issues: [b1Issue("awaiting_identity", false, { aged: true })] }));
    const row = await screen.findByTestId("refund-issue");
    expect(row.textContent).toContain(en["catering.refunds.issue.awaiting_identity"]);
    expect(row.textContent).toContain(en["catering.refunds.issue_blocking"]);
    expect(row.textContent).toContain(en["catering.refunds.issue_aged"]);
    expect(row.querySelectorAll("button")).toHaveLength(0);
    for (const label of actionLabels) expect(screen.queryByText(label)).toBeNull();
  });

  it("an event floor names its event and shows cumulative, explained and unexplained (review fix, Astra P2); other issues show no such line", async () => {
    panelWith(b1Summary({ issues: [b1Issue("awaiting_identity", true, {
      eventId: "evt_test_floor_1",
      detail: { event_cumulative_cents: 12000, explained_cents: 7000, remainder_cents: 5000 },
    })] }));
    const line = await screen.findByTestId("refund-issue-floor");
    for (const part of ["evt_test_floor_1", "$120.00", "$70.00", "$50.00"]) expect(line.textContent).toContain(part);
    cleanup();
    panelWith(b1Summary({ issues: [b1Issue("awaiting_identity", true), b1Issue("refund_revived", true, { id: "00000000-0000-4000-8000-0000000000e2", detail: { event_cumulative_cents: 12000 } })] }));
    await screen.findAllByTestId("refund-issue");
    expect(screen.queryByTestId("refund-issue-floor")).toBeNull();
  });

  it("with authority: one button per action the server sent; a held issue also offers Reopen and recheck", async () => {
    panelWith(b1Summary({ issues: [b1Issue("refund_revived", true, { state: "held", blocking: true })] }));
    const row = await screen.findByTestId("refund-issue");
    expect(row.textContent).toContain(en["catering.refunds.issue_held"]);
    expect([...row.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      en["catering.refunds.action.evidence_reviewed"],
      en["catering.refunds.action.keep_held"],
      en["catering.refunds.action.reopen_recheck"],
    ]);
  });

  it("an issue with no generation offers no action (the body could not name one)", async () => {
    panelWith(b1Summary({ issues: [b1Issue("unfamiliar_identity", true, { generation: null, blocking: false })] }));
    const row = await screen.findByTestId("refund-issue");
    expect(row.textContent).toContain(en["catering.refunds.issue_not_blocking"]);
    expect(row.querySelectorAll("button")).toHaveLength(0);
  });

  it("an evidence action validates the reference; Save posts ONE disposition and the summary comes from the response", async () => {
    const after = b1Summary({ issues: [] });
    const m = panelWith(b1Summary({ issues: [b1Issue("refund_revived", true)] }), () => ({ status: 200, body: { ok: true, summary: after } }));
    fireEvent.click(await screen.findByText(en["catering.refunds.action.evidence_reviewed"]));
    expect(en["catering.refunds.evidence_label"]).toContain("a reference to your reconciliation record, not customer details");
    const input = screen.getByLabelText(en["catering.refunds.evidence_label"]);
    const save = screen.getByText(en["catering.refunds.disposition_submit"]).closest("button")!;
    expect(save.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "not a reference, has spaces" } });
    expect(screen.getByText(en["catering.refunds.evidence_invalid"])).toBeTruthy();
    expect(save.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "recon:2026-11/QB#42" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(await screen.findByText(en["catering.refunds.result.disposition_done"])).toBeTruthy();
    expect(posts(m)).toHaveLength(1);
    const [url, init] = posts(m)[0]!;
    expect(url).toBe(`/api/catering/quotes/${Q}/refunds/disposition`);
    expect(JSON.parse(init!.body!)).toEqual({ issueId: B1_ISSUE, expectedGeneration: 3, action: "evidence_reviewed", evidenceRef: "recon:2026-11/QB#42", target: null });
    await waitFor(() => expect(screen.queryByTestId("refund-issues")).toBeNull());
    // One initial read, one POST, no second request of any kind.
    expect(m).toHaveBeenCalledTimes(2);
  });

  it("an action that names a refund asks for its id as well as the reference", async () => {
    const m = panelWith(b1Summary({ issues: [b1Issue("ambiguous_binding", true)] }), () => ({ status: 200, body: { ok: true, summary: b1Summary() } }));
    fireEvent.click(await screen.findByText(en["catering.refunds.action.bind_verified_refund"]));
    fireEvent.change(screen.getByLabelText(en["catering.refunds.target_label"]), { target: { value: "re_123" } });
    fireEvent.change(screen.getByLabelText(en["catering.refunds.evidence_label"]), { target: { value: "ticket-7" } });
    fireEvent.click(screen.getByText(en["catering.refunds.disposition_submit"]));
    await waitFor(() => expect(posts(m)).toHaveLength(1));
    expect(JSON.parse(posts(m)[0]![1]!.body!)).toEqual({ issueId: B1_ISSUE, expectedGeneration: 3, action: "bind_verified_refund", evidenceRef: "ticket-7", target: "re_123" });
  });

  it("acknowledge_followup needs no reference and sends nulls", async () => {
    const m = panelWith(b1Summary({ issues: [b1Issue("checkout_still_open", true, { blocking: false })] }), () => ({ status: 200, body: { ok: true, summary: b1Summary() } }));
    fireEvent.click(await screen.findByText(en["catering.refunds.action.acknowledge_followup"]));
    expect(screen.queryByLabelText(en["catering.refunds.evidence_label"])).toBeNull();
    fireEvent.click(screen.getByText(en["catering.refunds.disposition_submit"]));
    await waitFor(() => expect(posts(m)).toHaveLength(1));
    expect(JSON.parse(posts(m)[0]![1]!.body!)).toMatchObject({ action: "acknowledge_followup", evidenceRef: null, target: null });
  });

  it("a step-up answer opens the password prompt, and its confirm re-sends the SAME disposition", async () => {
    let dispositions = 0;
    const m = panelWith(b1Summary({ issues: [b1Issue("refund_revived", true)] }), (url) => {
      if (url === "/api/auth/step-up") return { status: 200, body: { ok: true } };
      dispositions += 1;
      return dispositions === 1 ? { status: 403, body: { code: "step_up_required" } } : { status: 200, body: { ok: true, summary: b1Summary() } };
    });
    fireEvent.click(await screen.findByText(en["catering.refunds.action.keep_held"]));
    fireEvent.change(screen.getByLabelText(en["catering.refunds.evidence_label"]), { target: { value: "recon-9" } });
    fireEvent.click(screen.getByText(en["catering.refunds.disposition_submit"]));
    fireEvent.change(await screen.findByLabelText(en["auth.step_up.password_label"]), { target: { value: "synthetic-pass" } });
    fireEvent.click(screen.getByText(en["auth.step_up.confirm"]));
    expect(await screen.findByText(en["catering.refunds.result.disposition_done"])).toBeTruthy();
    const sent = posts(m).filter(([u]) => u.endsWith("/refunds/disposition")).map(([, i]) => JSON.parse(i!.body!));
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(sent[0]).toMatchObject({ action: "keep_held", evidenceRef: "recon-9", expectedGeneration: 3 });
  });

  it("a stale generation is named, nothing is re-sent, and a reload is offered", async () => {
    const m = panelWith(b1Summary({ issues: [b1Issue("refund_revived", true)] }), () => ({ status: 409, body: { code: "stale_generation" } }));
    fireEvent.click(await screen.findByText(en["catering.refunds.action.keep_held"]));
    fireEvent.change(screen.getByLabelText(en["catering.refunds.evidence_label"]), { target: { value: "recon-9" } });
    fireEvent.click(screen.getByText(en["catering.refunds.disposition_submit"]));
    expect(await screen.findByText(en["catering.refunds.error.stale_generation"])).toBeTruthy();
    expect(posts(m)).toHaveLength(1);
    expect(m).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByText(en["catering.refunds.reload"]));
    await waitFor(() => expect(m).toHaveBeenCalledTimes(3));
    expect(posts(m)).toHaveLength(1);
  });
});

describe("LeadRefundBanner, Part B1", () => {
  it("an unchecked figure is labelled; a held order says it is on hold instead of offering money", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(200, { quotes: [
      { quoteId: Q, refundableCents: 5000, paidCents: 30000, stripeUnchecked: true, held: false },
      { quoteId: "00000000-0000-4000-8000-0000000000b2", refundableCents: 0, paidCents: 20000, stripeUnchecked: false, held: true },
    ] })));
    render(wrap(jsx(RefundsSwitch, { on: true, children: jsx(LeadRefundBanner, { leadId: L, phase: "lost" }) })));
    const banner = await screen.findByTestId("lead-refund-banner");
    expect(banner.textContent).toContain(en["catering.refunds.lead.unchecked"]);
    expect(banner.textContent).toContain(en["catering.refunds.lead.held"].replace("{paid}", "$200.00"));
    expect(banner.textContent).not.toContain(en["catering.refunds.lead.lost"].replace("{paid}", "$200.00").replace("{refundable}", "$0.00"));
    expect(screen.getAllByTestId("lead-refund-unchecked")).toHaveLength(1);
  });

  it("a verified, unheld figure carries no label (the pre-B1 banner)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(200, { quotes: [{ quoteId: Q, refundableCents: 5000, paidCents: 30000, stripeUnchecked: false, held: false }] })));
    render(wrap(jsx(RefundsSwitch, { on: true, children: jsx(LeadRefundBanner, { leadId: L, phase: "lost" }) })));
    const banner = await screen.findByTestId("lead-refund-banner");
    expect(banner.textContent).toBe(
      en["catering.refunds.lead.lost"].replace("{paid}", "$300.00").replace("{refundable}", "$50.00") + en["catering.refunds.lead.open"],
    );
  });
});

describe("i18n parity, Part B1: every refund error, issue code and action has en AND es, and en is never the key", () => {
  const keys = [
    ...REFUND_ERROR_CODES.map((c) => `catering.refunds.error.${c}`),
    ...REFUND_ISSUE_CODES.map((c) => `catering.refunds.issue.${c}`),
    ...REFUND_DISPOSITION_ACTIONS.map((a) => `catering.refunds.action.${a}`),
    ...["refunds_no_epoch", "refunds_recovering", "refunds_draining", "refunds_unavailable"].map((c) => `catering.refunds.epoch.${c}`),
  ];
  it.each(keys)("%s", (k) => {
    expect(typeof E[k]).toBe("string");
    expect(typeof S[k]).toBe("string");
    expect(E[k]).not.toBe(k);
    expect(S[k]).not.toBe(k);
    expect(E[k]!.length).toBeGreaterThan(0);
    expect(S[k]!.length).toBeGreaterThan(0);
  });
  it("released_request_has_refund says a replacement may already have been made", () => {
    expect(en["catering.refunds.issue.released_request_has_refund"]).toContain("replacement may already have been made");
    expect(es["catering.refunds.issue.released_request_has_refund"]).toContain("ya se haya hecho un reemplazo");
  });
  it("the action labels are the plan's panel names", () => {
    expect(REFUND_DISPOSITION_ACTIONS.map((a) => E[`catering.refunds.action.${a}`])).toEqual([
      "Resolve this event floor", "Bind verified refund", "Treat as external", "Exclude unrelated hint", "Recheck after restoring access",
      "Reviewed, access still required", "Record evidence reviewed", "Keep payment held", "Reopen and recheck", "Release reviewed reservation",
      "Acknowledge follow-up",
    ]);
  });
});
