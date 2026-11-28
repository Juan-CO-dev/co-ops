/**
 * Catering refunds Part B1 v2 — the READ and the sweep worker. SERVER-ONLY. GETs ONLY: nothing in this module creates,
 * changes or cancels anything at Stripe (the one POST lives in lib/catering/refunds.ts, after an armed reserve).
 * The database authority is migration 0359 (its header and each function's comment block are the contract).
 *
 * A READ (`runRefundRead`) is complete or it is not:
 *   F5 `catering_refund_read_begin`   opens the read (the DATABASE's id and clock) BEFORE the first GET;
 *   the OWNER                          every account the shop is permitted must ANSWER; all that know the
 *                                      PaymentIntent must agree (strict: `resolveRefundOwner`);
 *   the two LISTS                      by PaymentIntent AND by charge, each paged strictly to `has_more: false`;
 *   the exact RETRIEVES                every listed id, every id already mirrored, every id a request holds;
 *   F6 `catering_refund_record_read`   exactly ONE call, with `complete` or a named reason (`REFUND_READ_REASONS`).
 * Once F5 has opened the read, F6 is ALWAYS called (a provider problem, a timeout, a spent budget are named reasons,
 * never exceptions) [R3]: only a killed process leaves a read open, and 0359 F2 counts that after 15 minutes.
 * Whether the read is complete is decided in SQL from what the read hands over; this module only reports.
 *
 * THE KEY IS NEVER STORED, LOGGED OR SENT TO THE DATABASE [T5]. A read carries the resolved credential inside a
 * `RefundCredential`, whose secret is reachable only through `secretKey()` and which serializes (JSON, inspect) to its
 * slot and its non-secret FINGERPRINT (`credentialFingerprint`). The fingerprint is what 0359 stores.
 *
 * NO DATABASE LOCK IS HELD ACROSS PROVIDER I/O: every RPC is one short transaction.
 */
import "server-only";

import { createHash } from "node:crypto";
import { inspect } from "node:util";

import { getServiceRoleClient } from "@/lib/supabase-server";
import {
  listRefundsPageStrict,
  REFUND_EVIDENCE_MALFORMED,
  retrievePaymentIntentOwner,
  retrieveRefundStrict,
  StripeError,
  STRIPE_REFUND_CALL_MAX_MS,
  type RefundListFilter,
  type StrictRefund,
  type StripeCredentials,
} from "@/lib/stripe/client";
import { stripeAccountsForShop } from "@/lib/stripe/session-owner";
import type { RefundAccountSlot } from "@/lib/catering/refunds-shared";

type ServiceClient = ReturnType<typeof getServiceRoleClient>;

// ── The credential and its fingerprint [T5] ───────────────────────────────────────────────────────────────
const FINGERPRINT_PREFIX = "co-ops:catering-refund:credential:v1\n";

/** The NON-SECRET fingerprint of a secret key: the first 16 hex characters of sha256(prefix + key) [T5]. */
export function credentialFingerprint(secretKey: string): string {
  return createHash("sha256").update(FINGERPRINT_PREFIX + secretKey, "utf8").digest("hex").slice(0, 16);
}

/**
 * One permitted Stripe credential, as a read resolved it. The secret is private: `secretKey()` hands it to the Stripe
 * client and nothing else; JSON and `util.inspect` show only the slot and the fingerprint.
 */
export class RefundCredential {
  readonly slot: RefundAccountSlot;
  readonly fingerprint: string;
  readonly #secretKey: string;
  constructor(creds: Pick<StripeCredentials, "secretKey" | "source">) {
    this.slot = creds.source;
    this.#secretKey = creds.secretKey;
    this.fingerprint = credentialFingerprint(creds.secretKey);
  }
  secretKey(): string {
    return this.#secretKey;
  }
  toJSON(): { slot: RefundAccountSlot; fingerprint: string } {
    return { slot: this.slot, fingerprint: this.fingerprint };
  }
  toString(): string {
    return `RefundCredential(${this.slot}, ${this.fingerprint})`;
  }
  [inspect.custom](): string {
    return this.toString();
  }
}

// ── The named reasons a read is not complete (F6 `p_result`: ^[a-z][a-z0-9_]{0,39}$) ──────────────────────
/**
 * The app's closed set of reasons. 0359 adds its own (`read_too_old`, `evidence_malformed`, `evidence_mismatch`,
 * `evidence_conflict`, `contested`, `incomplete_evidence`) and those win when they apply.
 */
export const REFUND_READ_REASONS = [
  /** the shop's row could not be read: "we do not know the shop" is never "the shared account" */
  "shop_unknown",
  /** the shop has no complete credential pair */
  "no_credentials",
  /** a permitted account could not be asked (an outage, a refused key, a timeout), whoever else answered */
  "owner_unreachable",
  /** every permitted account answered and none knows the PaymentIntent */
  "owner_indeterminate",
  /** two accounts know it and differ in charge, currency, mode or captured amount [R14] */
  "owner_conflict",
  /** an account knows it but its answer does not carry the charge, currency, mode and captured amount */
  "owner_malformed",
  "list_failed",
  "list_malformed",
  "list_repeated_id",
  "list_repeated_cursor",
  /** more than `REFUND_LIST_MAX_PAGES` pages */
  "list_too_long",
  /** an id 0359 does not store (not `re_` / `pyr_`): never handed over */
  "refund_id_unrecognised",
  "retrieve_not_found",
  "retrieve_denied",
  "retrieve_failed",
  "retrieve_malformed",
  /** the read's budget ran out before its GETs were made */
  "deadline_exhausted",
] as const;
export type RefundReadReason = (typeof REFUND_READ_REASONS)[number];

/** Pages of 100 one list may take before the read gives up on it (`list_too_long`). */
export const REFUND_LIST_MAX_PAGES = 20;
/** Exact retrieves made at once (GETs, well under Stripe's read rate limit). */
export const REFUND_RETRIEVE_CONCURRENCY = 8;
/** Time kept back at the end of a read for its one F6 call. */
const RECORD_RESERVE_MS = 1_500;

const RE_ID = /^(re|pyr)_[A-Za-z0-9_]{1,250}$/;
const PI_ID = /^pi_[A-Za-z0-9_]{1,250}$/;
const CHARGE_ID = /^[a-z]{2,4}_[A-Za-z0-9_]{1,250}$/;

/** A missing function / table / grant: the schema is not what this build needs. Never fall back to anything. */
export function refundSchemaMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return ["PGRST202", "PGRST205", "42883", "42P01", "42501"].includes(error.code ?? "") || /could not find the (table|function)/i.test(error.message ?? "");
}

/** The schema 0359 is missing (or its grants are not as written): the route answers 503 `refunds_unavailable`. */
export class RefundsUnavailableError extends Error {
  constructor(public fn: string) {
    super("refunds_unavailable");
    this.name = "RefundsUnavailableError";
  }
}

/** One worker RPC. A missing schema THROWS `RefundsUnavailableError`; any other error is returned for the caller. */
async function workerRpc<T>(sb: ServiceClient, fn: string, args: Record<string, unknown>): Promise<{ data: T | null; error: { code?: string; message: string } | null }> {
  const { data, error } = await sb.rpc(fn, args);
  if (error && refundSchemaMissing(error)) throw new RefundsUnavailableError(fn);
  return { data: (data ?? null) as T | null, error: error ? { code: error.code, message: error.message } : null };
}

// ── The owner ─────────────────────────────────────────────────────────────────────────────────────────────
export interface ResolvedRefundOwner {
  paymentIntentId: string;
  chargeId: string;
  currency: string;
  livemode: boolean;
  capturedCents: number;
  /** The account every later call of this read, and the POST, goes through. */
  credential: RefundCredential;
}

export type RefundOwnerResult =
  | { status: "resolved"; owner: ResolvedRefundOwner; accountsAsked: number }
  | { status: "unreachable" | "indeterminate" | "owner_conflict"; reason: RefundReadReason; accountsAsked: number };

/** The shop's `locations.code`. THROWS on a failed read or a missing row: "we do not know the shop" is never the shared account. */
async function shopCode(sb: ServiceClient, locationId: string): Promise<string | null> {
  const { data, error } = await sb.from("locations").select("id, code").eq("id", locationId).maybeSingle<{ id: string; code: string | null }>();
  if (error) throw new Error("refund shop read failed");
  if (!data) throw new Error("refund shop: no such location");
  return data.code ?? null;
}

/**
 * STRICT owner resolution [R14]. Every account the shop is permitted (`stripeAccountsForShop`: the shop's own pair,
 * then the shared one) is asked, and every one must ANSWER (found or 404):
 *   unreachable    one could not be asked, or knows it with an answer that is not whole — EVEN when another account
 *                  knows the PaymentIntent (that answer cannot rule out the silent account);
 *   owner_conflict two that know it differ in charge, currency, mode OR captured amount;
 *   indeterminate  every one answered and none knows it (or the shop has no credential at all);
 *   resolved       the first account in that order that knows it.
 * ONE KEY IN BOTH SLOTS is ONE credential: accounts are de-duplicated by fingerprint (as `stripeAccountsForShop`
 * already does by key), and the slot reported is the first listed, the shop's own (`location`): that is the slot
 * `stripeCredentialsFor(code)` answers and where new money goes, so it is the slot a person is told to look in.
 * `deadlineMs` is an absolute epoch-ms deadline for the whole resolution.
 */
export async function resolveRefundOwner(sb: ServiceClient, locationId: string, paymentIntentId: string, deadlineMs: number): Promise<RefundOwnerResult> {
  let accounts: StripeCredentials[];
  try {
    accounts = stripeAccountsForShop(await shopCode(sb, locationId));
  } catch {
    return { status: "unreachable", reason: "shop_unknown", accountsAsked: 0 };
  }
  const credentials: RefundCredential[] = [];
  for (const a of accounts) {
    const c = new RefundCredential(a);
    if (!credentials.some((x) => x.fingerprint === c.fingerprint)) credentials.push(c);
  }
  if (credentials.length === 0) return { status: "indeterminate", reason: "no_credentials", accountsAsked: 0 };
  const answers = await Promise.all(credentials.map(async (credential) => {
    const left = deadlineMs - Date.now();
    try {
      const read = await retrievePaymentIntentOwner(credential.secretKey(), paymentIntentId, left);
      return { credential, read, failed: null as RefundReadReason | null };
    } catch (e) {
      const deadline = e instanceof StripeError && e.code === "deadline_exhausted";
      return { credential, read: null, failed: (deadline ? "deadline_exhausted" : "owner_unreachable") as RefundReadReason };
    }
  }));
  const asked = answers.length;
  const failed = answers.find((a) => a.failed);
  if (failed) return { status: "unreachable", reason: failed.failed!, accountsAsked: asked };
  const found = answers.filter((a) => a.read?.status === "found");
  for (const f of found) {
    const r = f.read!;
    if (!r.chargeId || !CHARGE_ID.test(r.chargeId) || !r.currency || r.livemode === null || r.amountCapturedCents === null) {
      return { status: "unreachable", reason: "owner_malformed", accountsAsked: asked };
    }
  }
  if (found.length === 0) return { status: "indeterminate", reason: "owner_indeterminate", accountsAsked: asked };
  const first = found[0]!;
  const a = first.read!;
  for (const other of found.slice(1)) {
    const b = other.read!;
    if (b.chargeId !== a.chargeId || b.currency !== a.currency || b.livemode !== a.livemode || b.amountCapturedCents !== a.amountCapturedCents) {
      return { status: "owner_conflict", reason: "owner_conflict", accountsAsked: asked };
    }
  }
  return {
    status: "resolved",
    accountsAsked: asked,
    owner: {
      paymentIntentId,
      chargeId: a.chargeId!,
      currency: a.currency!,
      livemode: a.livemode!,
      capturedCents: a.amountCapturedCents!,
      credential: first.credential,
    },
  };
}

// ── The read ──────────────────────────────────────────────────────────────────────────────────────────────
/** F5's answer (0359 `catering_refund_read_begin`). */
interface ReadBegun {
  eligible: boolean;
  read_id?: string;
  started_at?: string;
  replaced?: boolean;
  payment_id?: string;
  payment_intent?: string;
  quote_id?: string;
  location_id?: string | null;
  mirrored_ids?: string[];
  request_refund_ids?: string[];
}

/** F6's answer (0359 `catering_refund_record_read`). */
export interface RecordReadAnswer {
  result: "complete" | "not_complete" | "read_replaced";
  reason?: string | null;
  read_token?: string;
  started_at?: string;
  mirrored?: number;
  bound?: Array<{ request_id: string; refund_id: string }>;
  linked?: number;
  conflict_with?: string | null;
}

/**
 * What one read came to.
 *   complete       F6 stamped it complete: `readToken` is the one-time token F8 / F9 / F12 / F16 accept.
 *   not_complete   F6 recorded it with `reason` (the app's, or 0359's own) and marked the payment dirty.
 *   read_replaced  a later read was begun on this payment; this one handed over nothing (and F6 marked it dirty).
 *   ineligible     F5 answered `eligible: false` (not a Stripe-paid payment with a PaymentIntent): nothing was read.
 *   record_failed  F6 could not be called or answered something unknown: the read stays OPEN in the database and 0359
 *                  F2 counts it dirty after 15 minutes. No token.
 */
export type RefundReadResult = "complete" | "not_complete" | "read_replaced" | "ineligible" | "record_failed";

export interface RefundReadOutcome {
  paymentId: string;
  result: RefundReadResult;
  /** The app's reason (when it had one) or 0359's (`recorded.reason`). Null only for `complete` / `ineligible`. */
  reason: string | null;
  readToken: string | null;
  readId: string | null;
  startedAt: string | null;
  /** The PaymentIntent F5 read from the payment row (null when ineligible). */
  paymentIntentId: string | null;
  locationId: string | null;
  /** The resolved owner (its credential included, for the POST); null when the owner was not resolved. */
  owner: ResolvedRefundOwner | null;
  /** F6's raw answer (no secret in it), when F6 answered. */
  recorded: RecordReadAnswer | null;
  /** Requests this read bound by itself (F6 [Q2]). */
  bound: Array<{ requestId: string; refundId: string }>;
  /** GETs made by this read (owner + list pages + retrieves). */
  gets: number;
}

export interface RefundReadOptions {
  /** Absolute epoch-ms deadline for the whole read (provider GETs stop `RECORD_RESERVE_MS` before it). */
  deadlineMs: number;
}

type F6Refund = { id: string; amount: number; currency: string; payment_intent: string | null; charge: string | null; status: string | null; created: number; request_id: string | null };
const f6Refund = (r: StrictRefund): F6Refund => ({
  id: r.id, amount: r.amountCents, currency: r.currency, payment_intent: r.paymentIntentId, charge: r.chargeId,
  status: r.status, created: r.createdSec, request_id: r.requestId,
});

function classifyListError(e: unknown): RefundReadReason {
  if (e instanceof StripeError) {
    if (e.code === "deadline_exhausted") return "deadline_exhausted";
    if (e.code === REFUND_EVIDENCE_MALFORMED) return "list_malformed";
  }
  return "list_failed";
}
function classifyRetrieveError(e: unknown): RefundReadReason {
  if (e instanceof StripeError) {
    if (e.code === "deadline_exhausted") return "deadline_exhausted";
    if (e.code === REFUND_EVIDENCE_MALFORMED) return "retrieve_malformed";
    if (e.status === 401 || e.status === 403) return "retrieve_denied";
  }
  return "retrieve_failed";
}

/** One list, strictly, to its terminal page. Never throws: a failure is the reason it is not terminal. */
async function readList(secretKey: string, filter: RefundListFilter, stopAt: number, onGet: () => void): Promise<{ terminal: boolean; refunds: StrictRefund[]; reason: RefundReadReason | null }> {
  const refunds: StrictRefund[] = [];
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let after: string | null = null;
  for (let page = 0; page < REFUND_LIST_MAX_PAGES; page++) {
    const left = stopAt - Date.now();
    if (left < 250) return { terminal: false, refunds, reason: "deadline_exhausted" };
    let got;
    try {
      onGet();
      got = await listRefundsPageStrict(secretKey, filter, after, Math.min(left, STRIPE_REFUND_CALL_MAX_MS));
    } catch (e) {
      return { terminal: false, refunds, reason: classifyListError(e) };
    }
    for (const r of got.refunds) {
      // WITHIN one list a repeated id means the enumeration is not stable: not complete, never "all of them".
      if (ids.has(r.id)) return { terminal: false, refunds, reason: "list_repeated_id" };
      ids.add(r.id);
      refunds.push(r);
    }
    if (!got.hasMore) return { terminal: true, refunds, reason: null };
    if (!got.lastId || got.lastId === after || cursors.has(got.lastId)) return { terminal: false, refunds, reason: "list_repeated_cursor" };
    cursors.add(got.lastId);
    after = got.lastId;
  }
  return { terminal: false, refunds, reason: "list_too_long" };
}

/**
 * ONE read of one payment (see the header). Never POSTs. Never throws for a provider problem; THROWS only
 * `RefundsUnavailableError` (the schema is missing) or a database error from F5 itself (then no read was opened).
 */
export async function runRefundRead(sb: ServiceClient, paymentId: string, opts: RefundReadOptions): Promise<RefundReadOutcome> {
  const begun = await workerRpc<ReadBegun>(sb, "catering_refund_read_begin", { p_payment_id: paymentId });
  if (begun.error) throw new Error(`catering_refund_read_begin: ${begun.error.code ?? "error"}`);
  const b = begun.data;
  const base = (over: Partial<RefundReadOutcome>): RefundReadOutcome => ({
    paymentId, result: "record_failed", reason: null, readToken: null, readId: b?.read_id ?? null, startedAt: b?.started_at ?? null,
    paymentIntentId: b?.payment_intent ?? null, locationId: b?.location_id ?? null, owner: null, recorded: null, bound: [], gets: 0, ...over,
  });
  if (!b || b.eligible !== true) return base({ result: "ineligible", readId: null, startedAt: null, paymentIntentId: null, locationId: null });
  if (typeof b.read_id !== "string" || typeof b.payment_intent !== "string" || !PI_ID.test(b.payment_intent)) {
    // F5 opened something this build cannot read: nothing to record against. F2 counts the open read.
    return base({ result: "record_failed", reason: "begin_malformed" });
  }
  const readId = b.read_id;
  const stopAt = opts.deadlineMs - RECORD_RESERVE_MS;
  let gets = 0;
  const onGet = () => { gets++; };

  // ── provider work: every failure becomes the reason, never an exception ──
  let reason: RefundReadReason | null = null;
  let owner: ResolvedRefundOwner | null = null;
  const lists: Array<{ by: "payment_intent" | "charge"; terminal: boolean; ids: string[] }> = [];
  const retrieved = new Map<string, StrictRefund>();
  try {
    if (!b.location_id) {
      reason = "shop_unknown";
    } else if (stopAt - Date.now() < 250) {
      reason = "deadline_exhausted";
    } else {
      const o = await resolveRefundOwner(sb, b.location_id, b.payment_intent, stopAt);
      gets += o.accountsAsked;
      if (o.status !== "resolved") reason = o.reason;
      else owner = o.owner;
    }
    if (owner) {
      const key = owner.credential.secretKey();
      const [byPi, byCharge] = await Promise.all([
        readList(key, { paymentIntentId: owner.paymentIntentId, ownerChargeId: owner.chargeId }, stopAt, onGet),
        readList(key, { chargeId: owner.chargeId, ownerPaymentIntentId: owner.paymentIntentId }, stopAt, onGet),
      ]);
      reason = byPi.reason ?? byCharge.reason;
      // An id 0359 does not store is never handed over (it would make the whole evidence malformed).
      const keep = (rs: StrictRefund[]) => {
        const out: string[] = [];
        for (const r of rs) {
          if (RE_ID.test(r.id)) out.push(r.id);
          else reason ??= "refund_id_unrecognised";
        }
        return out;
      };
      lists.push({ by: "payment_intent", terminal: byPi.terminal, ids: keep(byPi.refunds) });
      lists.push({ by: "charge", terminal: byCharge.terminal, ids: keep(byCharge.refunds) });
      // The two lists are UNITED: an id in both is normal and is retrieved once [R16]. Then every id the database
      // already mirrors for the payment and every id a request holds.
      const want = [...new Set([...lists[0]!.ids, ...lists[1]!.ids, ...(b.mirrored_ids ?? []), ...(b.request_refund_ids ?? [])])]
        .filter((id) => {
          if (RE_ID.test(id)) return true;
          reason ??= "refund_id_unrecognised";
          return false;
        })
        .sort();
      for (let i = 0; i < want.length && reason === null; i += REFUND_RETRIEVE_CONCURRENCY) {
        const left = stopAt - Date.now();
        if (left < 250) { reason = "deadline_exhausted"; break; }
        const batch = want.slice(i, i + REFUND_RETRIEVE_CONCURRENCY);
        const got = await Promise.all(batch.map(async (id) => {
          gets++;
          try {
            const r = await retrieveRefundStrict(key, id, Math.min(stopAt - Date.now(), STRIPE_REFUND_CALL_MAX_MS));
            return r.status === "found" ? { refund: r.refund, failed: null } : { refund: null, failed: "retrieve_not_found" as RefundReadReason };
          } catch (e) {
            return { refund: null, failed: classifyRetrieveError(e) };
          }
        }));
        for (const g of got) {
          if (g.refund) retrieved.set(g.refund.id, g.refund);
          else reason ??= g.failed;
        }
      }
    }
  } catch {
    // A defect in the provider leg (never a database error: those are below) is still a named reason [R3].
    reason ??= "retrieve_failed";
  }

  // ── exactly ONE F6 call, whatever happened above ──
  const pOwner = owner ? {
    payment_intent: owner.paymentIntentId, charge: owner.chargeId, currency: owner.currency, livemode: owner.livemode,
    captured: owner.capturedCents, account_slot: owner.credential.slot, credential_fp: owner.credential.fingerprint,
  } : null;
  const pRefunds = owner ? [...retrieved.values()].sort((x, y) => (x.id < y.id ? -1 : 1)).map(f6Refund) : [];
  let rec: Awaited<ReturnType<typeof workerRpc<RecordReadAnswer>>>;
  try {
    rec = await workerRpc<RecordReadAnswer>(sb, "catering_refund_record_read", {
      p_payment_id: paymentId,
      p_read_id: readId,
      p_result: reason ?? "complete",
      p_owner: pOwner,
      p_lists: owner ? lists : [],
      p_refunds: pRefunds,
    });
  } catch (e) {
    if (e instanceof RefundsUnavailableError) throw e;
    return base({ result: "record_failed", reason: reason ?? "record_unanswered", readId, owner, gets });
  }
  if (rec.error || !rec.data) return base({ result: "record_failed", reason: reason ?? "record_unanswered", readId, owner, gets });
  const r = rec.data;
  const bound = Array.isArray(r.bound) ? r.bound.map((x) => ({ requestId: String(x.request_id), refundId: String(x.refund_id) })) : [];
  switch (r.result) {
    case "complete":
      if (typeof r.read_token !== "string") return base({ result: "record_failed", reason: "record_unanswered", readId, owner, recorded: r, gets });
      return base({ result: "complete", reason: null, readToken: r.read_token, readId, owner, recorded: r, bound, gets, startedAt: r.started_at ?? b.started_at ?? null });
    case "not_complete":
      return base({ result: "not_complete", reason: r.reason ?? reason ?? "not_complete", readId, owner, recorded: r, gets });
    case "read_replaced":
      return base({ result: "read_replaced", reason: "read_replaced", readId, owner, recorded: r, gets });
    default:
      // No default branch may read as success.
      return base({ result: "record_failed", reason: "record_unknown_answer", readId, owner, recorded: r, gets });
  }
}

// ── The sweep worker ─────────────────────────────────────────────────────────────────────────────────────
/** F13's answer (0359 `catering_refund_sweep_begin`). */
interface SweepBegun {
  claimed: boolean;
  reason?: string;
  claim_id?: string;
  claimed_at?: string;
  resumed?: boolean;
  resumed_rows?: number;
  transitions?: number;
  due?: {
    a?: string[];
    c?: string[];
    stale_unarmed?: string[];
    counts?: { never_read?: number; dirty?: number; unconfirmed?: number; ledger_rows_read?: number; in_scope?: number; known?: number };
    oldest_unchecked_at?: string | null;
  };
}

export interface RefundSweepOptions {
  /** Absolute epoch-ms deadline for the whole run (the route's budget less its finishing reserve). */
  deadlineMs: number;
  /** F13's `p_limit` (ids per list). Default 50. */
  limit?: number;
  /** One read's own budget (20 s, or what is left). */
  readBudgetMs?: number;
  /** A read starts only while at least this much of the run is left (5 s). */
  minLeftMs?: number;
  /** One `cancel_unarmed` call's budget (3 s); a call starts only while this much is left. */
  cancelBudgetMs?: number;
}

/** Counts only: never an id (the heartbeat carries this). */
export interface RefundSweepCounts {
  claimed: boolean;
  /** Why not claimed (`busy`, `observe_not_recorded`). */
  reason: string | null;
  resumed: boolean;
  resumedRows: number;
  transitions: number | null;
  /** Reads begun this run. */
  passes: number;
  complete: number;
  notComplete: Record<string, number>;
  replaced: number;
  ineligible: number;
  recordFailed: number;
  /** F5 itself failed (a database error): no read was opened. */
  beginFailed: number;
  bound: number;
  cancelledUnarmed: number;
  leftA: number;
  leftC: number;
  leftStaleUnarmed: number;
  neverRead: number;
  dirty: number;
  unconfirmed: number;
  ledgerRowsRead: number;
  oldestUncheckedAt: string | null;
  /** F18 stamped the pass end (false = not reached, or `superseded`). */
  passEndStamped: boolean;
  gets: number;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * One sweep run [R1] [R10] [S10] [T6]. GETs only.
 *   1. F13 `catering_refund_sweep_begin` ONCE (here and nowhere else; the route never claims). Not claimed -> stop.
 *   2. The reads, SHARED BY TIME: while both lists have work, one payment from C (the re-read), then one from A (needs
 *      a read now), and so on; each read with its own deadline (`readBudgetMs`, or what is left); no read starts when
 *      less than `minLeftMs` is left. So a run that can make any read at all makes a re-read, however slow A is.
 *   3. THEN F11 `catering_refund_cancel_unarmed` for each `stale_unarmed` id, each with its own `cancelBudgetMs`,
 *      only while that much is left [S10].
 *   4. F18 `catering_refund_sweep_end` with the claim id and the read counts, on every run that reached here [T6].
 * Returns counts only. THROWS `RefundsUnavailableError` (schema missing) or a database error of F13 itself.
 */
export async function runRefundSweep(sb: ServiceClient, opts: RefundSweepOptions): Promise<RefundSweepCounts> {
  const readBudget = opts.readBudgetMs ?? 20_000;
  const minLeft = opts.minLeftMs ?? 5_000;
  const cancelBudget = opts.cancelBudgetMs ?? 3_000;
  const begun = await workerRpc<SweepBegun>(sb, "catering_refund_sweep_begin", { p_limit: opts.limit ?? 50 });
  if (begun.error || !begun.data) throw new Error(`catering_refund_sweep_begin: ${begun.error?.code ?? "no answer"}`);
  const s = begun.data;
  const due = s.due ?? {};
  const counts: RefundSweepCounts = {
    claimed: s.claimed === true,
    reason: s.claimed === true ? null : String(s.reason ?? "not_claimed"),
    resumed: s.resumed === true,
    resumedRows: num(s.resumed_rows),
    transitions: typeof s.transitions === "number" ? s.transitions : null,
    passes: 0, complete: 0, notComplete: {}, replaced: 0, ineligible: 0, recordFailed: 0, beginFailed: 0, bound: 0, cancelledUnarmed: 0,
    leftA: 0, leftC: 0, leftStaleUnarmed: 0,
    neverRead: num(due.counts?.never_read), dirty: num(due.counts?.dirty), unconfirmed: num(due.counts?.unconfirmed),
    ledgerRowsRead: num(due.counts?.ledger_rows_read), oldestUncheckedAt: due.oldest_unchecked_at ?? null,
    passEndStamped: false, gets: 0,
  };
  if (s.claimed !== true) return counts;
  if (typeof s.claim_id !== "string") throw new Error("catering_refund_sweep_begin: claimed without a claim id");

  const a = [...(Array.isArray(due.a) ? due.a : [])];
  const c = [...(Array.isArray(due.c) ? due.c : [])];
  const readThisRun = new Set<string>();
  let turn: "c" | "a" = "c";
  while (a.length > 0 || c.length > 0) {
    const left = opts.deadlineMs - Date.now();
    if (left < minLeft) break;
    const from = turn === "c" ? (c.length > 0 ? c : a) : (a.length > 0 ? a : c);
    turn = turn === "c" ? "a" : "c";
    const paymentId = from.shift()!;
    if (readThisRun.has(paymentId)) continue;
    readThisRun.add(paymentId);
    counts.passes++;
    let out: RefundReadOutcome;
    try {
      out = await runRefundRead(sb, paymentId, { deadlineMs: Date.now() + Math.min(readBudget, left) });
    } catch (e) {
      if (e instanceof RefundsUnavailableError) throw e;
      counts.beginFailed++; // F5 itself failed: no read was opened; the next run finds the payment again
      continue;
    }
    counts.gets += out.gets;
    counts.bound += out.bound.length;
    switch (out.result) {
      case "complete": counts.complete++; break;
      case "not_complete": {
        const why = out.reason ?? "not_complete";
        counts.notComplete[why] = (counts.notComplete[why] ?? 0) + 1;
        break;
      }
      case "read_replaced": counts.replaced++; break;
      case "ineligible": counts.ineligible++; break;
      case "record_failed": counts.recordFailed++; break;
    }
  }
  counts.leftA = a.filter((id) => !readThisRun.has(id)).length;
  counts.leftC = c.filter((id) => !readThisRun.has(id)).length;

  // [S10] cleanup AFTER the reads.
  const stale = [...(Array.isArray(due.stale_unarmed) ? due.stale_unarmed : [])];
  while (stale.length > 0 && opts.deadlineMs - Date.now() >= cancelBudget) {
    const requestId = stale.shift()!;
    const signal = AbortSignal.timeout(cancelBudget);
    try {
      const { data, error } = await sb.rpc("catering_refund_cancel_unarmed", { p_request_id: requestId, p_reason: "sweep_stale_unarmed" }).abortSignal(signal);
      if (error && refundSchemaMissing(error)) throw new RefundsUnavailableError("catering_refund_cancel_unarmed");
      if (!error && (data as { result?: unknown } | null)?.result === "cancelled") counts.cancelledUnarmed++;
    } catch (e) {
      if (e instanceof RefundsUnavailableError) throw e;
      // one cancel that did not answer: the next run finds the row again
    }
  }
  counts.leftStaleUnarmed = stale.length;

  // [T6] the pass-end stamp.
  const end = await workerRpc<{ result?: string }>(sb, "catering_refund_sweep_end", {
    p_claim_id: s.claim_id, p_reads: counts.passes, p_complete: counts.complete,
  });
  counts.passEndStamped = !end.error && end.data?.result === "ended";
  return counts;
}
