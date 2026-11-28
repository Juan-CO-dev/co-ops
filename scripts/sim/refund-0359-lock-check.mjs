/** FILE ONLY: the lead / CC runs this after 0359 is applied to the SIM. Never in CI. Never loads .env or a direct DB URL,
 * never reads ~/.supabase-token (the operator passes the token in the environment, like every scripts/sim/ proof).
 *   SUPABASE_ACCESS_TOKEN=<operator environment>; node scripts/sim/refund-0359-lock-check.mjs --ref=jepgzucrvklhqpthowsc
 *   node scripts/sim/refund-0359-lock-check.mjs --self-test     OFFLINE: the same statements, single session, on PGlite
 *
 * The TWO-SESSION proof of migration 0359 that one PGlite backend cannot give (plan B1.6 "Use two independent sim
 * sessions for lock order and generation fencing", Activation 2 and 7). Every Management API request is its own database
 * session and owns ONE transaction, so two concurrent requests ARE two independent sessions. The technique is the house
 * one (scripts/sim/checklist-0276-lock-check-management.mjs `proveRace`): the HOLDER request calls the real function and
 * then sleeps 7 s inside its open transaction (`pg_sleep`), holding every lock the function took; the RACER request is
 * sent once the holder is seen sleeping; an observer request proves the racer is an UNGRANTED lock BLOCKED BY the holder's
 * backend (pg_locks + pg_blocking_pids), and the racer's elapsed time covers the holder's remaining sleep. The racer's
 * answer is captured inside its own transaction (set_config + a final select), so a refusal is data, never a transport
 * error. Holder and racer both run with lock_timeout 14 s / statement_timeout 25 s: a deadlock or a lost wait FAILS.
 *
 * STEPS (PASS / FAIL each; exit 1 on any FAIL):
 *   3b ADMISSION LOCK, seal first  holder = catering_refund_finish_drain (exclusive admission lock) seals and COMMITS;
 *                                  racer = catering_refund_event_register (shared admission lock) WAITS, then answers
 *                                  `refunds_sealed` and leaves no verdict and no work.
 *   3a ADMISSION LOCK, ingress first  holder = an ingress registration (shared lock) COMMITS; racer = finish_drain WAITS,
 *                                  then sees the holder's event and does NOT close (ingress that wins prevents closure).
 *   1a LOCK ORDER, apply first     holder = pass_begin + catering_refund_apply (payment FOR NO KEY UPDATE) COMMITS;
 *                                  racer = catering_refund_reserve_admitted on the same order WAITS, then reserves and
 *                                  sees the holder's complete pass.
 *   1b LOCK ORDER, reserve first   holder = reserve_admitted holds the payment, then ROLLS BACK (no destructive audit row
 *                                  is ever committed); racer = pass_begin + apply WAITS, then applies and sees no request.
 *                                  Neither order deadlocks.
 *   2  GENERATION FENCING          holder = pass_begin (stages a pass at generation g) COMMITS; racer = a new event
 *                                  registration on the payment WAITS, then attaches (generation g+1) and COMMITS; the
 *                                  holder's apply with its pass token then answers `stale_generation` (a third session).
 *   4  TWO CLAIMS, ONE REQUEST     holder = catering_refund_claim_admitted COMMITS; racer = the same claim WAITS, then
 *                                  answers claimed=false / in_progress. Exactly one claim.
 *   5a ARM vs RELEASE, arm first   holder = catering_refund_arm COMMITS; racer = resolve_anomaly(release_unsent) WAITS,
 *                                  then is refused `issue_closed`: the arm cleared the request's "reserved, not sent"
 *                                  occurrence in its own transaction (review fix), so there is nothing left to release.
 *                                  The request stays pending, armed.
 *   5b ARM vs RELEASE, release first  holder = release_unsent COMMITS; racer = arm WAITS, then answers `not_pending`.
 *                                  The request is failed `released_unsent` and was never armed.
 *   6a LOCK ORDER payment -> event, settlement first (fix round 2, F5)  the event is a recovery SEED not attached yet.
 *                                  holder = a settlement: it takes the PAYMENT lock, pauses 4 s inside its transaction,
 *                                  THEN calls catering_refund_settlement_attach (which needs the EVENT) and COMMITS;
 *                                  racer = the genuine signed delivery of that same event
 *                                  (catering_refund_event_register: a PROMOTION), started while the holder pauses.
 *                                  With ONE lock order the racer waits on the payment holding nothing, the holder
 *                                  attaches, and the racer then promotes: NO DEADLOCK. With the old order (event
 *                                  first) the racer would hold the event while waiting for the payment and the
 *                                  holder would wait for the event: Postgres aborts one (40P01) and this step FAILS.
 *   6b LOCK ORDER payment -> event, delivery first  holder = the signed delivery (payment, then event) COMMITS;
 *                                  racer = catering_refund_settlement_attach WAITS on the payment, then finds the
 *                                  event already attached and attaches nothing twice.
 * WHAT IT CANNOT PROVE: the Management API gives no session that stays open across requests, so a holder is always ONE
 * call followed by a sleep (never a person pausing between two calls), and timing beyond "waited at least the holder's
 * remainder" is not measured. The race of a Stripe POST itself is out of scope (no provider is called: every provider
 * fact is a synthetic evidence JSON).
 *
 * FIXTURE (committed, because two sessions must both see it; SYNTHETIC rows only, tagged SIM-0359-LOCK-<id>): one shop,
 * one owner with one session, five quotes with one $300 Stripe deposit each, the two missing install records as stand-ins
 * (B2 / B3: plan B1.5 "B1 proof before B2 exists"; only the parts not installed are added), two epochs inserted by the
 * fixture owner (draining, then live), five stripe_events ledger rows, two recovery-seed event rows (step 6), two
 * request rows and two issue rows. While it
 * runs (about two minutes) the sim has an open fixture epoch; with CATERING_REFUNDS unset nothing in the app reads it.
 * CLEANUP (finally, always): every row the fixture or a committed step wrote is DELETED by id (the issues, identities,
 * event work, requests, snapshots and work of the four payments; the ledger rows; the audit rows of the fixture's
 * epochs / issues / requests / payments / owner; payments, quotes, session, epochs, stand-ins, owner, shop) and a second
 * read proves every count is 0. No step writes an outcome row (the append-only table cannot be cleaned): evidence lists
 * are empty or hints only. The pre-flight refuses before any write unless every table it must clean is owned by the
 * runner, has no row trigger on DELETE and no forced RLS, and the sim has no epoch at all.
 * The printed fixture ids let an operator remove stranded rows by hand after an interrupted run.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { literal as q, managementQuery, projectRef } from '../supabase-management-query.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const settled = promise => promise.then(rows => ({ ok: true, rows }), error => ({ ok: false, error: String(error?.message ?? error) }));
const OUT = 'refund0359.out';
const HOLD_S = 7;

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
    // One session: the holder's whole transaction, then the racer's. Proves the SQL and the committed outcome only.
    const h = parseOut(await query(transactionSQL(holderName, holder.body, { hold: true, end: holder.end ?? 'commit', role: holder.role, sleep: 0 })));
    const r = parseOut(await query(transactionSQL(racerName, racer.body, { end: racer.end ?? 'rollback', role: racer.role })));
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
    rp = settled(query(transactionSQL(racerName, racer.body, { end: racer.end ?? 'rollback', role: racer.role }))).then(x => ({ ...x, finishedAt: Date.now(), racerStart }));
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
  const f = { tag: `SIM-0359-LOCK-${id.slice(0, 8)}`, shop: randomUUID(), owner: randomUUID(), session: randomUUID(),
    q: [1, 2, 3, 4, 5].map(() => randomUUID()), p: [1, 2, 3, 4, 5].map(() => randomUUID()), pi: [1, 2, 3, 4, 5].map(() => `pi_sim0359lock_${hex()}`),
    ch: [1, 2, 3, 4, 5].map(() => `ch_sim0359lock_${hex()}`), e1: randomUUID(), e2: randomUUID(),
    evSeal: `evt_sim0359lock_seal_${hex()}`, evIngress: `evt_sim0359lock_ingress_${hex()}`, evGen: `evt_sim0359lock_gen_${hex()}`,
    evOrderA: `evt_sim0359lock_ordera_${hex()}`, evOrderB: `evt_sim0359lock_orderb_${hex()}`,
    r4: randomUUID(), r5: randomUUID(), i4: randomUUID(), i5: randomUUID(), standIns: [] };
  return f;
}
const C = q('b1-1'); // the compiled caller contract of this release (0359's install record; the pre-flight checks it)
const owner = f => `jsonb_build_object('status', 'resolved', 'payment_intent', ${q(f.pi)}, 'charge', ${q(f.ch)}, 'currency', 'usd', 'livemode', false, 'captured_cents', 30000)`;
const evidence = (pi, ch) => `jsonb_build_object('complete', true, 'scheduled', false, 'run_id', gen_random_uuid(), 'owner', ${owner({ pi, ch })}, 'refunds', '[]'::jsonb)`;
const passApply = (f, i, extra = 'null') => capture(`b := public.catering_refund_pass_begin(${C}, ${q(f.p[i])}, gen_random_uuid());
    a := public.catering_refund_apply(${C}, ${q(f.p[i])}, (b->>'pass_token')::uuid, (b->>'generation')::bigint, ${evidence(f.pi[i], f.ch[i])});
    r := jsonb_build_object('begin', b, 'apply', a, 'extra', ${extra});`, 'b jsonb; a jsonb;');
const reserve = (f, i, extra = 'null') => capture(`x := public.catering_refund_reserve_admitted(${C}, ${q(f.owner)}, ${q(f.session)}, ${q(f.q[i])}, gen_random_uuid(), 5000, 'customer_cancelled', null, 'panel');
    r := jsonb_build_object('reserve', x, 'extra', ${extra});`, 'x jsonb;');
const register = (f, i, ev, hint) => capture(callInto(`public.catering_refund_event_register(${C}, ${q(ev)}, 'refund.created', null, false, ${q(f.pi[i])}, ${q(f.ch[i])},
    extract(epoch from clock_timestamp())::bigint, null, null, null, jsonb_build_array(jsonb_build_object('id', ${q(hint)}, 'status', 'pending')))`));
const finishDrain = (f, epoch) => capture(callInto(`public.catering_refund_finish_drain(${q(epoch)}, 1, ${q(f.tag)})`));
const claim = (f, req) => capture(callInto(`public.catering_refund_claim_admitted(${C}, ${q(f.owner)}, ${q(f.session)}, ${q(req)})`));
const arm = (f, req, token, gen) => capture(callInto(`public.catering_refund_arm(${C}, ${q(f.owner)}, ${q(f.session)}, ${q(req)}, ${token === null ? 'gen_random_uuid()' : `${q(token)}::uuid`}, ${gen}, ${q(f.pi[3])}, ${q(f.ch[3])}, false)`));
const releaseUnsent = (f, issue, gen) => capture(callInto(`public.catering_refund_resolve_anomaly(${C}, ${q(issue)}, ${gen}, 'release_unsent', 'sim-0359-lock-check', ${q(f.session)}, null)`));
const SVC = 'service_role';

export function fixtureSQL(f) {
  return `begin;
    insert into public.locations(id,name,code,type,active) values(${q(f.shop)},${q(f.tag)},${q(f.tag)},'permanent',true);
    insert into public.users(id,name,role,pin_hash,active) values(${q(f.owner)},${q(f.tag)},'owner','SIM-NO-VALID-CREDENTIAL',true);
    insert into public.sessions(id,user_id,token_hash,auth_method,step_up_unlocked,step_up_unlocked_at,expires_at)
      values(${q(f.session)},${q(f.owner)},${q(`${f.tag}-${f.session}`)},'pin',true,clock_timestamp(),clock_timestamp()+interval '1 hour');
    insert into public.catering_quotes(id,location_id,status) values ${f.q.map(id => `(${q(id)},${q(f.shop)},'accepted')`).join(',')};
    insert into public.catering_payments(id,quote_id,kind,amount_cents,status,provider,provider_ref,paid_at) values
      ${f.p.map((id, i) => `(${q(id)},${q(f.q[i])},'deposit',30000,'paid','stripe',${q(f.pi[i])},clock_timestamp()-interval '1 day')`).join(',')};
    insert into public.catering_refund_install_contracts(part,version,migration)
      select k, public.catering_refund_install_manifest()->>k, case k when 'B2' then '0362_sim_lock_check_stand_in' else '0363_sim_lock_check_stand_in' end
        from unnest(array[${f.standIns.map(q).join(',')}]::text[]) k;
    insert into public.catering_refund_epochs(id,state,manifest,opened_by,recovery_cutoff,recovery_complete_at,promoted_at,draining_at)
      values(${q(f.e1)},'draining',public.catering_refund_install_manifest(),${q(f.tag)},clock_timestamp(),clock_timestamp(),clock_timestamp(),clock_timestamp());
    insert into public.stripe_events(id,type,livemode,payload,location_id) values
      ${[f.evSeal, f.evIngress, f.evGen, f.evOrderA, f.evOrderB].map(id => `(${q(id)},'refund.created',false,jsonb_build_object('id',${q(id)},'synthetic',${q(f.tag)}),null)`).join(',')};
    commit;`;
}
const ids = f => ({ P: `array[${f.p.map(q).join(',')}]::uuid[]`, EV: `array[${[f.evSeal, f.evIngress, f.evGen, f.evOrderA, f.evOrderB].map(q).join(',')}]::text[]`,
  ALL: `array[${[...f.p, ...f.q, f.e1, f.e2, f.r4, f.r5, f.i4, f.i5, f.owner, f.shop].map(q).join(',')}]::uuid[]` });
export function cleanupSQL(f) {
  const { P, EV, ALL } = ids(f);
  return `begin;
    delete from public.catering_refund_issues where payment_id = any(${P});
    delete from public.catering_refund_identities where payment_id = any(${P});
    delete from public.catering_refund_event_work where event_id = any(${EV}) or payment_id = any(${P});
    delete from public.catering_payment_refund_events where payment_id = any(${P});
    delete from public.catering_refund_requests where payment_id = any(${P});
    delete from public.catering_refund_stripe_snapshots where payment_id = any(${P});
    delete from public.catering_refund_payment_work where payment_id = any(${P});
    delete from public.stripe_events where id = any(${EV});
    delete from public.audit_log where resource_id = any(${ALL}) or actor_id = ${q(f.owner)};
    delete from public.catering_payments where id = any(${P});
    delete from public.catering_quotes where id in (${f.q.map(q).join(',')});
    delete from public.sessions where user_id = ${q(f.owner)};
    delete from public.user_locations where user_id = ${q(f.owner)};
    delete from public.catering_refund_epochs where id in (${q(f.e1)},${q(f.e2)});
    delete from public.catering_refund_install_contracts where migration in ('0362_sim_lock_check_stand_in','0363_sim_lock_check_stand_in') and part = any(array[${f.standIns.map(q).join(',')}]::text[]);
    delete from public.users where id = ${q(f.owner)};
    delete from public.locations where id = ${q(f.shop)};
    commit;`;
}
export function leftoverSQL(f) {
  const { P, EV, ALL } = ids(f);
  return `select
    (select count(*) from public.catering_refund_issues where payment_id = any(${P}))::int
    + (select count(*) from public.catering_refund_identities where payment_id = any(${P}))::int
    + (select count(*) from public.catering_refund_event_work where event_id = any(${EV}) or payment_id = any(${P}))::int
    + (select count(*) from public.catering_payment_refund_outcomes where payment_id = any(${P}))::int
    + (select count(*) from public.catering_payment_refund_events where payment_id = any(${P}))::int
    + (select count(*) from public.catering_refund_requests where payment_id = any(${P}))::int
    + (select count(*) from public.catering_refund_stripe_snapshots where payment_id = any(${P}))::int
    + (select count(*) from public.catering_refund_payment_work where payment_id = any(${P}))::int
    + (select count(*) from public.stripe_events where id = any(${EV}))::int
    + (select count(*) from public.audit_log where resource_id = any(${ALL}) or actor_id = ${q(f.owner)})::int
    + (select count(*) from public.catering_payments where id = any(${P}))::int
    + (select count(*) from public.catering_quotes where id in (${f.q.map(q).join(',')}))::int
    + (select count(*) from public.sessions where user_id = ${q(f.owner)})::int
    + (select count(*) from public.catering_refund_epochs where id in (${q(f.e1)},${q(f.e2)}))::int
    + (select count(*) from public.catering_refund_install_contracts where migration in ('0362_sim_lock_check_stand_in','0363_sim_lock_check_stand_in'))::int
    + (select count(*) from public.users where id = ${q(f.owner)})::int
    + (select count(*) from public.locations where id = ${q(f.shop)})::int as leftovers,
    (select count(*) from public.catering_refund_epochs)::int as epochs_now`;
}

export const requiredColumns = {
  locations: ['id', 'name', 'code', 'type', 'active'], users: ['id', 'name', 'role', 'pin_hash', 'active'],
  sessions: ['id', 'user_id', 'token_hash', 'auth_method', 'step_up_unlocked', 'step_up_unlocked_at', 'expires_at'],
  catering_quotes: ['id', 'location_id', 'status'], catering_payments: ['id', 'quote_id', 'kind', 'amount_cents', 'status', 'provider', 'provider_ref', 'paid_at'],
  catering_refund_requests: ['id', 'payment_id', 'quote_id', 'location_id', 'client_token', 'amount_cents', 'reason_code', 'trigger_kind', 'requested_by'],
  catering_refund_issues: ['id', 'code', 'payment_id', 'location_id', 'request_id', 'evidence_fingerprint', 'blocking', 'generation_at_open'],
  catering_refund_epochs: ['id', 'state', 'manifest', 'opened_by', 'recovery_cutoff', 'recovery_complete_at', 'promoted_at', 'draining_at'],
  catering_refund_install_contracts: ['part', 'version', 'migration'], stripe_events: ['id', 'type', 'livemode', 'payload', 'location_id'],
  catering_refund_event_work: ['event_id', 'event_type', 'source', 'livemode', 'payment_intent_id', 'state'],
};
const CLEANED = ['catering_refund_issues', 'catering_refund_identities', 'catering_refund_event_work', 'catering_payment_refund_events', 'catering_refund_requests',
  'catering_refund_stripe_snapshots', 'catering_refund_payment_work', 'stripe_events', 'audit_log', 'catering_payments', 'catering_quotes', 'sessions', 'user_locations',
  'catering_refund_epochs', 'catering_refund_install_contracts', 'users', 'locations'];
/** FIRST request: read-only. 0359 live (B1 b1-1 current), no epoch at all, the worker surface executable by service_role,
 *  and every table the cleanup must delete from is the runner's, with no DELETE row trigger and no forced RLS. */
export async function preflight(query) {
  const rows = await query(`begin read only; set local statement_timeout = '10s';
    select (to_regclass('public.catering_refund_install_contracts') is not null) as installed,
      (select coalesce(string_agg(part || '/' || version, ',' order by part), '') from public.catering_refund_install_contracts where superseded_at is null) as records,
      (select count(*) from public.catering_refund_epochs)::int as epochs,
      (select bool_and(has_function_privilege('service_role', to_regprocedure('public.' || s), 'EXECUTE')) from unnest(array[
        'catering_refund_reserve_admitted(text,uuid,uuid,uuid,uuid,bigint,text,text,text)', 'catering_refund_claim_admitted(text,uuid,uuid,uuid)',
        'catering_refund_arm(text,uuid,uuid,uuid,uuid,bigint,text,text,boolean)', 'catering_refund_pass_begin(text,uuid,uuid)',
        'catering_refund_apply(text,uuid,uuid,bigint,jsonb)', 'catering_refund_event_register(text,text,text,uuid,boolean,text,text,bigint,bigint,bigint,boolean,jsonb)',
        'catering_refund_resolve_anomaly(text,uuid,bigint,text,text,uuid,text)', 'catering_refund_settlement_attach(text,uuid)']) s) as worker_ok,
      (to_regprocedure('public.catering_refund_finish_drain(uuid,bigint,text)') is not null) as lifecycle_ok,
      (select coalesce(string_agg(t, ',' order by t), '') from unnest(array[${CLEANED.map(q).join(',')}]::text[]) t
        where to_regclass('public.' || t) is null
           or not pg_has_role(current_user, (select relowner from pg_class where oid = to_regclass('public.' || t)), 'USAGE')
           or (select relforcerowsecurity from pg_class where oid = to_regclass('public.' || t))
           or exists (select 1 from pg_trigger tg where tg.tgrelid = to_regclass('public.' || t) and not tg.tgisinternal and (tg.tgtype & 8) <> 0)) as not_cleanable;
    commit;`);
  const r = rows[rows.length - 1];
  assert.equal(r?.installed, true, '0359 is not applied on this project');
  assert.ok(/(^|,)B1\/b1-1(,|$)/.test(r.records), `the B1 install record is not b1-1 (${r.records})`);
  assert.equal(r.epochs, 0, 'the project already has a refund epoch: this proof only runs on a sim that never opened one');
  assert.equal(r.worker_ok, true, 'service_role cannot execute the worker surface'); assert.equal(r.lifecycle_ok, true, 'finish_drain is missing');
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
  const recs = (await one(query, `select coalesce(string_agg(part, ',' order by part), '') as parts from public.catering_refund_install_contracts where superseded_at is null`)).parts.split(',');
  f.standIns = ['B2', 'B3'].filter(p => !recs.includes(p));
  log(`FIXTURE ${JSON.stringify(f)}`);
  let failed = 0;
  const step = async (name, fn) => {
    try { const detail = await fn(); log(`PASS ${name}${detail ? ` | ${detail}` : ''}`); }
    catch (error) { failed++; log(`FAIL ${name} | ${String(error?.message ?? error).slice(0, 400)}`); }
  };
  const race = (holder, racer, tag) => proveRace(query, holder, racer, `${f.tag}-${tag}`, { selfTest });
  const commitTx = (name, body, role = null) => query(transactionSQL(`${f.tag}-${name}`, body, { role })).then(parseOut);
  let fixtureMade = false;
  try {
    await step('fixture (committed, synthetic, tagged)', async () => { await query(fixtureSQL(f)); fixtureMade = true; return f.tag; });
    if (!fixtureMade) throw new Error('no fixture');

    await step('3b ADMISSION LOCK, seal first: finish_drain holds the exclusive admission lock; ingress waits, then refunds_sealed', async () => {
      const x = await race({ body: finishDrain(f, f.e1), role: null }, { body: capture(callInto(`public.catering_refund_event_register(${C}, ${q(f.evSeal)}, 'refund.created', null, false, ${q(f.pi[2])}, ${q(f.ch[2])}, extract(epoch from clock_timestamp())::bigint, null, null, null, '[]'::jsonb)`)), role: SVC }, '3b');
      assert.equal(x.holder?.ok?.closed, true, `the seal must close the drained fixture epoch (${JSON.stringify(x.holder)?.slice(0, 300)})`);
      assert.equal(x.racer?.err, 'refunds_sealed', `ingress after the seal must be refused refunds_sealed (${JSON.stringify(x.racer)})`);
      const s = await one(query, `select (select outcome from public.stripe_events where id = ${q(f.evSeal)}) as outcome,
        (select count(*) from public.catering_refund_event_work where event_id = ${q(f.evSeal)})::int as work,
        (select state || '/' || (ingress_sealed_at is not null)::text from public.catering_refund_epochs where id = ${q(f.e1)}) as epoch`);
      assert.deepEqual([s.outcome, s.work, s.epoch], [null, 0, 'closed/true'], 'the sealed ingress left no verdict and no work; the epoch is closed and sealed');
      return `blocked=${x.blocked}`;
    });

    await step('3a ADMISSION LOCK, ingress first: the ingress holds the shared lock; finish_drain waits, then does not close', async () => {
      await query(`begin; insert into public.catering_refund_epochs(id,state,manifest,opened_by,recovery_cutoff,recovery_complete_at,promoted_at,draining_at)
        values(${q(f.e2)},'draining',public.catering_refund_install_manifest(),${q(f.tag)},clock_timestamp(),clock_timestamp(),clock_timestamp(),clock_timestamp()); commit;`);
      const x = await race({ body: register(f, 2, f.evIngress, `re_sim0359lock_${hex()}`), role: SVC }, { body: finishDrain(f, f.e2), role: null }, '3a');
      assert.equal(x.holder?.ok?.state, 'attached', `the ingress must register and attach (${JSON.stringify(x.holder)})`);
      assert.equal(x.racer?.ok?.closed, false, `finish_drain must not close over the holder's event (${JSON.stringify(x.racer)?.slice(0, 300)})`);
      assert.ok((x.racer?.ok?.report?.outstanding_events ?? []).some(e => e.event_id === f.evIngress), 'the report lists the holder\'s event');
      const s = await one(query, `select state from public.catering_refund_epochs where id = ${q(f.e2)}`);
      assert.equal(s.state, 'draining');
      await query(`begin; update public.catering_refund_epochs set state = 'live', promoted_at = clock_timestamp(), draining_at = null where id = ${q(f.e2)}; commit;`);
      return `blocked=${x.blocked}`;
    });

    await step('1a LOCK ORDER, apply first: the apply holds the payment; reserve on the same order waits, then sees the complete pass', async () => {
      const x = await race({ body: passApply(f, 0), role: SVC },
        { body: reserve(f, 0, `(select jsonb_build_object('saw_pass', x.o_verified, 'captured', x.o_captured) from public.catering_refund_effective_figures(${q(f.p[0])}, null) x)`), role: SVC }, '1a');
      assert.equal(x.holder?.ok?.apply?.result, 'applied', `holder apply (${JSON.stringify(x.holder)?.slice(0, 300)})`);
      assert.equal(x.racer?.ok?.reserve?.requests?.length, 1, `the waiting reserve must succeed (${JSON.stringify(x.racer)?.slice(0, 300)})`);
      assert.equal(x.racer?.ok?.extra?.saw_pass, true, 'the reserve sees the holder\'s committed pass');
      assert.equal(Number(x.racer?.ok?.extra?.captured), 30000, 'with the capture the holder\'s apply verified');
      return `blocked=${x.blocked}`;
    });

    await step('1b LOCK ORDER, reserve first: the reserve holds the payment (then rolls back); the pass waits, then applies, no deadlock', async () => {
      const x = await race({ body: reserve(f, 0), role: SVC, end: 'rollback' }, { body: passApply(f, 0), role: SVC }, '1b');
      assert.equal(x.holder?.ok?.reserve?.requests?.length, 1, `holder reserve (${JSON.stringify(x.holder)?.slice(0, 300)})`);
      assert.equal(x.racer?.ok?.apply?.result, 'applied', `the waiting pass must apply (${JSON.stringify(x.racer)?.slice(0, 300)})`);
      assert.equal(x.racer?.ok?.begin?.requests?.length, 0, 'it sees the holder\'s final result: rolled back, no request');
      return `blocked=${x.blocked}`;
    });

    await step('2 GENERATION FENCING: a pass is staged; a new event moves the generation; the staged apply answers stale_generation', async () => {
      const x = await race({ body: capture(callInto(`public.catering_refund_pass_begin(${C}, ${q(f.p[1])}, gen_random_uuid())`)), role: SVC },
        { body: register(f, 1, f.evGen, `re_sim0359lock_${hex()}`), role: SVC, end: 'commit' }, '2');
      const b = x.holder?.ok;
      assert.equal(b?.result, 'begun', `holder pass_begin (${JSON.stringify(x.holder)})`);
      assert.equal(x.racer?.ok?.state, 'attached', `the waiting registration attaches (${JSON.stringify(x.racer)})`);
      const g = await one(query, `select generation from public.catering_refund_payment_work where payment_id = ${q(f.p[1])}`);
      assert.equal(Number(g.generation), Number(b.generation) + 1, 'the generation moved by one');
      const late = await query(transactionSQL(`${f.tag}-2-late`, capture(callInto(`public.catering_refund_apply(${C}, ${q(f.p[1])}, ${q(b.pass_token)}::uuid, ${Number(b.generation)}, ${evidence(f.pi[1], f.ch[1])})`)), { role: SVC, end: 'rollback' })).then(parseOut);
      assert.equal(late?.ok?.result, 'stale_generation', `the staged apply must be fenced (${JSON.stringify(late)})`);
      return `blocked=${x.blocked}`;
    });

    await step('4 TWO CLAIMS ON ONE REQUEST: exactly one claims', async () => {
      await query(`begin; insert into public.catering_refund_requests(id,payment_id,quote_id,location_id,client_token,amount_cents,reason_code,trigger_kind,requested_by)
        values(${q(f.r4)},${q(f.p[3])},${q(f.q[3])},${q(f.shop)},gen_random_uuid(),5000,'customer_cancelled','panel',${q(f.owner)}); commit;`);
      const x = await race({ body: claim(f, f.r4), role: SVC }, { body: claim(f, f.r4), role: SVC }, '4');
      assert.equal(x.holder?.ok?.claimed, true, `holder claim (${JSON.stringify(x.holder)})`);
      assert.deepEqual([x.racer?.ok?.claimed, x.racer?.ok?.reason], [false, 'in_progress'], `the second claim (${JSON.stringify(x.racer)})`);
      const s = await one(query, `select attempts, claim_token::text as t from public.catering_refund_requests where id = ${q(f.r4)}`);
      assert.deepEqual([s.attempts, s.t], [1, x.holder.ok.claim_token], 'one attempt, the holder\'s token');
      f.claimToken = x.holder.ok.claim_token;
      return `blocked=${x.blocked}`;
    });

    await step('5a ARM vs RELEASE, arm first: release_unsent waits, then is refused (the arm cleared the occurrence)', async () => {
      const pa = await commitTx('5-pass', passApply(f, 3), SVC);
      assert.equal(pa?.ok?.apply?.result, 'applied', `pre-pass on the payment (${JSON.stringify(pa)?.slice(0, 300)})`);
      const gen = Number(pa.ok.apply.generation);
      await query(`begin; insert into public.catering_refund_issues(id,code,payment_id,location_id,request_id,evidence_fingerprint,blocking,generation_at_open) values
        (${q(f.i4)},'reserved_not_sent',${q(f.p[3])},${q(f.shop)},${q(f.r4)},${q(`${f.tag}:r4`)},false,${gen}),
        (${q(f.i5)},'reserved_not_sent',${q(f.p[3])},${q(f.shop)},${q(f.r5)},${q(`${f.tag}:r5`)},false,${gen})
        on conflict do nothing;
        update public.sessions set step_up_unlocked = true, step_up_unlocked_at = clock_timestamp() where id = ${q(f.session)}; commit;`.replace(
        'insert into public.catering_refund_issues', `insert into public.catering_refund_requests(id,payment_id,quote_id,location_id,client_token,amount_cents,reason_code,trigger_kind,requested_by)
        values(${q(f.r5)},${q(f.p[3])},${q(f.q[3])},${q(f.shop)},gen_random_uuid(),4000,'customer_cancelled','panel',${q(f.owner)});
        insert into public.catering_refund_issues`));
      const x = await race({ body: arm(f, f.r4, f.claimToken, gen), role: SVC }, { body: releaseUnsent(f, f.i4, gen), role: SVC }, '5a');
      assert.equal(x.holder?.ok?.result, 'armed', `holder arm (${JSON.stringify(x.holder)})`);
      assert.equal(x.racer?.err, 'issue_closed', `release_unsent of an armed row must be refused (${JSON.stringify(x.racer)})`);
      const s = await one(query, `select status, create_armed_at is not null as armed, (select state from public.catering_refund_issues where id = ${q(f.i4)}) as issue
        from public.catering_refund_requests where id = ${q(f.r4)}`);
      assert.deepEqual([s.status, s.armed, s.issue], ['pending', true, 'resolved'], 'exactly one won: armed, still pending, its "reserved, not sent" occurrence cleared by the arm');
      f.gen = gen;
      return `blocked=${x.blocked}`;
    });

    await step('5b ARM vs RELEASE, release first: arm waits, then answers not_pending', async () => {
      await query(`begin; update public.sessions set step_up_unlocked_at = clock_timestamp() where id = ${q(f.session)}; commit;`);
      const x = await race({ body: releaseUnsent(f, f.i5, f.gen), role: SVC }, { body: arm(f, f.r5, null, f.gen), role: SVC }, '5b');
      assert.equal(x.holder?.ok?.result, 'ok', `holder release_unsent (${JSON.stringify(x.holder)})`);
      assert.equal(x.racer?.ok?.result, 'not_pending', `arm after the release (${JSON.stringify(x.racer)})`);
      const s = await one(query, `select status, last_error_code, create_armed_at is null as never_armed from public.catering_refund_requests where id = ${q(f.r5)}`);
      assert.deepEqual([s.status, s.last_error_code, s.never_armed], ['failed', 'released_unsent', true], 'exactly one won: released, never armed');
      return `blocked=${x.blocked}`;
    });

    // ── Fix round 2 (F5): ONE lock order, payment -> event. The event is a recovery SEED whose payment is settling.
    const seedRow = ev => `begin; update public.stripe_events set outcome = 'processing_failed' where id = ${q(ev)};
      insert into public.catering_refund_event_work(event_id,event_type,source,livemode,payment_intent_id,state)
        values(${q(ev)},'refund.created','recovery_seed',false,${q(f.pi[4])},'unmatched'); commit;`;
    const deliver = ev => capture(callInto(`public.catering_refund_event_register(${C}, ${q(ev)}, 'refund.created', null, false, ${q(f.pi[4])}, ${q(f.ch[4])},
      extract(epoch from clock_timestamp())::bigint, null, null, null, jsonb_build_array(jsonb_build_object('id', ${q(`re_sim0359lock_${hex()}`)}, 'status', 'pending')))`));
    const attach = `public.catering_refund_settlement_attach(${C}, ${q(f.p[4])})`;
    const noDeadlock = x => {
      for (const side of [x.holder, x.racer]) {
        assert.ok(!side?.err, `no session may be aborted (a deadlock is 40P01): ${JSON.stringify(side)?.slice(0, 300)}`);
      }
    };

    await step('6a LOCK ORDER payment -> event, settlement first: the settlement holds the payment, pauses, then attaches the event; the delivery waits on the PAYMENT (holding nothing), then promotes; no deadlock', async () => {
      await query(seedRow(f.evOrderA));
      // The holder takes the payment lock FIRST and only later asks for the event: exactly the interleaving in which a
      // delivery that locked the event first would close the cycle.
      const holder = capture(`perform 1 from public.catering_payments p where p.id = ${q(f.p[4])} for no key update;
        perform pg_sleep(${selfTest ? 0 : 4});
        r := ${attach};`);
      const x = await race({ body: holder, role: null }, { body: deliver(f.evOrderA), role: SVC, end: 'commit' }, '6a');
      noDeadlock(x);
      assert.deepEqual([x.holder?.ok?.result, x.holder?.ok?.events], ['attached', [f.evOrderA]], `the settlement attached the seed (${JSON.stringify(x.holder)?.slice(0, 300)})`);
      assert.deepEqual([x.racer?.ok?.result, x.racer?.ok?.state], ['registered', 'attached'], `the delivery then promoted it (${JSON.stringify(x.racer)?.slice(0, 300)})`);
      const s = await one(query, `select e.source, e.state, e.payment_id::text as payment, (select outcome from public.stripe_events where id = e.event_id) as outcome
        from public.catering_refund_event_work e where e.event_id = ${q(f.evOrderA)}`);
      assert.deepEqual([s.source, s.state, s.payment, s.outcome], ['ingress', 'attached', f.p[4], 'refund_state_owed'], 'one event row: ingress, attached to its payment, verdict stamped');
      return `blocked=${x.blocked}`;
    });

    await step('6b LOCK ORDER payment -> event, delivery first: the delivery holds payment then event; the settlement attach waits on the payment, then attaches nothing twice', async () => {
      await query(seedRow(f.evOrderB));
      const x = await race({ body: deliver(f.evOrderB), role: SVC }, { body: capture(callInto(attach)), role: SVC, end: 'commit' }, '6b');
      noDeadlock(x);
      assert.deepEqual([x.holder?.ok?.result, x.holder?.ok?.state], ['registered', 'attached'], `holder delivery (${JSON.stringify(x.holder)?.slice(0, 300)})`);
      assert.deepEqual([x.racer?.ok?.result, x.racer?.ok?.events], ['attached', []], `the waiting settlement finds nothing left to attach (${JSON.stringify(x.racer)?.slice(0, 300)})`);
      const s = await one(query, `select count(*)::int as n from public.catering_refund_event_work where payment_id = ${q(f.p[4])} and state = 'attached' and source = 'ingress'`);
      assert.equal(s.n, 2, 'both seeded events are attached once, as ingress');
      return `blocked=${x.blocked}`;
    });
  } finally {
    await step('cleanup: every fixture and committed-step row deleted; a second read proves 0 left', async () => {
      await query(cleanupSQL(f));
      const s = await one(query, leftoverSQL(f));
      assert.equal(s.leftovers, 0, `rows left: ${s.leftovers} (fixture ids above)`);
      assert.equal(s.epochs_now, 0, 'an epoch is left on the project');
      return 'leftovers=0, epochs=0';
    });
  }
  log(failed ? `FAIL refund-0359 lock check: ${failed} step(s) failed${selfTest ? ' (self-test, single session)' : ''}` : `PASS refund-0359 lock check: all steps${selfTest ? ' (SELF-TEST, single session on PGlite: SQL and committed outcomes only, no lock wait observed)' : ' with observed waits'}`);
  return failed;
}

/** OFFLINE: the same fixture, statements and committed outcomes on PGlite (the harness's real 0357 -> 0358 -> 0359). */
export async function selfTest(log = console.log) {
  const H = await import('../sql-harness-0359-lib.mjs');
  const db = await H.base();
  await db.exec(`alter table public.users add column pin_hash text not null;
    alter table public.sessions add column token_hash text not null unique, add column auth_method text not null check (auth_method in ('pin', 'password'));
    alter table public.locations add column name text, add column type text;`);
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
    console.error(`FAIL refund-0359 lock check: ${String(error?.message ?? error).slice(0, 300)} (check the SIM target, the pre-flight, connectivity; an interrupted run may leave the printed fixture ids to delete by hand)`);
    process.exitCode = 1;
  });
}
