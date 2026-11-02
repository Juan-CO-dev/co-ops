/** FILE ONLY: CC runs after 0287 on SIM. Never loads .env or a direct DB URL.
 * SUPABASE_ACCESS_TOKEN=<operator environment>; node scripts/sim/checklist-0287-lock-check-management.mjs --ref=jepgzucrvklhqpthowsc
 * Self-allocated SIM-0287 fixtures only; history retained, own config retired.
 * No retries: interrupted requests may have committed; printed IDs let CC retire
 * stranded fixtures manually. Never reuse operational users, shops or history.
 * Each API request owns ONE transaction. Matrix A calls the real writer, sleeps
 * holding its locks, then ROLLS BACK; B calls the real writer and rolls back too.
 * The 0276 observer proves an ungranted lock with A as blocker plus elapsed wait.
 * All 27 requested ordered pairs are expressible, including correction self-pairs.
 * SKIP the 9 non-correction/non-correction pairs: outside this correction proof.
 * No interactive transaction continuation is possible/attempted over this API.
 * Matrix proves serialization, not committed-winner semantics. Separate committed
 * confirmation/refusal and dual-accept checks cover those functional contracts.
 * Dual-accept intentionally still accepts ambiguous pre-revoke snapshots; this
 * harness does NOT claim filtered-only stale-revoke detection or app gate proof.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { literal as q, managementQuery, projectRef } from '../supabase-management-query.mjs';
import { preflightManagement } from '../preflight-0276-management.mjs';
import { proveRace, transactionSQL } from './checklist-0276-lock-check-management.mjs';

export const corrections = ['revoke', 'reason', 'authority'];
export const writers = ['replace', 'submit', 'confirm', ...corrections];
export const pairings = writers.flatMap(a => writers.filter(b => corrections.includes(a) || corrections.includes(b)).map(b => [a,b]));
export function fixture() {
  const f = Object.fromEntries(['actor','authority','shop','template','item','quickItem','referenceItem','prepItem'].map(k => [k,randomUUID()]));
  f.tag = `SIM-0287-${f.template}`;
  f.cases = Array.from({length: pairings.length + 4}, () => Object.fromEntries(['instance','old','reference','prep'].map(k => [k,randomUUID()])));
  return f;
}
export function fixtureSQL(f) {
  return `begin;
    insert into public.locations(id,name,code,type,active) values(${q(f.shop)},${q(f.tag)},${q(f.tag)},'permanent',true);
    insert into public.users(id,name,role,pin_hash,active) values
      ${[f.actor,f.authority].map(id => `(${q(id)},${q(f.tag)},'key_holder','SIM-NO-VALID-CREDENTIAL',true)`).join(',')};
    insert into public.user_locations(user_id,location_id,active) values
      (${q(f.actor)},${q(f.shop)},true),(${q(f.authority)},${q(f.shop)},true);
    insert into public.checklist_templates(id,location_id,type,name,active) values(${q(f.template)},${q(f.shop)},'closing',${q(f.tag)},true);
    insert into public.checklist_template_items(id,template_id,label,min_role_level,active,expects_count,report_reference_type) values
      ${[f.item,f.quickItem,f.referenceItem,f.prepItem].map(id => `(${q(id)},${q(f.template)},${q(f.tag)},3,true,true,${id===f.referenceItem ? "'cash_report'" : 'null'})`).join(',')};
    insert into public.checklist_instances(id,template_id,location_id,date,status) values
      ${f.cases.map((c,i) => `(${q(c.instance)},${q(f.template)},${q(f.shop)},date '2099-01-01'+${i},'open')`).join(',')};
    insert into public.checklist_completions(id,instance_id,template_item_id,completed_by,completed_at,count_value,notes,prep_data) values
      ${f.cases.map(c => `(${q(c.old)},${q(c.instance)},${q(f.item)},${q(f.actor)},clock_timestamp()-interval '2 minutes',1,${q(f.tag)},null)`).join(',')},
      (${q(f.cases.at(-1).reference)},${q(f.cases.at(-1).instance)},${q(f.referenceItem)},${q(f.actor)},clock_timestamp()-interval '2 minutes',null,${q(f.tag)},null),
      (${q(f.cases.at(-1).prep)},${q(f.cases.at(-1).instance)},${q(f.prepItem)},${q(f.actor)},clock_timestamp()-interval '2 minutes',null,${q(f.tag)},'{"phase1":true}');
    commit;`;
}
export function retireSQL(f) {
  return `begin;
    update public.checklist_template_items set active=false where template_id=${q(f.template)} and id in (${[f.item,f.quickItem,f.referenceItem,f.prepItem].map(q).join(',')});
    update public.checklist_templates set active=false where id=${q(f.template)} and name=${q(f.tag)};
    update public.user_locations set active=false where location_id=${q(f.shop)} and user_id in (${q(f.actor)},${q(f.authority)});
    update public.users set active=false where id in (${q(f.actor)},${q(f.authority)}) and name=${q(f.tag)};
    update public.locations set active=false where id=${q(f.shop)} and code=${q(f.tag)}; commit;`;
}
export const confirmSQL = (f,c,ids) => `select public.checklist_confirm_instance(${q(f.actor)},${q(c.instance)},clock_timestamp(),'[]',array[${ids.map(q).join(',')}]::uuid[]) as result`;
export function correctionSQL(name,f,id) {
  if(name==='revoke') return `select public.checklist_revoke_completion(${q(id)},${q(f.actor)}) as result`;
  if(name==='reason') return `select public.checklist_revoke_with_reason(${q(id)},${q(f.actor)},'other',${q(f.tag)}) as result`;
  assert.equal(name,'authority');
  return `select public.checklist_mark_not_done(${q(id)},${q(f.authority)},${q(f.tag)}) as result`;
}
export function calls(f,c,quick) {
  return {
    replace: `select public.checklist_write_completion(${q(f.actor)},${q(c.instance)},${q(f.quickItem)},3,null,${q(f.tag)}) as result`,
    submit: `select public.checklist_submit_batch(${q(f.actor)},${q(c.instance)},array[${q(c.old)}]::uuid[]) as result`,
    confirm: confirmSQL(f,c,[c.old,quick]),
    ...Object.fromEntries(corrections.map(name => [name,correctionSQL(name,f,name==='revoke'?quick:c.old)])),
  };
}
/** Catch only the expected P0001 INSIDE a subtransaction; unexpected errors and
 * unexpected success abort. Never expose arbitrary SQL error text via transport. */
export function refusalSQL(sql,expected) {
  assert.ok(['instance_not_open','reference_row_not_correctable','prep_data_not_correctable'].includes(expected));
  return `do $proof$ begin
    begin ${sql.replace(/^select /,'perform ').replace(/ as result$/,'')};
    exception when sqlstate 'P0001' then
      if sqlerrm = ${q(expected)} then return; end if; raise;
    end;
    raise exception 'expected refusal missing' using errcode='XX000';
  end $proof$`;
}
/** Reuse 0276's race observer unchanged; only transaction termination differs.
 * Reads pass through. No request/session is resumed and no query is retried. */
export function rollbackQuery(query) {
  return sql => query(sql.startsWith('begin isolation level read committed;') ? sql.replace(/commit;$/, 'rollback;') : sql);
}

export const requiredColumns = {
  locations:['id','name','code','type','active'], users:['id','name','role','pin_hash','active'],
  user_locations:['user_id','location_id','active'], checklist_templates:['id','location_id','type','name','active'],
  checklist_template_items:['id','template_id','label','min_role_level','active','expects_count','report_reference_type'],
  checklist_instances:['id','template_id','location_id','date','status'],
  checklist_completions:['id','instance_id','template_item_id','completed_by','completed_at','count_value','notes','prep_data'],
};
export async function fixturePreflight(query) {
  const tables = Object.keys(requiredColumns).map(q).join(',');
  const columns = await query(`select table_name,column_name,is_nullable,column_default,is_identity,is_generated from information_schema.columns where table_schema='public' and table_name in (${tables})`);
  for(const [table,names] of Object.entries(requiredColumns)) for(const name of names) {
    assert.ok(columns.some(c => c.table_name===table && c.column_name===name),'fixture schema must contain every inserted column');
  }
  for(const c of columns) assert.ok(c.is_nullable!=='NO' || c.column_default!=null || c.is_identity==='YES'
    || c.is_generated==='ALWAYS' || requiredColumns[c.table_name]?.includes(c.column_name),'fixture schema has omitted required column');
  const enums = await query(`select c.relname as table_name,a.attname as column_name,e.enumlabel
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    join pg_type t on t.oid=a.atttypid join pg_enum e on e.enumtypid=t.oid
    where n.nspname='public' and c.relname in (${tables})`);
  const values = {'locations.type':'permanent','users.role':'key_holder','checklist_templates.type':'closing',
    'checklist_instances.status':'open','checklist_template_items.report_reference_type':'cash_report'};
  for(const e of enums) {
    if(!requiredColumns[e.table_name]?.includes(e.column_name)) continue;
    assert.ok(values[`${e.table_name}.${e.column_name}`] && enums.some(v => v.table_name===e.table_name
      && v.column_name===e.column_name && v.enumlabel===values[`${e.table_name}.${e.column_name}`]),'fixture enum label mismatch');
  }
}

export async function runProof(query,log=console.log,raceOptions={}) {
  // Must be the FIRST request, before any fixture allocation/emission.
  await preflightManagement(query);
  await fixturePreflight(query);
  const f = fixture();
  log(`FIXTURE allocated ${JSON.stringify(f)}`);
  const check = async (name,fn) => {
    try { await fn(); log(`PASS ${name}`); }
    catch(error) { log(`FAIL ${name}`); throw error; }
  };
  const transact = sql => query(transactionSQL(`${f.tag}-fn`,sql));
  const heads = async c => (await query(`select id from public.checklist_completions where instance_id=${q(c.instance)} and superseded_at is null order by id`)).map(r=>r.id);
  const freshQuick = async c => {
    const rows = await transact(`select public.checklist_write_completion(${q(f.actor)},${q(c.instance)},${q(f.quickItem)},1,null,${q(f.tag)}) as result`);
    const id=rows[0]?.result?.completion?.id;
    assert.match(id ?? '',/^[0-9a-f-]{36}$/i,'writer must return quick completion UUID');
    log(`FIXTURE quick ${c.instance} ${id}`);
    return id;
  };
  const attest = async c => {
    const rows=await query(`select status,confirmed_by,(select count(*)::int from public.checklist_submissions s where s.instance_id=i.id and s.is_final_confirmation) as finals from public.checklist_instances i where id=${q(c.instance)}`);
    assert.equal(rows[0]?.status,'confirmed'); assert.equal(rows[0]?.confirmed_by,f.actor); assert.equal(rows[0]?.finals,1);
  };
  try {
    await check('fixture creation',()=>query(fixtureSQL(f)));
    log('SKIP 9 non-correction writer pairs: outside correction matrix; no requested correction pairing skipped');
    for(const [i,[a,b]] of pairings.entries()) {
      await check(`ordered lock pair ${a} -> ${b}`,async()=>{
        const c=f.cases[i], quick=await freshQuick(c), ops=calls(f,c,quick);
        const result=await proveRace(rollbackQuery(query),ops[a],ops[b],`${f.tag}-${i}`,raceOptions);
        assert.equal(result.ok,true,'waiter must succeed after holder rollback');
        const rows=await query(`select status,(select count(*)::int from public.checklist_submissions s where s.instance_id=i.id) as submissions,
          (select count(*)::int from public.checklist_completions c where c.instance_id=i.id and (c.revoked_at is not null or c.superseded_at is not null)) as changed
          from public.checklist_instances i where id=${q(c.instance)}`);
        assert.equal(rows[0]?.status,'open'); assert.equal(rows[0]?.submissions,0); assert.equal(rows[0]?.changed,0);
        assert.deepEqual((await heads(c)).sort(),[c.old,quick].sort());
      });
    }
    const closed=f.cases.at(-4), quick=await freshQuick(closed);
    await check('committed confirmation',async()=>{ await transact(confirmSQL(f,closed,[closed.old,quick])); await attest(closed); });
    for(const name of corrections) await check(`${name}: instance_not_open after committed confirm`,()=>transact(refusalSQL(correctionSQL(name,f,name==='revoke'?quick:closed.old),'instance_not_open')));
    const special=f.cases.at(-1);
    for(const [key,refusal] of [['reference','reference_row_not_correctable'],['prep','prep_data_not_correctable']]) {
      for(const name of corrections) await check(`${name}: ${refusal}`,()=>transact(refusalSQL(correctionSQL(name,f,special[key]),refusal)));
    }
    for(const [i,mode] of ['legacy','filtered'].entries()) await check(`dual-accept ${mode}`,async()=>{
      const c=f.cases.at(-3+i), quick=await freshQuick(c);
      await transact(correctionSQL('reason',f,c.old));
      const legacy=await heads(c);
      const filtered=(await query(`select id from public.checklist_completions where instance_id=${q(c.instance)} and superseded_at is null and revoked_at is null order by id`)).map(r=>r.id);
      assert.deepEqual(legacy.sort(),[c.old,quick].sort()); assert.deepEqual(filtered,[quick]);
      await transact(confirmSQL(f,c,mode==='legacy'?legacy:filtered)); await attest(c);
    });
    log('KNOWN TRANSITION LIMIT: pre-revoke filtered IDs can equal post-revoke legacy IDs; dual-accept does not close that race');
  } finally {
    await check('own fixture configuration retired; append-only evidence retained',async()=>{
      await query(retireSQL(f));
      const rows=await query(`select
        not exists(select 1 from public.users where id in (${q(f.actor)},${q(f.authority)}) and active)
        and not exists(select 1 from public.locations where id=${q(f.shop)} and active)
        and not exists(select 1 from public.user_locations where location_id=${q(f.shop)} and user_id in (${q(f.actor)},${q(f.authority)}) and active)
        and not exists(select 1 from public.checklist_templates where id=${q(f.template)} and active)
        and not exists(select 1 from public.checklist_template_items where template_id=${q(f.template)} and active) as retired`);
      assert.equal(rows[0]?.retired,true);
    });
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(()=>{
    const ref=projectRef(process.argv.slice(2),true);
    return runProof(managementQuery(ref,process.env.SUPABASE_ACCESS_TOKEN));
  }).catch(()=>{
    console.error('FAIL 0287 Management API proof: check SIM target, preflight, connectivity and invariants; interrupted requests may need fixture retirement');
    process.exitCode=1;
  });
}
