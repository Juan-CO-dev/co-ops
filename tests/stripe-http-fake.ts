/**
 * A fake of Stripe's Checkout Session HTTP endpoints, at the `fetch` boundary, that knows
 * about ACCOUNTS (audit wave W02, review r4 P2).
 *
 * tests/stripe-fake.ts replaces lib/stripe/client.ts's functions; it cannot test what those
 * functions make of an HTTP answer. This one sits under them: the real client runs, and
 * `fetch` is this object. It models exactly one thing the function-level fake could not:
 *
 *   A SECRET KEY ONLY SEES ITS OWN ACCOUNT'S OBJECTS. A session minted with account A's key
 *   is `404 resource_missing` to account B's key — while it is still open, and payable, in
 *   A. ("Stripe uses API keys to authenticate requests from your integration and determine
 *   which Stripe resources it can access" — docs.stripe.com/keys; "404 Not Found: The
 *   requested resource doesn't exist" — docs.stripe.com/api/errors.) So a 404 says "this
 *   key cannot see it" and nothing about whether anyone can still pay it.
 *
 * The three calls the client makes, and nothing else:
 *   POST /v1/checkout/sessions               create (status `open`)
 *   POST /v1/checkout/sessions/:id/expire    only an `open` session can be expired; anything
 *                                            else is a 400 (docs.stripe.com/api/checkout/sessions/expire)
 *   GET  /v1/checkout/sessions/:id           read
 *
 * NEVER A NETWORK CALL: a request to any other host or path THROWS, and so does a key no
 * test registered on the REFUND surface (the session surface keeps its original answer to
 * an unregistered key: a 401). Every key here is a fake string.
 *
 * ── THE REFUND SURFACE (catering refunds Part B1, plan B1.2 "Discovery" / "Coverage", B1.6) ─────────
 *
 *   GET  /v1/payment_intents/:id?expand[]=latest_charge   { id, currency, livemode, latest_charge: { id,
 *                                                          amount_captured, amount_refunded } }; another
 *                                                          account's key (or an unknown id) = 404 resource_missing
 *   GET  /v1/refunds?payment_intent=…&limit=…[&starting_after=…]
 *   GET  /v1/refunds?charge=…&limit=…[&starting_after=…]   (Part B1 v2: the second list)
 *                                                          { object: "list", data, has_more }, NEWEST FIRST,
 *                                                          paged by `pageSize` (so a test can force N pages);
 *                                                          a PaymentIntent / charge this key cannot see = 400
 *                                                          resource_missing (Stripe's exact answer here is
 *                                                          UNVERIFIED; the fake never answers an empty list for
 *                                                          it, which would read as "no refunds"). A refund with
 *                                                          NO PaymentIntent (`paymentIntentId: null`) is listed
 *                                                          by its charge only.
 *   GET  /v1/refunds/:id                                  the refund, or 404 resource_missing
 *   POST /v1/refunds  (Idempotency-Key REQUIRED)          idempotent create, modelled on Stripe's documented
 *                                                          rule ("saves the status code and body of the first
 *                                                          request made with a given idempotency key after
 *                                                          endpoint execution begins … including 500 errors";
 *                                                          other parameters with the same key = 400
 *                                                          idempotency_error — docs.stripe.com/api/idempotent_requests)
 *                                                          and on tests/catering-refunds-flow.test.ts's
 *                                                          function-level fake: a PaymentIntent this account does
 *                                                          not own = 400 resource_missing (saved), an amount above
 *                                                          what is left on the charge = 400 charge_already_refunded
 *                                                          (saved).
 *
 * SEQUENCES (`script` / `persist`), per endpoint and optionally per account: `delay(ms)` (the answer is late; the
 * request's AbortSignal is honoured and the promise rejects with the signal's reason, as fetch does), `status(n,
 * body?)` (any answer, a 200 with a hand-written body included), `malformed(kind)` (a 2xx answer bent one named
 * way), `networkError("before" | "after_executing")`. Steps combine by spread: `{ ...delay(50), ...status(500) }`.
 * On the CREATE endpoint: a scripted status below 500 is a refusal before execution (nothing saved); 500 and above
 * is SAVED under the idempotency key (execution began); a late answer (`delay`) has ALREADY EXECUTED — the abort
 * loses the response, not the refund — which is the hard case the app must survive.
 *
 * ROTATED CREDENTIALS (`rotateKey(account, newKey)`): the SAME account gets a new secret key, the old one answers
 * 401 `api_key_expired`, the objects stay where they are. WHETHER STRIPE KEEPS AN IDEMPOTENCY KEY ACROSS A
 * SAME-ACCOUNT KEY ROTATION IS UNVERIFIED (plan, Platform evidence row "Credential identity"). The fake models
 * BOTH, by an explicit option `idempotencyAcrossRotation: "kept" | "lost"`, and the DEFAULT is the conservative one
 * for our code, "lost": a re-POST with the rotated key under the same idempotency key creates a NEW refund at the
 * provider. That is exactly why the app must discover by PaymentIntent and ADOPT before it ever re-POSTs.
 *
 * Every request is logged (`calls`: method, path, the bearer key, the account it resolves to, the idempotency
 * key) and counted per account (`counts`).
 *
 * ── PART B1 v2 ADDITIONS ───────────────────────────────────────────────────────────────────────────────────────
 * REDIRECTS (`redirect(307 | 308 | …)` on any refund endpoint). The fake honours the request's `redirect` mode the
 * way `fetch` does: "manual" = the 3xx IS the answer (Node returns it as is); "error" = the request fails (TypeError);
 * anything else ("follow", the default) = the transport FOLLOWS it, which for a 307 / 308 RE-SENDS the request, body
 * and all: the fake logs a SECOND HTTP request (`calls[i].followed = true`) and executes it again. `httpRequests()`
 * counts HTTP requests, never `fetch` calls, so a test can prove ONE outbound POST.
 * CREATED TIME of a refund made by POST: `createdAt()` (epoch SECONDS; default the real clock, floored, as Stripe's
 * `created` is whole seconds). `addRefund` keeps its own deterministic clock unless given `created`.
 * THE REQUEST HOOK (`onRequest`): awaited before every refund-surface request is answered, with the call; a flow test
 * uses it to run a second press (or a database step) BETWEEN two of the first press's requests.
 */
export interface HttpFakeSession {
  id: string;
  /** The account that minted it (its first key) — the only account that can see it. */
  account: string;
  status: "open" | "complete" | "expired";
  amountCents: number;
  quoteId: string | null;
  paymentId: string | null;
  expiresAt: number | null;
  url: string;
}

// ── The refund model (shared with tests/stripe-fake.ts, which runs the same world under its function-level fake) ─

export type RefundEndpoint = "payment_intent" | "list" | "refund" | "create";

/** Bends a 2xx answer one named way. The KEPT kinds (`unknown_status`, `unknown_prefix`, `expanded_ids`) are valid. */
export type MalformedKind =
  // list-level
  | "no_data_array"
  | "has_more_not_boolean"
  | "non_terminal_without_cursor"
  | "repeated_cursor"
  | "truncated"
  | "repeated_id_in_page"
  // refund-level (the first refund of a list page, or the one refund read)
  | "refund_missing_amount"
  | "refund_amount_not_integer"
  | "refund_bad_currency"
  | "refund_other_payment_intent"
  | "refund_other_charge"
  | "metadata_not_object"
  | "unknown_status"
  | "unknown_prefix"
  | "expanded_ids"
  // PaymentIntent-level
  | "pi_other_id"
  | "pi_charge_unexpanded";

export const LIST_MALFORMED: readonly MalformedKind[] = [
  "no_data_array", "has_more_not_boolean", "non_terminal_without_cursor", "repeated_cursor", "truncated", "repeated_id_in_page",
];
export const REFUND_MALFORMED: readonly MalformedKind[] = [
  "refund_missing_amount", "refund_amount_not_integer", "refund_bad_currency", "refund_other_payment_intent",
  "refund_other_charge", "metadata_not_object", "unknown_status", "unknown_prefix", "expanded_ids",
];
export const PI_MALFORMED: readonly MalformedKind[] = ["pi_other_id", "pi_charge_unexpanded"];
/** Structurally valid answers a strict reader must KEEP, not refuse. */
export const KEPT_MALFORMED: readonly MalformedKind[] = ["unknown_status", "unknown_prefix", "expanded_ids"];

export interface Step {
  /** The answer is this late (ms). The request's AbortSignal is honoured. */
  delayMs?: number;
  /** Answer this status (and `body`, else a default Stripe-shaped error / the normal 2xx body). */
  status?: number;
  body?: unknown;
  malformed?: MalformedKind;
  /** No response at all: before the provider executed anything, or after it executed (the response is lost). */
  network?: "before" | "after_executing";
  /** Answer with this redirect (see the header): what happens depends on the request's `redirect` mode. */
  redirect?: 301 | 302 | 303 | 307 | 308;
}
export const delay = (ms: number): Step => ({ delayMs: ms });
export const status = (n: number, body?: unknown): Step => (body === undefined ? { status: n } : { status: n, body });
export const malformed = (kind: MalformedKind): Step => ({ malformed: kind });
export const networkError = (when: "before" | "after_executing" = "before"): Step => ({ network: when });
export const redirect = (n: 301 | 302 | 303 | 307 | 308): Step => ({ redirect: n });

export interface WorldPaymentIntent {
  id: string;
  /** The account id (its first key) that owns it. */
  account: string;
  currency: string;
  livemode: boolean;
  chargeId: string | null;
  amountCaptured: number;
}

export interface WorldRefund {
  id: string;
  account: string;
  /** Null = a refund with no PaymentIntent: listed by its charge only. */
  paymentIntentId: string | null;
  chargeId: string | null;
  amount: number;
  currency: string;
  status: string;
  created: number;
  metadata: Record<string, string>;
  reason: string | null;
  /** Insertion order: the tiebreak for equal `created` (newest first). */
  seq: number;
}

export interface RefundWorldOptions {
  /** UNVERIFIED on Stripe's side (see the header). Default "lost": the conservative case for our code. */
  idempotencyAcrossRotation?: "kept" | "lost";
  /** Page size of the refund list (the client asks for 100; the fake answers min(limit, pageSize)). */
  pageSize?: number;
  /** Status of a refund the create endpoint makes. */
  createStatus?: string;
  /** `created` (epoch seconds) of a refund the create endpoint makes. Default: the real clock, floored. */
  createdAt?: () => number;
}

export type ResolvedKey = { kind: "ok"; accountId: string } | { kind: "expired"; accountId: string } | { kind: "unknown" };

export interface RefundWorld {
  opts: Required<RefundWorldOptions>;
  paymentIntents: Map<string, WorldPaymentIntent>;
  refunds: WorldRefund[];
  /** Saved idempotent responses, by `<scope>|<idempotency key>` (scope = account id when kept, else the key). */
  idempotency: Map<string, { fingerprint: string; status: number; body: unknown }>;
  /** Every create that reached execution or a replay: the key, and whether it was a replay. */
  creates: Array<{ accountId: string; secretKey: string; idempotencyKey: string; replayed: boolean; status: number }>;
  /** Register a secret key as a real account (the key is the account's id). Idempotent. */
  account: (secretKey: string) => void;
  /** The SAME account gets `newKey`; its current key(s) answer 401 api_key_expired from now on. */
  rotateKey: (account: string, newKey: string) => void;
  resolve: (secretKey: string) => ResolvedKey;
  addPaymentIntent: (p: Partial<WorldPaymentIntent> & { id: string; account: string }) => WorldPaymentIntent;
  /** `paymentIntentId: null` + `chargeId` = a refund with no PaymentIntent (charge-only). */
  addRefund: (r: Partial<WorldRefund> & { paymentIntentId: string | null; amount: number }) => WorldRefund;
  setRefundStatus: (id: string, status: string) => void;
  /** What the charge shows refunded (every refund not failed / canceled). */
  refundedOn: (paymentIntentId: string) => number;
  /** Queue steps for an endpoint (optionally one account's requests only); each is used once, in order. */
  script: (endpoint: RefundEndpoint, steps: Step | Step[], opts?: ScriptScope) => void;
  /** A standing step for an endpoint until `clearScripts()` (e.g. `malformed("truncated")`: has_more forever). */
  persist: (endpoint: RefundEndpoint, step: Step, opts?: ScriptScope) => void;
  clearScripts: () => void;
  /** The step for the next request of `endpoint` from `accountId` (queued first, then standing), or null. */
  nextStep: (endpoint: RefundEndpoint, accountId: string, request?: { path: string; query: string }) => Step | null;
  // Bodies (exactly what the HTTP surface answers).
  paymentIntentBody: (pi: WorldPaymentIntent) => Record<string, unknown>;
  refundBody: (r: WorldRefund) => Record<string, unknown>;
  /** One list page: 200 + body, or the refusal for a PaymentIntent this account cannot see / a bad cursor. */
  listPage: (accountId: string, filter: { paymentIntentId: string } | { chargeId: string }, startingAfter: string | null, limit: number) => { status: number; body: Record<string, unknown> };
  /** Apply a malformed kind to a 2xx body of `endpoint` (throws when the kind does not belong there). */
  bend: (endpoint: RefundEndpoint, kind: MalformedKind, body: Record<string, unknown>, ctx: { accountId: string; startingAfter: string | null }) => Record<string, unknown>;
  /**
   * The create endpoint. `form` is the urlencoded body (it IS the parameter fingerprint). Returns the answer and
   * whether the response is lost (`network: "after_executing"`), or `{ network: "before" }`.
   */
  create: (secretKey: string, accountId: string, idempotencyKey: string, form: string, step: Step | null) => { status: number; body: unknown; lost: boolean } | { network: "before" };
}

/**
 * Which requests a scripted step applies to: one account's (by any of its keys), and / or the requests whose path +
 * query satisfy `match` (e.g. only the charge list: `(r) => r.query.includes("charge=")`; one refund id:
 * `(r) => r.path.endsWith("/re_x")`). Unscoped = the next request of that endpoint.
 */
export interface ScriptScope {
  account?: string;
  match?: (request: { path: string; query: string }) => boolean;
}
type Scripted = { endpoint: RefundEndpoint; account?: string; match?: ScriptScope["match"]; step: Step };

export const errorBody = (n: number, code?: string, message?: string) => ({
  error: {
    type: n >= 500 ? "api_error" : "invalid_request_error",
    ...(code ? { code } : n === 429 ? { code: "rate_limit" } : {}),
    message: message ?? `stripe-http-fake: ${n}`,
  },
});

/** The body a scripted `status(n, body?)` answers: the given body, else `{}` for a 2xx and a Stripe-shaped error otherwise. */
export const stepBody = (n: number, body: unknown): unknown => (body !== undefined ? body : n >= 200 && n < 300 ? {} : errorBody(n));

export function refundWorld(options: RefundWorldOptions = {}): RefundWorld {
  const opts: Required<RefundWorldOptions> = {
    idempotencyAcrossRotation: options.idempotencyAcrossRotation ?? "lost",
    pageSize: options.pageSize ?? 100,
    createStatus: options.createStatus ?? "succeeded",
    createdAt: options.createdAt ?? (() => Math.floor(Date.now() / 1000)),
  };
  const keys = new Map<string, { accountId: string; expired: boolean }>();
  const queued: Scripted[] = [];
  const standing: Scripted[] = [];
  let seq = 0;
  let clock = 1_790_000_000;
  let refundN = 0;

  const accountIdOf = (accountOrKey: string) => keys.get(accountOrKey)?.accountId ?? accountOrKey;
  const visible = (accountId: string, paymentIntentId: string) => {
    const pi = w.paymentIntents.get(paymentIntentId);
    return pi && pi.account === accountId ? pi : null;
  };
  const newestFirst = (a: WorldRefund, b: WorldRefund) => b.created - a.created || b.seq - a.seq;

  const w: RefundWorld = {
    opts,
    paymentIntents: new Map(),
    refunds: [],
    idempotency: new Map(),
    creates: [],

    account: (secretKey) => {
      if (!keys.has(secretKey)) keys.set(secretKey, { accountId: secretKey, expired: false });
    },
    rotateKey: (account, newKey) => {
      const accountId = accountIdOf(account);
      if (![...keys.values()].some((k) => k.accountId === accountId)) throw new Error(`stripe-http-fake: no account ${accountId}`);
      for (const k of keys.values()) if (k.accountId === accountId) k.expired = true;
      keys.set(newKey, { accountId, expired: false });
    },
    resolve: (secretKey) => {
      const k = keys.get(secretKey);
      if (!k) return { kind: "unknown" };
      return k.expired ? { kind: "expired", accountId: k.accountId } : { kind: "ok", accountId: k.accountId };
    },

    addPaymentIntent: (p) => {
      w.account(p.account);
      const pi: WorldPaymentIntent = {
        id: p.id,
        account: accountIdOf(p.account),
        currency: p.currency ?? "usd",
        livemode: p.livemode ?? false,
        chargeId: p.chargeId === undefined ? `ch_${p.id.replace(/^pi_/, "")}` : p.chargeId,
        amountCaptured: p.amountCaptured ?? 0,
      };
      w.paymentIntents.set(pi.id, pi);
      return pi;
    },
    addRefund: (r) => {
      const pi = r.paymentIntentId ? w.paymentIntents.get(r.paymentIntentId) : [...w.paymentIntents.values()].find((x) => x.chargeId !== null && x.chargeId === r.chargeId);
      const refund: WorldRefund = {
        id: r.id ?? `re_fake_${++refundN}`,
        account: r.account ? accountIdOf(r.account) : pi?.account ?? "",
        paymentIntentId: r.paymentIntentId,
        chargeId: r.chargeId === undefined ? pi?.chargeId ?? null : r.chargeId,
        amount: r.amount,
        currency: r.currency ?? pi?.currency ?? "usd",
        status: r.status ?? "succeeded",
        created: r.created ?? ++clock,
        metadata: r.metadata ?? {},
        reason: r.reason ?? null,
        seq: ++seq,
      };
      if (!refund.account) throw new Error("stripe-http-fake: a refund needs an account (or a known PaymentIntent)");
      w.refunds.push(refund);
      return refund;
    },
    setRefundStatus: (id, s) => {
      const r = w.refunds.find((x) => x.id === id);
      if (!r) throw new Error(`stripe-http-fake: no refund ${id}`);
      r.status = s;
    },
    refundedOn: (paymentIntentId) => {
      const charge = w.paymentIntents.get(paymentIntentId)?.chargeId ?? null;
      return w.refunds.filter((r) => (r.paymentIntentId === paymentIntentId || (r.paymentIntentId === null && charge !== null && r.chargeId === charge))
        && r.status !== "failed" && r.status !== "canceled").reduce((s, r) => s + r.amount, 0);
    },

    script: (endpoint, steps, o) => {
      for (const step of Array.isArray(steps) ? steps : [steps]) queued.push({ endpoint, account: o?.account ? accountIdOf(o.account) : undefined, match: o?.match, step });
    },
    persist: (endpoint, step, o) => {
      standing.push({ endpoint, account: o?.account ? accountIdOf(o.account) : undefined, match: o?.match, step });
    },
    clearScripts: () => {
      queued.length = 0;
      standing.length = 0;
    },
    nextStep: (endpoint, accountId, request) => {
      const match = (e: Scripted) => e.endpoint === endpoint && (!e.account || e.account === accountId)
        && (!e.match || (request !== undefined && e.match(request)));
      const i = queued.findIndex(match);
      if (i >= 0) return queued.splice(i, 1)[0]!.step;
      return standing.find(match)?.step ?? null;
    },

    paymentIntentBody: (pi) => ({
      id: pi.id,
      object: "payment_intent",
      currency: pi.currency,
      livemode: pi.livemode,
      latest_charge: pi.chargeId
        ? { id: pi.chargeId, object: "charge", amount_captured: pi.amountCaptured, amount_refunded: w.refundedOn(pi.id) }
        : null,
    }),
    refundBody: (r) => ({
      id: r.id,
      object: "refund",
      amount: r.amount,
      currency: r.currency,
      payment_intent: r.paymentIntentId,
      charge: r.chargeId,
      status: r.status,
      created: r.created,
      reason: r.reason,
      metadata: { ...r.metadata },
    }),
    listPage: (accountId, filter, startingAfter, limit) => {
      let all: WorldRefund[];
      if ("paymentIntentId" in filter) {
        const pi = visible(accountId, filter.paymentIntentId);
        if (!pi) return { status: 400, body: errorBody(400, "resource_missing", `No such payment_intent: '${filter.paymentIntentId}'`) };
        all = w.refunds.filter((r) => r.account === accountId && r.paymentIntentId === pi.id);
      } else {
        const pi = [...w.paymentIntents.values()].find((x) => x.account === accountId && x.chargeId === filter.chargeId);
        if (!pi) return { status: 400, body: errorBody(400, "resource_missing", `No such charge: '${filter.chargeId}'`) };
        all = w.refunds.filter((r) => r.account === accountId && r.chargeId === filter.chargeId);
      }
      all.sort(newestFirst);
      let from = 0;
      if (startingAfter !== null) {
        const at = all.findIndex((r) => r.id === startingAfter);
        if (at < 0) return { status: 400, body: errorBody(400, "resource_missing", `No such refund: '${startingAfter}'`) };
        from = at + 1;
      }
      const size = Math.max(1, Math.min(limit, opts.pageSize));
      const page = all.slice(from, from + size);
      return { status: 200, body: { object: "list", url: "/v1/refunds", data: page.map(w.refundBody), has_more: from + size < all.length } };
    },

    bend: (endpoint, kind, body, ctx) => {
      const b = structuredClone(body);
      const bendRefund = (r: Record<string, unknown>) => {
        switch (kind) {
          case "refund_missing_amount": delete r.amount; break;
          case "refund_amount_not_integer": r.amount = Number(r.amount) + 0.5; break;
          case "refund_bad_currency": r.currency = String(r.currency).toUpperCase(); break;
          case "refund_other_payment_intent": r.payment_intent = "pi_fake_other_intent"; break;
          case "refund_other_charge": r.charge = "ch_fake_other_charge"; r.payment_intent = "pi_fake_other_intent"; break;
          case "metadata_not_object": r.metadata = "refund_request_id=not-an-object"; break;
          case "unknown_status": r.status = "under_review_fake"; break;
          case "unknown_prefix": r.id = String(r.id).replace(/^[a-z]+_/, "zzr_"); break;
          case "expanded_ids":
            r.payment_intent = { id: r.payment_intent, object: "payment_intent" };
            r.charge = { id: r.charge, object: "charge" };
            break;
          default: throw new Error(`stripe-http-fake: ${kind} is not a refund-level kind`);
        }
      };
      if (PI_MALFORMED.includes(kind)) {
        if (endpoint !== "payment_intent") throw new Error(`stripe-http-fake: ${kind} belongs to the payment_intent endpoint`);
        if (kind === "pi_other_id") b.id = "pi_fake_other_intent";
        else b.latest_charge = (b.latest_charge as { id?: unknown } | null)?.id ?? null;
        return b;
      }
      if (REFUND_MALFORMED.includes(kind)) {
        if (endpoint === "refund") { bendRefund(b); return b; }
        if (endpoint !== "list") throw new Error(`stripe-http-fake: ${kind} belongs to a refund read or a list`);
        const data = b.data as Array<Record<string, unknown>>;
        if (!data[0]) throw new Error(`stripe-http-fake: ${kind} needs a non-empty page`);
        bendRefund(data[0]);
        return b;
      }
      if (endpoint !== "list") throw new Error(`stripe-http-fake: ${kind} belongs to the list endpoint`);
      const data = b.data as Array<Record<string, unknown>>;
      switch (kind) {
        case "no_data_array": delete b.data; break;
        case "has_more_not_boolean": b.has_more = String(b.has_more); break;
        case "non_terminal_without_cursor": b.data = []; b.has_more = true; break;
        case "truncated": b.has_more = true; break;
        case "repeated_id_in_page":
          if (!data[0]) throw new Error("stripe-http-fake: repeated_id_in_page needs a non-empty page");
          data.push(structuredClone(data[0]));
          break;
        case "repeated_cursor": {
          if (!ctx.startingAfter) throw new Error("stripe-http-fake: repeated_cursor needs a request that sent a cursor");
          const at = w.refunds.find((r) => r.id === ctx.startingAfter && r.account === ctx.accountId);
          if (!at) throw new Error("stripe-http-fake: repeated_cursor: the cursor is not a refund of this account");
          b.data = [w.refundBody(at)];
          b.has_more = true;
          break;
        }
        default: throw new Error(`stripe-http-fake: unmodelled kind ${kind}`);
      }
      return b;
    },

    create: (secretKey, accountId, idempotencyKey, form, step) => {
      if (step?.malformed) throw new Error("stripe-http-fake: malformed(...) is not modelled on the create endpoint");
      if (step?.network === "before") return { network: "before" };
      const lost = step?.network === "after_executing";
      if (step?.status !== undefined && step.status < 500) {
        // Refused before execution (401 / 403 / 429 / a 4xx): nothing is saved under the key.
        return { status: step.status, body: step.body ?? errorBody(step.status), lost };
      }
      const scope = opts.idempotencyAcrossRotation === "kept" ? accountId : secretKey;
      const slot = `${scope}|${idempotencyKey}`;
      const saved = w.idempotency.get(slot);
      if (saved) {
        if (saved.fingerprint !== form) {
          return {
            status: 400,
            body: errorBody(400, "idempotency_error", "Keys for idempotent requests can only be used with the same parameters they were first used with."),
            lost,
          };
        }
        w.creates.push({ accountId, secretKey, idempotencyKey, replayed: true, status: saved.status });
        return { status: saved.status, body: structuredClone(saved.body), lost };
      }
      const save = (s: number, body: unknown) => {
        w.idempotency.set(slot, { fingerprint: form, status: s, body: structuredClone(body) });
        w.creates.push({ accountId, secretKey, idempotencyKey, replayed: false, status: s });
        return { status: s, body, lost };
      };
      if (step?.status !== undefined) return save(step.status, step.body ?? errorBody(step.status));
      const p = new URLSearchParams(form);
      const piId = p.get("payment_intent") ?? "";
      const amount = Number(p.get("amount"));
      const pi = visible(accountId, piId);
      if (!pi) return save(400, errorBody(400, "resource_missing", `No such payment_intent: '${piId}'`));
      if (!Number.isSafeInteger(amount) || amount <= 0) return save(400, errorBody(400, "parameter_invalid_integer"));
      if (amount > pi.amountCaptured - w.refundedOn(pi.id)) {
        return save(400, errorBody(400, "charge_already_refunded", "Refund amount is greater than the unrefunded amount on the charge."));
      }
      const metadata: Record<string, string> = {};
      for (const [k, v] of p) {
        const m = /^metadata\[(.+)\]$/.exec(k);
        if (m) metadata[m[1]!] = v;
      }
      const refund = w.addRefund({ paymentIntentId: pi.id, amount, metadata, reason: p.get("reason"), status: opts.createStatus, account: accountId, created: opts.createdAt() });
      return save(200, w.refundBody(refund));
    },
  };
  return w;
}

/** Wait `ms`, rejecting with the signal's reason the moment it aborts — what fetch does with an aborted signal. */
export function sleepHonouringSignal(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal!.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// ── The HTTP fake ──────────────────────────────────────────────────────────────────────────────────────

export interface HttpFakeCall {
  /** The bearer key the request carried (the original field: suites compare it to a key). */
  account: string;
  method: string;
  path: string;
  /** The account the key resolves to (its first key); null for an unregistered key on the session surface. */
  accountId: string | null;
  query: string;
  idempotencyKey: string | null;
  /** A request the TRANSPORT made by following a redirect (the caller made one fetch). */
  followed?: boolean;
  /** The `redirect` mode the request carried ("follow" when none). */
  redirectMode?: string;
  /** The form body of a POST. */
  body?: string;
}

export interface StripeHttpFake {
  sessions: Map<string, HttpFakeSession>;
  /** Every request, in order. */
  calls: HttpFakeCall[];
  /** Accounts (by secret key or account id) that answer 503 to everything. */
  down: Set<string>;
  /** Register a secret key as a real account. An unregistered key is a 401 on sessions and THROWS on refunds. */
  account: (secretKey: string) => void;
  fetch: (url: unknown, init?: unknown) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
  /** The customer finishes a checkout. */
  complete: (sessionId: string) => void;
  open: () => HttpFakeSession[];
  byUrl: (url: string) => HttpFakeSession | undefined;
  // ── refunds ──
  world: RefundWorld;
  rotateKey: (account: string, newKey: string) => void;
  script: RefundWorld["script"];
  persist: RefundWorld["persist"];
  clearScripts: () => void;
  /** GETs and POSTs seen for one account (by any of its keys), or for all accounts. */
  counts: (account?: string) => { gets: number; posts: number };
  /** HTTP requests on the refund surface (followed redirects included), optionally one method only. */
  httpRequests: (method?: "GET" | "POST") => number;
  /** Awaited before a refund-surface request is answered (the interleaving hook; see the header). */
  onRequest: ((call: HttpFakeCall) => void | Promise<void>) | null;
}

const reply = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

export function stripeHttpFake(options: RefundWorldOptions = {}): StripeHttpFake {
  const sessions = new Map<string, HttpFakeSession>();
  const world = refundWorld(options);
  let n = 0;

  const body = (s: HttpFakeSession) => ({
    id: s.id,
    object: "checkout.session",
    status: s.status,
    url: s.status === "open" ? s.url : null,
    amount_total: s.amountCents,
    expires_at: s.expiresAt,
    metadata: { quote_id: s.quoteId, payment_id: s.paymentId },
  });

  const expired = () =>
    reply(401, { error: { type: "invalid_request_error", code: "api_key_expired", message: "Expired API Key provided" } });
  const isDown = (key: string, accountId: string | null) => fake.down.has(key) || (accountId !== null && fake.down.has(accountId));

  type RefundInit = { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal | null; redirect?: string };
  const refundFetch = async (url: URL, init: RefundInit, endpoint: RefundEndpoint, id: string | null, followed = false): Promise<ReturnType<typeof reply>> => {
    const method = init.method ?? "GET";
    const key = String(init.headers?.Authorization ?? "").replace(/^Bearer /, "");
    const resolved = world.resolve(key);
    if (resolved.kind === "unknown") throw new Error("stripe-http-fake: a refund-surface request with a key no test registered");
    const idempotencyKey = init.headers?.["Idempotency-Key"] ?? null;
    const call: HttpFakeCall = {
      account: key, method, path: url.pathname, accountId: resolved.accountId, query: url.search, idempotencyKey,
      redirectMode: init.redirect ?? "follow", ...(followed ? { followed: true } : {}), ...(method === "POST" ? { body: init.body ?? "" } : {}),
    };
    fake.calls.push(call);
    if (fake.onRequest) await fake.onRequest(call);
    if (resolved.kind === "expired") return expired();
    if (isDown(key, resolved.accountId)) return reply(503, { error: { type: "api_error", message: "Service unavailable" } });
    const signal = init.signal ?? null;
    if (signal?.aborted) throw signal.reason;
    const accountId = resolved.accountId;
    const step = world.nextStep(endpoint, accountId, { path: url.pathname, query: url.search });

    if (step?.redirect) {
      // What `fetch` does with a 3xx depends on the request's mode (see the header).
      if (init.redirect === "manual") return reply(step.redirect, { error: { type: "api_error", message: "stripe-http-fake: redirect" } });
      if (init.redirect === "error") throw new TypeError("fetch failed: redirect mode is set to error");
      // "follow": a 307 / 308 re-sends the same request, body and all (a 301 / 302 / 303 turns a POST into a GET).
      const resend = step.redirect === 307 || step.redirect === 308;
      const again: RefundInit = resend ? init : { ...init, method: "GET", body: undefined };
      return refundFetch(url, again, resend ? endpoint : endpoint === "create" ? "list" : endpoint, id, true);
    }

    if (endpoint === "create") {
      if (!idempotencyKey) throw new Error("stripe-http-fake: a refund POST without an Idempotency-Key");
      const out = world.create(key, accountId, idempotencyKey, init.body ?? "", step);
      if ("network" in out) throw new TypeError("fetch failed");
      if (step?.delayMs) await sleepHonouringSignal(step.delayMs, signal);
      if (out.lost) throw new TypeError("fetch failed");
      return reply(out.status, out.body);
    }

    if (step?.network) throw new TypeError("fetch failed");
    let answer: { status: number; body: unknown };
    if (step?.status !== undefined) {
      answer = { status: step.status, body: stepBody(step.status, step.body) };
    } else if (endpoint === "payment_intent") {
      const pi = world.paymentIntents.get(id!);
      answer = pi && pi.account === accountId
        ? { status: 200, body: world.paymentIntentBody(pi) }
        : { status: 404, body: errorBody(404, "resource_missing", `No such payment_intent: '${id}'`) };
    } else if (endpoint === "refund") {
      const r = world.refunds.find((x) => x.id === id && x.account === accountId);
      answer = r ? { status: 200, body: world.refundBody(r) } : { status: 404, body: errorBody(404, "resource_missing", `No such refund: '${id}'`) };
    } else {
      const pi = url.searchParams.get("payment_intent");
      const charge = url.searchParams.get("charge");
      if ((pi === null) === (charge === null)) throw new Error("stripe-http-fake: a refund list needs exactly one of payment_intent / charge");
      answer = world.listPage(accountId, pi !== null ? { paymentIntentId: pi } : { chargeId: charge! }, url.searchParams.get("starting_after"), Number(url.searchParams.get("limit") ?? 10));
    }
    if (step?.malformed) {
      if (answer.status !== 200) throw new Error(`stripe-http-fake: malformed(${step.malformed}) on a ${answer.status} answer`);
      answer = { status: 200, body: world.bend(endpoint, step.malformed, answer.body as Record<string, unknown>, { accountId, startingAfter: url.searchParams.get("starting_after") }) };
    }
    if (step?.delayMs) await sleepHonouringSignal(step.delayMs, signal);
    return reply(answer.status, answer.body);
  };

  const fake: StripeHttpFake = {
    sessions,
    calls: [],
    down: new Set<string>(),
    account: (secretKey) => world.account(secretKey),

    fetch: async (rawUrl, rawInit) => {
      const url = new URL(String(rawUrl));
      const init = (rawInit ?? {}) as RefundInit;
      if (url.origin !== "https://api.stripe.com") throw new Error(`stripe-http-fake: a request left for ${url.origin}`);
      const method = init.method ?? "GET";

      // ── refunds ──
      const piPath = /^\/v1\/payment_intents\/([^/]+)$/.exec(url.pathname);
      if (piPath) {
        if (method !== "GET") throw new Error(`stripe-http-fake: ${method} on a PaymentIntent is not modelled`);
        if (url.searchParams.getAll("expand[]").join(",") !== "latest_charge") throw new Error("stripe-http-fake: a PaymentIntent read without expand[]=latest_charge is not modelled");
        return refundFetch(url, init, "payment_intent", decodeURIComponent(piPath[1]!));
      }
      const refundPath = /^\/v1\/refunds(?:\/([^/]+))?$/.exec(url.pathname);
      if (refundPath) {
        const rid = refundPath[1] ? decodeURIComponent(refundPath[1]) : null;
        if (rid) {
          if (method !== "GET") throw new Error(`stripe-http-fake: ${method} on a refund is not modelled`);
          return refundFetch(url, init, "refund", rid);
        }
        if (method === "POST") return refundFetch(url, init, "create", null);
        if (method === "GET") return refundFetch(url, init, "list", null);
        throw new Error(`stripe-http-fake: ${method} /v1/refunds is not modelled`);
      }

      // ── checkout sessions (unchanged behaviour) ──
      const m = /^\/v1\/checkout\/sessions(?:\/([^/]+))?(\/expire)?$/.exec(url.pathname);
      if (!m) throw new Error(`stripe-http-fake: unmodelled path ${url.pathname}`);
      const key = String(init.headers?.Authorization ?? "").replace(/^Bearer /, "");
      const resolved = world.resolve(key);
      const accountId = resolved.kind === "unknown" ? null : resolved.accountId;
      fake.calls.push({ account: key, method, path: url.pathname, accountId, query: url.search, idempotencyKey: init.headers?.["Idempotency-Key"] ?? null });

      if (resolved.kind === "unknown") {
        return reply(401, { error: { type: "invalid_request_error", message: "Invalid API Key provided" } });
      }
      if (resolved.kind === "expired") return expired();
      if (isDown(key, accountId)) return reply(503, { error: { type: "api_error", message: "Service unavailable" } });

      const [, id, expire] = m;
      if (!id) {
        if (method !== "POST") throw new Error("stripe-http-fake: listing sessions is not modelled");
        const form = new URLSearchParams(init.body ?? "");
        const sid = `cs_test_${key.replace(/[^A-Za-z0-9]/g, "")}_${++n}`;
        const expiresAt = form.get("expires_at");
        const s: HttpFakeSession = {
          id: sid,
          account: resolved.accountId,
          status: "open",
          amountCents: Number(form.get("line_items[0][price_data][unit_amount]")),
          quoteId: form.get("metadata[quote_id]"),
          paymentId: form.get("metadata[payment_id]"),
          expiresAt: expiresAt == null ? null : Number(expiresAt),
          url: `https://checkout.stripe.test/${sid}`,
        };
        sessions.set(sid, s);
        return reply(200, body(s));
      }

      // AN ACCOUNT ONLY SEES ITS OWN OBJECTS (see the header).
      const s = sessions.get(id);
      if (!s || s.account !== resolved.accountId) {
        return reply(404, {
          error: { type: "invalid_request_error", code: "resource_missing", message: `No such checkout.session: '${id}'` },
        });
      }
      if (expire) {
        if (method !== "POST") throw new Error("stripe-http-fake: expire is a POST");
        if (s.status !== "open") {
          return reply(400, {
            error: { type: "invalid_request_error", message: 'Only Checkout Sessions with a status in ["open"] can be expired.' },
          });
        }
        s.status = "expired";
        return reply(200, body(s));
      }
      if (method !== "GET") throw new Error(`stripe-http-fake: ${method} on a session is not modelled`);
      return reply(200, body(s));
    },

    complete: (sessionId) => {
      sessions.get(sessionId)!.status = "complete";
    },
    open: () => [...sessions.values()].filter((s) => s.status === "open"),
    byUrl: (url) => [...sessions.values()].find((s) => s.url === url),

    world,
    rotateKey: (account, newKey) => world.rotateKey(account, newKey),
    script: (endpoint, steps, o) => world.script(endpoint, steps, o),
    persist: (endpoint, step, o) => world.persist(endpoint, step, o),
    clearScripts: () => world.clearScripts(),
    counts: (account) => {
      const r = account === undefined ? null : world.resolve(account);
      const target = r === null ? null : r.kind === "unknown" ? account! : r.accountId;
      const mine = fake.calls.filter((c) => target === null || c.accountId === target);
      return { gets: mine.filter((c) => c.method === "GET").length, posts: mine.filter((c) => c.method === "POST").length };
    },
    httpRequests: (method) => fake.calls.filter((c) => (c.path === "/v1/refunds" || c.path.startsWith("/v1/refunds/") || c.path.startsWith("/v1/payment_intents/"))
      && (method === undefined || c.method === method)).length,
    onRequest: null,
  };
  return fake;
}
