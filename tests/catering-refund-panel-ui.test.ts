// @vitest-environment jsdom
/**
 * The refund panel and the pipeline banner (catering refunds Part B1 v2), RENDERED (plan 4.3 as amended by section 15).
 * Summaries are built by the real mapper (`refundSummaryFromRpc`) from F7-shaped JSON, and the routes are a `fetch`
 * stub that follows the HTTP contract (refundB1-parts/v2-LIB-API.md); nothing leaves the test.
 *
 * Covers: no figure and no button unless every eligible payment is known (each not-known state renders NO currency
 * amount at all); "Check Stripe now"; the paused, unconfirmed (exact text), blocked, disagreement and claim lines;
 * per-row truth after a mixed press; the confirm sends `seenRefundableCents`; the 409 re-draw and the [S11] text
 * (exact, en + es); the resolve steps (account and mode named, fingerprint [T5], nothing pre-selected, "could not
 * tell" makes no request, attach lists only `attachableTo` refunds, release hidden before `releasableAt`, `legacy` and
 * `credential_changed` show the tell-CC line and no form); NO request between the password unlock and the action it
 * was typed for; the banner shows an amount only when known; and en + es parity for every key the panel, the banner
 * and the inventory page use.
 */
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { jsx } from "react/jsx-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TranslationProvider } from "@/lib/i18n/provider";
import { RefundPanel } from "@/components/catering/quotes/RefundPanel";
import { LeadRefundBanner, RefundsSwitch } from "@/components/catering/LeadRefundBanner";
import {
  REFUND_ACCOUNT_SLOTS,
  REFUND_CLAIM_KINDS,
  REFUND_ERROR_CODES,
  REFUND_FINDINGS,
  REFUND_REASON_CODES,
  refundSummaryFromRpc,
  type RefundSummary,
} from "@/lib/catering/refunds-shared";
import { formatCents, formatDateLabel, formatTime } from "@/lib/i18n/format";
import { etCalendarDate } from "@/lib/operational-day";
import type { Language } from "@/lib/i18n/types";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const EN = en as Record<string, string>;
const ES = es as Record<string, string>;
const Q = "00000000-0000-4000-8000-0000000000b1";
const L = "00000000-0000-4000-8000-0000000000d1";
const P1 = "00000000-0000-4000-8000-0000000000c1";
const P2 = "00000000-0000-4000-8000-0000000000c2";
const R1 = "00000000-0000-4000-8000-0000000000e1";
const R2 = "00000000-0000-4000-8000-0000000000e2";
const U = "00000000-0000-4000-8000-0000000000f1";

// ── F7-shaped builders (synthetic ids only) ──────────────────────────────────────────────────────────────
const pay = (over: Record<string, unknown> = {}) => ({
  payment_id: P1, kind: "deposit", status: "paid", amount_cents: 30000, paid_at: "2026-11-01T00:00:00Z", payment_intent: "pi_test_panel_1",
  eligible: true, state: "known", known: true, checked_at: "2026-11-28T09:00:00Z", captured_cents: 30000, counted_cents: 0,
  in_flight_cents: 0, refundable_cents: 30000, blocked: false, stripe_whole: false, disagrees: false, account_slot: "location",
  livemode: false, credential_fp: "0123456789abcdef", last_attempt_at: "2026-11-28T09:00:01Z", last_attempt_result: "complete",
  refunds: [], requests: [], ...over,
});
const req = (over: Record<string, unknown> = {}) => ({
  id: R1, status: "pending", armed: true, amount_cents: 5000, reason_code: "customer_cancelled", trigger: "panel", requested_by: U,
  requested_at: "2026-11-27T09:00:00Z", armed_at: "2026-11-27T09:00:05Z", releasable_at: "2026-11-28T09:00:05Z", stripe_refund_id: null,
  last_error_code: null, resolved_by: null, resolved_at: null, settled_at: null, arm_account_slot: "location", arm_livemode: false,
  legacy: false, ...over,
});
const ref = (over: Record<string, unknown> = {}) => ({
  refund_id: "re_test_panel_1", amount_cents: 5000, currency: "usd", status: "succeeded", previous_status: null, status_changed_at: null,
  created_at: "2026-11-27T09:00:06Z", request_id: null, names_request: false, kind: "none", attachable_to: null, ...over,
});
function summary(payments: unknown[], o: { total?: number | null; generatedAt?: string; partsReady?: boolean; canRefund?: boolean; canRelease?: boolean } = {}): RefundSummary {
  const raw = {
    quotes: [{ quote_id: Q, location_id: "00000000-0000-4000-8000-0000000000a1", payments, refundable_total_cents: o.total === undefined ? 30000 : o.total }],
    generated_at: o.generatedAt ?? "2026-11-28T10:00:00Z",
    parts_ready: o.partsReady ?? true,
  };
  return refundSummaryFromRpc(raw, { quoteId: Q, canRefund: o.canRefund ?? true, canRelease: o.canRelease ?? false, names: { [U]: "Synthetic Person" } })!;
}

// ── The routes, stubbed by the contract ──────────────────────────────────────────────────────────────────
type Reply = { ok: boolean; status: number; type: string; json: () => Promise<unknown> };
const reply = (status: number, body: unknown): Reply => ({ ok: status >= 200 && status < 300, status, type: "basic", json: async () => body });
type Handler = (url: string, method: string, body: unknown) => Reply | undefined;
function routes(handler: Handler) {
  const log: string[] = [];
  const bodies: Array<{ url: string; body: unknown }> = [];
  const fn = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? "GET";
    log.push(`${method} ${url}`);
    const body = init?.body ? JSON.parse(init.body) : undefined;
    if (body !== undefined) bodies.push({ url, body });
    return handler(url, method, body) ?? reply(500, { code: "generic" });
  });
  vi.stubGlobal("fetch", fn);
  return { fn, log, bodies };
}
const SUMMARY_URL = `/api/catering/quotes/${Q}/refunds`;

const wrap = (child: unknown, lang: Language = "en") => jsx(TranslationProvider, { initialLanguage: lang, children: child });
function renderPanel(lang: Language = "en", openTrigger: "declined" | "lost" | null = null) {
  return render(wrap(jsx(RefundPanel, { quoteId: Q, openTrigger, onTriggerHandled: () => {}, onChanged: () => {} }), lang));
}
const fill = (s: string, p: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k: string) => p[k] ?? `{${k}}`);
const when = (iso: string, lang: Language = "en") => `${formatDateLabel(etCalendarDate(iso), lang)} ${formatTime(iso, lang)}`;
const NO_MONEY = /\$|\d[.,]\d{2}\b/;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("not known = no number, no button", () => {
  it.each(["never_read", "dirty", "paused"] as const)("%s: no currency amount anywhere, no refund form, the right line", async (state) => {
    const s = summary([pay({ state, known: false, refundable_cents: 30000, captured_cents: 30000 })], { total: 30000 });
    routes((url) => (url === SUMMARY_URL ? reply(200, { summary: s }) : undefined));
    const { container } = renderPanel();
    await screen.findByTestId("refund-panel");
    expect(container.textContent ?? "").not.toMatch(NO_MONEY);
    expect(screen.queryByText(EN["catering.refunds.start"]!)).toBeNull();
    expect(screen.queryByTestId("refund-form")).toBeNull();
    expect(screen.getByText(EN["catering.refunds.totals.not_known"]!)).toBeTruthy();
    if (state === "paused") {
      expect(screen.getByText(EN["catering.refunds.payment.paused"]!)).toBeTruthy();
      expect(screen.queryByTestId("refund-check-now")).toBeNull();
    } else {
      expect(screen.getByText(EN["catering.refunds.payment.checking"]!)).toBeTruthy();
      expect(screen.getByTestId("refund-check-now").textContent).toBe(EN["catering.refunds.payment.check_now"]);
    }
  });

  it("one payment known and one dirty: the known one shows its figures, the order has no total and no form", async () => {
    const s = summary([pay(), pay({ payment_id: P2, kind: "balance", state: "dirty", known: false, payment_intent: "pi_test_panel_2" })], { total: 30000 });
    routes((url) => (url === SUMMARY_URL ? reply(200, { summary: s }) : undefined));
    renderPanel();
    const [known, dirty] = await screen.findAllByTestId("refund-payment");
    expect(known!.textContent).toContain(formatCents(30000, "en"));
    expect(dirty!.textContent ?? "").not.toMatch(NO_MONEY);
    expect(screen.queryByTestId("refund-totals")).toBeNull();
    expect(screen.queryByText(EN["catering.refunds.start"]!)).toBeNull();
  });

  it("known but the database gate is shut (parts not ready), or the actor may not refund: no form", async () => {
    for (const o of [{ partsReady: false }, { canRefund: false }]) {
      routes((url) => (url === SUMMARY_URL ? reply(200, { summary: summary([pay()], o) }) : undefined));
      renderPanel();
      await screen.findByTestId("refund-panel");
      expect(screen.queryByText(EN["catering.refunds.start"]!)).toBeNull();
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  it("Check Stripe now: POST .../refunds/check with {} and the answer's summary is drawn", async () => {
    const before = summary([pay({ state: "dirty", known: false })], { total: null });
    const after = summary([pay()]);
    const r = routes((url, method) => {
      if (url === SUMMARY_URL && method === "GET") return reply(200, { summary: before });
      if (url === `${SUMMARY_URL}/check` && method === "POST") return reply(200, { checks: [{ paymentId: P1, result: "complete", reason: null, bound: 0 }], summary: after });
      return undefined;
    });
    renderPanel();
    fireEvent.click(await screen.findByTestId("refund-check-now"));
    await screen.findByText(EN["catering.refunds.payment.check_done"]!);
    expect(r.bodies).toEqual([{ url: `${SUMMARY_URL}/check`, body: {} }]);
    expect(screen.getByTestId("refund-totals").textContent).toContain(formatCents(30000, "en"));
  });
});

describe("the lines a payment and a request carry", () => {
  it("blocked, disagreement, a refund not made in the app, and claim warnings with their kind", async () => {
    const s = summary([pay({
      blocked: true, disagrees: true,
      refunds: [ref({ refund_id: "re_test_out", kind: "none" }), ref({ refund_id: "re_test_rel", kind: "released", names_request: true, request_id: R2 }), ref({ refund_id: "re_test_cand", kind: "candidate", names_request: true })],
    })]);
    routes((url) => (url === SUMMARY_URL ? reply(200, { summary: s }) : undefined));
    renderPanel();
    await screen.findByTestId("refund-panel");
    expect(screen.getByText(EN["catering.refunds.payment.blocked"]!)).toBeTruthy();
    expect(screen.getByText(EN["catering.refunds.payment.disagrees"]!)).toBeTruthy();
    expect(EN["catering.refunds.payment.disagrees"]).toBe("Stripe and this payment's status do not match. The amounts above are Stripe's. Tell CC.");
    expect(EN["catering.refunds.payment.blocked"]).toBe("A refund on this payment is not resolved yet. No other refund can be made on it until it is.");
    const rows = screen.getAllByTestId("refund-stripe-refund");
    expect(rows.map((r) => r.getAttribute("data-kind"))).toEqual(["none", "released", "candidate"]);
    expect(rows[0]!.textContent).toContain(EN["catering.refunds.refund.outside"]);
    expect(rows[1]!.textContent).toContain(EN["catering.refunds.refund.warning.released"]);
    expect(rows[2]!.textContent).toContain(EN["catering.refunds.refund.warning.candidate"]);
  });

  it("the unconfirmed text is EXACT (en and es), with the releasable instant", async () => {
    const at = "2026-11-28T09:00:05Z";
    for (const lang of ["en", "es"] as const) {
      routes((url) => (url === SUMMARY_URL ? reply(200, { summary: summary([pay({ blocked: true, requests: [req({ releasable_at: at })] })]) }) : undefined));
      renderPanel(lang);
      const line = await screen.findByTestId("refund-row-unconfirmed");
      const want = lang === "en"
        ? `Stripe has not confirmed this refund. Do not refund it again. We keep checking. If it is still not found after ${when(at, "en")}, a MoO or the owner can resolve it.`
        : fill(ES["catering.refunds.view.unconfirmed"]!, { releasableAt: when(at, "es") });
      expect(line.textContent).toBe(want);
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  it("request views: reserved, bound with Stripe's status and who attached it, released by whom, never sent, closed", async () => {
    const s = summary([pay({
      refunds: [ref({ refund_id: "re_test_bound", kind: "bound", status: "requires_action", request_id: R1, names_request: true })],
      requests: [
        req({ id: R1, status: "submitted", stripe_refund_id: "re_test_bound", resolved_by: U, resolved_at: "2026-11-28T08:00:00Z" }),
        req({ id: R2, status: "failed", last_error_code: "released_no_refund", resolved_by: U, resolved_at: "2026-11-28T08:30:00Z" }),
        req({ id: "00000000-0000-4000-8000-0000000000e3", status: "pending", armed: false }),
        req({ id: "00000000-0000-4000-8000-0000000000e4", status: "failed", armed: false, last_error_code: "never_sent" }),
        req({ id: "00000000-0000-4000-8000-0000000000e5", status: "succeeded", stripe_refund_id: "re_test_old" }),
      ],
    })]);
    routes((url) => (url === SUMMARY_URL ? reply(200, { summary: s }) : undefined));
    renderPanel();
    await screen.findByTestId("refund-panel");
    const rows = screen.getAllByTestId("refund-row");
    expect(rows.map((r) => r.getAttribute("data-view"))).toEqual(["bound", "released", "reserved", "never_sent", "closed"]);
    expect(rows[0]!.textContent).toContain(fill(EN["catering.refunds.view.bound"]!, { refund: "re_test_bound", status: EN["catering.refunds.stripe_status.requires_action"]! }));
    expect(rows[0]!.textContent).toContain(fill(EN["catering.refunds.view.attached_by"]!, { name: "Synthetic Person", date: when("2026-11-28T08:00:00Z") }));
    expect(rows[1]!.textContent).toContain(fill(EN["catering.refunds.view.released"]!, { name: "Synthetic Person", date: when("2026-11-28T08:30:00Z") }));
    expect(rows[2]!.textContent).toContain(EN["catering.refunds.view.reserved"]);
    expect(rows[3]!.textContent).toContain(EN["catering.refunds.view.never_sent"]);
    expect(rows[4]!.textContent).toContain(EN["catering.refunds.view.closed"]);
  });
});

describe("the refund form and one press", () => {
  async function openConfirm() {
    fireEvent.click(await screen.findByText(EN["catering.refunds.start"]!));
    fireEvent.click(await screen.findByText(EN["catering.refunds.review"]!));
    return screen.findByText(fill(EN["catering.refunds.confirm_button"]!, { amount: formatCents(30000, "en") }));
  }

  it("Full sends the confirmed number AND the refundable total it showed; a mixed press tells the truth per row", async () => {
    const rows = [
      { requestId: R1, paymentId: P1, amountCents: 10000, outcome: "created", posted: true, cause: null, stripeRefundId: "re_test_made", accountSlot: "location", httpStatus: 200, rowState: null, alreadyBound: false },
      { requestId: R2, paymentId: P2, amountCents: 8000, outcome: "unconfirmed", posted: true, cause: null, stripeRefundId: null, accountSlot: "location", httpStatus: 500, rowState: null, alreadyBound: false },
      { requestId: "00000000-0000-4000-8000-0000000000e3", paymentId: P2, amountCents: 7000, outcome: "never_sent", posted: false, cause: "stopped", stripeRefundId: null, accountSlot: null, httpStatus: null, rowState: null, alreadyBound: false },
      { requestId: "00000000-0000-4000-8000-0000000000e4", paymentId: P2, amountCents: 5000, outcome: "armed_unsent", posted: false, cause: "credential_mismatch", stripeRefundId: null, accountSlot: "location", httpStatus: null, rowState: null, alreadyBound: false },
    ];
    const r = routes((url, method) => {
      if (url === SUMMARY_URL && method === "GET") return reply(200, { summary: summary([pay()]) });
      if (url === SUMMARY_URL && method === "POST") return reply(200, { result: { kind: "pressed", rows }, summary: summary([pay({ state: "dirty", known: false })], { total: null }) });
      return undefined;
    });
    renderPanel();
    fireEvent.click(await openConfirm());
    await screen.findByTestId("refund-press");
    expect(r.bodies[0]!.body).toMatchObject({ amountCents: 30000, seenRefundableCents: 30000, reasonCode: "customer_cancelled", trigger: "panel" });
    const out = screen.getAllByTestId("refund-press-row");
    expect(out.map((x) => x.getAttribute("data-outcome"))).toEqual(["created", "unconfirmed", "never_sent", "armed_unsent"]);
    expect(out[0]!.textContent).toBe(fill(EN["catering.refunds.outcome.created"]!, { amount: formatCents(10000, "en"), refund: "re_test_made" }));
    expect(out[1]!.textContent).toBe(fill(EN["catering.refunds.outcome.unconfirmed"]!, { amount: formatCents(8000, "en") }));
    expect(out[1]!.textContent).toContain("Do not refund it again");
    expect(out[2]!.textContent).toBe(fill(EN["catering.refunds.outcome.never_sent"]!, { amount: formatCents(7000, "en"), cause: EN["catering.refunds.cause.stopped"]! }));
    expect(out[3]!.textContent).toBe(fill(EN["catering.refunds.outcome.armed_unsent"]!, { amount: formatCents(5000, "en"), cause: EN["catering.refunds.cause.credential_mismatch"]! }));
    // Only the created row is in the confirm colour; nothing else reads as done.
    expect(out.filter((x) => x.className.includes("text-co-confirm-text"))).toHaveLength(1);
  });

  it("[S11] a 409 stripe_unchecked shows the EXACT text (en and es) and re-draws from the summary in the error body", async () => {
    for (const lang of ["en", "es"] as const) {
      const after = summary([pay({ state: "dirty", known: false })], { total: null });
      routes((url, method) => {
        if (url === SUMMARY_URL && method === "GET") return reply(200, { summary: summary([pay()]) });
        if (url === SUMMARY_URL && method === "POST") return reply(409, { error: "stripe_unchecked", code: "stripe_unchecked", paymentId: P1, summary: after });
        return undefined;
      });
      renderPanel(lang);
      const dict = lang === "en" ? EN : ES;
      fireEvent.click(await screen.findByText(dict["catering.refunds.start"]!));
      fireEvent.click(await screen.findByText(dict["catering.refunds.review"]!));
      fireEvent.click(await screen.findByText(fill(dict["catering.refunds.confirm_button"]!, { amount: formatCents(30000, lang) })));
      const err = await screen.findByTestId("refund-error");
      expect(err.textContent).toBe(lang === "en"
        ? "This copy of your press did not send a refund. Check the list below before you try again."
        : "Esta copia de tu toque no envió un reembolso. Revisa la lista de abajo antes de intentarlo otra vez.");
      expect(screen.getByText(dict["catering.refunds.payment.checking"]!)).toBeTruthy();
      expect(screen.queryByTestId("refund-confirm")).toBeNull();
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  it("a 409 figures_changed re-draws the new total; the next confirm sends the NEW seen total", async () => {
    let posts = 0;
    const r = routes((url, method) => {
      if (url === SUMMARY_URL && method === "GET") return reply(200, { summary: summary([pay()]) });
      if (url === SUMMARY_URL && method === "POST") {
        posts += 1;
        return posts === 1
          ? reply(409, { code: "figures_changed", refundableCents: 20000, summary: summary([pay({ refundable_cents: 20000, counted_cents: 10000 })], { total: 20000 }) })
          : reply(200, { result: { kind: "replay", requests: [] }, summary: null });
      }
      return undefined;
    });
    renderPanel();
    fireEvent.click(await openConfirm());
    expect((await screen.findByTestId("refund-error")).textContent).toBe(EN["catering.refunds.error.figures_changed"]);
    // Back on the form (not the confirm), re-drawn at the new total.
    expect(screen.queryByTestId("refund-confirm")).toBeNull();
    expect(screen.getByTestId("refund-form").textContent).toContain(fill(EN["catering.refunds.choice.full"]!, { amount: formatCents(20000, "en") }));
    fireEvent.click(await screen.findByText(EN["catering.refunds.review"]!));
    fireEvent.click(await screen.findByText(fill(EN["catering.refunds.confirm_button"]!, { amount: formatCents(20000, "en") })));
    await screen.findByText(EN["catering.refunds.press.replay"]!);
    expect(r.bodies[1]!.body).toMatchObject({ amountCents: 20000, seenRefundableCents: 20000 });
    expect((r.bodies[1]!.body as { clientToken: string }).clientToken).not.toBe((r.bodies[0]!.body as { clientToken: string }).clientToken);
  });

  it("the password: NO request between the unlock and the confirm it was typed for", async () => {
    let posts = 0;
    const r = routes((url, method) => {
      if (url === SUMMARY_URL && method === "GET") return reply(200, { summary: summary([pay()]) });
      if (url === SUMMARY_URL && method === "POST") {
        posts += 1;
        return posts === 1 ? reply(403, { code: "step_up_required" }) : reply(200, { result: { kind: "pressed", rows: [] }, summary: summary([pay()]) });
      }
      if (url === "/api/auth/step-up" && method === "POST") return reply(200, { ok: true });
      return undefined;
    });
    renderPanel();
    fireEvent.click(await openConfirm());
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(EN["auth.step_up.password_label"]!), { target: { value: "synthetic-password" } });
    fireEvent.click(within(dialog).getByText(EN["auth.step_up.confirm"]!));
    await screen.findByTestId("refund-press");
    expect(r.log).toEqual([`GET ${SUMMARY_URL}`, `POST ${SUMMARY_URL}`, "POST /api/auth/step-up", `POST ${SUMMARY_URL}`]);
  });
});

describe("resolve an unconfirmed refund (release roles)", () => {
  const unconfirmed = (over: Record<string, unknown> = {}, payOver: Record<string, unknown> = {}, o: Parameters<typeof summary>[1] = {}) =>
    summary([pay({ blocked: true, requests: [req(over)], ...payOver })], { canRelease: true, ...o });

  it("names the account and the mode and the fingerprint; nothing is pre-selected; 'could not tell' sends nothing", async () => {
    const r = routes((url) => (url === SUMMARY_URL ? reply(200, { summary: unconfirmed() }) : undefined));
    renderPanel();
    const box = await screen.findByTestId("refund-resolve");
    expect(within(box).getByTestId("refund-resolve-where").textContent).toBe(
      "Open payment pi_test_panel_1 in Stripe. It is in this shop's own Stripe account, in test mode. If you cannot open it there, you are in the wrong account: stop.");
    expect(box.textContent).toContain(fill(EN["catering.refunds.resolve.fingerprint"]!, { fp: "0123456789abcdef" }));
    expect(box.textContent).toContain(`catering-refund:${R1}`);
    const radios = within(box).getAllByRole("radio") as HTMLInputElement[];
    expect(radios).toHaveLength(REFUND_FINDINGS.length);
    expect(radios.some((x) => x.checked)).toBe(false);
    const calls = r.log.length;
    fireEvent.click(within(box).getByLabelText(EN["catering.refunds.resolve.finding.unclear"]!));
    expect(within(box).getByTestId("refund-resolve-unclear").textContent).toBe("Do not release. Tell CC.");
    expect(within(box).queryByRole("button")).toBeNull();
    expect(r.log.length).toBe(calls);
  });

  it("the shared account in live mode is named as such", async () => {
    routes((url) => (url === SUMMARY_URL ? reply(200, { summary: unconfirmed({ arm_account_slot: "default", arm_livemode: true }) }) : undefined));
    renderPanel();
    expect((await screen.findByTestId("refund-resolve-where")).textContent).toContain("It is in the shared Stripe account, in live mode.");
  });

  it("'it succeeded': attach lists ONLY the refunds attachable to this request; the pick is sent", async () => {
    const s = unconfirmed({}, {
      refunds: [
        ref({ refund_id: "re_test_mine", kind: "candidate", names_request: true, request_id: R1, attachable_to: R1 }),
        ref({ refund_id: "re_test_outside", kind: "none" }),
        ref({ refund_id: "re_test_other", kind: "candidate", names_request: true, attachable_to: R2 }),
      ],
    });
    const r = routes((url, method) => {
      if (url === SUMMARY_URL && method === "GET") return reply(200, { summary: s });
      if (url === `${SUMMARY_URL}/${R1}/attach` && method === "POST") return reply(200, { result: { result: "attached" }, summary: s });
      return undefined;
    });
    renderPanel();
    const box = await screen.findByTestId("refund-resolve");
    fireEvent.click(within(box).getByLabelText(EN["catering.refunds.resolve.finding.request_succeeded"]!));
    const attach = within(box).getByTestId("refund-attach");
    const radios = within(attach).getAllByRole("radio") as HTMLInputElement[];
    expect(radios).toHaveLength(1);
    expect(radios[0]!.checked).toBe(false);
    expect(attach.textContent).toContain("re_test_mine");
    expect(attach.textContent).not.toContain("re_test_other");
    const button = within(attach).getByText(EN["catering.refunds.resolve.attach_button"]!) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(radios[0]!);
    fireEvent.click(button);
    await screen.findByText(EN["catering.refunds.resolve.done.attached"]!);
    expect(r.bodies).toEqual([{ url: `${SUMMARY_URL}/${R1}/attach`, body: { refundId: "re_test_mine", note: null } }]);
  });

  it("'it succeeded' with nothing to attach: do not release, press Check Stripe, tell CC", async () => {
    routes((url) => (url === SUMMARY_URL ? reply(200, { summary: unconfirmed() }) : undefined));
    renderPanel();
    const box = await screen.findByTestId("refund-resolve");
    fireEvent.click(within(box).getByLabelText(EN["catering.refunds.resolve.finding.request_succeeded"]!));
    expect(within(box).getByTestId("refund-attach-none").textContent).toContain("Do not release. Press Check Stripe, then tell CC.");
  });

  it("release is hidden before releasableAt", async () => {
    routes((url) => (url === SUMMARY_URL ? reply(200, { summary: unconfirmed({ releasable_at: "2026-11-28T12:00:00Z" }) }) : undefined));
    renderPanel();
    const box = await screen.findByTestId("refund-resolve");
    fireEvent.click(within(box).getByLabelText(EN["catering.refunds.resolve.finding.no_request"]!));
    expect(within(box).getByTestId("refund-release-wait")).toBeTruthy();
    expect(within(box).queryByTestId("refund-release")).toBeNull();
    expect(within(box).queryByText(EN["catering.refunds.resolve.release_button"]!)).toBeNull();
  });

  it("after releasableAt: account and mode are picked (nothing pre-selected) and sent with the finding", async () => {
    const r = routes((url, method) => {
      if (url === SUMMARY_URL && method === "GET") return reply(200, { summary: unconfirmed() });
      if (url === `${SUMMARY_URL}/${R1}/release` && method === "POST") return reply(200, { result: { result: "released" }, summary: unconfirmed() });
      return undefined;
    });
    renderPanel();
    const box = await screen.findByTestId("refund-resolve");
    fireEvent.click(within(box).getByLabelText(EN["catering.refunds.resolve.finding.request_failed"]!));
    const rel = within(box).getByTestId("refund-release");
    const radios = within(rel).getAllByRole("radio") as HTMLInputElement[];
    expect(radios).toHaveLength(REFUND_ACCOUNT_SLOTS.length + 2);
    expect(radios.some((x) => x.checked)).toBe(false);
    const button = within(rel).getByText(EN["catering.refunds.resolve.release_button"]!) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(within(rel).getByLabelText(EN["catering.refunds.resolve.account_option.location"]!));
    expect(button.disabled).toBe(true);
    fireEvent.click(within(rel).getByLabelText(EN["catering.refunds.resolve.mode_option.test"]!));
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await screen.findByText(EN["catering.refunds.resolve.done.released"]!);
    expect(r.bodies).toEqual([{ url: `${SUMMARY_URL}/${R1}/release`, body: { finding: "request_failed", accountSlot: "location", livemode: false, note: null } }]);
  });

  it("a legacy request (no fingerprint): the tell-CC line and no form", async () => {
    routes((url) => (url === SUMMARY_URL ? reply(200, { summary: unconfirmed({ legacy: true, arm_account_slot: null, arm_livemode: null }) }) : undefined));
    renderPanel();
    expect((await screen.findByTestId("refund-resolve-legacy")).textContent).toBe(
      "The Stripe key for this shop changed since this refund was sent. It cannot be resolved here. Tell CC.");
    expect(screen.queryByTestId("refund-resolve")).toBeNull();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("a credential_changed answer: the tell-CC line replaces the form [T5]", async () => {
    routes((url, method) => {
      if (url === SUMMARY_URL && method === "GET") return reply(200, { summary: unconfirmed() });
      if (url === `${SUMMARY_URL}/${R1}/release`) return reply(409, { code: "credential_changed" });
      return undefined;
    });
    renderPanel();
    const box = await screen.findByTestId("refund-resolve");
    fireEvent.click(within(box).getByLabelText(EN["catering.refunds.resolve.finding.no_request"]!));
    fireEvent.click(within(box).getByLabelText(EN["catering.refunds.resolve.account_option.location"]!));
    fireEvent.click(within(box).getByLabelText(EN["catering.refunds.resolve.mode_option.test"]!));
    fireEvent.click(within(box).getByText(EN["catering.refunds.resolve.release_button"]!));
    await screen.findByTestId("refund-resolve-legacy");
    expect(screen.queryByTestId("refund-resolve")).toBeNull();
    expect(screen.getByTestId("refund-error").getAttribute("data-code")).toBe("credential_changed");
  });

  it("not a release role: no resolve section at all", async () => {
    routes((url) => (url === SUMMARY_URL ? reply(200, { summary: unconfirmed({}, {}, { canRelease: false }) }) : undefined));
    renderPanel();
    await screen.findByTestId("refund-row-unconfirmed");
    expect(screen.queryByTestId("refund-resolve")).toBeNull();
  });

  it("while a release waits for the password nothing else is requested (Check Stripe is held), and the unlock goes straight to the release", async () => {
    // P1 has the unconfirmed request; P2 is dirty, so a "Check Stripe now" button is on the page.
    const s = summary([pay({ blocked: true, requests: [req()] }), pay({ payment_id: P2, kind: "balance", state: "dirty", known: false, payment_intent: "pi_test_panel_2" })], { canRelease: true, total: null });
    let releases = 0;
    const r = routes((url, method) => {
      if (url === SUMMARY_URL && method === "GET") return reply(200, { summary: s });
      if (url === `${SUMMARY_URL}/${R1}/release` && method === "POST") {
        releases += 1;
        return releases === 1 ? reply(403, { code: "step_up_stale" }) : reply(200, { result: { result: "released" }, summary: s });
      }
      if (url === "/api/auth/step-up" && method === "POST") return reply(200, { ok: true });
      if (url === `${SUMMARY_URL}/check`) return reply(200, { checks: [], summary: s });
      return undefined;
    });
    renderPanel();
    const box = await screen.findByTestId("refund-resolve");
    fireEvent.click(within(box).getByLabelText(EN["catering.refunds.resolve.finding.no_request"]!));
    fireEvent.click(within(box).getByLabelText(EN["catering.refunds.resolve.account_option.location"]!));
    fireEvent.click(within(box).getByLabelText(EN["catering.refunds.resolve.mode_option.test"]!));
    fireEvent.click(within(box).getByText(EN["catering.refunds.resolve.release_button"]!));
    const dialog = await screen.findByRole("dialog");
    const check = screen.getByTestId("refund-check-now") as HTMLButtonElement;
    expect(check.disabled).toBe(true);
    fireEvent.click(check);
    expect(r.log.filter((x) => x.endsWith("/check"))).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(EN["auth.step_up.password_label"]!), { target: { value: "synthetic-password" } });
    fireEvent.click(within(dialog).getByText(EN["auth.step_up.confirm"]!));
    await screen.findByText(EN["catering.refunds.resolve.done.released"]!);
    const i = r.log.indexOf("POST /api/auth/step-up");
    expect(r.log.slice(i)).toEqual(["POST /api/auth/step-up", `POST ${SUMMARY_URL}/${R1}/release`]);
    expect(r.log.filter((x) => x.endsWith("/check"))).toHaveLength(0);
  });
});

describe("loading", () => {
  it("a failed read shows the unavailable state with Try again, and Try again reloads", async () => {
    let gets = 0;
    routes((url) => {
      if (url !== SUMMARY_URL) return undefined;
      gets += 1;
      return gets === 1 ? reply(500, { code: "generic" }) : reply(200, { summary: summary([pay()]) });
    });
    renderPanel();
    expect(await screen.findByText(EN["catering.refunds.unavailable"]!)).toBeTruthy();
    fireEvent.click(screen.getByText(EN["catering.refunds.try_again"]!));
    expect(await screen.findByTestId("refund-totals")).toBeTruthy();
    expect(gets).toBe(2);
  });
});

describe("LeadRefundBanner", () => {
  const banner = (on = true) => render(wrap(jsx(RefundsSwitch, { on, children: jsx(LeadRefundBanner, { leadId: L, phase: "lost" }) })));

  it("an amount only when every payment is known; otherwise the checking line and NO number (never 0)", async () => {
    routes(() => reply(200, { quotes: [
      { quoteId: Q, refundableCents: null, capturedCents: null, allKnown: false, eligiblePayments: 1 },
      { quoteId: "00000000-0000-4000-8000-0000000000b2", refundableCents: 12000, capturedCents: 30000, allKnown: true, eligiblePayments: 1 },
      { quoteId: "00000000-0000-4000-8000-0000000000b3", refundableCents: 0, capturedCents: 30000, allKnown: true, eligiblePayments: 1 },
    ] }));
    banner();
    const quotes = await screen.findAllByTestId("lead-refund-quote");
    expect(quotes).toHaveLength(2);
    expect(quotes[0]!.textContent).toContain(EN["catering.refunds.lead.checking"]);
    expect(quotes[0]!.textContent ?? "").not.toMatch(NO_MONEY);
    expect(quotes[1]!.textContent).toContain(fill(EN["catering.refunds.lead.lost"]!, { paid: formatCents(30000, "en"), refundable: formatCents(12000, "en") }));
  });

  it("a failed read says it could not check (with Try again); an empty read renders nothing", async () => {
    let n = 0;
    routes(() => (++n === 1 ? reply(503, { code: "refunds_unavailable" }) : reply(200, { quotes: [] })));
    const { container } = banner();
    expect(await screen.findByText(EN["catering.refunds.lead.unavailable"]!)).toBeTruthy();
    fireEvent.click(screen.getByText(EN["catering.refunds.try_again"]!));
    await waitFor(() => expect(screen.queryByText(EN["catering.refunds.lead.unavailable"]!)).toBeNull());
    expect(container.querySelector("[data-testid='lead-refund-banner']")).toBeNull();
  });

  it("switch off, or no switch at all (OFF parity): nothing renders and nothing is fetched", () => {
    const r = routes(() => undefined);
    const { container } = banner(false);
    expect(container.textContent).toBe("");
    cleanup();
    const absent = render(wrap(jsx(LeadRefundBanner, { leadId: L, phase: "confirming_lost" })));
    expect(absent.container.textContent).toBe("");
    expect(r.fn).not.toHaveBeenCalled();
  });
});

// ── i18n: every key the panel, the banner and the inventory page use resolves in en AND es ────────────────
describe("i18n", () => {
  const SOURCES = ["components/catering/quotes/RefundPanel.tsx", "components/catering/LeadRefundBanner.tsx", "app/admin/catering/refunds/page.tsx"];
  const holes = (v: string) => [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  const NAMESPACES = ["catering.refunds.", "admin.cateringRefunds."];

  it("the two namespaces hold the same keys in en and es, each non-empty with the same params, never usted", () => {
    for (const ns of NAMESPACES) {
      const e = Object.keys(EN).filter((k) => k.startsWith(ns)).sort();
      const s = Object.keys(ES).filter((k) => k.startsWith(ns)).sort();
      expect(s).toEqual(e);
      for (const k of e) {
        expect(EN[k], k).toBeTruthy();
        expect(ES[k], k).toBeTruthy();
        expect(holes(ES[k]!), k).toEqual(holes(EN[k]!));
        expect(ES[k], k).not.toMatch(/\busted\b/i);
      }
    }
  });

  it("every literal key in the sources exists in both files; every template family is complete", () => {
    for (const file of SOURCES) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/"((?:catering\.refunds|admin\.cateringRefunds)\.[A-Za-z_.]+)"/g)) {
        expect(EN[m[1]!], `${file}: ${m[1]}`).toBeTruthy();
        expect(ES[m[1]!], `${file}: ${m[1]}`).toBeTruthy();
      }
      // A template key (`...${x}`) must name a family listed below.
      for (const m of src.matchAll(/`((?:catering\.refunds|admin\.cateringRefunds)\.[A-Za-z_.]+)\$\{/g)) {
        expect(Object.keys(FAMILIES), `${file}: ${m[1]}`).toContain(m[1]);
      }
      expect(src, file).not.toMatch(/toLocale/);
      for (const c of src.matchAll(/min-h-\[44px\][^"`]*/g)) expect(c[0], `${file}: ${c[0]}`).toContain("items-center");
    }
    for (const [prefix, members] of Object.entries(FAMILIES)) {
      for (const m of members) {
        expect(EN[`${prefix}${m}`], `${prefix}${m}`).toBeTruthy();
        expect(ES[`${prefix}${m}`], `${prefix}${m}`).toBeTruthy();
      }
    }
  });

  it("the 13 v2 error codes (and every other REFUND_ERROR_CODE) have their own message", () => {
    for (const c of REFUND_ERROR_CODES) {
      expect(EN[`catering.refunds.error.${c}`], c).toBeTruthy();
      expect(ES[`catering.refunds.error.${c}`], c).toBeTruthy();
    }
  });

  it("the retired copy is gone: no Retry-send, no 24-hour window text, no reconcile copy", () => {
    for (const k of ["catering.refunds.retry", "catering.refunds.needs_reconcile", "catering.refunds.release_confirm", "catering.refunds.result.pending", "catering.refunds.error.needs_reconcile", "catering.refunds.error.not_retryable"]) {
      expect(EN[k], k).toBeUndefined();
      expect(ES[k], k).toBeUndefined();
    }
    const src = readFileSync("components/catering/quotes/RefundPanel.tsx", "utf8");
    expect(src).not.toMatch(/\/retry/);
  });
});

const OUTCOMES = [
  "created", "unconfirmed", "answer_mismatch", "answer_conflict", "answered_after_release", "already_bound_unconfirmed_answer", "closed",
  "finish_not_armed", "finish_state_changed", "finish_not_found", "finish_unrecorded", "never_sent", "not_armable", "armed_unsent",
  "cancel_failed", "row_not_found",
];
const CAUSES = ["deadline", "payment_intent_changed", "figures_stale", "deadline_passed", "arm_unanswered", "stopped", "credential_mismatch", "not_sent_by_client", "unknown"];
const FAMILIES: Record<string, readonly string[]> = {
  "catering.refunds.error.": REFUND_ERROR_CODES,
  "catering.refunds.reason.": REFUND_REASON_CODES,
  "catering.refunds.stripe_status.": ["pending", "succeeded", "failed", "canceled", "requires_action", "unknown"],
  "catering.refunds.cause.": CAUSES,
  "catering.refunds.outcome.": OUTCOMES,
  "catering.refunds.refund.warning.": REFUND_CLAIM_KINDS.filter((k) => k !== "bound" && k !== "none"),
  "catering.refunds.payment.kind.": ["deposit", "balance", "full"],
  "catering.refunds.resolve.finding.": REFUND_FINDINGS,
  "catering.refunds.resolve.account.": REFUND_ACCOUNT_SLOTS,
  "catering.refunds.resolve.account_option.": REFUND_ACCOUNT_SLOTS,
  "admin.cateringRefunds.counts.": [
    "in_scope", "paused", "never_read", "dirty", "known", "not_complete", "open_reads", "abandoned_reads", "disagreements",
    "unresolved_requests", "unconfirmed", "legacy_attempted", "attachable", "released_with_refund", "unbound_claims",
  ],
  "admin.cateringRefunds.lists.heading.": ["not_complete", "never_read", "dirty", "open_reads", "disagreements", "unresolved_requests", "claims"],
  "admin.cateringRefunds.field.": [
    "payment", "request", "refund", "reason", "status", "amount", "kind", "conflict_with", "attempted_at", "started_at", "abandoned", "captured",
    "counted", "stripe_whole", "armed", "armed_at", "releasable_at", "requested_at", "legacy", "last_error", "attachable_to",
  ],
};
