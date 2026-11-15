/**
 * A small STATEFUL fake of the three Stripe Checkout calls the portal makes (audit wave W02,
 * review r1). The always-successful `mockResolvedValue({ id: "cs_new" })` the first spine
 * used could not see two real regressions, because both live in Stripe's own memory:
 *
 *   - IDEMPOTENCY KEYS (docs.stripe.com/api/idempotent_requests). A key replays the
 *     ORIGINAL response for at least 24 hours — whatever has happened to the session since — and a
 *     key re-used with different parameters is an error, not a new object. So "mint again
 *     under the same key" hands back an EXPIRED session, and "same key, new quote" is a 400.
 *   - SESSION STATUS. A session is `open`, `complete` or `expired`; only an open one can be
 *     expired, and only an open one has a hosted URL worth sending anyone to.
 *
 * Both are modelled here and nothing else is. Never a network call. The functions have the
 * signatures of lib/stripe/client.ts so a test wires them in with `mockImplementation`.
 */
import { StripeError } from "@/lib/stripe/client";
import { checkoutSessionParams, type CheckoutSessionParamsInput } from "@/lib/stripe/shared";

export interface FakeSession {
  id: string;
  url: string;
  status: "open" | "complete" | "expired";
  amountCents: number;
  quoteId: string;
  paymentId: string;
  /** The idempotency key it was minted under. */
  key: string;
  /** The `expires_at` it was minted with (epoch seconds); undefined = Stripe's default. */
  expiresAtSec?: number;
}

export interface StripeFake {
  sessions: Map<string, FakeSession>;
  /** Every create call, in order: the key, and whether Stripe REPLAYED an earlier response. */
  creates: Array<{ key: string; replayed: boolean; sessionId: string }>;
  retires: string[];
  retrieves: string[];
  /** When true, every expire call fails the way an unreachable Stripe does. */
  down: boolean;
  create: (secretKey: string, input: CheckoutSessionParamsInput, idempotencyKey: string) => Promise<{ id: string; url: string }>;
  retire: (secretKey: string, sessionId: string) => Promise<"expired" | "complete">;
  retrieve: (
    secretKey: string,
    sessionId: string,
  ) => Promise<{ status: "open" | "complete" | "expired" | "gone"; url: string | null; amountTotal: number | null; quoteId: string | null; paymentId: string | null; expiresAt?: number | null }>;
  /** The customer finishes a checkout. */
  complete: (sessionId: string) => void;
  /** A session lapses on its own (24 h). */
  lapse: (sessionId: string) => void;
  /** The session a hosted URL belongs to. */
  byUrl: (url: string) => FakeSession | undefined;
}

export function stripeFake(): StripeFake {
  const sessions = new Map<string, FakeSession>();
  const keys = new Map<string, { fingerprint: string; sessionId: string }>();
  let n = 0;

  const fake: StripeFake = {
    sessions,
    creates: [],
    retires: [],
    retrieves: [],
    down: false,

    create: async (_secretKey, input, idempotencyKey) => {
      if (fake.down) throw new StripeError(502, "network_error", "socket hang up");
      const fingerprint = JSON.stringify(checkoutSessionParams(input));
      const seen = keys.get(idempotencyKey);
      if (seen) {
        if (seen.fingerprint !== fingerprint) {
          throw new StripeError(
            400,
            "idempotency_error",
            "Keys for idempotent requests can only be used with the same parameters they were first used with.",
          );
        }
        // A replay is the ORIGINAL response. Stripe does not look at the session again.
        const original = sessions.get(seen.sessionId)!;
        fake.creates.push({ key: idempotencyKey, replayed: true, sessionId: original.id });
        return { id: original.id, url: original.url };
      }
      const id = `cs_test_${++n}`;
      const session: FakeSession = {
        id,
        url: `https://checkout.stripe.test/${id}`,
        status: "open",
        amountCents: input.amountCents,
        quoteId: input.quoteId,
        paymentId: input.paymentId,
        key: idempotencyKey,
        expiresAtSec: input.expiresAtSec,
      };
      sessions.set(id, session);
      keys.set(idempotencyKey, { fingerprint, sessionId: id });
      fake.creates.push({ key: idempotencyKey, replayed: false, sessionId: id });
      return { id, url: session.url };
    },

    retire: async (_secretKey, sessionId) => {
      fake.retires.push(sessionId);
      if (fake.down) throw new StripeError(502, "network_error", "socket hang up");
      const s = sessions.get(sessionId);
      if (!s) return "expired"; // this account has never heard of it
      if (s.status === "complete") return "complete";
      s.status = "expired";
      return "expired";
    },

    retrieve: async (_secretKey, sessionId) => {
      fake.retrieves.push(sessionId);
      if (fake.down) throw new StripeError(502, "network_error", "socket hang up");
      const s = sessions.get(sessionId);
      if (!s) return { status: "gone", url: null, amountTotal: null, quoteId: null, paymentId: null };
      return {
        status: s.status,
        url: s.status === "open" ? s.url : null,
        amountTotal: s.amountCents,
        quoteId: s.quoteId,
        paymentId: s.paymentId,
        expiresAt: s.expiresAtSec ?? null,
      };
    },

    complete: (sessionId) => {
      sessions.get(sessionId)!.status = "complete";
    },
    lapse: (sessionId) => {
      sessions.get(sessionId)!.status = "expired";
    },
    byUrl: (url) => [...sessions.values()].find((s) => s.url === url),
  };
  return fake;
}
