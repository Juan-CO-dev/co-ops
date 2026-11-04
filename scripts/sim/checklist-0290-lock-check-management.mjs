/** FILE ONLY: CC runs after 0290 on SIM. Never loads .env or a direct DB URL.
 * SUPABASE_ACCESS_TOKEN=<operator environment>; node scripts/sim/checklist-0290-lock-check-management.mjs --ref=jepgzucrvklhqpthowsc
 * Self-allocated SIM-0290 fixtures only; history retained, own config retired.
 * No retries: interrupted requests may have committed; printed IDs let CC retire
 * stranded fixtures manually. Never reuse operational users, shops or history.
 * Each API request owns ONE transaction. Matrix A calls the real writer, sleeps
 * holding its locks, then ROLLS BACK; B calls the real writer and rolls back too.
 * The 0276 observer proves an ungranted lock with A as blocker plus elapsed wait.
 * Eight ordered pairs prove serialization, not committed-winner semantics.
 * Five separate committed functional probes assert skip/CAS/correction contracts.
 * Ambiguous heads include a revoked unsuperseded legacy row, as in the direct
 * 0290 harness; no index changes. No interactive transaction continuation.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { literal as q, managementQuery, projectRef } from '../supabase-management-query.mjs';
import { preflightManagement } from '../preflight-0276-management.mjs';
import { proveRace, transactionSQL } from './checklist-0276-lock-check-management.mjs';
import { rollbackQuery } from './checklist-0287-lock-check-management.mjs';

export const pairings = [
  ['replace','confirm'], ['confirm','replace'],
  ['replace','revoke'], ['revoke','replace'],
  ['replace','am'], ['am','replace'],
  ['am','confirm'], ['confirm','am'],
];
export function fixture() {
  const f = Object.fromEntries(['actor','shop','template','amTemplate','item','referenceItem'].map(k => [k,randomUUID()]));
  f.tag = `SIM-0290-${f.template}`;
  f.cases = Array.from({length:pairings.length+5}, () =>
    Object.fromEntries(['closing','am','old','generic','extra','stale'].map(k => [k,randomUUID()])));
  return f;
}
export const metadata = c => ({reportType:'am_prep',reportInstanceId:c.am,reportSubmittedAt:'2199-01-01T00:00:00.000Z'});
export function fixtureSQL(f) {
  return `begin;
    insert into public.locations(id,name,code,type,active) values(${q(f.shop)},${q(f.tag)},${q(f.tag)},'permanent',true);
    insert into public.users(id,name,role,pin_hash,active) values(${q(f.actor)},${q(f.tag)},'key_holder','SIM-NO-VALID-CREDENTIAL',true);
    insert into public.user_locations(user_id,location_id,active) values(${q(f.actor)},${q(f.shop)},true);
    insert into public.checklist_templates(id,location_id,type,name,active) values
      (${q(f.template)},${q(f.shop)},'closing',${q(f.tag)},true),
      (${q(f.amTemplate)},${q(f.shop)},'prep',${q(f.tag)},true);
    insert into public.checklist_template_items(id,template_id,label,min_role_level,active,report_reference_type) values
      (${q(f.item)},${q(f.template)},${q(f.tag)},3,true,null),
      (${q(f.referenceItem)},${q(f.template)},${q(f.tag)},3,true,'am_prep');
    insert into public.checklist_instances(id,template_id,location_id,date,status) values
      ${f.cases.flatMap((c,i) => [[c.closing,f.template],[c.am,f.amTemplate]].map(([id,t]) =>
        `(${q(id)},${q(t)},${q(f.shop)},date '2099-01-01'+${i},'open')`)).join(',')};
    insert into public.checklist_completions(id,instance_id,template_item_id,completed_by,completed_at,auto_complete_meta) values
      ${f.cases.flatMap(c => [
        `(${q(c.old)},${q(c.closing)},${q(f.referenceItem)},${q(f.actor)},clock_timestamp()-interval '2 minutes',${q(JSON.stringify(metadata(c)))}::jsonb)`,
        `(${q(c.generic)},${q(c.closing)},${q(f.item)},${q(f.actor)},clock_timestamp()-interval '2 minutes',null)`,
      ]).join(',')}; commit;`;
}
export function retireSQL(f) {
  return `begin;
    update public.checklist_template_items set active=false where template_id=${q(f.template)} and id in (${q(f.item)},${q(f.referenceItem)});
    update public.checklist_templates set active=false where id in (${q(f.template)},${q(f.amTemplate)}) and name=${q(f.tag)};
    update public.user_locations set active=false where location_id=${q(f.shop)} and user_id=${q(f.actor)};
    update public.users set active=false where id=${q(f.actor)} and name=${q(f.tag)};
    update public.locations set active=false where id=${q(f.shop)} and code=${q(f.tag)}; commit;`;
}
export const replaceSQL = (f,c,expected=c.old) => `select public.checklist_replace_closing_ref(${q(c.closing)},${q(f.referenceItem)},${q(f.actor)},${q(expected)},${q(JSON.stringify(metadata(c)))}::jsonb) as result`;
export function calls(f,c) {
  return {
    replace: replaceSQL(f,c),
    confirm: `select public.checklist_confirm_instance(${q(f.actor)},${q(c.closing)},clock_timestamp(),'[]'::jsonb,array[${q(c.old)},${q(c.generic)}]::uuid[]) as result`,
    revoke: `select public.checklist_revoke_with_reason(${q(c.generic)},${q(f.actor)},'other',${q(f.tag)}) as result`,
    am: `select public.submit_am_prep_atomic(${q(c.am)},${q(f.actor)},'[]'::jsonb,${q(f.referenceItem)},false,null::uuid,null::jsonb,null::text,null::text) as result`,
  };
}
export function refusalSQL(sql,expected) {
  assert.ok(['closing_ref_multiple_heads','reference_row_not_correctable'].includes(expected));
  return `begin ${sql.replace(/^select /,'perform ').replace(/ as result$/,'')};
    exception when sqlstate 'P0001' then
      if sqlerrm = ${q(expected)} then refused := true; else raise; end if;
    end;
    if not refused then raise exception 'expected refusal missing' using errcode='XX000'; end if;`;
}
const must = condition => `if (${condition}) is distinct from true then raise exception '0290 functional invariant failed' using errcode='XX000'; end if;`;
const capture = sql => sql.replace(/ as result$/,' into r;');
const refs = (f,c) => `(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]'::jsonb) from public.checklist_completions x where instance_id=${q(c.closing)} and template_item_id=${q(f.referenceItem)})`;
export function functionalProbes(f) {
  return ['revoked','multiple','stale','correct','correction'].map((name,i) => {
    const c=f.cases[pairings.length+i], ops=calls(f,c);
    let body='';
    // Fixture-only legacy setup, under the same AM -> closing parent order.
    if(name==='revoked') body+=`update public.checklist_completions set revoked_at=clock_timestamp(),revoked_by=${q(f.actor)} where id=${q(c.old)};`;
    if(name==='multiple') body+=`insert into public.checklist_completions(id,instance_id,template_item_id,completed_by,completed_at,revoked_at)
      values(${q(c.extra)},${q(c.closing)},${q(f.referenceItem)},${q(f.actor)},clock_timestamp(),clock_timestamp());`;
    body+=`before_rows := ${refs(f,c)};`;
    if(name==='revoked' || name==='multiple') {
      const reason=name==='revoked'?'closing_ref_revoked':'closing_ref_multiple_heads';
      body+=capture(ops.am)+must(`r->'closingRefSkip' = ${q(JSON.stringify({instanceId:c.closing,itemId:f.referenceItem,reason}))}::jsonb
        and r->'autoCompleteId' = 'null'::jsonb and r->'instance'->>'status' = 'confirmed'`);
      body+=must(`exists(select 1 from public.checklist_instances where id=${q(c.am)} and status='confirmed' and confirmed_by=${q(f.actor)})
        and (select count(*) from public.checklist_submissions where instance_id=${q(c.am)} and is_final_confirmation)=1`);
      if(name==='multiple') body+=refusalSQL(ops.replace,reason);
      body+=must(`${refs(f,c)} = before_rows`);
    } else if(name==='stale') {
      body+=capture(replaceSQL(f,c,c.stale))+must(`r->>'result' = 'lost' and r->>'completionId' = ${q(c.old)}`)+must(`${refs(f,c)} = before_rows`);
    } else if(name==='correct') {
      body+=capture(ops.replace)+must(`r->>'result' = 'superseded'`);
      body+=must(`(select count(*) from public.checklist_completions where instance_id=${q(c.closing)} and template_item_id=${q(f.referenceItem)} and superseded_at is null)=1
        and (select count(*) from public.checklist_completions where instance_id=${q(c.closing)} and template_item_id=${q(f.referenceItem)})=2
        and exists(select 1 from public.checklist_completions old join public.checklist_completions fresh on fresh.id=old.superseded_by
          where old.id=${q(c.old)} and old.superseded_at is not null and fresh.id=(r->>'completionId')::uuid
          and fresh.superseded_at is null and fresh.revoked_at is null and fresh.completed_by=${q(f.actor)}
          and fresh.completed_at is not null and fresh.auto_complete_meta=${q(JSON.stringify(metadata(c)))}::jsonb)`);
    } else {
      body+=refusalSQL(`select public.checklist_revoke_with_reason(${q(c.old)},${q(f.actor)},'other',${q(f.tag)}) as result`,'reference_row_not_correctable');
      body+=must(`${refs(f,c)} = before_rows`);
    }
    return {name,c,sql:`do $proof$ declare r jsonb; before_rows jsonb; refused boolean := false; begin
      perform 1 from public.checklist_instances where id=${q(c.am)} for no key update;
      perform 1 from public.checklist_instances where id=${q(c.closing)} for no key update;
      ${body} end $proof$`};
  });
}

export const requiredColumns = {
  locations:['id','name','code','type','active'], users:['id','name','role','pin_hash','active'],
  user_locations:['user_id','location_id','active'], checklist_templates:['id','location_id','type','name','active'],
  checklist_template_items:['id','template_id','label','min_role_level','active','report_reference_type'],
  checklist_instances:['id','template_id','location_id','date','status'],
  checklist_completions:['id','instance_id','template_item_id','completed_by','completed_at','auto_complete_meta','revoked_at'],
};
export async function fixturePreflight(query) {
  const tables=Object.keys(requiredColumns).map(q).join(',');
  const columns=await query(`select table_name,column_name,is_nullable,column_default,is_identity,is_generated from information_schema.columns where table_schema='public' and table_name in (${tables})`);
  for(const [table,names] of Object.entries(requiredColumns)) for(const name of names)
    assert.ok(columns.some(c=>c.table_name===table && c.column_name===name),'fixture schema must contain every inserted column');
  for(const c of columns) assert.ok(c.is_nullable!=='NO' || c.column_default!=null || c.is_identity==='YES'
    || c.is_generated==='ALWAYS' || requiredColumns[c.table_name]?.includes(c.column_name),'fixture schema has omitted required column');
  const enums=await query(`select c.relname as table_name,a.attname as column_name,e.enumlabel
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    join pg_type t on t.oid=a.atttypid join pg_enum e on e.enumtypid=t.oid
    where n.nspname='public' and c.relname in (${tables})`);
  const values={'locations.type':['permanent'],'users.role':['key_holder'],'checklist_templates.type':['closing','prep'],
    'checklist_instances.status':['open'],'checklist_template_items.report_reference_type':['am_prep']};
  for(const e of enums) {
    if(!requiredColumns[e.table_name]?.includes(e.column_name)) continue;
    const expected=values[`${e.table_name}.${e.column_name}`];
    assert.ok(expected && expected.every(label=>enums.some(v=>v.table_name===e.table_name && v.column_name===e.column_name && v.enumlabel===label)),'fixture enum label mismatch');
  }
  const signatures=[
    'public.checklist_replace_closing_ref(uuid,uuid,uuid,uuid,jsonb)',
    'public.submit_am_prep_atomic(uuid,uuid,jsonb,uuid,boolean,uuid,jsonb,text,text)',
    'public.checklist_revoke_with_reason(uuid,uuid,text,text)',
  ];
  const grants=await query(`select signature,to_regprocedure(signature) is not null as present,
    coalesce(has_function_privilege('service_role',to_regprocedure(signature),'EXECUTE'),false) as executable
    from unnest(array[${signatures.map(q).join(',')}]::text[]) as required(signature)`);
  for(const signature of signatures) assert.ok(grants.some(r=>r.signature===signature && r.present===true && r.executable===true),'0290 required function or service_role EXECUTE missing');
}

export async function runProof(query,log=console.log,raceOptions={}) {
  // FIRST request, before allocation or fixture emission.
  await preflightManagement(query);
  await fixturePreflight(query);
  const f=fixture();
  log(`FIXTURE allocated ${JSON.stringify(f)}`);
  const check=async(name,fn)=>{
    try { await fn(); log(`PASS ${name}`); }
    catch(error) { log(`FAIL ${name}`); throw error; }
  };
  const snapshot=c=>query(`select
    (select jsonb_agg(to_jsonb(i) order by id) from public.checklist_instances i where id in (${q(c.am)},${q(c.closing)})) as instances,
    (select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]'::jsonb) from public.checklist_completions x where instance_id in (${q(c.am)},${q(c.closing)})) as completions,
    (select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]'::jsonb) from public.checklist_submissions s where instance_id in (${q(c.am)},${q(c.closing)})) as submissions`);
  try {
    await check('fixture creation',()=>query(fixtureSQL(f)));
    for(const [i,[a,b]] of pairings.entries()) await check(`ordered lock pair ${a} -> ${b}`,async()=>{
      const c=f.cases[i], ops=calls(f,c), before=await snapshot(c);
      const result=await proveRace(rollbackQuery(query),ops[a],ops[b],`${f.tag}-${i}`,raceOptions);
      assert.equal(result.ok,true,'waiter must succeed after holder rollback');
      assert.deepEqual(await snapshot(c),before,'both matrix transactions must roll back');
    });
    for(const probe of functionalProbes(f)) await check(`committed functional probe ${probe.name}`,async()=>{
      await query(transactionSQL(`${f.tag}-${probe.name}`,probe.sql));
      const rows=await query(`select id from public.checklist_completions where instance_id=${q(probe.c.closing)} order by id`);
      log(`FIXTURE completion IDs ${probe.name} ${JSON.stringify(rows.map(r=>r.id))}`);
    });
    log('PASS 0290: 8 ordered lock pairs; 5 committed functional probes');
  } finally {
    await check('own fixture configuration retired; append-only evidence retained',async()=>{
      await query(retireSQL(f));
      const rows=await query(`select
        not exists(select 1 from public.users where id=${q(f.actor)} and active)
        and not exists(select 1 from public.locations where id=${q(f.shop)} and active)
        and not exists(select 1 from public.user_locations where location_id=${q(f.shop)} and user_id=${q(f.actor)} and active)
        and not exists(select 1 from public.checklist_templates where id in (${q(f.template)},${q(f.amTemplate)}) and active)
        and not exists(select 1 from public.checklist_template_items where template_id=${q(f.template)} and active) as retired`);
      assert.equal(rows[0]?.retired,true);
    });
  }
}
export function main(args=process.argv.slice(2)) {
  const ref=projectRef(args,true);
  return runProof(managementQuery(ref,process.env.SUPABASE_ACCESS_TOKEN));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(()=>main()).catch(()=>{
    console.error('FAIL 0290 Management API proof: check SIM target, preflight, connectivity and invariants; interrupted requests may need fixture retirement');
    process.exitCode=1;
  });
}
