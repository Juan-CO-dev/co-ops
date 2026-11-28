/** FILE ONLY: the lead / CC runs this after 0359_catering_refund_mirror (refund B1 v2) is applied to the SIM. Never in
 * CI. Never loads .env or a direct DB URL, never reads ~/.supabase-token (the operator passes the token in the
 * environment, like every scripts/sim/ proof).
 *   SUPABASE_ACCESS_TOKEN=<operator environment>; node scripts/sim/refund-0359-lock-check.mjs --ref=jepgzucrvklhqpthowsc
 *   node scripts/sim/refund-0359-lock-check.mjs --self-test     OFFLINE: the same statements, ONE session, on PGlite
 *
 * The TWO-SESSION proof of 0359's lock order (plan section 2.3 as re-stated by [S8], section 10 "Sim") that one PGlite
 * backend cannot give. Every Management API request is its own database session and owns ONE transaction, so two
 * concurrent requests ARE two independent sessions. The technique is the house one (the 71b7e316 script, after
 * scripts/sim/checklist-0276-lock-check-management.mjs `proveRace`): the HOLDER request calls the real function and then
 * sleeps 7 s inside its open transaction (`pg_sleep`), holding every lock the function took; the RACER request is sent
 * once the holder is seen sleeping; an observer request proves the racer holds an UNGRANTED lock BLOCKED BY the
 * holder's backend (pg_locks + pg_blocking_pids), and the racer's elapsed time covers the holder's remaining sleep. The
 * racer's answer is captured inside its own transaction (set_config + a final select), so a named refusal is data,
 * never a transport error. Both run with lock_timeout 14 s / statement_timeout 25 s: a deadlock (40P01) or a lost wait
 * FAILS the step.
 *
 * STEPS (PASS / FAIL each; exit 1 on any FAIL). "read" = read_begin + record_read(complete) in one transaction.
 *   1   reserve vs reserve, one payment     the second waits, then answers nothing_refundable (the first's row blocks it)
 *   2a  arm vs cancel, arm first            cancel waits, then not_cancelled (armed, pending)
 *   2b  cancel vs arm, cancel first         arm waits, then not_armable (failed)
 *   3a  arm vs release, arm first           release waits, then not_releasable_yet (armed just now)
 *   3b  release vs arm, release first       (a row armed 25 h ago, inserted by the fixture) arm waits, then not_armable
 *   4a  arm vs attach, arm first            attach waits, then figures_stale (the arm's own dirty stamp)
 *   4b  attach vs arm, attach first         (a row armed 25 h ago + a mirrored refund) arm waits, then not_armable
 *   5a  a begin vs a record, begin first    the record waits, then read_replaced (and the payment is dirty)
 *   5b  a record vs a begin, record first   the begin waits, then opens a fresh read (replaced = false)
 *   6a  a read vs a reserve, read first     the reserve (with the previous read's token) waits, then figures_stale
 *   6b  a reserve vs a read, reserve first  the read waits, then completes
 *   7   a reserve vs main's paid -> refunded UPDATE (as service_role, rolled back): the UPDATE waits, no deadlock
 *   8a  finish vs a read binding the same request, finish first   the read waits, completes, links the mirror row
 *   8b  a read binding vs finish, read first                      finish waits, then created + already_bound
 *   9a/9b  the operator statement's bulk stamp (catering_refund_observe_set) vs a read, both orders: no deadlock
 *   9c/9d  the operator statement vs an arm, both orders: no deadlock (operator first: the arm is figures_stale)
 *   10a/10b the sweep's bulk stamp (catering_refund_sweep_begin, resumed) vs a read, both orders: no deadlock
 *   10c/10d the sweep's bulk stamp vs an arm, both orders: no deadlock (sweep first: the arm is figures_stale)
 *   S8  an arm that waits on the state row held by the operator statement past p_max_wait_ms (2 s) answers deadline_passed
 * WHAT IT CANNOT PROVE: the Management API gives no session that stays open across requests, so a holder is always ONE
 * call followed by a sleep; timing beyond "waited at least the holder's remainder" is not measured. No Stripe call: every
 * provider fact is synthetic evidence JSON. `--self-test` runs every statement in ONE PGlite session, holder then racer:
 * it proves the SQL and the committed outcomes, never a wait (S8 then answers figures_stale, said so in its output).
 *
 * FIXTURE (committed, because two sessions must both see it; SYNTHETIC rows only, tagged SIM-0359v2-LOCK-<id>): one shop,
 * one owner, 23 quotes with one $300 Stripe deposit each, one 30-day-old synthetic ledger row (so the ledger's coverage
 * is provable), and the two B2 / B3 readiness functions as STAND-INS (created by the fixture, executable by nobody but
 * the owner; F4 then answers true so F8 can reserve: plan B1.5 "B1 proof before B2 exists"). Fixture time travel (owner
 * UPDATEs of B1's own observation row and of the fixture's own state rows; never a clock mock) makes a read `known`
 * without waiting 5 minutes. While it runs (about four minutes) the sim's observation row reads ON and parts_ready reads
 * true; with both switches unset nothing in the app reads either.
 * CLEANUP (finally, always): every row the fixture or a step wrote is DELETED by the fixture's ids (mirror, state,
 * requests, snapshots, refund events, audit rows of the fixture owner, ledger row, payments, quotes, owner, shop), the
 * stand-ins are DROPPED, and the observation row is put back to EXACTLY the install state the pre-flight required (OFF,
 * zero transitions, every stamp null). A second read proves every count is 0 and the row is back.
 * PRE-FLIGHT (read-only, before any write): the target is the sim (projectRef, sim only); 0359 v2 installed and
 * recorded; the worker surface executable by service_role; the observation row in its install state; NO state row and
 * NO mirror row anywhere on the sim (the bulk stamps touch every state row: only the fixture's may exist); the stand-in
 * names free; every table the cleanup deletes from owned by the runner, with no DELETE row trigger and no forced RLS.
 * The printed fixture ids let an operator remove stranded rows by hand after an interrupted run.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { literal as q, managementQuery, projectRef } from '../supabase-management-query.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const settled = promise => promise.then(rows => ({ ok: true, rows }), error => ({ ok: false, error: String(error?.message ?? error) }));
const OUT = 'refund0359v2.out';
const HOLD_S = 7;
const FP = '0123456789abcdef'; // a synthetic credential fingerprint [T5] (16 hex); no key exists behind it
const N = 23;

/** A call whose answer (or named refusal) is kept in the transaction-local setting OUT. */
export const capture = (body, declares = '') => `do $cap$ declare ${declares} r jsonb; begin
  begin ${body}
    perform set_config('${OUT}', jsonb_build_object('ok', r)::text, true);
  exception when others then perform set_config('${OUT}', jsonb_build_object('err', sqlerrm, 'state', sqlstate)::text, true); end;
end $cap$`;
const callInto = expr => `r := ${expr};`;
/** ONE transaction. `hold` = sleep inside it holding every lock taken; `end` = commit | rollback. */
export const transactionSQL = (name, body, { hold = false, end = 'commit', role = null, sleep = HOLD_S } = {}) => `begin isolation level read committed;
  set local statement_timeout = '25s'; set local lock_timeout = '14s';
  set local application_name = ${q(name)}; ${role ? `set local role ${role};` : ''}
  ${body};
  ${hold ? `select pg_sleep(${sleep});` : ''}
  select current_setting('${OUT}', true) as out;
  ${end};`;
const parseOut = rows => { const v = rows?.[rows.length - 1]?.out; return v ? JSON.parse(v) : null; };

/** Holder sleeps holding its locks; the racer starts once the holder sleeps; an observer sees the racer blocked by it. */
export async function proveRace(query, holder, racer, tag, { selfTest = false } = {}) {
  const holderName = `${tag}-h`, racerName = `${tag}-r`;
  if (selfTest) {
    const h = parseOut(await query(transactionSQL(holderName, holder.body, { hold: true, end: holder.end ?? 'commit', role: holder.role, sleep: 0 })));
    const r = parseOut(await query(transactionSQL(racerName, racer.body, { end: racer.end ?? 'commit', role: racer.role })));
    return { holder: h, racer: r, blocked: 'not observable in one session' };
  }
  const holderStart = Date.now();
  const hp = settled(query(transactionSQL(holderName, holder.body, { hold: true, end: holder.end ?? 'commit', role: holder.role })));
  let rp;
  try {
    let ready = false;
    for (let i = 0; i < 40; i++) {
      const rows = await query(`select exists(select 1 from pg_stat_activity where application_name=${q(holderName)} and wait_event='PgSleep') as ready`);
      if (rows[0]?.ready === true) { ready = true; break; }
      await pause(100);
    }
    assert.ok(ready, 'holder must take its locks and enter pg_sleep');
    await pause(Math.max(0, 1500 - (Date.now() - holderStart)));
    const racerStart = Date.now();
    rp = settled(query(transactionSQL(racerName, racer.body, { end: racer.end ?? 'commit', role: racer.role }))).then(x => ({ ...x, finishedAt: Date.now(), racerStart }));
    let blocked = false;
    for (let i = 0; i < 40; i++) {
      const rows = await query(`select exists(select 1 from pg_stat_activity h
        join pg_stat_activity r on h.pid = any(pg_blocking_pids(r.pid))
        join pg_locks l on l.pid = r.pid and not l.granted
        where h.application_name=${q(holderName)} and r.application_name=${q(racerName)} and h.pid<>r.pid) as blocked`);
      if (rows[0]?.blocked === true) { blocked = true; break; }
      await pause(100);
    }
    const [a, b] = await Promise.all([hp, rp]);
    assert.ok(a.ok, `holder transaction failed (${a.error})`);
    assert.ok(b.ok, `racer transaction failed (${b.error})`);
    assert.ok(blocked, 'racer must hold an ungranted lock blocked by the holder backend');
    assert.ok(b.finishedAt - b.racerStart >= Math.max(0, HOLD_S * 1000 - (b.racerStart - holderStart)) - 250, 'racer elapsed time must cover the holder remainder');
    return { holder: parseOut(a.rows), racer: parseOut(b.rows), blocked: true };
  } finally {
    await Promise.all([hp, rp].filter(Boolean));
  }
}

const hex = () => randomUUID().replaceAll('-', '');
export function fixture() {
  const id = randomUUID();
  const ix = Array.from({ length: N }, (_, i) => i);
  return { tag: `SIM-0359v2-LOCK-${id.slice(0, 8)}`, shop: randomUUID(), owner: randomUUID(),
    q: ix.map(() => randomUUID()), p: ix.map(() => randomUUID()), pi: ix.map(() => `pi_sim0359v2lock_${hex()}`), ch: ix.map(() => `ch_sim0359v2lock_${hex()}`),
    evCover: `evt_sim0359v2lock_cover_${hex()}`, pre4: randomUUID(), pre6: randomUUID(), re6: `re_sim0359v2lock_${hex()}`, re12: `re_sim0359v2lock_${hex()}`,
    re13: `re_sim0359v2lock_${hex()}`, standIns: false };
}
const SVC = 'service_role';
const ownerFacts = (f, i) => `jsonb_build_object('payment_intent', ${q(f.pi[i])}, 'charge', ${q(f.ch[i])}, 'currency', 'usd', 'livemode', false, 'captured', 30000,
  'account_slot', 'default', 'credential_fp', ${q(FP)})`;
const refundObj = (f, i, id, req, created) => `jsonb_build_object('id', ${q(id)}, 'amount', 5000, 'currency', 'usd', 'payment_intent', ${q(f.pi[i])}, 'charge', ${q(f.ch[i])},
  'status', 'succeeded', 'created', ${created}, 'request_id', ${req ? q(req) : 'null'})`;
const NOW_S = 'extract(epoch from clock_timestamp())::bigint';
/** One whole read of payment i (begin -> record complete) with the given retrieved refunds [{ id, sql }]. */
const readBody = (f, i, refunds = []) => {
  const ids = `jsonb_build_array(${refunds.map(x => q(x.id)).join(', ')})`;
  return capture(`b := public.catering_refund_read_begin(${q(f.p[i])});
    x := public.catering_refund_record_read(${q(f.p[i])}, (b->>'read_id')::uuid, 'complete', ${ownerFacts(f, i)},
           jsonb_build_array(jsonb_build_object('by', 'payment_intent', 'terminal', true, 'ids', ${ids}), jsonb_build_object('by', 'charge', 'terminal', true, 'ids', ${ids})),
           jsonb_build_array(${refunds.map(x => x.sql).join(', ')}));
    r := x || jsonb_build_object('begin', b);`, 'b jsonb; x jsonb;');
};
const beginBody = (f, i) => capture(callInto(`public.catering_refund_read_begin(${q(f.p[i])})`));
const recordBody = (f, i, readId) => capture(callInto(`public.catering_refund_record_read(${q(f.p[i])}, ${q(readId)}::uuid, 'complete', ${ownerFacts(f, i)},
  jsonb_build_array(jsonb_build_object('by', 'payment_intent', 'terminal', true, 'ids', '[]'::jsonb), jsonb_build_object('by', 'charge', 'terminal', true, 'ids', '[]'::jsonb)), '[]'::jsonb)`));
const reserveBody = (f, i, token) => capture(callInto(`public.catering_refund_reserve_fresh(${q(f.owner)}, ${q(f.q[i])}, gen_random_uuid(), 5000, 30000, 'customer_cancelled', null, 'panel',
  jsonb_build_array(jsonb_build_object('payment_id', ${q(f.p[i])}, 'read_token', ${q(token)})))`));
const armBody = (req, token, wait = 30000) => capture(callInto(`public.catering_refund_arm(${q(req)}, ${q(token)}::uuid, ${wait})`));
const cancelBody = req => capture(callInto(`public.catering_refund_cancel_unarmed(${q(req)}, 'sim-0359v2-lock-check')`));
const releaseBody = (f, req, token) => capture(callInto(`public.catering_refund_release(${q(f.owner)}, ${q(req)}, ${q(token)}::uuid, 'no_request', 'default', false, null)`));
const attachBody = (f, req, refund, token) => capture(callInto(`public.catering_refund_attach(${q(f.owner)}, ${q(req)}, ${q(refund)}, ${q(token)}::uuid, null)`));
const finishBody = (f, i, req, refund) => capture(callInto(`public.catering_refund_finish(${q(req)}, 'created', ${refundObj(f, i, refund, req, `${NOW_S} + 5`)}, null, null)`));
const observeBody = () => capture(callInto('public.catering_refund_observe_set(true)'));
const sweepBody = () => capture(callInto('public.catering_refund_sweep_begin(5)'));
const mainRefundedBody = (f, i) => capture(`update public.catering_payments set status = 'refunded' where id = ${q(f.p[i])};
    get diagnostics n = row_count; r := jsonb_build_object('rows', n);`, 'n bigint;');

export function fixtureSQL(f) {
  return `begin;
    insert into public.locations(id,name,code,type,active) values(${q(f.shop)},${q(f.tag)},${q(f.tag)},'permanent',true);
    insert into public.users(id,name,role,pin_hash,active) values(${q(f.owner)},${q(f.tag)},'owner','SIM-NO-VALID-CREDENTIAL',true);
    insert into public.catering_quotes(id,location_id,status) values ${f.q.map(id => `(${q(id)},${q(f.shop)},'accepted')`).join(',')};
    insert into public.catering_payments(id,quote_id,kind,amount_cents,status,provider,provider_ref,paid_at) values
      ${f.p.map((id, i) => `(${q(id)},${q(f.q[i])},'deposit',30000,'paid','stripe',${q(f.pi[i])},clock_timestamp()-interval '1 day')`).join(',')};
    insert into public.stripe_events(id,type,livemode,payload,location_id,received_at) values
      (${q(f.evCover)},'ping',false,jsonb_build_object('id',${q(f.evCover)},'synthetic',${q(f.tag)}),null,clock_timestamp()-interval '30 days');
    create function public.catering_refund_b2_ready() returns boolean language sql stable as $$ select true $$;
    create function public.catering_refund_b3_ready() returns boolean language sql stable as $$ select true $$;
    revoke all on function public.catering_refund_b2_ready() from public, anon, authenticated, service_role;
    revoke all on function public.catering_refund_b3_ready() from public, anon, authenticated, service_role;
    commit;`;
}
/** The armed-25-hours-ago request rows of steps 3b / 4b (an INSERT: the write-once guard governs UPDATEs only). */
const preArmedSQL = (f, i, id) => `begin;
  insert into public.catering_refund_requests(id,payment_id,quote_id,location_id,client_token,amount_cents,reason_code,trigger_kind,requested_by,status,attempts,
      first_attempt_at,requested_at,updated_at,create_armed_at,arm_payment_intent,arm_account_slot,arm_livemode,arm_credential_fp,reserve_read_token)
    values(${q(id)},${q(f.p[i])},${q(f.q[i])},${q(f.shop)},gen_random_uuid(),5000,'customer_cancelled','panel',${q(f.owner)},'pending',1,
      clock_timestamp()-interval '25 hours',clock_timestamp()-interval '25 hours',clock_timestamp()-interval '25 hours',clock_timestamp()-interval '25 hours',
      ${q(f.pi[i])},'default',false,${q(FP)},gen_random_uuid());
  commit;`;
/** Fixture time travel (owner): observation recorded ON long ago, the sweep live, the fixture's dirty stamps old. */
const settleSQL = f => `begin;
  update public.catering_refund_observation set observe_on = true, transitioned_at = clock_timestamp() - interval '20 minutes',
    resumed_at = case when resumed_at is null then null else clock_timestamp() - interval '20 minutes' end,
    last_claim_at = clock_timestamp() - interval '1 minute', last_claim_transitions = transitions, lease_until = null where id;
  update public.catering_refund_payment_state set dirty_since = clock_timestamp() - interval '20 minutes'
   where payment_id = any(${pArr(f)}) and dirty_since is not null;
  commit;`;
/** Make the next sweep claim a RESUME (its bulk stamp): free the lease, forget the transition count it saw. */
const resumeNextSQL = `begin; update public.catering_refund_observation set lease_until = null, last_claim_transitions = null where id; commit;`;
const pArr = f => `array[${f.p.map(q).join(',')}]::uuid[]`;
const RESTORE_OBSERVATION = `update public.catering_refund_observation set transitions = 0, observe_on = false, transitioned_at = null, resumed_at = null,
    lease_until = null, last_claim_at = null, last_claim_transitions = null, last_claim_id = null, last_pass_ended_at = null, last_pass_reads = null,
    last_pass_complete = null where id`;
export function cleanupSQL(f) {
  const P = pArr(f);
  return `begin;
    delete from public.catering_refund_observed where payment_id = any(${P});
    delete from public.catering_refund_payment_state where payment_id = any(${P});
    delete from public.catering_refund_requests where payment_id = any(${P});
    delete from public.catering_refund_stripe_snapshots where payment_id = any(${P});
    delete from public.catering_payment_refund_events where payment_id = any(${P});
    delete from public.audit_log where actor_id = ${q(f.owner)};
    delete from public.stripe_events where id = ${q(f.evCover)};
    delete from public.catering_payments where id = any(${P});
    delete from public.catering_quotes where id in (${f.q.map(q).join(',')});
    delete from public.user_locations where user_id = ${q(f.owner)};
    delete from public.users where id = ${q(f.owner)};
    delete from public.locations where id = ${q(f.shop)};
    ${f.standIns ? 'drop function if exists public.catering_refund_b2_ready(); drop function if exists public.catering_refund_b3_ready();' : ''}
    ${RESTORE_OBSERVATION};
    commit;`;
}
export function leftoverSQL(f) {
  const P = pArr(f);
  return `select
    (select count(*) from public.catering_refund_observed where payment_id = any(${P}))::int
    + (select count(*) from public.catering_refund_payment_state where payment_id = any(${P}))::int
    + (select count(*) from public.catering_refund_requests where payment_id = any(${P}))::int
    + (select count(*) from public.catering_refund_stripe_snapshots where payment_id = any(${P}))::int
    + (select count(*) from public.catering_payment_refund_events where payment_id = any(${P}))::int
    + (select count(*) from public.audit_log where actor_id = ${q(f.owner)})::int
    + (select count(*) from public.stripe_events where id = ${q(f.evCover)})::int
    + (select count(*) from public.catering_payments where id = any(${P}))::int
    + (select count(*) from public.catering_quotes where id in (${f.q.map(q).join(',')}))::int
    + (select count(*) from public.users where id = ${q(f.owner)})::int
    + (select count(*) from public.locations where id = ${q(f.shop)})::int as leftovers,
    (select count(*) from public.catering_refund_payment_state)::int + (select count(*) from public.catering_refund_observed)::int as b1_rows_anywhere,
    (to_regprocedure('public.catering_refund_b2_ready()') is not null or to_regprocedure('public.catering_refund_b3_ready()') is not null) as stand_ins_left,
    ${OBSERVATION_PRISTINE} as observation_pristine`;
}
const OBSERVATION_PRISTINE = `coalesce((select count(*) = 1 and bool_and(not o.observe_on and o.transitions = 0 and o.transitioned_at is null and o.resumed_at is null and o.lease_until is null
    and o.last_claim_at is null and o.last_claim_transitions is null and o.last_claim_id is null and o.last_pass_ended_at is null and o.last_pass_reads is null
    and o.last_pass_complete is null) from public.catering_refund_observation o), false)`;

export const requiredColumns = {
  locations: ['id', 'name', 'code', 'type', 'active'], users: ['id', 'name', 'role', 'pin_hash', 'active'],
  catering_quotes: ['id', 'location_id', 'status'], catering_payments: ['id', 'quote_id', 'kind', 'amount_cents', 'status', 'provider', 'provider_ref', 'paid_at'],
  catering_refund_requests: ['id', 'payment_id', 'quote_id', 'location_id', 'client_token', 'amount_cents', 'reason_code', 'trigger_kind', 'requested_by'],
  stripe_events: ['id', 'type', 'livemode', 'payload', 'location_id', 'received_at'],
};
const CLEANED = ['catering_refund_observed', 'catering_refund_payment_state', 'catering_refund_requests', 'catering_refund_stripe_snapshots', 'catering_payment_refund_events',
  'audit_log', 'stripe_events', 'catering_payments', 'catering_quotes', 'user_locations', 'users', 'locations', 'catering_refund_observation'];
const WORKER = ['catering_refund_read_begin(uuid)', 'catering_refund_record_read(uuid,uuid,text,jsonb,jsonb,jsonb)', 'catering_refund_reserve_fresh(uuid,uuid,uuid,bigint,bigint,text,text,text,jsonb)',
  'catering_refund_arm(uuid,uuid,integer)', 'catering_refund_finish(uuid,text,jsonb,text,text)', 'catering_refund_cancel_unarmed(uuid,text)',
  'catering_refund_release(uuid,uuid,uuid,text,text,boolean,text)', 'catering_refund_attach(uuid,uuid,text,uuid,text)', 'catering_refund_sweep_begin(integer)'];
/** FIRST request: read-only (see the header). */
export async function preflight(query) {
  const rows = await query(`begin read only; set local statement_timeout = '10s';
    select (to_regclass('public.catering_refund_observed') is not null) as installed,
      (select count(*) from supabase_migrations.schema_migrations where name = '0359_catering_refund_mirror')::int as recorded,
      (select bool_and(has_function_privilege('service_role', to_regprocedure('public.' || s), 'EXECUTE')) from unnest(array[${WORKER.map(q).join(',')}]) s) as worker_ok,
      (to_regprocedure('public.catering_refund_observe_set(boolean)') is not null) as operator_ok,
      ${OBSERVATION_PRISTINE} as observation_pristine,
      (select count(*) from public.catering_refund_payment_state)::int as state_rows,
      (select count(*) from public.catering_refund_observed)::int as mirror_rows,
      (to_regprocedure('public.catering_refund_b2_ready()') is null and to_regprocedure('public.catering_refund_b3_ready()') is null) as stand_ins_free,
      (select coalesce(string_agg(t, ',' order by t), '') from unnest(array[${CLEANED.map(q).join(',')}]::text[]) t
        where to_regclass('public.' || t) is null
           or not pg_has_role(current_user, (select relowner from pg_class where oid = to_regclass('public.' || t)), 'USAGE')
           or (select relforcerowsecurity from pg_class where oid = to_regclass('public.' || t))
           or exists (select 1 from pg_trigger tg where tg.tgrelid = to_regclass('public.' || t) and not tg.tgisinternal and (tg.tgtype & 8) <> 0)) as not_cleanable;
    commit;`);
  const r = rows[rows.length - 1];
  assert.equal(r?.installed, true, '0359_catering_refund_mirror is not applied on this project');
  assert.equal(r.recorded, 1, '0359_catering_refund_mirror is not recorded exactly once');
  assert.equal(r.worker_ok, true, 'service_role cannot execute the worker surface'); assert.equal(r.operator_ok, true, 'the operator statement is missing');
  assert.equal(r.observation_pristine, true, 'the observation row is not in its install state (observation was used here): this proof only runs on a sim that never recorded ON');
  assert.equal(r.state_rows + r.mirror_rows, 0, 'B1 state or mirror rows exist: the bulk stamps would touch rows this proof did not create');
  assert.equal(r.stand_ins_free, true, 'catering_refund_b2_ready / _b3_ready exist: B2 / B3 are installed or a stand-in was left behind');
  assert.equal(r.not_cleanable, '', `the cleanup could not delete from: ${r.not_cleanable}`);
  return r;
}
export async function fixturePreflight(query) {
  const tables = Object.keys(requiredColumns).map(q).join(',');
  const columns = await query(`select table_name,column_name,is_nullable,column_default,is_identity,is_generated from information_schema.columns where table_schema='public' and table_name in (${tables})`);
  for (const [table, names] of Object.entries(requiredColumns)) for (const name of names) {
    assert.ok(columns.some(c => c.table_name === table && c.column_name === name), `fixture schema must contain ${table}.${name}`);
  }
  for (const c of columns) assert.ok(c.is_nullable !== 'NO' || c.column_default != null || c.is_identity === 'YES'
    || c.is_generated === 'ALWAYS' || requiredColumns[c.table_name]?.includes(c.column_name), `fixture schema has an omitted required column ${c.table_name}.${c.column_name}`);
  const enums = await query(`select c.relname as table_name, a.attname as column_name from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped join pg_type t on t.oid=a.atttypid
    where n.nspname='public' and c.relname in (${tables}) and t.typtype = 'e'`);
  for (const e of enums) assert.ok(!requiredColumns[e.table_name]?.includes(e.column_name), `fixture column ${e.table_name}.${e.column_name} is an enum (labels not checked): refusing`);
}

const one = async (query, sql) => (await query(sql))[0];
export async function runProof(query, { log = console.log, selfTest = false } = {}) {
  await preflight(query);
  await fixturePreflight(query);
  const f = fixture();
  log(`FIXTURE ${JSON.stringify(f)}`);
  let failed = 0;
  const step = async (name, fn) => {
    try { const detail = await fn(); log(`PASS ${name}${detail ? ` | ${detail}` : ''}`); }
    catch (error) { failed++; log(`FAIL ${name} | ${String(error?.message ?? error).slice(0, 500)}`); }
  };
  const race = (holder, racer, tag) => proveRace(query, holder, racer, `${f.tag}-${tag}`, { selfTest });
  const tx = (name, body, role = null, end = 'commit') => query(transactionSQL(`${f.tag}-${name}`, body, { role, end })).then(parseOut);
  const raw = sql => query(sql);
  const settle = () => raw(settleSQL(f));
  const read = async (i, refunds = []) => { const x = await tx(`read-${i}`, readBody(f, i, refunds), SVC); assert.equal(x?.ok?.result, 'complete', `read of payment ${i} (${JSON.stringify(x)?.slice(0, 300)})`); return x.ok; };
  /** settle -> a complete read -> one reserve: the request (pending, unarmed) and the token that read returned. */
  const reserved = async i => {
    await settle();
    const rd = await read(i);
    const x = await tx(`reserve-${i}`, reserveBody(f, i, rd.read_token), SVC);
    assert.equal(x?.ok?.requests?.length, 1, `reserve on payment ${i} (${JSON.stringify(x)?.slice(0, 300)})`);
    return { req: x.ok.requests[0].id, token: rd.read_token };
  };
  const state = i => one(query, `select dirty_since is not null as dirty, open_read_id is not null as open from public.catering_refund_payment_state where payment_id = ${q(f.p[i])}`);
  const reqRow = id => one(query, `select status, create_armed_at is not null as armed, stripe_refund_id from public.catering_refund_requests where id = ${q(id)}`);
  const noDeadlock = x => { for (const side of [x.holder, x.racer]) assert.ok(side?.err === undefined || side?.state !== '40P01', `no session may be aborted by a deadlock (40P01): ${JSON.stringify(side)?.slice(0, 300)}`); };
  let fixtureMade = false;
  try {
    await step('fixture (committed, synthetic, tagged; B2 / B3 stand-ins)', async () => { await raw(fixtureSQL(f)); fixtureMade = true; f.standIns = true; return f.tag; });
    if (!fixtureMade) throw new Error('no fixture');

    await step('1 RESERVE vs RESERVE on one payment: the second waits, then nothing_refundable (the first row blocks the payment)', async () => {
      await settle(); const rd = await read(0);
      const x = await race({ body: reserveBody(f, 0, rd.read_token), role: SVC }, { body: reserveBody(f, 0, rd.read_token), role: SVC }, '1');
      assert.equal(x.holder?.ok?.requests?.length, 1, `holder reserve (${JSON.stringify(x.holder)?.slice(0, 300)})`);
      assert.equal(x.racer?.err, 'nothing_refundable', `the waiting reserve (${JSON.stringify(x.racer)})`);
      const s = await one(query, `select count(*)::int n from public.catering_refund_requests where payment_id = ${q(f.p[0])}`);
      assert.equal(s.n, 1, 'exactly one request on the payment');
      return `blocked=${x.blocked}`;
    });
    await step('2a ARM vs CANCEL, arm first: cancel waits, then not_cancelled; the row is armed', async () => {
      const { req, token } = await reserved(1);
      const x = await race({ body: armBody(req, token), role: SVC }, { body: cancelBody(req), role: SVC }, '2a');
      assert.equal(x.holder?.ok?.result, 'armed', `holder arm (${JSON.stringify(x.holder)?.slice(0, 300)})`);
      assert.deepEqual([x.racer?.ok?.result, x.racer?.ok?.armed], ['not_cancelled', true], `the waiting cancel (${JSON.stringify(x.racer)})`);
      assert.deepEqual(Object.values(await reqRow(req)).slice(0, 2), ['pending', true]);
      return `blocked=${x.blocked}`;
    });
    await step('2b CANCEL vs ARM, cancel first: arm waits, then not_armable; the row is failed, never armed', async () => {
      const { req, token } = await reserved(2);
      const x = await race({ body: cancelBody(req), role: SVC }, { body: armBody(req, token), role: SVC }, '2b');
      assert.equal(x.holder?.ok?.result, 'cancelled', `holder cancel (${JSON.stringify(x.holder)})`);
      assert.deepEqual([x.racer?.ok?.result, x.racer?.ok?.status], ['not_armable', 'failed'], `the waiting arm (${JSON.stringify(x.racer)})`);
      assert.deepEqual(Object.values(await reqRow(req)).slice(0, 2), ['failed', false]);
      return `blocked=${x.blocked}`;
    });
    await step('3a ARM vs RELEASE, arm first: release waits, then not_releasable_yet (it sees the arm)', async () => {
      const { req, token } = await reserved(3);
      const x = await race({ body: armBody(req, token), role: SVC }, { body: releaseBody(f, req, token), role: SVC }, '3a');
      assert.equal(x.holder?.ok?.result, 'armed', `holder arm (${JSON.stringify(x.holder)?.slice(0, 300)})`);
      assert.equal(x.racer?.err, 'not_releasable_yet', `the waiting release (${JSON.stringify(x.racer)})`);
      return `blocked=${x.blocked}`;
    });
    await step('3b RELEASE vs ARM, release first (a row armed 25 h ago): arm waits, then not_armable (failed)', async () => {
      await raw(preArmedSQL(f, 4, f.pre4)); await settle(); const rd = await read(4);
      const x = await race({ body: releaseBody(f, f.pre4, rd.read_token), role: SVC }, { body: armBody(f.pre4, rd.read_token), role: SVC }, '3b');
      assert.equal(x.holder?.ok?.result, 'released', `holder release (${JSON.stringify(x.holder)})`);
      assert.deepEqual([x.racer?.ok?.result, x.racer?.ok?.status], ['not_armable', 'failed'], `the waiting arm (${JSON.stringify(x.racer)})`);
      return `blocked=${x.blocked}`;
    });
    await step("4a ARM vs ATTACH, arm first: attach waits, then figures_stale (the arm's own dirty stamp)", async () => {
      const { req, token } = await reserved(5);
      const x = await race({ body: armBody(req, token), role: SVC }, { body: attachBody(f, req, `re_sim0359v2lock_${hex()}`, token), role: SVC }, '4a');
      assert.equal(x.holder?.ok?.result, 'armed', `holder arm (${JSON.stringify(x.holder)?.slice(0, 300)})`);
      assert.equal(x.racer?.err, 'figures_stale', `the waiting attach (${JSON.stringify(x.racer)})`);
      return `blocked=${x.blocked}`;
    });
    await step('4b ATTACH vs ARM, attach first (a row armed 25 h ago + its mirrored refund): arm waits, then not_armable (submitted)', async () => {
      await raw(preArmedSQL(f, 6, f.pre6)); await settle();
      const rd = await read(6, [{ id: f.re6, sql: refundObj(f, 6, f.re6, null, `${NOW_S} - 60`) }]);
      const x = await race({ body: attachBody(f, f.pre6, f.re6, rd.read_token), role: SVC }, { body: armBody(f.pre6, rd.read_token), role: SVC }, '4b');
      assert.equal(x.holder?.ok?.result, 'attached', `holder attach (${JSON.stringify(x.holder)})`);
      assert.deepEqual([x.racer?.ok?.result, x.racer?.ok?.status], ['not_armable', 'submitted'], `the waiting arm (${JSON.stringify(x.racer)})`);
      return `blocked=${x.blocked}`;
    });
    await step('5a BEGIN vs RECORD on one payment, begin first: the record waits, then read_replaced; the payment is dirty', async () => {
      await settle();
      const first = await tx('5a-first', beginBody(f, 7), SVC);
      const x = await race({ body: beginBody(f, 7), role: SVC }, { body: recordBody(f, 7, first.ok.read_id), role: SVC }, '5a');
      assert.equal(x.holder?.ok?.replaced, true, `holder begin replaces the open read (${JSON.stringify(x.holder)?.slice(0, 200)})`);
      assert.equal(x.racer?.ok?.result, 'read_replaced', `the waiting record (${JSON.stringify(x.racer)})`);
      assert.equal((await state(7)).dirty, true, 'the payment is dirty');
      return `blocked=${x.blocked}`;
    });
    await step('5b RECORD vs BEGIN, record first: the begin waits, then opens a fresh read (replaced = false)', async () => {
      await settle();
      const first = await tx('5b-first', beginBody(f, 8), SVC);
      const x = await race({ body: recordBody(f, 8, first.ok.read_id), role: SVC }, { body: beginBody(f, 8), role: SVC }, '5b');
      assert.equal(x.holder?.ok?.result, 'complete', `holder record (${JSON.stringify(x.holder)?.slice(0, 300)})`);
      assert.deepEqual([x.racer?.ok?.eligible, x.racer?.ok?.replaced], [true, false], `the waiting begin (${JSON.stringify(x.racer)?.slice(0, 200)})`);
      return `blocked=${x.blocked}`;
    });
    await step("6a READ vs RESERVE, read first: the reserve (with the earlier read's token) waits, then figures_stale", async () => {
      await settle(); const rd = await read(9);
      const x = await race({ body: readBody(f, 9), role: SVC }, { body: reserveBody(f, 9, rd.read_token), role: SVC }, '6a');
      assert.equal(x.holder?.ok?.result, 'complete', `holder read (${JSON.stringify(x.holder)?.slice(0, 300)})`);
      assert.equal(x.racer?.err, 'figures_stale', `the waiting reserve (${JSON.stringify(x.racer)})`);
      return `blocked=${x.blocked}`;
    });
    await step('6b RESERVE vs READ, reserve first: the read waits, then completes', async () => {
      await settle(); const rd = await read(10);
      const x = await race({ body: reserveBody(f, 10, rd.read_token), role: SVC }, { body: readBody(f, 10), role: SVC }, '6b');
      assert.equal(x.holder?.ok?.requests?.length, 1, `holder reserve (${JSON.stringify(x.holder)?.slice(0, 300)})`);
      assert.equal(x.racer?.ok?.result, 'complete', `the waiting read (${JSON.stringify(x.racer)?.slice(0, 300)})`);
      return `blocked=${x.blocked}`;
    });
    await step("7 RESERVE vs MAIN's paid -> refunded UPDATE: the UPDATE waits (no deadlock); both rolled back", async () => {
      await settle(); const rd = await read(11);
      const x = await race({ body: reserveBody(f, 11, rd.read_token), role: SVC, end: 'rollback' }, { body: mainRefundedBody(f, 11), role: SVC, end: 'rollback' }, '7');
      noDeadlock(x);
      assert.equal(x.holder?.ok?.requests?.length, 1, `holder reserve (${JSON.stringify(x.holder)?.slice(0, 300)})`);
      assert.equal(Number(x.racer?.ok?.rows), 1, `main's UPDATE ran after the wait (${JSON.stringify(x.racer)})`);
      const s = await one(query, `select status from public.catering_payments where id = ${q(f.p[11])}`);
      assert.equal(s.status, 'paid', 'both rolled back: the payment is still paid');
      return `blocked=${x.blocked}`;
    });
    await step('8a FINISH vs a READ binding the same request, finish first: the read waits, completes, links the mirror row', async () => {
      const { req, token } = await reserved(12);
      assert.equal((await tx('8a-arm', armBody(req, token), SVC))?.ok?.result, 'armed');
      const x = await race({ body: finishBody(f, 12, req, f.re12), role: SVC },
        { body: readBody(f, 12, [{ id: f.re12, sql: refundObj(f, 12, f.re12, req, `${NOW_S} + 5`) }]), role: SVC }, '8a');
      assert.equal(x.holder?.ok?.result, 'created', `holder finish (${JSON.stringify(x.holder)})`);
      assert.deepEqual([x.racer?.ok?.result, Number(x.racer?.ok?.linked)], ['complete', 1], `the waiting read (${JSON.stringify(x.racer)?.slice(0, 300)})`);
      assert.deepEqual([(await reqRow(req)).status, (await reqRow(req)).stripe_refund_id], ['submitted', f.re12]);
      return `blocked=${x.blocked}`;
    });
    await step('8b a READ binding vs FINISH, read first: finish waits, then created + already_bound', async () => {
      const { req, token } = await reserved(13);
      assert.equal((await tx('8b-arm', armBody(req, token), SVC))?.ok?.result, 'armed');
      const x = await race({ body: readBody(f, 13, [{ id: f.re13, sql: refundObj(f, 13, f.re13, req, `${NOW_S} + 5`) }]), role: SVC },
        { body: finishBody(f, 13, req, f.re13), role: SVC }, '8b');
      assert.equal(x.holder?.ok?.result, 'complete', `holder read (${JSON.stringify(x.holder)?.slice(0, 300)})`);
      assert.equal(x.holder?.ok?.bound?.[0]?.request_id, req, 'the read bound the request');
      assert.deepEqual([x.racer?.ok?.result, x.racer?.ok?.already_bound], ['created', true], `the waiting finish (${JSON.stringify(x.racer)})`);
      return `blocked=${x.blocked}`;
    });
    // ── the bulk stamps: the operator statement (F17, owner) and the sweep's resume (F13) vs a read and vs an arm
    await step('9a OPERATOR STATEMENT vs READ, operator first: the read waits on the state row, then completes; no deadlock', async () => {
      await settle(); await read(14);
      const x = await race({ body: observeBody(), role: null }, { body: readBody(f, 14), role: SVC }, '9a');
      noDeadlock(x);
      assert.ok(Number(x.holder?.ok?.stamped) >= 1, `holder observe_set stamped the state rows (${JSON.stringify(x.holder)})`);
      assert.equal(x.racer?.ok?.result, 'complete', `the waiting read (${JSON.stringify(x.racer)?.slice(0, 300)})`);
      return `blocked=${x.blocked}`;
    });
    await step('9b READ vs OPERATOR STATEMENT, read first: the statement waits, then stamps; no deadlock', async () => {
      await settle(); await read(15);
      const x = await race({ body: readBody(f, 15), role: SVC }, { body: observeBody(), role: null }, '9b');
      noDeadlock(x);
      assert.equal(x.holder?.ok?.result, 'complete', `holder read (${JSON.stringify(x.holder)?.slice(0, 300)})`);
      assert.ok(Number(x.racer?.ok?.stamped) >= 1, `the waiting observe_set (${JSON.stringify(x.racer)})`);
      return `blocked=${x.blocked}`;
    });
    await step('9c OPERATOR STATEMENT vs ARM, operator first: the arm waits on the state row, then figures_stale; no deadlock', async () => {
      const { req, token } = await reserved(16);
      const x = await race({ body: observeBody(), role: null }, { body: armBody(req, token), role: SVC }, '9c');
      noDeadlock(x);
      assert.ok(Number(x.holder?.ok?.stamped) >= 1, `holder observe_set (${JSON.stringify(x.holder)})`);
      assert.equal(x.racer?.ok?.result, 'figures_stale', `the waiting arm (${JSON.stringify(x.racer)})`);
      return `blocked=${x.blocked}`;
    });
    await step('9d ARM vs OPERATOR STATEMENT, arm first: the statement waits, then stamps; the arm stands; no deadlock', async () => {
      const { req, token } = await reserved(17);
      const x = await race({ body: armBody(req, token), role: SVC }, { body: observeBody(), role: null }, '9d');
      noDeadlock(x);
      assert.equal(x.holder?.ok?.result, 'armed', `holder arm (${JSON.stringify(x.holder)?.slice(0, 300)})`);
      assert.ok(Number(x.racer?.ok?.stamped) >= 1, `the waiting observe_set (${JSON.stringify(x.racer)})`);
      return `blocked=${x.blocked}`;
    });
    await step('10a SWEEP RESUME vs READ, sweep first: the read waits on the state row, then completes; no deadlock', async () => {
      await settle(); await read(18); await raw(resumeNextSQL);
      const x = await race({ body: sweepBody(), role: SVC }, { body: readBody(f, 18), role: SVC }, '10a');
      noDeadlock(x);
      assert.deepEqual([x.holder?.ok?.claimed, x.holder?.ok?.resumed], [true, true], `holder sweep_begin resumed (${JSON.stringify(x.holder)?.slice(0, 300)})`);
      assert.equal(x.racer?.ok?.result, 'complete', `the waiting read (${JSON.stringify(x.racer)?.slice(0, 300)})`);
      return `blocked=${x.blocked}`;
    });
    await step('10b READ vs SWEEP RESUME, read first: the sweep waits, then resumes; no deadlock', async () => {
      await settle(); await read(19); await raw(resumeNextSQL);
      const x = await race({ body: readBody(f, 19), role: SVC }, { body: sweepBody(), role: SVC }, '10b');
      noDeadlock(x);
      assert.equal(x.holder?.ok?.result, 'complete', `holder read (${JSON.stringify(x.holder)?.slice(0, 300)})`);
      assert.deepEqual([x.racer?.ok?.claimed, x.racer?.ok?.resumed], [true, true], `the waiting sweep_begin (${JSON.stringify(x.racer)?.slice(0, 300)})`);
      return `blocked=${x.blocked}`;
    });
    await step('10c SWEEP RESUME vs ARM, sweep first: the arm waits, then figures_stale; no deadlock', async () => {
      const { req, token } = await reserved(20); await raw(resumeNextSQL);
      const x = await race({ body: sweepBody(), role: SVC }, { body: armBody(req, token), role: SVC }, '10c');
      noDeadlock(x);
      assert.deepEqual([x.holder?.ok?.claimed, x.holder?.ok?.resumed], [true, true], `holder sweep_begin (${JSON.stringify(x.holder)?.slice(0, 300)})`);
      assert.equal(x.racer?.ok?.result, 'figures_stale', `the waiting arm (${JSON.stringify(x.racer)})`);
      return `blocked=${x.blocked}`;
    });
    await step('10d ARM vs SWEEP RESUME, arm first: the sweep waits, then resumes; the arm stands; no deadlock', async () => {
      const { req, token } = await reserved(21); await raw(resumeNextSQL);
      const x = await race({ body: armBody(req, token), role: SVC }, { body: sweepBody(), role: SVC }, '10d');
      noDeadlock(x);
      assert.equal(x.holder?.ok?.result, 'armed', `holder arm (${JSON.stringify(x.holder)?.slice(0, 300)})`);
      assert.deepEqual([x.racer?.ok?.claimed, x.racer?.ok?.resumed], [true, true], `the waiting sweep_begin (${JSON.stringify(x.racer)?.slice(0, 300)})`);
      return `blocked=${x.blocked}`;
    });
    await step(`S8 an ARM waiting on the state row held by the operator statement past p_max_wait_ms (2 s) answers ${selfTest ? 'figures_stale (SELF-TEST: no wait in one session, so the deadline cannot pass)' : 'deadline_passed'}`, async () => {
      const { req, token } = await reserved(22);
      const x = await race({ body: observeBody(), role: null }, { body: armBody(req, token, 2000), role: SVC }, 'S8');
      noDeadlock(x);
      assert.equal(x.racer?.ok?.result, selfTest ? 'figures_stale' : 'deadline_passed', `the waiting arm (${JSON.stringify(x.racer)})`);
      assert.deepEqual(Object.values(await reqRow(req)).slice(0, 2), ['pending', false], 'never armed');
      return `blocked=${x.blocked}`;
    });
  } finally {
    await step('cleanup: every fixture row deleted by id, stand-ins dropped, observation back to its install state; a second read proves it', async () => {
      await raw(cleanupSQL(f));
      const s = await one(query, leftoverSQL(f));
      assert.equal(s.leftovers, 0, `rows left: ${s.leftovers} (fixture ids above)`);
      assert.equal(s.b1_rows_anywhere, 0, 'B1 state / mirror rows left on the project');
      assert.equal(s.stand_ins_left, false, 'a B2 / B3 stand-in is left');
      assert.equal(s.observation_pristine, true, 'the observation row is not back to its install state');
      return 'leftovers=0, b1_rows=0, stand_ins=0, observation=install state';
    });
  }
  log(failed ? `FAIL refund-0359 v2 lock check: ${failed} step(s) failed${selfTest ? ' (self-test, single session)' : ''}`
    : `PASS refund-0359 v2 lock check: all steps${selfTest ? ' (SELF-TEST, ONE PGlite session: the plumbing and each statement sequentially, holder then racer; NO lock wait observed; the two-session run is the lead\'s, on the sim)' : ' with observed waits'}`);
  return failed;
}

/** OFFLINE: the same fixture, statements and committed outcomes on PGlite (the harness's real 0357 -> 0358 -> 0359). */
export async function selfTest(log = console.log) {
  const H = await import('../sql-harness-0359-lib.mjs');
  const db = await H.base();
  await db.exec(`alter table public.users add column pin_hash text not null;
    alter table public.locations add column name text, add column type text;
    create schema supabase_migrations; create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
    insert into supabase_migrations.schema_migrations (version, name) values ('20261128000000', '0359_catering_refund_mirror');`);
  const query = async sql => { const res = await db.exec(sql); const withRows = res.filter(r => r.fields?.length); return withRows.length ? withRows[withRows.length - 1].rows : []; };
  try { return await runProof(query, { log, selfTest: true }); } finally { await db.close(); }
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--self-test') return selfTest();
  const ref = projectRef(args, true); // SIM ONLY: refuses prod and every other ref
  return runProof(managementQuery(ref, process.env.SUPABASE_ACCESS_TOKEN));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(() => main()).then(failed => { process.exitCode = failed ? 1 : 0; }).catch(error => {
    console.error(`FAIL refund-0359 v2 lock check: ${String(error?.message ?? error).slice(0, 300)} (check the SIM target, the pre-flight, connectivity; an interrupted run may leave the printed fixture ids to delete by hand)`);
    process.exitCode = 1;
  });
}
