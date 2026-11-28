/**
 * Scenario toolkit over the 0359 PGlite base (scripts/sql-harness-0359-lib.mjs). SYNTHETIC ROWS ONLY: shops, people,
 * quotes, payments, ledger rows and the evidence a read would hand over. No network, no key, no real database.
 * Shared by scripts/sql-harness-0359.mjs, tests/helpers/refund-pglite.ts and the sim lock check's self-test.
 *
 * TIME. Every decision of 0359 reads clock_timestamp(), so the harness cannot freeze the clock. `elapse(db, '6 minutes')`
 * makes time pass instead: it moves EVERY stored instant of B1's tables, of the requests table and of main's ledger
 * back by that much (fixture owner, row triggers off). After it, the database is exactly what it would be that much
 * later with nothing having happened in between.
 */
import { randomUUID } from "node:crypto";
import { one, rows } from "./sql-harness-0359-lib.mjs";

export const rpc = async (db, fn, args = []) =>
  (await one(db, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)).r;

/** Call an RPC as the application's role (service_role): proves the grant as well as the answer. */
export async function asService(db, fn) {
  await db.exec("set role service_role");
  try { return await fn(); } finally { await db.exec("reset role"); }
}

export async function world(db) {
  const shop = (await one(db, "insert into public.locations (code) values ('S1') returning id")).id;
  const other = (await one(db, "insert into public.locations (code) values ('S2') returning id")).id;
  const user = async (role, { member = shop, active = true, memberActive = true } = {}) => {
    const id = (await one(db, "insert into public.users (role, active) values ($1, $2) returning id", [role, active])).id;
    if (member) await db.query("insert into public.user_locations (user_id, location_id, active) values ($1, $2, $3)", [id, member, memberActive]);
    return id;
  };
  const quote = async (loc = shop, root = null) => (await one(db,
    "insert into public.catering_quotes (location_id, version, status, root_id) values ($1, 1, 'accepted', $2) returning id", [loc, root])).id;
  let n = 0;
  /** A payment row as main leaves it. `charge` is what Stripe would report as the PaymentIntent's charge. */
  const pay = async (quoteId, kind, amount, { status = "paid", pi = `pi_test_${++n}_${randomUUID().slice(0, 8)}`, provider = "stripe", session = null } = {}) => {
    const id = (await one(db,
      `insert into public.catering_payments (quote_id, kind, amount_cents, status, provider, provider_ref, paid_at, provider_session_id)
       values ($1, $2, $3, $4, $5, $6, case when $4 in ('paid', 'refunded') then now() - interval '2 days' end, $7) returning id`,
      [quoteId, kind, amount, status, provider, status === "due" || status === "void" ? null : pi, session])).id;
    return { id, pi, charge: `ch_${pi.slice(3)}`, amount };
  };
  return { shop, other, user, quote, pay };
}

/** The owner facts a read resolved (plan F6 `p_owner`). `fp` is the credential fingerprint [T5]: 16 hex characters. */
export const ownerOf = (p, { captured = p.amount, currency = "usd", livemode = false, slot = "default", fp = "0123456789abcdef", charge = p.charge, pi = p.pi } = {}) =>
  ({ payment_intent: pi, charge, currency, livemode, captured, account_slot: slot, credential_fp: fp });

let rn = 0;
/** A RETRIEVED refund object as the app hands it over (plan F6 `p_refunds`). created = epoch seconds. */
export const refundOf = (p, amount, { id = `re_h${++rn}x${randomUUID().slice(0, 6)}`, status = "succeeded", created = Math.floor(Date.now() / 1000) - 3600,
  request = null, pi = p.pi, charge = p.charge, currency = "usd" } = {}) =>
  ({ id, amount, currency, payment_intent: pi, charge, status, created, request_id: request });

/** The two terminal lists for a set of refund objects (plan F6 `p_lists`). */
export const listsOf = (refunds, { piTerminal = true, chargeTerminal = true } = {}) => [
  { by: "payment_intent", terminal: piTerminal, ids: refunds.filter((r) => r.payment_intent).map((r) => r.id) },
  { by: "charge", terminal: chargeTerminal, ids: refunds.map((r) => r.id) },
];

export const begin = (db, paymentId) => rpc(db, "catering_refund_read_begin", [paymentId]);
export const record = (db, paymentId, readId, { result = "complete", owner = null, lists = [], refunds = [] } = {}) =>
  rpc(db, "catering_refund_record_read", [paymentId, readId, result, owner == null ? null : JSON.stringify(owner), JSON.stringify(lists), JSON.stringify(refunds)]);

/** One whole read of a payment: begin, then record what was "retrieved". Returns F6's answer plus the begin's. */
export async function read(db, p, { refunds = [], result = "complete", owner = ownerOf(p), lists = listsOf(refunds) } = {}) {
  const b = await begin(db, p.id);
  if (!b.eligible) return { ...b, begun: b };
  const r = await record(db, p.id, b.read_id, { result, owner, lists, refunds });
  return { ...r, begun: b };
}

/** F3 for one payment, cents as numbers. */
export const figures = async (db, paymentId) => {
  const f = await one(db, "select * from public.catering_refund_payment_figures($1)", [paymentId]);
  return Object.fromEntries(Object.entries(f).map(([key, v]) => [key.replace(/^o_/, ""), typeof v === "boolean" || v == null || v instanceof Date || key === "o_state" ? v : Number(v)]));
};

const TIMES = {
  catering_refund_payment_state: ["open_read_started_at", "last_complete_read_started_at", "last_complete_read_recorded_at", "dirty_since", "last_attempt_at"],
  catering_refund_observation: ["transitioned_at", "resumed_at", "lease_until", "last_claim_at", "last_pass_ended_at"],
  catering_refund_observed: ["read_started_at", "recorded_at", "first_seen_at", "status_changed_at", "stripe_created_at"],
  catering_refund_requests: ["create_armed_at", "first_attempt_at", "requested_at", "updated_at", "settled_at", "resolved_at", "claimed_until"],
  stripe_events: ["received_at"],
};
/** Make `interval` pass: every stored instant moves back by it (see the header). */
export async function elapse(db, interval) {
  await db.exec("set session_replication_role = replica");
  try {
    for (const [table, cols] of Object.entries(TIMES)) {
      await db.query(`update public.${table} set ${cols.map((c) => `${c} = ${c} - $1::interval`).join(", ")}`, [interval]);
    }
  } finally {
    await db.exec("set session_replication_role = origin");
  }
}

let evt = 0;
/**
 * A delivery as main's webhook stores it: ONE ledger row (0204). `shape` chooses how the object names the payment:
 *   refund (default)     a refund / charge.refunded-like object with scalar payment_intent and charge
 *   expanded             payment_intent and charge as expanded objects
 *   charge_own           a charge.* event whose OBJECT is the charge (its own id), no payment_intent field
 *   pi_own               a payment_intent.* event whose object is the PaymentIntent
 */
export async function ledger(db, { type = "charge.refund.updated", pi = null, charge = null, shape = "refund", ago = null, id = `evt_h${++evt}_${randomUUID().slice(0, 6)}`, extra = {} } = {}) {
  let object;
  if (shape === "expanded") object = { id: "re_x", payment_intent: pi ? { id: pi, object: "payment_intent" } : null, charge: charge ? { id: charge, object: "charge" } : null };
  else if (shape === "charge_own") { object = { id: charge }; type = type.startsWith("charge.") ? type : "charge.refunded"; }
  else if (shape === "pi_own") { object = { id: pi }; type = "payment_intent.succeeded"; }
  else object = { id: "re_x", payment_intent: pi, charge };
  Object.assign(object, extra);
  await db.query(
    `insert into public.stripe_events (id, type, livemode, payload, received_at)
     values ($1, $2, false, $3, clock_timestamp() - coalesce($4::interval, interval '0'))`,
    [id, type, JSON.stringify({ id, type, data: { object } }), ago]);
  return id;
}

/**
 * Observation ON and live, and old enough that nothing about the turn-on is still settling: the operator statement,
 * one claim, an old ledger row (so coverage is provable), then 10 minutes pass.
 */
export async function observing(db) {
  await ledger(db, { type: "ping", ago: "30 days" });
  await rpc(db, "catering_refund_observe_set", [true]);
  const claim = await rpc(db, "catering_refund_sweep_begin", [50]);
  await elapse(db, "10 minutes");
  return claim;
}

/** Fixture-owner time travel for ONE column of one row (row triggers off). */
export async function backdate(db, table, column, id, interval, idColumn = "id") {
  if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(column) || !/^[a-z_]+$/.test(idColumn)) throw new Error("backdate: bad identifier");
  await db.exec("set session_replication_role = replica");
  try {
    await db.query(`update public.${table} set ${column} = coalesce(${column}, clock_timestamp()) - $2::interval where ${idColumn} = $1`, [id, interval]);
  } finally {
    await db.exec("set session_replication_role = origin");
  }
}

export const requestRow = (db, id) => one(db, "select * from public.catering_refund_requests where id = $1", [id]);
export const stateRow = (db, paymentId) => one(db, "select * from public.catering_refund_payment_state where payment_id = $1", [paymentId]);
export const mirror = (db, paymentId) => rows(db, "select * from public.catering_refund_observed where payment_id = $1 order by refund_id", [paymentId]);

/**
 * A press, as the lib makes it: probe -> a read of every payment the probe named -> ONE reserve with the tokens.
 * `readsFor(p)` may return per-payment read options. Returns { probe, reads, reserved } (reserve refusals throw).
 */
export async function press(db, { actor, quoteId, amount, seen, payments, token = randomUUID(), reason = "customer_cancelled", note = null, trigger = "panel", readOptions = () => ({}) }) {
  const probe = await rpc(db, "catering_refund_reserve_fresh", [actor, quoteId, token, amount, null, reason, note, trigger, null]);
  if (probe.replay) return { probe, replay: true, token };
  const reads = [];
  for (const row of probe.payments) {
    const p = payments.find((x) => x.id === row.payment_id);
    reads.push({ payment_id: p.id, ...(await read(db, p, readOptions(p))) });
  }
  const reserved = await rpc(db, "catering_refund_reserve_fresh", [actor, quoteId, token, amount, seen, reason, note, trigger,
    JSON.stringify(reads.map((r) => ({ payment_id: r.payment_id, read_token: r.read_token ?? null })))]);
  return { probe, reads, reserved, token };
}
