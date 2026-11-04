/** FILE ONLY: CC runs after 0290 on SIM. Never loads .env. Do not run in CI.
 * node scripts/sim/checklist-0290-lock-check.mjs --actor=UUID --closing=UUID
 *   --am=UUID --ref-item=UUID --generic-completion=UUID
 * Prepare disposable 2099+ OPEN AM + closing instances at the same shop/day.
 * Ref-item is the closing am_prep reference with exactly one unrevoked head.
 * Generic-completion is an old (>60s) generic row on closing, authored by actor.
 * Actor must be active KH+ with membership and permission to confirm closing.
 * AM must have no completions/submissions: submit uses an empty entries array.
 * Every writer is real; all transactions ROLLBACK, preserving fixtures.
 * Six ordered pairs prove parent blocking via independent backends and
 * pg_blocking_pids, not merely elapsed time. Rollbacks prove lock ordering,
 * not committed-winner semantics (covered separately by the SQL harness).
 * Revoke targets a generic row sharing the parent: 0287 refuses reference
 * corrections. That refusal is also probed explicitly before the matrix.
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { simDatabaseTarget } from '../sim-0270-0271-lock-check-lib.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function main() {
  const target = simDatabaseTarget(process.env.SIM_DATABASE_URL);
  if (!target.ok) throw new Error('SIM target refused');
  const names = ['actor','closing','am','ref-item','generic-completion'];
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (!match || !names.includes(match[1]) || args[match[1]] || !UUID.test(match[2])) throw new Error('Invalid fixture arguments');
    args[match[1]] = match[2].toLowerCase();
  }
  assert.ok(names.every(name => args[name]), 'all fixture arguments required');
  assert.notEqual(args.am,args.closing);
  const { default: pg } = await import('pg');
  const clients = Array.from({length:3}, () => new pg.Client(target.config));
  const [a,b,observer] = clients;
  const connected = [];
  const begin = async client => {
    await client.query('begin isolation level read committed');
    await client.query("set local statement_timeout='15s'");
    await client.query("set local lock_timeout='12s'");
    await client.query('set local role service_role');
  };
  const invoke = (client,call) => client.query(call.sql,call.params);
  try {
    for (const client of clients) { await client.connect(); connected.push(client); }
    await observer.query('set default_transaction_read_only=on');
    const fixture = (await observer.query(`select c.id from public.checklist_instances c
      join public.checklist_instances am on am.location_id=c.location_id and am.date=c.date
      join public.checklist_template_items item on item.template_id=c.template_id and item.id=$3
      join public.checklist_completions g on g.instance_id=c.id and g.id=$4
      join public.checklist_template_items gi on gi.id=g.template_item_id
      where c.id=$1 and am.id=$2 and c.status='open' and am.status='open'
      and c.date>=date '2099-01-01' and item.report_reference_type='am_prep'
      and gi.report_reference_type is null and g.prep_data is null
      and g.completed_by=$5 and g.completed_at<clock_timestamp()-interval '60 seconds'
      and g.revoked_at is null and g.superseded_at is null
      and not exists(select 1 from public.checklist_completions x where x.instance_id=am.id)
      and not exists(select 1 from public.checklist_submissions s where s.instance_id in (c.id,am.id))`,
    [args.closing,args.am,args['ref-item'],args['generic-completion'],args.actor])).rows;
    assert.equal(fixture.length,1,'disposable empty AM and unsubmitted closing fixtures required');
    const heads = (await observer.query(`select id,auto_complete_meta,revoked_at from public.checklist_completions
      where instance_id=$1 and template_item_id=$2 and superseded_at is null`,[args.closing,args['ref-item']])).rows;
    assert.equal(heads.length,1,'one reference head required');
    const head = heads[0];
    assert.equal(head.revoked_at,null);
    const expected = (await observer.query(`select id from public.checklist_completions
      where instance_id=$1 and superseded_at is null and revoked_at is null order by id`,[args.closing])).rows.map(row=>row.id);
    const meta = {...head.auto_complete_meta,reportType:'am_prep',reportInstanceId:args.am,
      reportSubmittedAt:'2199-01-01T00:00:00.000Z'};
    const calls = {
      replace:{sql:'select public.checklist_replace_closing_ref($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::jsonb)',
        params:[args.closing,args['ref-item'],args.actor,head.id,JSON.stringify(meta)]},
      confirm:{sql:"select public.checklist_confirm_instance($1::uuid,$2::uuid,clock_timestamp(),'[]'::jsonb,$3::uuid[])",
        params:[args.actor,args.closing,expected]},
      revoke:{sql:"select public.checklist_revoke_with_reason($1::uuid,$2::uuid,'other','SIM 0290 lock proof')",
        params:[args['generic-completion'],args.actor]},
      am:{sql:"select public.submit_am_prep_atomic($1::uuid,$2::uuid,'[]'::jsonb,$3::uuid,false,null::uuid,null::jsonb,null::text,null::text)",
        params:[args.am,args.actor,args['ref-item']]},
    };
    // Refuse a report-reference correction without relying on UI constraints.
    await begin(a);
    await assert.rejects(a.query(calls.revoke.sql,[head.id,args.actor]),error=>error.code==='P0001' && error.message==='reference_row_not_correctable');
    await a.query('rollback');
    // Exercise the revised AM skip contract with temporary legacy fixtures.
    // Generic corrections cannot create a revoked reference under 0287.
    for (const reason of ['closing_ref_revoked','closing_ref_multiple_heads']) {
      await begin(a);
      await a.query('select id from public.checklist_instances where id=$1 for no key update',[args.am]);
      await a.query('select id from public.checklist_instances where id=$1 for no key update',[args.closing]);
      if (reason==='closing_ref_revoked') {
        await a.query('update public.checklist_completions set revoked_at=clock_timestamp() where id=$1',[head.id]);
      } else {
        await a.query(`insert into public.checklist_completions(instance_id,template_item_id,completed_by,completed_at,revoked_at)
          values($1,$2,$3,clock_timestamp(),clock_timestamp())`,[args.closing,args['ref-item'],args.actor]);
      }
      const readHeads=()=>a.query('select * from public.checklist_completions where instance_id=$1 and template_item_id=$2 order by id',[args.closing,args['ref-item']]);
      const before=(await readHeads()).rows;
      const result=(await invoke(a,calls.am)).rows[0].submit_am_prep_atomic;
      assert.equal(result.autoCompleteId,null);
      assert.equal(result.instance.status,'confirmed');
      assert.deepEqual(result.closingRefSkip,{instanceId:args.closing,itemId:args['ref-item'],reason});
      assert.deepEqual((await readHeads()).rows,before);
      await a.query('rollback');
    }
    // Fail before racing if a fixture cannot exercise any real writer.
    for (const call of Object.values(calls)) {
      await begin(a); await invoke(a,call); await a.query('rollback');
    }
    const pidA = (await a.query('select pg_backend_pid() as pid')).rows[0].pid;
    const pidB = (await b.query('select pg_backend_pid() as pid')).rows[0].pid;
    assert.notEqual(pidA,pidB);
    for (const other of ['confirm','revoke','am']) for (const [first,second] of [['replace',other],[other,'replace']]) {
      await begin(a); await invoke(a,calls[first]);
      await begin(b);
      const waiter = invoke(b,calls[second]).then(value=>({ok:true,value}),()=>({ok:false}));
      let blocked = false;
      for (const start=Date.now(); Date.now()-start<5000; await pause(25)) {
        if ((await observer.query('select $1::int=any(pg_blocking_pids($2::int)) as blocked',[pidA,pidB])).rows[0].blocked) { blocked=true; break; }
      }
      assert.ok(blocked,`${first} -> ${second}: B must block on A`);
      await a.query('rollback');
      assert.equal((await waiter).ok,true,`${first} -> ${second}: succeeds after rollback`);
      await b.query('rollback');
      console.log(`PASS ordered lock pair ${first} -> ${second}`);
    }
    console.log('PASS 0290: six ordered pairs; reference correction refused; all writes rolled back');
  } finally {
    for (const client of connected) await client.query('rollback').catch(()=>{});
    for (const client of connected) await client.end().catch(()=>{});
  }
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().catch(()=>{ console.error('FAIL 0290 sim proof (target, fixture, connection, or invariant); no credentials logged'); process.exitCode=1; });
}
