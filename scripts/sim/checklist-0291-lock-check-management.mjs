/** FILE ONLY: CC runs after 0291 on SIM. No .env or direct database URL.
 * Uses the 0290 Management API fixture/catalog/retirement pattern and 0276
 * observed-wait transactions. Unlike the 0290 rollback matrix, these races
 * COMMIT to prove one durable submission per key. Never retry transport errors.
 * Only allocated SIM-0291 config is retired; append-only evidence is retained.
 * Interrupted requests may have committed: printed IDs support manual retirement.
 */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { literal as q, managementQuery, projectRef } from '../supabase-management-query.mjs';
import { preflightManagement } from '../preflight-0276-management.mjs';
import { proveRace, transactionSQL } from './checklist-0276-lock-check-management.mjs';
import { fixture as previousFixture, fixtureSQL as previousFixtureSQL,
  retireSQL as previousRetireSQL } from './checklist-0290-lock-check-management.mjs';

export const pairings = [
  ['original','original'], ['edit','edit'],
  ['replay','confirm'], ['confirm','replay'],
];
export function fixture() {
  const f=previousFixture();
  f.tag=`SIM-0291-${f.template}`;
  f.prepItem=randomUUID();
  f.cases=f.cases.slice(0,pairings.length).map(c=>({...c,key:randomUUID(),editKey:randomUUID()}));
  return f;
}
export function fixtureSQL(f) {
  return previousFixtureSQL(f).replace('commit;', `
    insert into public.checklist_template_items(id,template_id,label,min_role_level,active)
      values(${q(f.prepItem)},${q(f.amTemplate)},${q(f.tag)},3,true); commit;`);
}
export function retireSQL(f) {
  return previousRetireSQL(f).replace('commit;', `
    update public.checklist_template_items set active=false
      where id=${q(f.prepItem)} and template_id=${q(f.amTemplate)}; commit;`);
}
export function submitSQL(f,c,edit=false) {
  const entries=JSON.stringify([{templateItemId:f.prepItem,inputs:{onHand:edit?2:1},snapshot:{}}]);
  const digest=createHash('sha256').update(JSON.stringify({edit,entries})).digest('hex');
  const head=edit?`(select id from public.checklist_submissions where instance_id=${q(c.am)} and original_submission_id is null and client_request_id=${q(c.key)})`:'null::uuid';
  return `select public.submit_am_prep_atomic(${q(c.am)},${q(f.actor)},${q(entries)}::jsonb,
    ${q(f.referenceItem)},${edit},${head},null::jsonb,null::text,null::text,
    ${q(edit?c.editKey:c.key)}::uuid,${q(digest)}) as result`;
}
export function calls(f,c) {
  return {
    original:submitSQL(f,c), edit:submitSQL(f,c,true), replay:submitSQL(f,c,true),
    confirm:`select public.checklist_confirm_instance(${q(f.actor)},${q(c.closing)},clock_timestamp(),'[]'::jsonb,
      array(select id from public.checklist_completions where instance_id=${q(c.closing)}
        and superseded_at is null and revoked_at is null order by id)::uuid[]) as result`,
  };
}
export function evidenceSQL(c) {
  return `select
    (select count(*)::int from public.checklist_submissions where instance_id=${q(c.am)}) as submissions,
    (select count(*)::int from public.checklist_completions where instance_id=${q(c.am)}) as completions,
    (select count(*)::int from public.checklist_completions where instance_id=${q(c.am)} and superseded_at is null and revoked_at is null) as live,
    (select max(edit_count) from public.checklist_submissions where instance_id=${q(c.am)}) as edits,
    (select count(*)::int from public.audit_log where resource_id in
      (select id from public.checklist_submissions where instance_id=${q(c.am)}) and action='report.update') as audits,
    (select status from public.checklist_instances where id=${q(c.closing)}) as closing_status`;
}
export function assertEvidence(row,edited,confirmed=false) {
  assert.equal(row?.submissions,edited?2:1,'one submission for each distinct request key');
  assert.equal(row?.completions,edited?2:1,'replay creates no completion history');
  assert.equal(row?.live,1,'one live completion');
  assert.equal(row?.edits,edited?1:0,'replay consumes no edit slot');
  assert.equal(row?.audits,edited?1:0,'replay creates no SQL success audit');
  assert.equal(row?.closing_status,confirmed?'confirmed':'open');
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
    'public.submit_am_prep_atomic(uuid,uuid,jsonb,uuid,boolean,uuid,jsonb,text,text,uuid,text)',
    'public.checklist_revoke_with_reason(uuid,uuid,text,text)',
  ];
  const grants=await query(`select signature,to_regprocedure(signature) is not null as present,
    coalesce(has_function_privilege('service_role',to_regprocedure(signature),'EXECUTE'),false) as executable
    from unnest(array[${signatures.map(q).join(',')}]::text[]) as required(signature)`);
  for(const signature of signatures) assert.ok(grants.some(r=>r.signature===signature && r.present===true && r.executable===true),'0291 required function or service_role EXECUTE missing');
}


/** Edits/replays never write or lock closing. Prove actual overlapping transactions
 * in both start orders, without claiming a lock conflict that does not exist.
 * Holder readiness is observed in pg_stat_activity, as in the 0276 lock proof.
 */
export async function proveClosingOverlap(query,holderSQL,racerSQL,tag,{sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  const holderName=`${tag}-h`;
  const settled=promise=>promise.then(rows=>({ok:true,rows}),()=>({ok:false}));
  const holder=settled(query(transactionSQL(holderName,holderSQL,true)));
  let racer;
  try {
    let ready=false;
    for(let i=0;i<40;i++) {
      const rows=await query(`select exists(select 1 from pg_stat_activity
        where application_name=${q(holderName)} and wait_event='PgSleep') as ready`);
      if(rows[0]?.ready===true) {ready=true;break;}
      await sleep(100);
    }
    assert.ok(ready,'first operation must finish and hold its transaction open');
    racer=settled(query(transactionSQL(`${tag}-r`,racerSQL)));
    const result=await racer;
    assert.equal(result.ok,true,'overlapping closing/replay operation must commit');
    const stillOpen=await query(`select exists(select 1 from pg_stat_activity
      where application_name=${q(holderName)} and wait_event='PgSleep') as ready`);
    assert.equal(stillOpen[0]?.ready,true,'second operation must commit while first remains open');
    assert.equal((await holder).ok,true,'first transaction must commit');
    return result;
  } finally {
    await Promise.all([holder,racer].filter(Boolean));
  }
}

export async function runProof(query,log=console.log,raceOptions={}) {
  await preflightManagement(query);
  await fixturePreflight(query);
  const f=fixture();
  log(`FIXTURE allocated ${JSON.stringify(f)}`);
  try {
    await query(fixtureSQL(f));
    for(const [i,[a,b]] of pairings.entries()) {
      const c=f.cases[i],ops=calls(f,c);
      if(i>0) await query(transactionSQL(`${f.tag}-${i}-original`,ops.original));
      // Both closing races retry an already committed edit, so the confirm-first
      // order proves replay remains valid after closing becomes confirmed.
      if(i>1) await query(transactionSQL(`${f.tag}-${i}-edit`,ops.edit));
      const before=await query(evidenceSQL(c));
      const race=i>1?proveClosingOverlap:proveRace;
      const result=await race(query,ops[a],ops[b],`${f.tag}-${i}`,raceOptions);
      assert.equal(result.ok,true,'both committed race participants must succeed');
      if(b!=='confirm') assert.equal(result.rows[0]?.result?.replayed,true,'waiting same-key submit must replay');
      const rows=await query(evidenceSQL(c));
      assertEvidence(rows[0],i>0,i>1);
      if(i>1) for(const key of ['submissions','completions','live','edits','audits'])
        assert.equal(rows[0]?.[key],before[0]?.[key],'closing/replay race must preserve prep evidence');
      // Replay again to verify the winner IDs match the only stored keyed row.
      const replay=await query(transactionSQL(`${f.tag}-${i}-verify`,i>0?ops.edit:ops.original));
      const stored=await query(`select id,completion_ids from public.checklist_submissions
        where instance_id=${q(c.am)} and submitted_by=${q(f.actor)} and client_request_id=${q(i>0?c.editKey:c.key)}`);
      assert.equal(replay[0]?.result?.replayed,true);
      assert.equal(replay[0]?.result?.submissionId,stored[0]?.id);
      assert.deepEqual(replay[0]?.result?.completionIds,stored[0]?.completion_ids);
      log(`PASS committed ordered pair ${a} -> ${b}; same IDs and one submission per key`);
    }
    log('PASS 0291: 2 committed lock pairs with observed waits; 2 nonblocking closing/replay overlaps');
  } finally {
    await query(retireSQL(f));
    const retired=await query(`select
      not exists(select 1 from public.users where id=${q(f.actor)} and active)
      and not exists(select 1 from public.locations where id=${q(f.shop)} and active)
      and not exists(select 1 from public.user_locations where user_id=${q(f.actor)} and location_id=${q(f.shop)} and active)
      and not exists(select 1 from public.checklist_templates where id in (${q(f.template)},${q(f.amTemplate)}) and active)
      and not exists(select 1 from public.checklist_template_items where template_id in (${q(f.template)},${q(f.amTemplate)}) and active) as retired`);
    assert.equal(retired[0]?.retired,true,'all own fixture configuration retired');
    log('PASS own fixture configuration retired; append-only evidence retained');
  }
}
export function main(args=process.argv.slice(2)) {
  const ref=projectRef(args,true);
  return runProof(managementQuery(ref,process.env.SUPABASE_ACCESS_TOKEN));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(()=>main()).catch(()=>{
    console.error('FAIL 0291 Management API proof: check SIM target, preflight, connectivity and invariants; interrupted requests may need fixture retirement');
    process.exitCode=1;
  });
}
