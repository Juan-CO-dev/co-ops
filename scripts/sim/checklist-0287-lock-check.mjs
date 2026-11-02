/** FILE ONLY: CC runs after 0287 on SIM. Never loads .env.
 * node scripts/sim/checklist-0287-lock-check.mjs --actor=UUID --authority=UUID
 *   --instance=UUID --quick-item=UUID --old-completion=UUID
 *
 * Prepare one disposable OPEN 2099+ instance, no final submission; a generic
 * old completion (>60s) by actor, and a DIFFERENT generic numeric quick-item.
 * Both actors must be active KH+ members; authority must be at least actor's
 * level. Quick-item must permit actor. Do not use operational fixtures.
 *
 * All 36 ordered pairings of six parent-serialized writers run on independent
 * connections. A executes the REAL writer; B must block on A, proven with
 * pg_blocking_pids. A rolls back; B must then succeed and also rolls back.
 * Rollback matrix proves blocking in both directions, not committed-winner
 * semantics. A final committed confirm then proves all corrections refuse.
 * Each pairing commits a fresh quick-item replacement through the real writer
 * (different count prevents notes-only timestamp carry). That append-only
 * fixture history and the final confirmation remain. No deletion/reset.
 * A separate race commits a reason revoke while a filtered confirm waits:
 * transitional dual-accept CAN accept that stale snapshot. This is explicitly
 * demonstrated, NOT claimed closed; filtered-only tightening is still needed.
 * No real database is contacted by CI. PGlite cannot establish these waits.
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { simDatabaseTarget } from '../sim-0270-0271-lock-check-lib.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WRITE = `select public.checklist_write_completion($1::uuid,$2::uuid,$3::uuid,$4::numeric,null::uuid,'SIM 0287 lock proof') as result`;
const CONFIRM = `select public.checklist_confirm_instance($1::uuid,$2::uuid,clock_timestamp(),'[]'::jsonb,$3::uuid[]) as result`;
const REVOKE = `select public.checklist_revoke_completion($1::uuid,$2::uuid) as result`;
const REASON = `select public.checklist_revoke_with_reason($1::uuid,$2::uuid,'other','SIM 0287 lock proof') as result`;
const AUTHORITY = `select public.checklist_mark_not_done($1::uuid,$2::uuid,'SIM 0287 lock proof') as result`;
const SUBMIT = `select public.checklist_submit_batch($1::uuid,$2::uuid,$3::uuid[]) as result`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const race = (client, call) => client.query(call.sql, call.params).then(
  value => ({ ok: true, value }), error => ({ ok: false, code: error.code, message: error.message }));

export async function main() {
  const target = simDatabaseTarget(process.env.SIM_DATABASE_URL);
  if (!target.ok) throw new Error('SIM target refused');
  const names = ['actor','authority','instance','quick-item','old-completion'];
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (!match || !names.includes(match[1]) || args[match[1]] || !UUID.test(match[2])) {
      throw new Error('Require exactly actor, authority, instance, quick-item, old-completion UUID arguments');
    }
    args[match[1]] = match[2].toLowerCase();
  }
  assert.ok(names.every(name => args[name]), 'all fixture arguments required');
  assert.notEqual(args.actor, args.authority);
  const { default: pg } = await import('pg'); // Only after target and args validated.
  const clients = Array.from({ length: 3 }, () => new pg.Client(target.config));
  const [a,b,observer] = clients;
  const connected = [];
  const begin = async client => {
    await client.query('begin isolation level read committed');
    await client.query("set local statement_timeout='15s'");
    await client.query("set local lock_timeout='12s'");
    await client.query('set local role service_role');
  };
  const snapshot = async () => (await observer.query(`select id from public.checklist_completions
    where instance_id=$1 and superseded_at is null and revoked_at is null order by id`, [args.instance])).rows.map(r => r.id);
  let counter = 0;
  const freshQuick = async () => {
    // Different from the stored numeric value, including after a partially run proof.
    const row = (await observer.query(`select count_value from public.checklist_completions
      where instance_id=$1 and template_item_id=$2 and superseded_at is null and revoked_at is null`,
    [args.instance,args['quick-item']])).rows;
    assert.ok(row.length <= 1, 'quick item has at most one generic live head');
    const count = Number(row[0]?.count_value ?? 0) === 1 ? 2 : 1;
    await begin(a);
    const result = await a.query(WRITE,[args.actor,args.instance,args['quick-item'],count]);
    await a.query('commit');
    counter++;
    return result.rows[0].result.completion.id;
  };
  const calls = (quick, expected) => ({
    replace: {sql:WRITE,params:[args.actor,args.instance,args['quick-item'],3]},
    submit: {sql:SUBMIT,params:[args.actor,args.instance,[args['old-completion']]]},
    confirm: {sql:CONFIRM,params:[args.actor,args.instance,expected]},
    revoke: {sql:REVOKE,params:[quick,args.actor]},
    reason: {sql:REASON,params:[args['old-completion'],args.actor]},
    authority: {sql:AUTHORITY,params:[args['old-completion'],args.authority]},
  });
  try {
    for (const client of clients) { await client.connect(); connected.push(client); }
    await observer.query('set default_transaction_read_only=on');
    const pidA = (await a.query('select pg_backend_pid() as pid')).rows[0].pid;
    const pidB = (await b.query('select pg_backend_pid() as pid')).rows[0].pid;
    assert.notEqual(pidA,pidB,'independent backends');
    const blocked = async () => {
      for (const start=Date.now(); Date.now()-start<5000; await pause(25)) {
        if ((await observer.query('select $1::int=any(pg_blocking_pids($2::int)) as blocked',[pidA,pidB])).rows[0].blocked) return;
      }
      assert.fail('B did not block on A');
    };
    const fixture = (await observer.query(`select i.id from public.checklist_instances i
      join public.checklist_completions c on c.instance_id=i.id and c.id=$2
      join public.checklist_template_items old_item on old_item.id=c.template_item_id
      join public.checklist_template_items quick_item on quick_item.id=$3 and quick_item.template_id=i.template_id
      where i.id=$1 and i.status='open' and i.date>=date '2099-01-01'
      and c.completed_by=$4 and c.completed_at<clock_timestamp()-interval '60 seconds'
      and c.revoked_at is null and c.superseded_at is null and c.prep_data is null
      and old_item.report_reference_type is null and quick_item.report_reference_type is null
      and old_item.id<>quick_item.id and quick_item.input_type is null and quick_item.expects_count
      and not exists(select 1 from public.checklist_completions r where r.instance_id=i.id
        and r.superseded_at is null and r.revoked_at is not null)
      and not exists(select 1 from public.checklist_submissions s where s.instance_id=i.id and s.is_final_confirmation)`,
    [args.instance,args['old-completion'],args['quick-item'],args.actor])).rows;
    assert.equal(fixture.length,1,'disposable generic fixture required');
    // Probe every writer before the matrix, refusing unsuitable authorization.
    let quick = await freshQuick();
    let operations = calls(quick,await snapshot());
    for (const call of Object.values(operations)) {
      await begin(a); await a.query(call.sql,call.params); await a.query('rollback');
    }
    for (const first of Object.keys(operations)) for (const second of Object.keys(operations)) {
      quick = await freshQuick();
      operations = calls(quick,await snapshot());
      await begin(a);
      await a.query(operations[first].sql,operations[first].params);
      await begin(b);
      const waiter = race(b,operations[second]);
      await blocked();
      await a.query('rollback');
      const result = await waiter;
      assert.equal(result.ok,true,`${first} -> ${second}: waiter must succeed after rollback (${result.message ?? ''})`);
      await b.query('rollback');
      console.log(`PASS ordered lock pair ${first} -> ${second}`);
    }
    // Transitional limitation: identical legacy IDs cannot identify a new caller.
    operations = calls(quick,await snapshot());
    await begin(a); await a.query(REASON,operations.reason.params);
    await begin(b); const stale = race(b,operations.confirm);
    await blocked(); await a.query('commit');
    assert.equal((await stale).ok,true,'dual-accept currently accepts ambiguous pre-revoke snapshot');
    await b.query('rollback');
    console.log('KNOWN TRANSITION LIMIT: filtered snapshot before revoke matched legacy IDs after revoke');
    // Refreshed confirm commits; every correction must refuse the closed parent.
    await begin(a); await a.query(CONFIRM,[args.actor,args.instance,await snapshot()]); await a.query('commit');
    for (const name of ['revoke','reason','authority']) {
      await begin(b); const result = await race(b,operations[name]);
      assert.equal(result.ok,false); assert.equal(result.code,'P0001');
      assert.equal(result.message,'instance_not_open'); await b.query('rollback');
    }
    console.log('PASS 0287: 36 ordered lock pairs; committed confirm refuses all three corrections');
  } finally {
    for (const client of connected) await client.query('rollback').catch(()=>{});
    for (const client of connected) await client.end().catch(()=>{});
    console.log(`SIM fixture retained: ${args.instance}; ${counter} quick replacement commits; no deletion/reset`);
  }
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().catch(()=>{
    // Never print driver errors or a credential-bearing connection string.
    console.error('FAIL 0287 sim proof (target, fixture, connection, or invariant); no credentials logged');
    process.exitCode=1;
  });
}
