/**
 * Catering refunds Part B1 — the reconciler END TO END: lib/catering/refund-reconcile.ts (`runRefundPass`,
 * `runRefundSweep`, `runReversalCleanup`) over the REAL SQL (PGlite: 0357 -> 0358 -> 0359) as `service_role`, with the
 * in-memory Stripe fake (tests/helpers/refund-flow-stripe.ts) scripted per account. GETs only on this path: every
 * test asserts the fake's POST count is zero. Synthetic rows only; no network.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGliteInterface as PGlite } from "@electric-sql/pglite";

import { refundClient, refundDb, harnessKit, harnessLib, type RefundClientOpts } from "./helpers/refund-pglite";
import { KEY_A, KEY_SHARED, ACCT_A, account, actorFor, flowWorld, grantAppTables, openIssues, req, work, type Account, type Flow } from "./helpers/refund-flow-world";

const h = vi.hoisted(() => ({
  client: null as unknown,
  accounts: [] as Array<{ secretKey: string; webhookSecret: string; source: string }>,
  stripe: null as unknown as import("./helpers/refund-flow-stripe").FlowStripe,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/stripe/session-owner", () => ({ stripeAccountsForShop: () => h.accounts }));
vi.mock("@/lib/stripe/client", async (orig) => {
  const real = await orig<typeof import("@/lib/stripe/client")>();
  return {
    ...real,
    retrievePaymentIntentOwner: (...a: Parameters<typeof real.retrievePaymentIntentOwner>) => h.stripe.retrievePaymentIntentOwner(...a),
    listRefundsPageStrict: (...a: Parameters<typeof real.listRefundsPageStrict>) => h.stripe.listRefundsPageStrict(...a),
    retrieveRefundStrict: (...a: Parameters<typeof real.retrieveRefundStrict>) => h.stripe.retrieveRefundStrict(...a),
    createRefund: (...a: Parameters<typeof real.createRefund>) => h.stripe.createRefund(...a),
  };
});

import { requestRefund, loadRefundSummary } from "@/lib/catering/refunds";
import { runRefundPass, runRefundSweep, runReversalCleanup } from "@/lib/catering/refund-reconcile";
import type { ClosedCheckouts, CloseQuoteCheckoutsInput } from "@/lib/catering/payment-sessions";

let BASE: PGlite;
beforeAll(async () => {
  BASE = await grantAppTables(await refundDb());
}, 60_000);

let calls: NonNullable<RefundClientOpts["calls"]>;
let x: Flow;
async function setup(opts: { accounts?: Account[]; captured?: number; live?: boolean } = {}): Promise<Flow> {
  x = await flowWorld(await BASE.clone(), { captured: opts.captured, live: opts.live });
  calls = [];
  h.client = refundClient(x.db, { calls });
  h.accounts = opts.accounts ?? [account(KEY_A)];
  h.stripe = x.stripe;
  return x;
}
const DEADLINE = () => Date.now() + 100_000;
const sb = () => h.client as never;
const pass = (paymentId: string, o: { scheduled?: boolean; runId?: string; maxPages?: number } = {}) => runRefundPass(sb(), paymentId, { deadlineMs: DEADLINE(), ...o });
const now = () => Math.floor(Date.now() / 1000);
const identity = (db: PGlite, id: string) => harnessLib.one(db, "select * from public.catering_refund_identities where refund_id = $1", [id]);

beforeEach(() => {
  process.env.CATERING_REFUNDS = "1";
});
afterEach(async () => {
  await x?.db.close().catch(() => {});
});

describe("discovery", () => {
  it("pagination_past_capacity: more list pages than maxPages = an INCOMPLETE pass, the cursor persisted; the NEXT pass completes; nothing published in between", async () => {
    await setup();
    x.stripe.pageSize = 1;
    const ids = [4000, 3000, 2000, 1000].map((amount, i) => x.stripe.refund(x.pay.pi, amount, "succeeded", { created: now() - 100 - i }));
    const first = await pass(x.pay.id, { maxPages: 2 });
    expect([first.result, first.reason]).toEqual(["incomplete_evidence", "list_incomplete"]);
    let w = await work(x.db, x.pay.id);
    expect(w.discovery_cursor).toMatchObject({ after: ids[1], pages: 2 });
    expect(w.last_complete_pass_at).toBeNull();
    // Nothing published: the stored figures are still the unchecked ones.
    const owner = await actorFor(x.w, "owner");
    const s = await loadRefundSummary(owner, x.quote);
    expect([s.payments[0]!.verified, s.stripeUnchecked]).toEqual([false, true]);
    expect(await harnessLib.count(x.db, "select count(*) n from public.catering_payment_refund_outcomes")).toBe(0);
    const listsBefore = x.stripe.log.filter((l) => l.op === "list").length;

    const second = await pass(x.pay.id, { maxPages: 5 });
    expect(second.result).toBe("applied");
    // It resumed from the persisted cursor (no page re-read from the top).
    expect(x.stripe.log.filter((l) => l.op === "list").slice(listsBefore).map((l) => l.arg.split("|")[1])).toEqual([ids[1], ids[2]]);
    expect([second.returned_cents, second.available_cents]).toEqual([10000, 20000]);
    w = await work(x.db, x.pay.id);
    expect(w.last_complete_pass_at).not.toBeNull();
    expect(x.stripe.posts).toBe(0);
  });

  it("omitted_bound_id: a bound refund the LIST omits is still read exactly (coverage is the contract's, not the list's); a transient read of it publishes nothing", async () => {
    await setup();
    const owner = await actorFor(x.w, "owner");
    const out = await requestRefund(owner, x.quote, { clientToken: crypto.randomUUID(), amountCents: 10000, reasonCode: "customer_cancelled", reasonNote: null, trigger: "panel" }, DEADLINE());
    const rid = String((await req(x.db, out.results[0]!.id)).stripe_refund_id);
    expect(x.stripe.posts).toBe(1);
    x.stripe.hidden.add(rid); // the list no longer shows it
    const gets = x.stripe.log.length;
    const a = await pass(x.pay.id);
    expect([a.result, a.returned_cents]).toEqual(["applied", 10000]);
    expect(x.stripe.log.slice(gets).filter((l) => l.op === "get").map((l) => l.arg)).toContain(rid);
    expect((await req(x.db, out.results[0]!.id)).status).toBe("succeeded");
    // A transient read of the bound id: incomplete, nothing published, no anomaly.
    const genBefore = (await work(x.db, x.pay.id)).last_complete_generation;
    x.stripe.failNext("get", { status: 429, code: "rate_limit" }, (id) => id === rid);
    const t = await pass(x.pay.id);
    expect([t.result, t.reason]).toEqual(["incomplete_evidence", "read_transient"]);
    expect((await work(x.db, x.pay.id)).last_complete_generation).toBe(genBefore);
    expect(await openIssues(x.db, x.pay.id)).toEqual([]);
    expect(x.stripe.posts).toBe(1);
  });

  it("unknown_prefix_reserves_without_blocking_other_identities: an unfamiliar status AND an unfamiliar prefix each reserve (never counted as returned), others proceed; flagged, never blocking", async () => {
    await setup();
    const odd = x.stripe.refund(x.pay.pi, 4000, "succeeded", { id: "rfnd_NEWPREFIX1" });
    const strange = x.stripe.refund(x.pay.pi, 3000, "under_review");
    const fine = x.stripe.refund(x.pay.pi, 2000, "succeeded");
    const a = await pass(x.pay.id);
    // Review fix (Astra P1): plan B1.2 "Reserve the verified amount ... Do not count it as returned" holds for a prefix too.
    expect([a.result, a.returned_cents, a.reserved_cents, a.available_cents, a.held]).toEqual(["applied", 2000, 7000, 21000, false]);
    const rows = await harnessLib.rows(x.db, "select refund_id, unfamiliar, class from public.catering_refund_identities where payment_id = $1 order by refund_id", [x.pay.id]);
    expect(rows).toEqual([{ refund_id: fine, unfamiliar: false, class: "returned" }, { refund_id: strange, unfamiliar: true, class: "reserved" }, { refund_id: odd, unfamiliar: true, class: "reserved" }]
      .sort((p, q) => (p.refund_id < q.refund_id ? -1 : 1)));
    expect((await openIssues(x.db, x.pay.id)).map((i) => [i.code, i.blocking])).toEqual([["unfamiliar_identity", false], ["unfamiliar_identity", false]]);
    // Not blocking: a Confirm against what is left still goes through.
    const out = await requestRefund(await actorFor(x.w, "owner"), x.quote, { clientToken: crypto.randomUUID(), amountCents: 5000, reasonCode: "customer_cancelled", reasonNote: null, trigger: "panel" }, DEADLINE());
    expect(out.results[0]!.status).toBe("succeeded");
    expect(x.stripe.posts).toBe(1);
  });
});

describe("anomalies", () => {
  it("verified_404_blocks_only_its_payment: a verified id every permitted account now 404s holds ITS payment; the order's other payment still applies; a transient read is no anomaly", async () => {
    await setup({ accounts: [account(KEY_A), account(KEY_SHARED, "default")] });
    const p2 = await x.w.pay(x.quote, "balance", 20000);
    x.stripe.charge(p2.pi, { account: ACCT_A, captured: 20000 });
    const r = x.stripe.refund(x.pay.pi, 5000, "succeeded");
    expect((await pass(x.pay.id)).result).toBe("applied");
    expect((await pass(p2.id)).result).toBe("applied");
    const before = await harnessLib.one(x.db, "select amount_cents::int as a, class, provider_status from public.catering_refund_identities where refund_id = $1", [r]);
    x.stripe.refunds.delete(r); // every account answers 404 now
    const a = await pass(x.pay.id);
    expect(a.result).toBe("held");
    const getsOfR = x.stripe.log.filter((l) => l.op === "get" && l.arg === r).map((l) => l.key);
    expect(getsOfR.slice(-2).sort()).toEqual([KEY_A, KEY_SHARED].sort()); // EVERY permitted account was asked
    expect((await harnessKit.figures(x.db, x.pay.id)).o_held).toBe(true);
    expect(await harnessLib.one(x.db, "select amount_cents::int as a, class, provider_status from public.catering_refund_identities where refund_id = $1", [r])).toEqual(before);
    expect((await identity(x.db, r)).unreadable_since).not.toBeNull();
    expect((await openIssues(x.db, x.pay.id)).map((i) => i.code)).toContain("verified_unreadable");
    const b = await pass(p2.id);
    expect([b.result, b.held, b.available_cents]).toEqual(["applied", false, 20000]);
    expect(x.stripe.posts).toBe(0);
    await x.db.close();

    // A transient failure on the verified id: incomplete, NO anomaly.
    await setup({ accounts: [account(KEY_A), account(KEY_SHARED, "default")] });
    const r2 = x.stripe.refund(x.pay.pi, 5000, "succeeded");
    await pass(x.pay.id);
    x.stripe.failNext("get", { status: 503, code: "api_error" }, (id) => id === r2);
    const t = await pass(x.pay.id);
    expect([t.result, t.reason, (await openIssues(x.db, x.pay.id)).length]).toEqual(["incomplete_evidence", "read_transient", 0]);
    expect(x.stripe.posts).toBe(0);
  });

  it("all_404_hint_quarantines_and_reopens_on_new_evidence: three DISTINCT scheduled all-404 passes quarantine a never-verified hint; a 401 and a 429 pass consume no attempt; new evidence re-opens it", async () => {
    await setup();
    await harnessKit.ingest(x.db, { type: "refund.updated", pi: x.pay.pi, created: now() - 60, hints: [{ id: "re_ghost", status: "pending" }] });
    const n = async () => harnessLib.one(x.db, "select not_found_passes as n, quarantined_at from public.catering_refund_identities where refund_id = 're_ghost'");
    const r1 = crypto.randomUUID();
    let a = await pass(x.pay.id, { scheduled: true, runId: r1 });
    expect([a.result, a.reason, (await n()).n]).toEqual(["incomplete_evidence", "hint_unresolved", 1]);
    await pass(x.pay.id, { scheduled: true, runId: r1 });
    expect((await n()).n).toBe(1); // the SAME scheduled attempt does not count twice
    x.stripe.failNext("get", { status: 401, code: "invalid_api_key" }, (id) => id === "re_ghost");
    await pass(x.pay.id, { scheduled: true, runId: crypto.randomUUID() });
    expect((await n()).n).toBe(1); // a 401 consumes no attempt
    x.stripe.failNext("get", { status: 429, code: "rate_limit" }, (id) => id === "re_ghost");
    await pass(x.pay.id, { scheduled: true, runId: crypto.randomUUID() });
    expect((await n()).n).toBe(1); // a 429 consumes no attempt
    await pass(x.pay.id, { scheduled: false });
    expect((await n()).n).toBe(1); // a staff / unscheduled pass is not a scheduled attempt
    await pass(x.pay.id, { scheduled: true, runId: crypto.randomUUID() });
    a = await pass(x.pay.id, { scheduled: true, runId: crypto.randomUUID() });
    const q = await n();
    expect([q.n, q.quarantined_at != null, a.result]).toEqual([3, true, "applied"]);
    expect((await openIssues(x.db, x.pay.id)).map((i) => [i.code, i.blocking])).toEqual([["quarantined_hint", false]]);
    // New evidence re-opens the quarantined hint.
    await harnessKit.ingest(x.db, { type: "refund.updated", pi: x.pay.pi, created: now() - 10, hints: [{ id: "re_ghost", status: "succeeded" }] });
    expect(await n()).toEqual({ n: 0, quarantined_at: null });
    expect(x.stripe.posts).toBe(0);
  });

  it("the sweep: GETs only, every kind fair, an owner-indeterminate payment does not stop the others", async () => {
    await setup({ live: false });
    const p2 = await x.w.pay(x.quote, "balance", 20000); // no charge at Stripe in any account: indeterminate owner
    await harnessKit.goLive(x.db); // recovery seeds both payments' work
    const sweep = await runRefundSweep(sb(), { deadlineMs: DEADLINE() });
    expect(sweep.ran).toBe(true);
    expect(sweep.applied).toBeGreaterThanOrEqual(1);
    expect((await openIssues(x.db, p2.id)).map((i) => i.code)).toContain("owner_indeterminate");
    expect((await work(x.db, x.pay.id)).last_complete_pass_at).not.toBeNull();
    expect(x.stripe.posts).toBe(0);
    expect(x.stripe.log.every((l) => l.op !== "create")).toBe(true);
  });
});

describe("reversal", () => {
  it("reversal_retires_reopened_checkout_and_reports_race: refunded -> paid; the injected close is called with the family; still_open / completing / already_paid_duplicates reported; nothing refunded automatically", async () => {
    await setup();
    // A legitimate balance of the same order (the designed deposit + balance pair) and a SECOND deposit paid while
    // the first one read `refunded` (the race: the customer may have paid twice).
    const balance = await x.w.pay(x.quote, "balance", 20000);
    x.stripe.charge(balance.pi, { account: ACCT_A, captured: 20000 });
    const full = x.stripe.refund(x.pay.pi, 30000, "succeeded");
    let a = await pass(x.pay.id);
    expect([a.payment_status, a.cleanup_owed ?? false]).toEqual(["refunded", false]);
    const dup = await x.w.pay(x.quote, "deposit", 30000);
    await x.db.query("update public.catering_payments set provider_session_id = 'cs_test_flow_original' where id = $1", [x.pay.id]);

    const closeCalls: CloseQuoteCheckoutsInput[] = [];
    let answer: ClosedCheckouts = { retired: ["pay_retired_1"], stillOpen: ["pay_open_1"], completing: ["pay_completing_1"] };
    const close = vi.fn(async (_sb: unknown, input: CloseQuoteCheckoutsInput) => {
      closeCalls.push(input);
      return answer;
    });
    const cleanups: unknown[] = [];
    x.stripe.refunds.get(full)!.status = "canceled";
    a = await runRefundPass(sb(), x.pay.id, {
      deadlineMs: DEADLINE(),
      cleanup: async (c, pid) => {
        const r = await runReversalCleanup(c as never, pid, close as never);
        cleanups.push(r);
        return r;
      },
    });
    expect([a.result, a.payment_status, a.previous_payment_status, a.cleanup_owed]).toEqual(["applied", "paid", "refunded", true]);
    expect(closeCalls).toEqual([{ quoteId: x.quote, locationId: x.w.shop, settledPaymentId: x.pay.id, settledSessionId: "cs_test_flow_original" }]);
    expect(cleanups).toEqual([{ complete: false, report: { still_open: 1, completing: 1, already_paid_duplicates: 1, retired: 1 } }]);
    // The obligation stands and the open checkout is raised to staff; the balance was not counted as a duplicate.
    let w = await work(x.db, x.pay.id);
    expect([w.checkout_cleanup_owed_at != null, w.checkout_cleanup_done_at]).toEqual([true, null]);
    expect(w.checkout_cleanup_report).toMatchObject({ still_open: 1, completing: 1, already_paid_duplicates: 1 });
    expect((await openIssues(x.db, x.pay.id)).map((i) => [i.code, i.blocking])).toContainEqual(["checkout_still_open", false]);
    void dup;

    // The sweep resumes the obligation; once nothing is open it is done.
    answer = { retired: ["pay_open_1"], stillOpen: [], completing: [] };
    const sweep = await runRefundSweep(sb(), { deadlineMs: DEADLINE(), cleanup: (c, pid) => runReversalCleanup(c as never, pid, close as never) });
    expect(sweep.cleanups).toBe(1);
    w = await work(x.db, x.pay.id);
    expect(w.checkout_cleanup_done_at).not.toBeNull();
    // Nothing is refunded automatically, ever.
    expect(x.stripe.posts).toBe(0);
    expect(await harnessLib.count(x.db, "select count(*) n from public.catering_refund_requests")).toBe(0);
  });

  it("reversal_retires_reopened_checkout_and_reports_race: a REPLACEMENT balance checkout opened while the balance read refunded is retired through the owning account (review fix, Astra P1)", async () => {
    await setup();
    const balance = await x.w.pay(x.quote, "balance", 20000);
    x.stripe.charge(balance.pi, { account: ACCT_A, captured: 20000 });
    const full = x.stripe.refund(balance.pi, 20000, "succeeded");
    let a = await pass(balance.id);
    expect(a.payment_status).toBe("refunded");
    // While it read `refunded` the portal opened a REPLACEMENT balance intent with its own checkout.
    const replacement = await x.w.pay(x.quote, "balance", 20000, { status: "due" });
    await x.db.query("update public.catering_payments set provider_session_id = 'cs_test_replacement_balance' where id = $1", [replacement.id]);
    // The shared helper preserves an ordinary balance by design: it reports nothing for the replacement.
    const close = vi.fn(async () => ({ retired: [], stillOpen: [], completing: [] }));
    const retired: string[] = [];
    const retireFor = vi.fn(async () => async (sessionId: string) => { retired.push(sessionId); return "expired" as const; });
    x.stripe.refunds.get(full)!.status = "canceled";
    let report: unknown = null;
    a = await runRefundPass(sb(), balance.id, { deadlineMs: DEADLINE(), cleanup: async (c, pid) => (report = await runReversalCleanup(c as never, pid, close as never, retireFor as never)) as never });
    expect([a.payment_status, a.previous_payment_status]).toEqual(["paid", "refunded"]);
    expect(retired).toEqual(["cs_test_replacement_balance"]);
    expect(report).toEqual({ complete: true, report: { still_open: 0, completing: 0, already_paid_duplicates: 0, retired: 1 } });
    expect((await harnessLib.one(x.db, "select provider_session_id from public.catering_payments where id = $1", [replacement.id])).provider_session_id).toBeNull();
    // The designed deposit + balance pair is untouched: the DEPOSIT's row and session were never asked about.
    expect(retireFor).toHaveBeenCalledTimes(1);
    expect(x.stripe.posts).toBe(0);
  });

  it("reversal_retires_reopened_checkout_and_reports_race: a replacement checkout that cannot be confirmed closed keeps the obligation and is raised", async () => {
    await setup();
    const balance = await x.w.pay(x.quote, "balance", 20000);
    x.stripe.charge(balance.pi, { account: ACCT_A, captured: 20000 });
    const full = x.stripe.refund(balance.pi, 20000, "succeeded");
    await pass(balance.id);
    const replacement = await x.w.pay(x.quote, "balance", 20000, { status: "due" });
    await x.db.query("update public.catering_payments set provider_session_id = 'cs_test_replacement_stuck' where id = $1", [replacement.id]);
    const close = vi.fn(async () => ({ retired: [], stillOpen: [], completing: [] }));
    const retireFor = vi.fn(async () => async () => { throw new Error("stripe down"); });
    x.stripe.refunds.get(full)!.status = "failed";
    let report: unknown = null;
    await runRefundPass(sb(), balance.id, { deadlineMs: DEADLINE(), cleanup: async (c, pid) => (report = await runReversalCleanup(c as never, pid, close as never, retireFor as never)) as never });
    expect(report).toEqual({ complete: false, report: { still_open: 1, completing: 0, already_paid_duplicates: 0, retired: 0 } });
    expect((await harnessLib.one(x.db, "select provider_session_id from public.catering_payments where id = $1", [replacement.id])).provider_session_id).toBe("cs_test_replacement_stuck");
    const w = await work(x.db, balance.id);
    expect([w.checkout_cleanup_owed_at != null, w.checkout_cleanup_done_at]).toEqual([true, null]);
    expect((await openIssues(x.db, balance.id)).map((i) => i.code)).toContain("checkout_still_open");
  });

  it("reversal_retires_reopened_checkout_and_reports_race: with only the designed deposit + balance pair, no duplicate is reported", async () => {
    await setup();
    const balance = await x.w.pay(x.quote, "balance", 20000);
    x.stripe.charge(balance.pi, { account: ACCT_A, captured: 20000 });
    const full = x.stripe.refund(x.pay.pi, 30000, "succeeded");
    await pass(x.pay.id);
    x.stripe.refunds.get(full)!.status = "failed";
    const close = vi.fn(async () => ({ retired: [], stillOpen: [], completing: [] }));
    let report: unknown = null;
    await runRefundPass(sb(), x.pay.id, { deadlineMs: DEADLINE(), cleanup: async (c, pid) => (report = await runReversalCleanup(c as never, pid, close as never)) as never });
    expect(report).toEqual({ complete: true, report: { still_open: 0, completing: 0, already_paid_duplicates: 0, retired: 0 } });
    expect((await work(x.db, x.pay.id)).checkout_cleanup_done_at).not.toBeNull();
    expect(x.stripe.posts).toBe(0);
  });
});
