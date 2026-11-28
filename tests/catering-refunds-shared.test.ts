/**
 * Catering refunds — the pure rules (lib/catering/refunds-shared.ts), re-written for Part B1 v2 [R17]: every case of
 * the 0357-era file that is still valid is ported to the kept and new exports (the switches, the gates, the role
 * lists, the strict bodies, the typed-dollars parse, Stripe's vocabulary, the idempotency key, the named refusals),
 * and the v2 additions are pinned: `refundCreateBlock` in every switch combination with `REFUND_PARTS_BUILT`, the
 * release roles, the release / attach / check bodies, the F7 -> read-model mapper with every request `view`.
 * Removed exports (`refundFigures`, `allocateRefund`, the retry window, `stripeCreateFailure`, ...) have no case here
 * by design: v2 has ONE figures definition, in SQL.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import * as shared from "@/lib/catering/refunds-shared";
import {
  canReleaseRefund,
  canRequestRefund,
  cateringRefundsObserveOn,
  cateringRefundsOn,
  parseAttachBody,
  parseCheckBody,
  parseRefundBody,
  parseReleaseBody,
  refundActionBlock,
  refundCreateBlock,
  refundDollarsToCents,
  refundFormOffered,
  refundIdempotencyKey,
  refundRefusal,
  refundStatusFromStripe,
  refundSummaryFromRpc,
  requestView,
  stripeRefundReason,
  summarizeTotals,
  REFUND_ERROR_CODES,
  REFUND_FINDINGS,
  REFUND_PARTS_BUILT,
  REFUND_REASON_CODES,
  REFUND_RELEASE_FINDINGS,
  REFUND_RELEASE_ROLES,
  REFUND_REQUEST_VIEWS,
  REFUND_ROLES,
  REFUND_RPC_REFUSALS,
  REFUND_SQL_REFUSALS,
  REFUND_STATUSES,
} from "@/lib/catering/refunds-shared";
import { ROLES, type RoleCode } from "@/lib/roles";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const ALL_ROLES = Object.keys(ROLES) as RoleCode[];

describe("the switches", () => {
  it("only CATERING_REFUNDS=1 turns the panel on (unchanged)", () => {
    expect(cateringRefundsOn({})).toBe(false);
    expect(cateringRefundsOn({ CATERING_REFUNDS: "0" })).toBe(false);
    expect(cateringRefundsOn({ CATERING_REFUNDS: "true" })).toBe(false);
    expect(cateringRefundsOn({ CATERING_REFUNDS: "1" })).toBe(true);
    expect(cateringRefundsOn({ CATERING_REFUNDS_OBSERVE: "1" })).toBe(false);
  });
  it("only CATERING_REFUNDS_OBSERVE=1 turns observation on, independently", () => {
    expect(cateringRefundsObserveOn({})).toBe(false);
    expect(cateringRefundsObserveOn({ CATERING_REFUNDS_OBSERVE: "yes" })).toBe(false);
    expect(cateringRefundsObserveOn({ CATERING_REFUNDS: "1" })).toBe(false);
    expect(cateringRefundsObserveOn({ CATERING_REFUNDS_OBSERVE: "1" })).toBe(true);
  });
  it("REFUND_PARTS_BUILT is false in Part B1", () => {
    expect(REFUND_PARTS_BUILT).toBe(false);
  });
  it("the module never reads process.env itself (a -shared module takes `env` as an argument)", () => {
    const src = readFileSync("lib/catering/refunds-shared.ts", "utf8");
    expect(src).not.toMatch(/process\.env/);
    expect(src).not.toMatch(/^import (?!type )/m);
  });
});

describe("refundCreateBlock: all four switch combinations, with and without the parts built", () => {
  const combos: Array<[Record<string, string>, boolean, string | null]> = [
    [{}, false, "refunds_off"],
    [{}, true, "refunds_off"],
    [{ CATERING_REFUNDS_OBSERVE: "1" }, false, "refunds_off"],
    [{ CATERING_REFUNDS_OBSERVE: "1" }, true, "refunds_off"],
    [{ CATERING_REFUNDS: "1" }, false, "refunds_unavailable"],
    [{ CATERING_REFUNDS: "1" }, true, "refunds_unavailable"],
    [{ CATERING_REFUNDS: "1", CATERING_REFUNDS_OBSERVE: "1" }, false, "refunds_not_activated"],
    [{ CATERING_REFUNDS: "1", CATERING_REFUNDS_OBSERVE: "1" }, true, null],
  ];
  it.each(combos)("env %j, parts built %s -> %s", (env, built, want) => {
    expect(refundCreateBlock(env, built)).toBe(want);
  });
  it("with no second argument the build constant decides: today nothing can be created", () => {
    expect(refundCreateBlock({ CATERING_REFUNDS: "1", CATERING_REFUNDS_OBSERVE: "1" })).toBe("refunds_not_activated");
  });
  it("Check / Attach / Release need both switches and no build gate", () => {
    expect(refundActionBlock({})).toBe("refunds_off");
    expect(refundActionBlock({ CATERING_REFUNDS_OBSERVE: "1" })).toBe("refunds_off");
    expect(refundActionBlock({ CATERING_REFUNDS: "1" })).toBe("refunds_unavailable");
    expect(refundActionBlock({ CATERING_REFUNDS: "1", CATERING_REFUNDS_OBSERVE: "1" })).toBeNull();
  });
});

describe("who may refund (Juan 2026-11-25: GM and AGM too) — ported", () => {
  it("exactly six roles: catering manager, AGM, GM, MoO, owner, CGS", () => {
    const allowed = ALL_ROLES.filter(canRequestRefund).sort();
    expect(allowed).toEqual(["agm", "catering_mgr", "cgs", "gm", "moo", "owner"]);
    expect([...REFUND_ROLES].sort()).toEqual(allowed);
    expect(new Set(REFUND_ROLES).size).toBe(REFUND_ROLES.length);
  });
  it("a ROLE list, never a level: the other level-6 managers and everyone below stay out", () => {
    const level6 = ALL_ROLES.filter((r) => ROLES[r].level === 6).sort();
    expect(level6).toEqual(["agm", "catering_mgr", "prep_mgr", "social_media_mgr"]);
    for (const role of ["prep_mgr", "social_media_mgr", "shift_lead", "key_holder", "trainer", "employee", "trainee", "hired_not_yet_worked", "prospect"] as RoleCode[]) {
      expect(canRequestRefund(role), role).toBe(false);
    }
    expect(ALL_ROLES.filter((r) => !canRequestRefund(r))).toHaveLength(ALL_ROLES.length - 6);
  });
  it("the forbidden message names every role, and says WHO needs a shop, in both languages", () => {
    const key = "catering.refunds.error.forbidden";
    const words = (text: string) => text.split(/[^\p{L}]+/u).filter(Boolean);
    for (const word of ["AGM", "GM", "MoO", "CGS", "owner"]) expect(words(en[key]), word).toContain(word);
    for (const word of ["AGM", "GM", "MoO", "CGS", "dueño"]) expect(words(es[key]), word).toContain(word);
    const [enAny, enMember] = en[key].split(" at any shop; ");
    expect(enMember).toBeDefined();
    for (const word of ["owner", "CGS"]) expect(words(enAny!), word).toContain(word);
    for (const word of ["MoO", "AGM", "GM"]) expect(words(enAny!), word).not.toContain(word);
    expect(enMember).toContain("only at a shop they belong to");
    const [esAny, esMember] = es[key].split(" en cualquier tienda; ");
    expect(esMember).toBeDefined();
    for (const word of ["dueño", "CGS"]) expect(words(esAny!), word).toContain(word);
    expect(esMember).toContain("solo en una tienda a la que pertenecen");
  });
});

describe("who may resolve (attach / release) [DR3]", () => {
  it("exactly MoO, owner and CGS — a ROLE list", () => {
    expect(ALL_ROLES.filter(canReleaseRefund).sort()).toEqual(["cgs", "moo", "owner"]);
    expect([...REFUND_RELEASE_ROLES].sort()).toEqual(["cgs", "moo", "owner"]);
    for (const role of ["gm", "agm", "catering_mgr", "prep_mgr", "social_media_mgr", "shift_lead"] as RoleCode[]) {
      expect(canReleaseRefund(role), role).toBe(false);
    }
  });
  it("every release role may also refund (the release roles are a subset)", () => {
    for (const r of REFUND_RELEASE_ROLES) expect(canRequestRefund(r), r).toBe(true);
  });
  it("held equal to 0359 catering_refund_release_role", () => {
    const sql = readFileSync("supabase/migrations/0359_catering_refund_mirror.sql", "utf8");
    const fn = sql.slice(sql.indexOf("create function public.catering_refund_release_role"), sql.indexOf("-- ── F14"));
    expect(fn).toContain("v_role in ('owner', 'cgs')");
    expect(fn).toContain("v_role = 'moo'");
  });
});

describe("Stripe's vocabulary — ported", () => {
  it("a refund's status maps onto ours (docs.stripe.com/api/refunds/object)", () => {
    expect(refundStatusFromStripe("succeeded")).toBe("succeeded");
    expect(refundStatusFromStripe("pending")).toBe("submitted");
    expect(refundStatusFromStripe("requires_action")).toBe("submitted");
    expect(refundStatusFromStripe("failed")).toBe("failed");
    expect(refundStatusFromStripe("canceled")).toBe("failed");
    expect(refundStatusFromStripe("weird")).toBeNull();
    expect(refundStatusFromStripe(null)).toBeNull();
  });
  it("our reasons map onto Stripe's enum; never fraudulent", () => {
    expect(stripeRefundReason("duplicate_charge")).toBe("duplicate");
    for (const r of ["customer_cancelled", "quote_declined", "event_lost"] as const) expect(stripeRefundReason(r)).toBe("requested_by_customer");
    for (const r of ["service_issue", "other"] as const) expect(stripeRefundReason(r)).toBeNull();
    for (const r of REFUND_REASON_CODES) expect(stripeRefundReason(r)).not.toBe("fraudulent");
  });
  it("the idempotency key is `catering-refund:<request id>` (the client builds the same spelling)", () => {
    expect(refundIdempotencyKey("abc")).toBe("catering-refund:abc");
    expect(readFileSync("lib/stripe/client.ts", "utf8")).toContain("`catering-refund:${requestId}`");
  });
});

describe("parseRefundBody — strict, ported, + required seenRefundableCents [DR6]", () => {
  const ok = { clientToken: "11111111-1111-4111-8111-111111111111", amountCents: 1000, seenRefundableCents: 2500, reasonCode: "event_lost", reasonNote: " lost it ", trigger: "lost" };
  it("accepts a good body and trims the note", () => {
    expect(parseRefundBody(ok)).toEqual({ ...ok, reasonNote: "lost it" });
    expect(parseRefundBody({ ...ok, reasonNote: null })).toMatchObject({ amountCents: 1000, reasonNote: null });
    expect(parseRefundBody({ ...ok, clientToken: ok.clientToken.toUpperCase() })).toMatchObject({ clientToken: ok.clientToken });
  });
  it("the amount is required", () => {
    expect(parseRefundBody({ ...ok, amountCents: null })).toBe("invalid_amount");
    const { amountCents: _drop, ...noAmount } = ok;
    void _drop;
    expect(parseRefundBody(noAmount)).toBe("invalid_amount");
  });
  it("seenRefundableCents is REQUIRED: a non-negative integer", () => {
    const { seenRefundableCents: _drop, ...noSeen } = ok;
    void _drop;
    expect(parseRefundBody(noSeen)).toBe("invalid_request");
    for (const v of [null, -1, 1.5, "2500", 10_000_001]) expect(parseRefundBody({ ...ok, seenRefundableCents: v }), String(v)).toBe("invalid_request");
    expect(parseRefundBody({ ...ok, seenRefundableCents: 0 })).toMatchObject({ seenRefundableCents: 0 });
  });
  it("refuses unknown keys, bad tokens, reasons and triggers", () => {
    expect(parseRefundBody({ ...ok, extra: 1 })).toBe("invalid_request");
    expect(parseRefundBody({ ...ok, clientToken: "nope" })).toBe("invalid_request");
    expect(parseRefundBody({ ...ok, reasonCode: "because" })).toBe("invalid_request");
    expect(parseRefundBody({ ...ok, trigger: "constructor" })).toBe("invalid_request");
    expect(parseRefundBody(null)).toBe("invalid_request");
    expect(parseRefundBody([ok])).toBe("invalid_request");
    expect(parseRefundBody({ ...ok, reasonNote: "x".repeat(501) })).toBe("invalid_request");
  });
  it("refuses a non-integer, zero, negative or huge amount", () => {
    for (const a of [10.5, 0, -1, "100", 10_000_001]) expect(parseRefundBody({ ...ok, amountCents: a })).toBe("invalid_amount");
  });
  it("`other` needs a note", () => {
    expect(parseRefundBody({ ...ok, reasonCode: "other", reasonNote: "   " })).toBe("note_required");
    expect(parseRefundBody({ ...ok, reasonCode: "other", reasonNote: "card charged twice" })).toMatchObject({ reasonCode: "other" });
  });
});

describe("the release / attach / check bodies", () => {
  const rel = { finding: "no_request", accountSlot: "location", livemode: true, note: "  checked the log  " };
  it("release: exactly { finding, accountSlot, livemode, note? }", () => {
    expect(parseReleaseBody(rel)).toEqual({ finding: "no_request", accountSlot: "location", livemode: true, note: "checked the log" });
    expect(parseReleaseBody({ finding: "request_failed", accountSlot: "default", livemode: false })).toEqual({ finding: "request_failed", accountSlot: "default", livemode: false, note: null });
    expect(parseReleaseBody({ ...rel, extra: 1 })).toBe("invalid_request");
    expect(parseReleaseBody({ ...rel, finding: "maybe" })).toBe("invalid_request");
    expect(parseReleaseBody({ ...rel, accountSlot: "acct_123" })).toBe("invalid_request");
    expect(parseReleaseBody({ ...rel, livemode: "true" })).toBe("invalid_request");
    const { livemode: _l, ...noMode } = rel;
    void _l;
    expect(parseReleaseBody(noMode)).toBe("invalid_request");
    expect(parseReleaseBody({ ...rel, note: "x".repeat(501) })).toBe("invalid_request");
    expect(parseReleaseBody(null)).toBe("invalid_request");
  });
  it("release: `request_succeeded` is use_attach; `unclear` releases nothing", () => {
    expect(parseReleaseBody({ ...rel, finding: "request_succeeded" })).toBe("use_attach");
    expect(parseReleaseBody({ ...rel, finding: "unclear" })).toBe("finding_not_releasable");
    expect([...REFUND_FINDINGS].sort()).toEqual(["no_request", "request_failed", "request_succeeded", "unclear"]);
    expect([...REFUND_RELEASE_FINDINGS]).toEqual(["no_request", "request_failed"]);
  });
  it("release findings are held equal to 0359 F12's", () => {
    const sql = readFileSync("supabase/migrations/0359_catering_refund_mirror.sql", "utf8");
    expect(sql).toContain("p_finding not in ('no_request', 'request_failed')");
    expect(sql).toContain("if p_finding = 'request_succeeded' then raise exception 'use_attach'");
  });
  it("attach: exactly { refundId, note? } with a Stripe refund id", () => {
    expect(parseAttachBody({ refundId: "re_123abc" })).toEqual({ refundId: "re_123abc", note: null });
    expect(parseAttachBody({ refundId: "pyr_1", note: " ok " })).toEqual({ refundId: "pyr_1", note: "ok" });
    for (const refundId of ["", "ch_1", "re_a/b", "re_", 12]) expect(parseAttachBody({ refundId }), String(refundId)).toBe("invalid_request");
    expect(parseAttachBody({ refundId: "re_1", extra: true })).toBe("invalid_request");
  });
  it("check: `{}` only", () => {
    expect(parseCheckBody({})).toBe(true);
    for (const b of [null, [], { x: 1 }, "x"]) expect(parseCheckBody(b)).toBe("invalid_request");
  });
});

describe("refundDollarsToCents — ported", () => {
  it("reads dollars without float maths", () => {
    expect(refundDollarsToCents("12.34")).toBe(1234);
    expect(refundDollarsToCents("$0.1")).toBe(10);
    expect(refundDollarsToCents("19.99")).toBe(1999);
    expect(refundDollarsToCents(" 300 ")).toBe(30000);
    for (const bad of ["", "0", "0.00", "1.234", "-5", "abc", "1,000"]) expect(refundDollarsToCents(bad)).toBeNull();
  });
});

describe("named refusals", () => {
  it("0357's map is kept exactly (its migration test holds it equal to 0357's raises)", () => {
    expect(Object.keys(REFUND_SQL_REFUSALS).sort()).toEqual(
      ["forbidden", "invalid_amount", "invalid_reason", "invalid_request", "note_required", "note_too_long", "nothing_refundable", "over_refundable", "quote_not_found", "token_reused"]);
  });
  it("every v2 refusal maps to a code the routes may answer", () => {
    for (const [fn, map] of Object.entries(REFUND_RPC_REFUSALS)) {
      for (const [name, r] of Object.entries(map)) {
        expect(REFUND_ERROR_CODES as readonly string[], `${fn}.${name}`).toContain(r.code);
        expect([400, 403, 404, 409, 503], `${fn}.${name}`).toContain(r.status);
      }
    }
  });
  it("figures_stale is stripe_unchecked on the create [S11], figures_stale on a release / attach", () => {
    expect(refundRefusal("reserve", "figures_stale")).toEqual({ status: 409, code: "stripe_unchecked" });
    expect(refundRefusal("release", "figures_stale")).toEqual({ status: 409, code: "figures_stale" });
    expect(refundRefusal("attach", "figures_stale")).toEqual({ status: 409, code: "figures_stale" });
    expect(refundRefusal("reserve", "refunds_not_activated")).toEqual({ status: 503, code: "refunds_not_activated" });
    expect(refundRefusal("release", "credential_changed")).toEqual({ status: 409, code: "credential_changed" });
    expect(refundRefusal("release", "constructor")).toBeNull();
    expect(refundRefusal("attach", "use_attach")).toBeNull();
  });
  it("every P0001 name 0359's three raising functions raise is mapped (and nothing else)", () => {
    const sql = readFileSync("supabase/migrations/0359_catering_refund_mirror.sql", "utf8");
    const body = (fn: string) => {
      const start = sql.indexOf(`create function public.${fn}(`);
      return sql.slice(start, sql.indexOf("end $$;", start));
    };
    const raised = (fn: string) => [...new Set([...body(fn).matchAll(/raise exception '([a-z_]+)' using errcode = 'P0001'/g)].map((m) => m[1]!))].sort();
    const quiet = new Set(["refund_bind_defect"]); // a defect guard (both rows under the call's own lock): a 500, never a refusal
    const reserveRaised = raised("catering_refund_reserve_fresh");
    expect(reserveRaised.filter((n) => !refundRefusal("reserve", n))).toEqual([]);
    expect(raised("catering_refund_release").filter((n) => !refundRefusal("release", n))).toEqual([]);
    expect(raised("catering_refund_attach").filter((n) => !quiet.has(n) && !refundRefusal("attach", n))).toEqual([]);
    // 0359 F8 raises nothing the map does not know: the reserve map is 0357's plus v2's three.
    expect(Object.keys(REFUND_RPC_REFUSALS.reserve).filter((n) => !(n in REFUND_SQL_REFUSALS)).sort()).toEqual(["figures_changed", "figures_stale", "refunds_not_activated"]);
  });
  it("the removed 0357-era exports are gone (v2 has ONE figures definition, in SQL)", () => {
    for (const name of ["refundFigures", "stripeCreateFailure", "REFUND_RETRY_WINDOW_MS", "REFUND_SEND_MARGIN_MS", "resendStillInWindow", "requestRetryState", "allocateRefund"]) {
      expect(name in shared, name).toBe(false);
    }
  });
});

// ── The F7 mapper ─────────────────────────────────────────────────────────────────────────────────────────
const Q = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const P1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const P2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const U = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const req = (over: Record<string, unknown>) => ({
  id: `11111111-0000-4000-8000-${String(Math.random()).slice(2, 14).padEnd(12, "0")}`, amount_cents: 1000, status: "pending", reason_code: "customer_cancelled",
  trigger: "panel", requested_by: U, requested_at: "2026-11-28T10:00:00Z", armed: false, armed_at: null, releasable_at: null,
  stripe_refund_id: null, last_error_code: null, resolved_by: null, resolved_at: null, settled_at: null,
  arm_account_slot: null, arm_livemode: null, arm_credential_fp: null, legacy: false, ...over,
});
const payment = (over: Record<string, unknown>) => ({
  payment_id: P1, kind: "deposit", status: "paid", amount_cents: 30000, paid_at: "2026-11-01T00:00:00Z", payment_intent: "pi_1",
  eligible: true, state: "known", known: true, checked_at: "2026-11-28T09:00:00Z", captured_cents: 30000, counted_cents: 1000,
  in_flight_cents: 0, refundable_cents: 29000, blocked: false, stripe_whole: false, disagrees: false, account_slot: "location",
  livemode: false, credential_fp: "0123456789abcdef", last_attempt_at: "2026-11-28T09:00:01Z", last_attempt_result: "complete",
  refunds: [], requests: [], ...over,
});
const f7 = (payments: unknown[], over: Record<string, unknown> = {}) => ({
  quotes: [{ quote_id: Q, location_id: SHOP, payments, all_known: true, eligible_payments: payments.length, refundable_total_cents: 29000, ...over }],
  generated_at: "2026-11-28T10:00:00Z",
  parts_ready: false,
});
const map = (raw: unknown, o: Partial<{ canRefund: boolean; canRelease: boolean }> = {}) =>
  refundSummaryFromRpc(raw, { quoteId: Q, canRefund: o.canRefund ?? true, canRelease: o.canRelease ?? false, names: { [U]: "Synthetic Person" } })!;

describe("refundSummaryFromRpc — F7 -> the read model", () => {
  it("a known payment carries its figures, slot, mode and fingerprint; the order total; partsReady", () => {
    const s = map(f7([payment({})]));
    expect(s).toMatchObject({ quoteId: Q, locationId: SHOP, canRefund: true, canRelease: false, partsReady: false, allKnown: true, eligiblePayments: 1, refundableTotalCents: 29000 });
    expect(s.payments[0]).toMatchObject({ id: P1, state: "known", known: true, capturedCents: 30000, countedCents: 1000, refundableCents: 29000, accountSlot: "location", livemode: false, credentialFp: "0123456789abcdef", paymentIntentId: "pi_1" });
    expect(s.totals).toEqual({ capturedCents: 30000, countedCents: 1000, inFlightCents: 0, refundableCents: 29000, outsideAppCents: 0 });
  });
  it.each(["never_read", "dirty", "paused"])("%s: NO figures (null, never 0), no order total, the form is not offered", (state) => {
    const s = map(f7([payment({ state, known: false })], { refundable_total_cents: null }));
    expect(s.payments[0]).toMatchObject({ state, known: false, capturedCents: null, countedCents: null, inFlightCents: null, refundableCents: null, stripeWhole: null });
    expect(s.allKnown).toBe(false);
    expect(s.refundableTotalCents).toBeNull();
    expect(s.totals.refundableCents).toBeNull();
    expect(refundFormOffered({ ...s, partsReady: true })).toBe(false);
  });
  it("figures are withheld even if F7 sent a number with a not-known state (fail closed)", () => {
    const s = map(f7([payment({ state: "dirty", known: false, refundable_cents: 29000 })]));
    expect(s.payments[0]!.refundableCents).toBeNull();
    expect(s.refundableTotalCents).toBeNull();
  });
  it("an unknown state reads `paused` (no figures)", () => {
    expect(map(f7([payment({ state: "fresh", known: true })])).payments[0]).toMatchObject({ state: "paused", known: false, refundableCents: null });
  });
  it("one unknown payment beside a known one hides the order total; an ineligible payment is outside the app", () => {
    const s = map(f7([payment({}), payment({ payment_id: P2, state: "dirty", known: false })]));
    expect(s.allKnown).toBe(false);
    expect(s.refundableTotalCents).toBeNull();
    const hand = map(f7([payment({}), payment({ payment_id: P2, eligible: false, state: "known", known: false, payment_intent: null, amount_cents: 700 })]));
    expect(hand.allKnown).toBe(true);
    expect(hand.totals.outsideAppCents).toBe(700);
    expect(hand.payments[1]!.paymentIntentId).toBeNull();
  });
  it("the form is offered only with the role, the database gate, every payment known and a positive total", () => {
    const s = map(f7([payment({})]));
    expect(refundFormOffered(s)).toBe(false); // parts_ready false today
    expect(refundFormOffered({ ...s, partsReady: true })).toBe(true);
    expect(refundFormOffered({ ...s, partsReady: true, canRefund: false })).toBe(false);
    expect(refundFormOffered({ ...s, partsReady: true, refundableTotalCents: 0 })).toBe(false);
  });

  const views: Array<[string, Record<string, unknown>, string]> = [
    ["pending, not armed", { status: "pending", armed: false }, "reserved"],
    ["pending, armed", { status: "pending", armed: true, armed_at: "2026-11-28T10:00:00Z", releasable_at: "2026-11-29T10:00:00Z" }, "unconfirmed"],
    ["submitted with a refund", { status: "submitted", armed: true, stripe_refund_id: "re_1" }, "bound"],
    ["failed, released", { status: "failed", armed: true, last_error_code: "released_no_refund", resolved_by: U, resolved_at: "2026-11-29T11:00:00Z" }, "released"],
    ["failed, never sent", { status: "failed", armed: false, last_error_code: "never_sent" }, "never_sent"],
    ["failed, a 0357 refusal", { status: "failed", armed: false, last_error_code: "charge_already_refunded" }, "closed"],
    ["succeeded (0357's sender)", { status: "succeeded", stripe_refund_id: "re_2" }, "closed"],
    ["an unknown status", { status: "mystery" }, "closed"],
  ];
  it.each(views)("request %s -> view %s", (_name, over, view) => {
    const s = map(f7([payment({ requests: [req(over)] })]));
    expect(s.requests[0]!.view).toBe(view);
    expect(s.payments[0]!.requests[0]!.view).toBe(view);
  });
  it("every view is reachable and only those", () => {
    expect(new Set(views.map((v) => v[2]))).toEqual(new Set(REFUND_REQUEST_VIEWS));
  });
  it("releasableAt only on an unconfirmed row; names, arm slot and the legacy flag are carried", () => {
    const s = map(f7([payment({ requests: [
      req({ status: "pending", armed: true, releasable_at: "2026-11-29T10:00:00Z", arm_account_slot: "default", arm_livemode: true, arm_credential_fp: "0123456789abcdef" }),
      req({ status: "submitted", armed: true, stripe_refund_id: "re_1", releasable_at: "2026-11-29T10:00:00Z", requested_at: "2026-11-28T11:00:00Z" }),
      req({ status: "pending", armed: true, legacy: true, requested_at: "2026-11-28T12:00:00Z" }),
    ] })]));
    expect(s.requests.map((r) => r.releasableAt)).toEqual(["2026-11-29T10:00:00Z", null, null]);
    expect(s.requests[0]).toMatchObject({ requestedByName: "Synthetic Person", armAccountSlot: "default", armLivemode: true });
    expect(s.requests[2]!.legacy).toBe(true);
  });
  it("mirrored refunds carry their claim kind and attachable_to; an unknown kind reads `foreign`", () => {
    const s = map(f7([payment({ refunds: [
      { refund_id: "re_1", amount_cents: 500, currency: "usd", status: "succeeded", previous_status: null, status_changed_at: null, created_at: "2026-11-28T10:00:01Z", request_id: null, names_request: false, kind: "none", attachable_to: "11111111-1111-4111-8111-111111111111" },
      { refund_id: "re_2", amount_cents: 600, currency: "usd", status: "failed", previous_status: "succeeded", status_changed_at: "2026-11-28T10:30:00Z", created_at: "2026-11-28T10:00:02Z", request_id: null, names_request: true, kind: "weird", attachable_to: null },
    ] })]));
    expect(s.payments[0]!.refunds[0]).toMatchObject({ refundId: "re_1", claimKind: "none", attachableTo: "11111111-1111-4111-8111-111111111111", namesRequest: false });
    expect(s.payments[0]!.refunds[1]).toMatchObject({ claimKind: "foreign", previousStatus: "succeeded", status: "failed" });
  });
  it("a quote the answer does not carry is null; junk is null", () => {
    expect(refundSummaryFromRpc(f7([]), { quoteId: P2, canRefund: true, canRelease: true })).toBeNull();
    expect(refundSummaryFromRpc(null, { quoteId: Q, canRefund: true, canRelease: true })).toBeNull();
    expect(refundSummaryFromRpc({ quotes: "x" }, { quoteId: Q, canRefund: true, canRelease: true })).toBeNull();
  });
  it("requestView is the one rule", () => {
    expect(requestView({ status: "submitted", armed: true, stripeRefundId: null, lastErrorCode: null })).toBe("closed");
    expect(requestView({ status: "pending", armed: true, stripeRefundId: null, lastErrorCode: "http_500" })).toBe("unconfirmed");
  });
  it("summarizeTotals sums only when every eligible payment is known", () => {
    const s = map(f7([payment({}), payment({ payment_id: P2, captured_cents: 5000, counted_cents: 5000, refundable_cents: 0 })]));
    expect(summarizeTotals(s.payments)).toEqual({ capturedCents: 35000, countedCents: 6000, inFlightCents: 0, refundableCents: 29000, outsideAppCents: 0 });
  });
});

describe("i18n: every refund error code, reason and status exists in en AND es, with the same placeholders", () => {
  const keys = [
    ...REFUND_ERROR_CODES.map((c) => `catering.refunds.error.${c}`),
    ...REFUND_REASON_CODES.map((c) => `catering.refunds.reason.${c}`),
    ...REFUND_STATUSES.map((c) => `catering.refunds.status.${c}`),
    ...Object.keys(en).filter((k) => k.startsWith("catering.refunds.")),
  ];
  const holes = (v: string | undefined) => [...(v ?? "").matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  it.each([...new Set(keys)])("%s", (k) => {
    const e = (en as Record<string, string>)[k];
    const s = (es as Record<string, string>)[k];
    expect(typeof e).toBe("string");
    expect(typeof s).toBe("string");
    expect(holes(s)).toEqual(holes(e));
  });
});
