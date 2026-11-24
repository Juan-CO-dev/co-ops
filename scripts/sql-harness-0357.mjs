/**
 * Local Postgres proof of migration 0357 (catering refund requests — the in-app refund step on a rejected / cancelled /
 * lost order). SYNTHETIC ROWS ONLY — PGlite, in memory. CC owns the Supabase sim/prod gate; this never touches a real
 * database.
 *
 *   node scripts/sql-harness-0357.mjs
 *
 * Builds catering_quotes (0120 + 0127's alters) and catering_payments (0127) from the REAL DDL, the REAL 0333
 * `catering_payment_refund_events` table, minimal users / user_locations / locations / audit_log, then applies the
 * REAL 0357 file and proves:
 *   P0  the pre-flight refuses without 0333's table and on a second apply; a refused apply leaves nothing
 *   P1  the objects and the privilege ceiling: anon / authenticated cannot execute any function; service_role cannot
 *       INSERT or DELETE a request row, may UPDATE only the outcome columns, and may execute the three functions
 *   P2  the actor rule: owner / cgs anywhere; moo / catering_mgr only with an active membership; gm, agm, prep_mgr,
 *       an inactive user and a membership that is not active are refused
 *   P3  the figures: a Stripe-paid row is refundable in full; a hand-marked row, a due row and a refunded row are 0;
 *       Stripe's cumulative refunded amount is subtracted and the CHARGE amount Stripe reported is what was captured,
 *       in both directions (review r1); own pending / submitted rows count
 *   P4  the reserve: full and partial; the balance is taken before the deposit; over-refund and nothing-refundable are
 *       refused by name (over_refundable carries the refundable total); a refusal writes nothing
 *   P5  the same tap twice (same client_token) returns the same rows and inserts nothing; a different amount under
 *       the same token is `token_reused`
 *   P6  the guard trigger: money facts immutable, forward-only statuses, terminal rows frozen, a Stripe id never moves
 *   P7  one destructive `catering.refund.request` audit row per inserted request, naming who and why
 *   P8  input refusals: reason, trigger, note required for `other`, note length, a missing or non-positive amount,
 *       unknown quote
 *   P9  the sender claim (review r1): exclusive while live, re-takeable once expired with a new token, attempts counted
 *       only for a pending row, the 24 h clock never moves, an outcome fenced on an outlived token writes nothing,
 *       a finished row cannot be claimed, attempts never go backwards
 *
 * WHAT A SINGLE SESSION CANNOT SHOW: two simultaneous reserves queuing on the payment locks. That is a two-session
 * proof and belongs on the sim (the scratchpad apply script's `--two-sessions` step, run by CC).
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const read = (n) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), "utf8");
const M0357 = read("0357_catering_refund_requests.sql");

function must(match, what) {
  if (!match) throw new Error(`harness: could not extract ${what}`);
  return match[0];
}
function table(file, name) {
  return must(read(file).match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`, "i")), `${name} from ${file}`);
}
const M0127 = read("0127_catering_portal_orders.sql");
const QUOTES_0120 = table("0120_catering_quotes.sql", "catering_quotes");
const QUOTES_0127 = must(
  M0127.match(/ALTER TABLE catering_quotes DROP CONSTRAINT catering_quotes_status_check;[\s\S]*?CHECK \(origin IN \('self_serve','staff'\)\);/i),
  "0127 catering_quotes alters",
);
const PAYMENTS_0127 = must(
  M0127.match(/CREATE TABLE catering_payments \([\s\S]*?ALTER TABLE catering_payments ENABLE ROW LEVEL SECURITY;/i),
  "0127 catering_payments",
);
const EVENTS_0333 = table("0333_marketing_entry_moves_and_refund_time.sql", "catering_payment_refund_events");

let failures = 0;
let checks = 0;
const check = (ok, what) => { checks++; if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
async function refuses(fn, needle, what) {
  try { await fn(); check(false, `${what} (no error; expected ${needle})`); }
  catch (e) { const s = `${e.code ?? ""} ${e.message} ${e.detail ?? ""}`; check(s.includes(needle), `${what} → ${needle}${s.includes(needle) ? "" : ` (got: ${s})`}`); }
}

async function base({ events = true } = {}) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.locations (id uuid primary key default gen_random_uuid(), code text, active boolean not null default true);
    create table public.users (id uuid primary key default gen_random_uuid(), role text not null, active boolean not null default true);
    create table public.user_locations (user_id uuid not null references public.users(id), location_id uuid not null references public.locations(id),
      active boolean not null default true, primary key (user_id, location_id));
    create table public.audit_log (id bigserial primary key, actor_id uuid, actor_role text, action text not null, resource_table text,
      resource_id uuid, metadata jsonb, destructive boolean not null default false, occurred_at timestamptz not null default now());
    ${table("0108_catering_scaffold_capture.sql", "catering_customers")}
    ${table("0108_catering_scaffold_capture.sql", "catering_pipeline")}
    create table public.catering_delivery_zones (id uuid primary key default gen_random_uuid());
    ${QUOTES_0120}
    ${QUOTES_0127}
    ${PAYMENTS_0127}
    ${events ? EVENTS_0333 : ""}`);
  return db;
}

const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const count = async (db, sql, params = []) => Number((await one(db, sql, params)).n);

async function fixtures(db) {
  const shop = (await one(db, "insert into public.locations (code) values ('S1') returning id")).id;
  const other = (await one(db, "insert into public.locations (code) values ('S2') returning id")).id;
  const user = async (role, { member = shop, active = true, memberActive = true } = {}) => {
    const id = (await one(db, "insert into public.users (role, active) values ($1, $2) returning id", [role, active])).id;
    if (member) await db.query("insert into public.user_locations (user_id, location_id, active) values ($1, $2, $3)", [id, member, memberActive]);
    return id;
  };
  const quote = async (rootId = null, loc = shop) => (await one(db,
    "insert into public.catering_quotes (location_id, version, status, root_id) values ($1, $2, 'accepted', $3) returning id",
    [loc, rootId ? 2 : 1, rootId])).id;
  let n = 0;
  const pay = async (quoteId, kind, amount, { status = "paid", provider = "stripe", paidAt = null } = {}) => (await one(db,
    `insert into public.catering_payments (quote_id, kind, amount_cents, status, provider, provider_ref, paid_at)
     values ($1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now())) returning id`,
    [quoteId, kind, amount, status, provider, provider === "stripe" ? `pi_test_${++n}` : null, paidAt])).id;
  return { shop, other, user, quote, pay };
}

const reserve = (db, actor, quote, token, amount, reason = "customer_cancelled", note = null, trigger = "panel") =>
  db.query("select public.catering_refund_reserve($1, $2, $3, $4, $5, $6, $7) as r", [actor, quote, token, amount, reason, note, trigger])
    .then((r) => r.rows[0].r);
const figures = (db, payment) => one(db, "select * from public.catering_refund_figures($1)", [payment]);

let db;
try {
  // ── P0 — the pre-flight ──────────────────────────────────────────────────────────────────────
  {
    const no0333 = await base({ events: false });
    await refuses(() => no0333.exec(M0357), "0357: public.catering_payment_refund_events is missing", "P0 refuses without 0333's refund events");
    await no0333.exec("rollback");
    check((await one(no0333, "select to_regclass('public.catering_refund_requests') is null as gone")).gone === true, "P0 a refused apply leaves no table");
    await no0333.close();
    const again = await base();
    await again.exec(M0357);
    await refuses(() => again.exec(M0357), "0357: public.catering_refund_requests already exists", "P0 a second apply is refused");
    await again.exec("rollback");
    await again.close();
  }

  db = await base();
  const f = await fixtures(db);
  await db.exec(M0357);
  check(true, "0357 applied");

  // ── P1 — objects and privileges ──────────────────────────────────────────────────────────────
  for (const fn of ["catering_refund_actor_ok(uuid,uuid)", "catering_refund_figures(uuid)", "catering_refund_reserve(uuid,uuid,uuid,bigint,text,text,text)", "catering_refund_claim(uuid)", "catering_refund_record_snapshot(uuid,timestamptz,bigint,jsonb)"]) {
    for (const role of ["anon", "authenticated"]) {
      check((await one(db, `select has_function_privilege('${role}', 'public.${fn}', 'execute') as ok`)).ok === false, `P1 ${role} cannot execute ${fn}`);
    }
    check((await one(db, `select has_function_privilege('service_role', 'public.${fn}', 'execute') as ok`)).ok === true, `P1 service_role executes ${fn}`);
  }
  for (const priv of ["INSERT", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
    check((await one(db, `select has_table_privilege('service_role', 'public.catering_refund_requests', '${priv}') as ok`)).ok === false, `P1 service_role has no ${priv}`);
  }
  check((await one(db, "select has_table_privilege('service_role', 'public.catering_refund_requests', 'SELECT') as ok")).ok === true, "P1 service_role SELECT");
  for (const priv of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
    check((await one(db, `select has_table_privilege('service_role', 'public.catering_refund_stripe_snapshots', '${priv}') as ok`)).ok === false, `P1 snapshots: service_role has no ${priv} (the writer function only)`);
  }
  for (const col of ["amount_cents", "payment_id", "client_token", "reason_code", "requested_by", "attempts", "first_attempt_at"]) {
    check((await one(db, `select has_column_privilege('service_role', 'public.catering_refund_requests', '${col}', 'UPDATE') as ok`)).ok === false, `P1 service_role cannot UPDATE ${col}`);
  }
  check((await one(db, "select has_column_privilege('service_role', 'public.catering_refund_requests', 'status', 'UPDATE') as ok")).ok === true, "P1 service_role may UPDATE status");
  check((await count(db, "select count(*) n from pg_policies where tablename = 'catering_refund_requests'")) === 0, "P1 deny-all RLS (no policy)");
  check((await one(db, "select relrowsecurity as on from pg_class where oid = 'public.catering_refund_requests'::regclass")).on === true, "P1 RLS enabled");

  // ── P2 — the actor rule ──────────────────────────────────────────────────────────────────────
  const owner = await f.user("owner", { member: null });
  const cgs = await f.user("cgs", { member: null });
  const moo = await f.user("moo");
  const ctr = await f.user("catering_mgr");
  const ctrElsewhere = await f.user("catering_mgr", { member: f.other });
  const ctrLapsed = await f.user("catering_mgr", { memberActive: false });
  const gm = await f.user("gm");
  const agm = await f.user("agm");
  const prep = await f.user("prep_mgr");
  const inactive = await f.user("owner", { member: null, active: false });
  const ok = async (u) => (await one(db, "select public.catering_refund_actor_ok($1, $2) as ok", [u, f.shop])).ok;
  for (const [u, want, name] of [[owner, true, "owner (no membership)"], [cgs, true, "cgs"], [moo, true, "moo at their shop"], [ctr, true, "catering_mgr at their shop"],
    [ctrElsewhere, false, "catering_mgr of another shop"], [ctrLapsed, false, "catering_mgr with a lapsed membership"], [gm, false, "gm"], [agm, false, "agm"],
    [prep, false, "prep_mgr"], [inactive, false, "an inactive owner"]]) {
    check((await ok(u)) === want, `P2 ${name} → ${want}`);
  }

  // ── P3 — figures ─────────────────────────────────────────────────────────────────────────────
  const Q = await f.quote();
  const dep = await f.pay(Q, "deposit", 30000, { paidAt: "2026-11-01T10:00:00Z" });
  const bal = await f.pay(Q, "balance", 70000, { paidAt: "2026-11-05T10:00:00Z" });
  const manual = await f.pay(Q, "full", 5000, { provider: "manual" });
  const due = await f.pay(Q, "full", 9000, { status: "due", provider: "stripe" });
  let fig = await figures(db, dep);
  check(fig.o_eligible === true && Number(fig.o_refundable) === 30000, "P3 a Stripe-paid deposit is refundable in full");
  check(Number((await figures(db, manual)).o_refundable) === 0 && (await figures(db, manual)).o_eligible === false, "P3 a hand-marked payment is not refundable here");
  check(Number((await figures(db, due)).o_refundable) === 0, "P3 a due row is not refundable");
  const Qr = await f.quote();
  const refunded = await f.pay(Qr, "deposit", 10000, { status: "refunded" });
  check(Number((await figures(db, refunded)).o_refundable) === 0, "P3 a refunded row is 0");
  await db.query("insert into public.catering_payment_refund_events (stripe_event_id, payment_id, refunded_at, cumulative_refunded_cents, charge_amount_cents) values ('evt_1', $1, now(), 5000, 29000)", [dep]);
  fig = await figures(db, dep);
  check(Number(fig.o_captured) === 29000 && Number(fig.o_refunded) === 5000 && Number(fig.o_refundable) === 24000,
    "P3 the charge Stripe reported is what was captured; Stripe's cumulative refund is subtracted");
  {
    // Review r1: a $300 charge on a row that says $200 (an old re-price) is $300 the customer paid. After a $200
    // refund Stripe reports the charge, and the remaining $100 is refundable — never stranded.
    const Qm = await f.quote();
    const over = await f.pay(Qm, "deposit", 20000);
    await db.query("insert into public.catering_payment_refund_events (stripe_event_id, payment_id, refunded_at, cumulative_refunded_cents, charge_amount_cents) values ('evt_m', $1, now(), 20000, 30000)", [over]);
    const fm = await figures(db, over);
    check(Number(fm.o_captured) === 30000 && Number(fm.o_refundable) === 10000, "P3 a charge LARGER than the row: the difference stays refundable");
  }
  {
    // Review r4-r6: refunded BY IDENTITY AND CURRENT STATUS, from the newest Stripe snapshot of the charge's refunds.
    const Qx = await f.quote();
    const px = await f.pay(Qx, "deposit", 30000);
    const snap = (at, refunds, captured = 30000) => one(db, "select public.catering_refund_record_snapshot($1, $2, $3, $4::jsonb) as ok", [px, at, captured, JSON.stringify(refunds)]).then((r) => r.ok);
    await db.query("insert into public.catering_payment_refund_events (stripe_event_id, payment_id, refunded_at, cumulative_refunded_cents, charge_amount_cents) values ('evt_x', $1, now() - interval '10 minutes', 10000, 30000)", [px]);
    // The panel opened: Stripe lists a $100 dashboard refund (no CO-OPS id), pending.
    check(await snap(new Date(Date.now() - 60_000).toISOString(), [{ id: "re_dash", amount: 10000, status: "pending", request_id: null }]) === true, "P3 a snapshot is recorded");
    const rx = await reserve(db, owner, Qx, randomUUID(), 5000);
    await db.query("update public.catering_refund_requests set status = 'succeeded', stripe_refund_id = 're_x' where id = $1", [rx.requests[0].id]);
    let fx = await figures(db, px);
    check(Number(fx.o_refunded) === 15000 && Number(fx.o_refundable) === 15000, "P3 r4: the dashboard refund (listed) + ours (not listed yet) both count, once");
    const ry = await reserve(db, owner, Qx, randomUUID(), 5000);
    await db.query("update public.catering_refund_requests set status = 'submitted', stripe_refund_id = 're_y' where id = $1", [ry.requests[0].id]);
    fx = await figures(db, px);
    check(Number(fx.o_refunded) === 20000 && Number(fx.o_refundable) === 10000, "P3 r5: two app refunds and the dashboard refund: each counts once");
    // r6: the dashboard refund is CANCELED; the next listing shows it, and lists ours by id.
    const now = new Date().toISOString();
    check(await snap(now, [
      { id: "re_dash", amount: 10000, status: "canceled", request_id: null },
      { id: "re_x", amount: 5000, status: "succeeded", request_id: rx.requests[0].id },
      { id: "re_y", amount: 5000, status: "pending", request_id: ry.requests[0].id },
    ]) === true, "P3 a newer snapshot replaces the older");
    fx = await figures(db, px);
    check(Number(fx.o_refunded) === 10000 && Number(fx.o_refundable) === 20000, "P3 r6: a canceled refund stops counting; ours count once (listed, by id)");
    check(await snap(new Date(Date.now() - 3_600_000).toISOString(), [{ id: "re_dash", amount: 10000, status: "pending", request_id: null }]) === false, "P3 an OLDER listing recorded late never overwrites the newer");
    fx = await figures(db, px);
    check(Number(fx.o_refunded) === 10000, "P3 …and the figures still follow the newest");
    // A pending row whose refund Stripe already lists (a lost answer) counts once, as listed — not again as in flight.
    const rz = await reserve(db, owner, Qx, randomUUID(), 3000);
    check(await snap(new Date(Date.now() + 1000).toISOString(), [
      { id: "re_x", amount: 5000, status: "succeeded", request_id: rx.requests[0].id },
      { id: "re_y", amount: 5000, status: "succeeded", request_id: ry.requests[0].id },
      { id: "re_z", amount: 3000, status: "succeeded", request_id: rz.requests[0].id },
    ]) === true, "P3 a listing that includes a refund our row has not recorded yet");
    fx = await figures(db, px);
    check(Number(fx.o_refunded) === 13000 && Number(fx.o_in_flight) === 0 && Number(fx.o_refundable) === 17000, "P3 a lost answer that landed counts once (listed), not also in flight");
    // A webhook event NEWER than the snapshot (a refund made after it): the larger figure wins.
    await db.query("insert into public.catering_payment_refund_events (stripe_event_id, payment_id, refunded_at, cumulative_refunded_cents, charge_amount_cents) values ('evt_y', $1, now() + interval '1 hour', 25000, 30000)", [px]);
    fx = await figures(db, px);
    check(Number(fx.o_refunded) === 25000, "P3 an event newer than the snapshot is not ignored");
    // The writer validates what it stores.
    await refuses(() => snap(new Date(Date.now() + 7_200_000).toISOString(), [{ id: "nope", amount: 1, status: "succeeded" }]), "invalid_request", "P3 a listing with a non-refund id is refused");
    await refuses(() => snap(new Date(Date.now() + 7_200_000).toISOString(), [{ id: "re_q", amount: 1.5, status: "succeeded" }]), "invalid_request", "P3 a fractional amount is refused");
    await refuses(() => one(db, "select public.catering_refund_record_snapshot($1, $2, null, $3::jsonb) as ok", [px, now, JSON.stringify({ a: 1 })]), "invalid_request", "P3 a listing that is not an array is refused");
  }

  // ── P4 — reserve ─────────────────────────────────────────────────────────────────────────────
  const auditBefore = await count(db, "select count(*) n from public.audit_log");
  const requestsBefore = await count(db, "select count(*) n from public.catering_refund_requests");
  await refuses(() => reserve(db, gm, Q, randomUUID(), 100), "forbidden", "P4 a GM is refused");
  await refuses(() => reserve(db, ctr, Q, randomUUID(), 94001), "over_refundable", "P4 asking above the refundable total is refused");
  await refuses(() => reserve(db, ctr, Q, randomUUID(), 94001), "94000", "P4 …and names the refundable total (24000 + 70000)");
  check((await count(db, "select count(*) n from public.catering_refund_requests")) === requestsBefore && (await count(db, "select count(*) n from public.audit_log")) === auditBefore,
    "P4 a refusal writes nothing");
  const t1 = randomUUID();
  const r1 = await reserve(db, ctr, Q, t1, 80000, "event_lost", null, "lost");
  check(r1.replay === false && r1.requests.length === 2, "P4 a partial over both payments makes two rows");
  const byPay = Object.fromEntries(r1.requests.map((r) => [r.payment_id, Number(r.amount_cents)]));
  check(byPay[bal] === 70000 && byPay[dep] === 10000, "P4 the balance is taken first, then the deposit");
  check(r1.requests.every((r) => r.status === "pending"), "P4 the rows start pending");
  fig = await figures(db, dep);
  check(Number(fig.o_in_flight) === 10000 && Number(fig.o_refundable) === 14000, "P4 a pending row counts against the refundable figure");
  await db.query("update public.catering_refund_requests set status = 'succeeded', stripe_refund_id = 're_test_1', stripe_status = 'succeeded' where payment_id = $1", [bal]);
  check(Number((await figures(db, bal)).o_refundable) === 0, "P4 a succeeded row counts as refunded");
  await db.query("update public.catering_refund_requests set status = 'failed', stripe_status = 'failed' where payment_id = $1", [dep]);
  check(Number((await figures(db, dep)).o_refundable) === 24000, "P4 a failed row releases its amount");
  await refuses(() => reserve(db, owner, Q, randomUUID(), null), "invalid_amount", "P4 no amount is refused (review r1: the confirmed number is required, never re-read as 'everything')");
  const r2 = await reserve(db, owner, Q, randomUUID(), 24000);
  check(r2.requests.length === 1 && Number(r2.requests[0].amount_cents) === 24000 && r2.requests[0].payment_id === dep, "P4 a full refund takes everything left");
  await refuses(() => reserve(db, owner, Q, randomUUID(), 1), "nothing_refundable", "P4 nothing left: nothing_refundable");
  // A revision of the quote: the family is one order.
  const QA = await f.quote();
  const QB = await f.quote(QA);
  const famDep = await f.pay(QA, "deposit", 20000);
  const viaRev = await reserve(db, moo, QB, randomUUID(), 5000);
  check(viaRev.requests[0].payment_id === famDep, "P4 a payment on an earlier revision is the same order's (family by root_id)");

  // ── P5 — the same tap twice ──────────────────────────────────────────────────────────────────
  const rowsBefore = await count(db, "select count(*) n from public.catering_refund_requests");
  const again = await reserve(db, ctr, Q, t1, 80000, "event_lost", null, "lost");
  check(again.replay === true && again.requests.length === 2 && (await count(db, "select count(*) n from public.catering_refund_requests")) === rowsBefore,
    "P5 the same token returns the same rows and inserts nothing");
  await refuses(() => reserve(db, ctr, Q, t1, null, "event_lost", null, "lost"), "invalid_amount", "P5 a replay still needs the amount");
  await refuses(() => reserve(db, ctr, Q, t1, 1000), "token_reused", "P5 a different amount under the same token is refused");
  await refuses(() => reserve(db, ctr, QA, t1, 80000), "token_reused", "P5 the same token on another order is refused");

  // ── P6 — the guard trigger ───────────────────────────────────────────────────────────────────
  const famRow = viaRev.requests[0].id;
  await refuses(() => db.query("update public.catering_refund_requests set amount_cents = 1 where id = $1", [famRow]), "refund_request_immutable", "P6 the amount never changes");
  await db.query("update public.catering_refund_requests set status = 'submitted', stripe_refund_id = 're_test_2', stripe_status = 'pending' where id = $1", [famRow]);
  await refuses(() => db.query("update public.catering_refund_requests set status = 'pending' where id = $1", [famRow]), "refund_request_bad_transition", "P6 submitted never goes back to pending");
  await refuses(() => db.query("update public.catering_refund_requests set stripe_refund_id = 're_other' where id = $1", [famRow]), "refund_request_immutable", "P6 a Stripe id never moves");
  await db.query("update public.catering_refund_requests set status = 'succeeded', stripe_status = 'succeeded' where id = $1", [famRow]);
  await refuses(() => db.query("update public.catering_refund_requests set status = 'failed' where id = $1", [famRow]), "refund_request_bad_transition", "P6 a terminal row is frozen");
  await refuses(() => db.query("update public.catering_refund_requests set stripe_status = 'failed' where id = $1", [famRow]), "refund_request_immutable", "P6 …its Stripe status too");

  // ── P7 — the audit rows ──────────────────────────────────────────────────────────────────────
  const audits = (await db.query("select * from public.audit_log where action = 'catering.refund.request' order by id")).rows;
  const requests = await count(db, "select count(*) n from public.catering_refund_requests");
  check(audits.length === requests, "P7 one audit row per request row");
  check(audits.every((a) => a.destructive === true && a.actor_id && a.metadata.reason_code && a.metadata.amount_cents > 0 && a.metadata.trigger), "P7 each names who, why, how much and from where (destructive)");
  check(audits.some((a) => a.actor_role === "catering_mgr" && a.metadata.reason_code === "event_lost" && a.metadata.trigger === "lost"), "P7 the role and the reason are recorded");

  // ── P9 — the sender claim (review r1) ────────────────────────────────────────────────────────────
  {
    const Qc = await f.quote();
    await f.pay(Qc, "deposit", 5000);
    const made = await reserve(db, owner, Qc, randomUUID(), 5000);
    const id = made.requests[0].id;
    const claim = async () => (await one(db, "select public.catering_refund_claim($1) as c", [id])).c;
    const c1 = await claim();
    check(c1 && c1.claim_token && Number(c1.attempts) === 1 && c1.first_attempt_at, "P9 the first claim takes the row, counts an attempt and stamps the 24 h clock");
    check((await claim()) === null, "P9 a second press while the claim is live gets nothing");
    const first = (await one(db, "select first_attempt_at from public.catering_refund_requests where id = $1", [id])).first_attempt_at;
    await db.query("update public.catering_refund_requests set claimed_until = now() - interval '1 second' where id = $1", [id]);
    const c2 = await claim();
    check(c2 && c2.claim_token !== c1.claim_token && Number(c2.attempts) === 2, "P9 an expired claim can be taken again, with a new token");
    check(String((await one(db, "select first_attempt_at from public.catering_refund_requests where id = $1", [id])).first_attempt_at) === String(first), "P9 the 24 h clock never moves");
    // A write fenced on the OLD token matches nothing (the app's compare-and-set).
    const stale = await db.query("update public.catering_refund_requests set status = 'failed' where id = $1 and claim_token = $2", [id, c1.claim_token]);
    check(stale.affectedRows === 0, "P9 an outcome fenced on an outlived claim writes nothing");
    await db.query("update public.catering_refund_requests set status = 'submitted', stripe_refund_id = 're_claim', claim_token = null, claimed_until = null where id = $1 and claim_token = $2", [id, c2.claim_token]);
    const c3 = await claim();
    check(c3 && Number(c3.attempts) === 2 && c3.status === "submitted", "P9 a submitted row can be claimed to refresh, without counting a send");
    await db.query("update public.catering_refund_requests set status = 'succeeded', claim_token = null, claimed_until = null where id = $1", [id]);
    check((await claim()) === null, "P9 a finished row cannot be claimed");
    await refuses(() => db.query("update public.catering_refund_requests set attempts = 0 where id = $1", [id]), "refund_request_immutable", "P9 attempts never go backwards");
  }

  // ── P8 — input refusals ──────────────────────────────────────────────────────────────────────
  const QZ = await f.quote();
  await f.pay(QZ, "deposit", 1000);
  await refuses(() => reserve(db, owner, QZ, randomUUID(), 100, "because"), "invalid_reason", "P8 an unknown reason");
  await refuses(() => reserve(db, owner, QZ, randomUUID(), 100, "other", "  "), "note_required", "P8 `other` needs a note");
  await refuses(() => reserve(db, owner, QZ, randomUUID(), 100, "other", "x".repeat(501)), "note_too_long", "P8 a note over 500");
  await refuses(() => reserve(db, owner, QZ, randomUUID(), 0), "invalid_amount", "P8 a zero amount");
  await refuses(() => reserve(db, owner, QZ, randomUUID(), -5), "invalid_amount", "P8 a negative amount");
  await refuses(() => reserve(db, owner, QZ, randomUUID(), 100, "customer_cancelled", null, "whenever"), "invalid_request", "P8 an unknown trigger");
  await refuses(() => reserve(db, owner, randomUUID(), randomUUID(), 100), "quote_not_found", "P8 an unknown quote");
  const withNote = await reserve(db, owner, QZ, randomUUID(), 1000, "other", "  card was charged twice  ");
  check((await one(db, "select reason_note from public.catering_refund_requests where id = $1", [withNote.requests[0].id])).reason_note === "card was charged twice",
    "P8 the note is trimmed and kept on the row");
} catch (e) {
  failures++;
  console.error(`FAIL 0357 harness: ${e.stack ?? e}`);
} finally {
  if (db) await db.close();
}
if (failures) { console.error(`${failures} failure(s)`); process.exitCode = 1; }
else console.log(`PASS 0357: ${checks} checks (single-session PGlite; two simultaneous reserves queuing on the locks need two sessions — sim)`);
