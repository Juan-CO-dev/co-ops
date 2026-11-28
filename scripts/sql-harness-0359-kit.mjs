/**
 * Scenario toolkit over the 0359 PGlite base (scripts/sql-harness-0359-lib.mjs). SYNTHETIC ROWS ONLY: shops, people,
 * sessions, quotes, payments, signed-event deliveries and a stateful stand-in for what Stripe would answer about
 * refunds. No network, no key, no real database. Shared by the harness and by tests/helpers/refund-pglite.ts.
 */
import { randomUUID } from "node:crypto";
import { CALLER, one } from "./sql-harness-0359-lib.mjs";

/** A stateful stand-in for what Stripe would answer about refunds: plain objects. */
export class FakeStripe {
  constructor() { this.charges = new Map(); this.refunds = new Map(); this.hidden = new Set(); this.n = 0; }
  charge(pi, { captured = 30000, currency = "usd", livemode = false, charge = `ch_${pi.slice(3)}` } = {}) {
    this.charges.set(pi, { charge, captured, currency, livemode });
    return this.charges.get(pi);
  }
  /** created = epoch seconds. request / metaPayment / metaQuote = what our create wrote into the refund's metadata. */
  refund(pi, amount, status, { id = `re_fake${++this.n}`, created = Math.floor(Date.now() / 1000) - 600, request = null, metaPayment = null, metaQuote = null, charge, currency } = {}) {
    const c = this.charges.get(pi);
    this.refunds.set(id, { id, pi, charge: charge ?? c.charge, amount, currency: currency ?? c.currency, status, created, request, metaPayment, metaQuote });
    return id;
  }
  set(id, patch) { Object.assign(this.refunds.get(id), patch); }
  /** What a COMPLETE list of the PaymentIntent returns right now (a hidden id models a list that has not caught up). */
  listed(pi) { return [...this.refunds.values()].filter((r) => r.pi === pi && !this.hidden.has(r.id)).map((r) => r.id); }
  read(id, how = null) {
    if (how) return { id, read: how };
    const r = this.refunds.get(id);
    if (!r) return { id, read: "not_found_all" };
    return { id, read: "ok", payment_intent: r.pi, charge: r.charge, amount: r.amount, currency: r.currency, status: r.status,
             created: r.created, request: r.request, meta_payment: r.metaPayment, meta_quote: r.metaQuote };
  }
  owner(pi, status = "resolved") {
    const c = this.charges.get(pi);
    if (status !== "resolved" || !c) return { status: c ? status : "indeterminate" };
    return { status: "resolved", payment_intent: pi, charge: c.charge, currency: c.currency, livemode: c.livemode, captured_cents: c.captured };
  }
}

export const rpc = async (db, fn, args) => (await one(db, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)).r;

export async function world(db) {
  const shop = (await one(db, "insert into public.locations (code) values ('S1') returning id")).id;
  const other = (await one(db, "insert into public.locations (code) values ('S2') returning id")).id;
  const user = async (role, { member = shop, active = true, memberActive = true } = {}) => {
    const id = (await one(db, "insert into public.users (role, active) values ($1, $2) returning id", [role, active])).id;
    if (member) await db.query("insert into public.user_locations (user_id, location_id, active) values ($1, $2, $3)", [id, member, memberActive]);
    return id;
  };
  /** A live session; fresh = a Tier B step-up inside the 120-second window; stale = one typed ten minutes ago. */
  const session = async (userId, { fresh = false, stale = false } = {}) => (await one(db,
    "insert into public.sessions (user_id, step_up_unlocked, step_up_unlocked_at) values ($1, $2, $3) returning id",
    [userId, fresh || stale, fresh ? new Date() : stale ? new Date(Date.now() - 10 * 60_000) : null])).id;
  const quote = async (loc = shop, root = null) => (await one(db,
    "insert into public.catering_quotes (location_id, version, status, root_id) values ($1, 1, 'accepted', $2) returning id", [loc, root])).id;
  let n = 0;
  const pay = async (quoteId, kind, amount, { status = "paid", pi = `pi_test_${++n}_${randomUUID().slice(0, 8)}` } = {}) => {
    const id = (await one(db,
      `insert into public.catering_payments (quote_id, kind, amount_cents, status, provider, provider_ref, paid_at)
       values ($1, $2, $3, $4, 'stripe', $5, now()) returning id`, [quoteId, kind, amount, status, status === "due" ? null : pi])).id;
    return { id, pi };
  };
  return { shop, other, user, session, quote, pay };
}

/** Open recovery, seed to completion, promote with the acknowledged counts: the ORDINARY operator lifecycle. */
export async function goLive(db, operator = "harness") {
  const opened = await rpc(db, "catering_refund_open_recovery", [operator]);
  for (let i = 0; i < 50; i++) {
    const b = await rpc(db, "catering_refund_recovery_seed_batch", [CALLER, 200]);
    if (b.complete) break;
  }
  const report = await rpc(db, "catering_refund_recovery_report", []);
  const promoted = await rpc(db, "catering_refund_promote", [opened.epoch_id, 1, JSON.stringify(report.counts), operator]);
  return { epoch: opened.epoch_id, generation: promoted.generation, report };
}

let evt = 0;
/** A signed delivery as the ON webhook stores and registers it: the ledger row first, then the one ingress transaction. */
export async function ingest(db, { id = `evt_h${++evt}_${randomUUID().slice(0, 6)}`, type = "charge.refunded", pi, charge = null, created = Math.floor(Date.now() / 1000),
  cumulative = null, chargeAmount = null, full = null, hints = [], loc = null, livemode = false, ledgerOnly = false } = {}) {
  const object = type === "charge.refunded"
    ? { id: charge, payment_intent: pi, amount_refunded: cumulative, amount: chargeAmount, refunded: full, refunds: { data: hints } }
    : { id: hints[0]?.id ?? null, status: hints[0]?.status ?? null, payment_intent: pi, charge };
  await db.query("insert into public.stripe_events (id, type, livemode, payload, location_id) values ($1, $2, $3, $4, $5) on conflict (id) do nothing",
    [id, type, livemode, JSON.stringify({ id, type, created, livemode, data: { object } }), loc]);
  if (ledgerOnly) return { id };
  const r = await rpc(db, "catering_refund_event_register", [CALLER, id, type, loc, livemode, pi, charge, created, cumulative, chargeAmount, full, JSON.stringify(hints)]);
  return { id, ...r };
}

/** One discovery pass: begin -> (the fake's list + exact reads) -> the financial apply. */
export async function pass(db, paymentId, stripe, { complete = true, scheduled = false, runId = randomUUID(), reads = {}, ownerStatus = "resolved", generation = null, token = null } = {}) {
  const begun = await rpc(db, "catering_refund_pass_begin", [CALLER, paymentId, runId]);
  if (begun.result !== "begun") return begun;
  const ids = new Set([...begun.ids.map((x) => x.id), ...stripe.listed(begun.payment_intent)]);
  const evidence = { complete, scheduled, run_id: runId, owner: stripe.owner(begun.payment_intent, ownerStatus),
    refunds: [...ids].sort().map((id) => stripe.read(id, reads[id] ?? null)) };
  const applied = await rpc(db, "catering_refund_apply", [CALLER, paymentId, token ?? begun.pass_token, generation ?? begun.generation, JSON.stringify(evidence)]);
  return { ...applied, begun, evidence };
}

/** The ON figures of one payment, cents as numbers. */
export const figures = async (db, paymentId, exclude = null) => {
  const f = await one(db, "select * from public.catering_refund_effective_figures($1, $2)", [paymentId, exclude]);
  return Object.fromEntries(Object.entries(f).map(([key, v]) => [key, typeof v === "boolean" || v == null ? v : Number(v)]));
};

/** Fixture-owner time travel: move a column back without the guard (session_replication_role skips row triggers). */
export async function backdate(db, table, column, id, interval, idColumn = "id") {
  if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(column) || !/^[a-z_]+$/.test(idColumn)) throw new Error("backdate: bad identifier");
  await db.exec("set session_replication_role = replica");
  try {
    await db.query(`update public.${table} set ${column} = coalesce(${column}, now()) - $2::interval where ${idColumn} = $1`, [id, interval]);
  } finally {
    await db.exec("set session_replication_role = origin");
  }
}
