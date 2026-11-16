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
 * test registered. Every key here is a fake string.
 */
export interface HttpFakeSession {
  id: string;
  /** The secret key of the account that minted it — the only key that can see it. */
  account: string;
  status: "open" | "complete" | "expired";
  amountCents: number;
  quoteId: string | null;
  paymentId: string | null;
  expiresAt: number | null;
  url: string;
}

export interface StripeHttpFake {
  sessions: Map<string, HttpFakeSession>;
  /** Every request, in order. */
  calls: Array<{ account: string; method: string; path: string }>;
  /** Accounts (by secret key) that answer 503 to everything. */
  down: Set<string>;
  /** Register a secret key as a real account. An unregistered key is a 401. */
  account: (secretKey: string) => void;
  fetch: (url: unknown, init?: unknown) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
  /** The customer finishes a checkout. */
  complete: (sessionId: string) => void;
  open: () => HttpFakeSession[];
  byUrl: (url: string) => HttpFakeSession | undefined;
}

const reply = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

export function stripeHttpFake(): StripeHttpFake {
  const sessions = new Map<string, HttpFakeSession>();
  const accounts = new Set<string>();
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

  const fake: StripeHttpFake = {
    sessions,
    calls: [],
    down: new Set<string>(),
    account: (secretKey) => {
      accounts.add(secretKey);
    },

    fetch: async (rawUrl, rawInit) => {
      const url = new URL(String(rawUrl));
      const init = (rawInit ?? {}) as { method?: string; headers?: Record<string, string>; body?: string };
      if (url.origin !== "https://api.stripe.com") throw new Error(`stripe-http-fake: a request left for ${url.origin}`);
      const m = /^\/v1\/checkout\/sessions(?:\/([^/]+))?(\/expire)?$/.exec(url.pathname);
      if (!m) throw new Error(`stripe-http-fake: unmodelled path ${url.pathname}`);
      const method = init.method ?? "GET";
      const account = String(init.headers?.Authorization ?? "").replace(/^Bearer /, "");
      fake.calls.push({ account, method, path: url.pathname });

      if (!accounts.has(account)) {
        return reply(401, { error: { type: "invalid_request_error", message: "Invalid API Key provided" } });
      }
      if (fake.down.has(account)) return reply(503, { error: { type: "api_error", message: "Service unavailable" } });

      const [, id, expire] = m;
      if (!id) {
        if (method !== "POST") throw new Error("stripe-http-fake: listing sessions is not modelled");
        const form = new URLSearchParams(init.body ?? "");
        const sid = `cs_test_${account.replace(/[^A-Za-z0-9]/g, "")}_${++n}`;
        const expiresAt = form.get("expires_at");
        const s: HttpFakeSession = {
          id: sid,
          account,
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
      if (!s || s.account !== account) {
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
  };
  return fake;
}
