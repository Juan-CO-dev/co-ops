/**
 * Catering refunds Part B1 flow tests — ONE stateful, in-memory fake of the four Stripe calls the staff press, the
 * reads and the reconciler make (lib/stripe/client.ts: `retrievePaymentIntentOwner`, `listRefundsPageStrict`,
 * `retrieveRefundStrict`, `createRefund`). NEVER a network call; synthetic ids only; no key is real.
 *
 * The model (what decides "one refund, never two"; docs.stripe.com/api/idempotent_requests):
 *   · ACCOUNTS by secret key. Several keys may resolve to the SAME account (a rotated key): they see the same
 *     PaymentIntents, charges and refunds. An unknown key answers 401.
 *   · An IDEMPOTENCY KEY replays its FIRST executed response (a saved 500 included); the same key with other
 *     parameters is a 400 `idempotency_error`. The table is scoped by SECRET KEY: whether Stripe deduplicates one
 *     idempotency key across two secret keys of one account is UNVERIFIED, so the fake assumes it does NOT (the
 *     conservative model: a rotated key gets no provider-side deduplication, and only OUR discovery can prevent a
 *     second refund).
 *   · A refund above what is left on the charge is refused (400 `charge_already_refunded`, saved).
 *   · A refund carries the `metadata` our create wrote, so a list can find a send whose answer was lost.
 *   · `hidden` ids are missing from the LIST (a list that has not caught up) but still readable by id.
 *   · `failNext(op, kind, match?)` scripts ONE failure of the next matching call; `onCall` runs a hook before each
 *     call (time travel during discovery, a race, a process death).
 * Counters: `gets` (every GET: owner, list page, refund read) and `posts` (every create attempt that left).
 */
import { StripeError, type CreateRefundInput, type PaymentIntentOwner, type RefundListPage, type StrictRefund, type StripeRefund } from "@/lib/stripe/client";

export interface FakeCharge { account: string; charge: string; captured: number | null; currency: string; livemode: boolean }
export interface FakeRefund {
  id: string; account: string; pi: string; charge: string; amount: number; currency: string; status: string; created: number;
  requestId: string | null; metaPayment: string | null; metaQuote: string | null;
}
export type FakeOp = "owner" | "list" | "get" | "create";
export type FailKind =
  | "network" // no response, nothing executed
  | "lost_after_executing" // create only: executed and saved, the answer lost
  | "500_saved" // create only: a 500 that the key replays
  | { status: number; code: string }; // a plain HTTP error (not saved)

export interface CallLog { op: FakeOp; key: string; arg: string; idem?: string; params?: string }

export class FlowStripe {
  keys = new Map<string, string>();
  charges = new Map<string, FakeCharge>();
  refunds = new Map<string, FakeRefund>();
  idem = new Map<string, { params: string; ok: FakeRefund | null; err: { status: number; code: string } | null }>();
  hidden = new Set<string>();
  pageSize = 100;
  createStatus = "succeeded";
  gets = 0;
  posts = 0;
  log: CallLog[] = [];
  private failures: Array<{ op: FakeOp; kind: FailKind; match?: (arg: string, key: string) => boolean }> = [];
  onCall: ((op: FakeOp, arg: string, key: string) => void | Promise<void>) | null = null;
  private n = 0;

  account(secretKey: string, accountId: string): this {
    this.keys.set(secretKey, accountId);
    return this;
  }
  charge(pi: string, opts: Partial<FakeCharge> & { account: string }): FakeCharge {
    const c: FakeCharge = { charge: `ch_${pi.slice(3)}`, captured: 30000, currency: "usd", livemode: false, ...opts };
    this.charges.set(pi, c);
    return c;
  }
  /** A refund made elsewhere (the Dashboard, a lost create): it exists at Stripe whatever our database knows. */
  refund(pi: string, amount: number, status: string, o: Partial<Omit<FakeRefund, "pi" | "amount" | "status">> = {}): string {
    const c = this.charges.get(pi);
    if (!c) throw new Error(`FlowStripe: no charge for ${pi}`);
    const id = o.id ?? `re_flow${++this.n}`;
    this.refunds.set(id, {
      id, pi, amount, status, account: o.account ?? c.account, charge: o.charge ?? c.charge, currency: o.currency ?? c.currency,
      created: o.created ?? Math.floor(Date.now() / 1000) - 60, requestId: o.requestId ?? null, metaPayment: o.metaPayment ?? null, metaQuote: o.metaQuote ?? null,
    });
    return id;
  }
  refundsOf(pi: string): FakeRefund[] {
    return [...this.refunds.values()].filter((r) => r.pi === pi);
  }
  failNext(op: FakeOp, kind: FailKind, match?: (arg: string, key: string) => boolean): this {
    this.failures.push({ op, kind, match });
    return this;
  }
  creates(): CallLog[] {
    return this.log.filter((l) => l.op === "create");
  }

  private takeFailure(op: FakeOp, arg: string, key: string): FailKind | null {
    const i = this.failures.findIndex((f) => f.op === op && (!f.match || f.match(arg, key)));
    if (i < 0) return null;
    return this.failures.splice(i, 1)[0]!.kind;
  }
  private acct(key: string): string {
    const a = this.keys.get(key);
    if (!a) throw new StripeError(401, "invalid_api_key", "Invalid API Key provided");
    return a;
  }
  private async enter(op: FakeOp, arg: string, key: string, extra: Partial<CallLog> = {}): Promise<FailKind | null> {
    if (op === "create") this.posts++;
    else this.gets++;
    this.log.push({ op, key, arg, ...extra });
    if (this.onCall) await this.onCall(op, arg, key);
    const f = this.takeFailure(op, arg, key);
    if (f === "network") throw new StripeError(0, "network_error", "fetch failed");
    if (f && typeof f === "object") throw new StripeError(f.status, f.code);
    return f;
  }
  private strict(r: FakeRefund): StrictRefund {
    return {
      id: r.id, paymentIntentId: r.pi, chargeId: r.charge, amountCents: r.amount, currency: r.currency, status: r.status, createdSec: r.created,
      requestId: r.requestId, metaPaymentId: r.metaPayment, metaQuoteId: r.metaQuote,
    };
  }

  // ── The four calls (signatures of lib/stripe/client.ts) ──
  retrievePaymentIntentOwner = async (secretKey: string, pi: string, _timeoutMs?: number): Promise<PaymentIntentOwner> => {
    await this.enter("owner", pi, secretKey);
    const a = this.acct(secretKey);
    const c = this.charges.get(pi);
    if (!c || c.account !== a) return { status: "not_found", chargeId: null, currency: null, livemode: null, amountCapturedCents: null };
    return { status: "found", chargeId: c.charge, currency: c.currency, livemode: c.livemode, amountCapturedCents: c.captured };
  };

  listRefundsPageStrict = async (secretKey: string, pi: string, after: string | null, _timeoutMs?: number): Promise<RefundListPage> => {
    await this.enter("list", `${pi}|${after ?? ""}`, secretKey);
    const a = this.acct(secretKey);
    const c = this.charges.get(pi);
    if (!c || c.account !== a) throw new StripeError(404, "resource_missing");
    // Newest first, id as the tiebreak (a stable enumeration).
    const all = [...this.refunds.values()].filter((r) => r.pi === pi && r.account === a && !this.hidden.has(r.id))
      .sort((x, y) => y.created - x.created || (x.id < y.id ? 1 : -1));
    const start = after ? all.findIndex((r) => r.id === after) + 1 : 0;
    const page = all.slice(start, start + this.pageSize);
    const hasMore = start + this.pageSize < all.length;
    return { refunds: page.map((r) => this.strict(r)), hasMore, lastId: page.length ? page[page.length - 1]!.id : null };
  };

  retrieveRefundStrict = async (secretKey: string, id: string, _timeoutMs?: number): Promise<{ status: "found"; refund: StrictRefund } | { status: "not_found" }> => {
    await this.enter("get", id, secretKey);
    const a = this.acct(secretKey);
    const r = this.refunds.get(id);
    if (!r || r.account !== a) return { status: "not_found" };
    return { status: "found", refund: this.strict(r) };
  };

  createRefund = async (secretKey: string, input: CreateRefundInput, idempotencyKey: string, _timeoutMs?: number): Promise<StripeRefund> => {
    const params = JSON.stringify(input);
    const fail = await this.enter("create", input.paymentIntentId, secretKey, { idem: idempotencyKey, params });
    const a = this.acct(secretKey);
    const slot = `${secretKey}|${idempotencyKey}`;
    const saved = this.idem.get(slot);
    const answer = (r: FakeRefund): StripeRefund => ({ id: r.id, status: r.status, amountCents: r.amount, requestId: r.requestId });
    if (saved) {
      if (saved.params !== params) throw new StripeError(400, "idempotency_error", "Keys for idempotent requests can only be used with the same parameters");
      if (saved.ok) return answer(saved.ok);
      throw new StripeError(saved.err!.status, saved.err!.code);
    }
    if (fail === "500_saved") {
      this.idem.set(slot, { params, ok: null, err: { status: 500, code: "api_error" } });
      throw new StripeError(500, "api_error");
    }
    const c = this.charges.get(input.paymentIntentId);
    if (!c || c.account !== a) {
      this.idem.set(slot, { params, ok: null, err: { status: 404, code: "resource_missing" } });
      throw new StripeError(404, "resource_missing");
    }
    const used = this.refundsOf(input.paymentIntentId).filter((r) => r.status !== "failed" && r.status !== "canceled").reduce((s, r) => s + r.amount, 0);
    if (input.amountCents > (c.captured ?? 0) - used) {
      this.idem.set(slot, { params, ok: null, err: { status: 400, code: "charge_already_refunded" } });
      throw new StripeError(400, "charge_already_refunded");
    }
    const id = `re_flow${++this.n}`;
    const r: FakeRefund = {
      id, account: a, pi: input.paymentIntentId, charge: c.charge, amount: input.amountCents, currency: c.currency, status: this.createStatus,
      created: Math.floor(Date.now() / 1000), requestId: input.metadata.refund_request_id, metaPayment: input.metadata.payment_id, metaQuote: input.metadata.quote_id,
    };
    this.refunds.set(id, r);
    this.idem.set(slot, { params, ok: r, err: null });
    if (fail === "lost_after_executing") throw new StripeError(0, "network_error", "the response was lost");
    return answer(r);
  };
}
