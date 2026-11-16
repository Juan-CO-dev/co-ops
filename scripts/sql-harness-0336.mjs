/** 0336 offline proof: the REAL 0300 (with its real parents, as sql-harness-0300 loads them), then the
 *  REAL 0336. Synthetic fixtures only; no sim, no prod. The schema-cache readiness and the two-session
 *  lease proof are sim-only (CC, plan r2 §7 items 7 and 11). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const read=n=>readFileSync(new URL(`../supabase/migrations/${n}`,import.meta.url),'utf8');
const m0300=read('0300_meta_leads.sql');
const migration=read('0336_meta_lead_ad_refs.sql');
function table(file,name) { const m=read(file).match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`,'i')); assert.ok(m,name); return m[0]; }
const lease0275=read('0275_schedule_weeks.sql').match(/alter table public\.cron_route_leases drop constraint cron_route_leases_job_check,[\s\S]*?grant execute on function public\.claim_cron_route\(text\) to service_role;/i)?.[0];
assert.ok(lease0275);
const profiles=read('0234_customer_profiles.sql');
function fn(name) {const m=profiles.match(new RegExp(`create function public\\.${name}\\([\\s\\S]*?\\$\\$;`,'i')); assert.ok(m,name); return m[0];}
const consentView=profiles.match(/create view public\.customer_consent_current[\s\S]*?e\.id desc;/i)?.[0];
assert.ok(consentView);
const quotes0127=read('0127_catering_portal_orders.sql').match(/ALTER TABLE catering_quotes DROP CONSTRAINT catering_quotes_status_check;[\s\S]*?CHECK \(origin IN \('self_serve','staff'\)\);/i)?.[0];
const pipeline0129=read('0129_order_artifact_intake.sql').match(/ALTER TABLE public\.catering_pipeline\s+ADD COLUMN contact_phone[\s\S]*?dropoff_door\s+text;/i)?.[0];
const pipeline0139=read('0139_catering_pipeline_geo_routing.sql').match(/ALTER TABLE public\.catering_pipeline\s+ADD COLUMN geo_lat[\s\S]*?fulfillment_routed boolean NOT NULL DEFAULT false;/i)?.[0];
assert.ok(quotes0127&&pipeline0129&&pipeline0139);
// The exact 0300 five-argument function, for the drift and rollback proofs.
const record0300=m0300.match(/create function public\.meta_lead_record\([\s\S]*?end \$\$;/)?.[0];
assert.ok(record0300);

const db=new PGlite(); let checks=0;
const check=(v,s)=>{assert.ok(v,s);checks++;console.log(`ok ${s}`);};
const one=async(s,a=[])=>(await db.query(s,a)).rows[0];
const reject=async(f,re,s)=>{await assert.rejects(f,re);check(true,s);};
/** PostgREST's own call shape: named notation, every argument by name. */
const named=async(n,args)=>{const keys=Object.keys(args);return (await one(`select public.${n}(${keys.map((k,i)=>`${k} := $${i+1}`).join(', ')}) result`,Object.values(args))).result;};
const row=async id=>(await one('select to_jsonb(e) j from meta_lead_events e where leadgen_id=$1',[id]))?.j;
const shop=randomUUID(),manager=randomUUID(),customer=randomUUID();
const intake={contact_name:'Synthetic',email:'synthetic@example.test',company:'Unverified text',headcount:20,event_date:'2027-01-02',fulfillment:'pickup',notes:'Synthetic note',language:'en',secondary_email:'profile@example.test'};
const five=id=>({p_leadgen_id:id,p_page_id:'10',p_form_id:'20',p_created_at:'2026-11-16T12:00:00Z',p_enabled:true});
const claim=async id=>{const lease=randomUUID();return {lease,...await named('meta_lead_claim',{p_leadgen_id:id,p_lease_id:lease})};};
const refs=(id,lease,ad,adset)=>named('meta_lead_record_ad_refs',{p_leadgen_id:id,p_lease_id:lease,p_ad_id:ad,p_adset_id:adset});
const backfill=(id,ad,adset)=>named('meta_lead_backfill_ad_refs',{p_leadgen_id:id,p_ad_id:ad,p_adset_id:adset});
const without=(j,keys)=>Object.fromEntries(Object.entries(j).filter(([k])=>!keys.includes(k)));
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to public,anon,authenticated,service_role;
    alter default privileges in schema public grant all on functions to public,anon,authenticated,service_role;
    create table locations(id uuid primary key,active boolean default true);
    create table users(id uuid primary key,role text,active boolean);
    ${table('0108_catering_scaffold_capture.sql','catering_customers')}
    ${table('0108_catering_scaffold_capture.sql','catering_pipeline')}
    ${pipeline0129}
    ${pipeline0139}
    alter table catering_pipeline drop constraint catering_pipeline_stage_check;
    alter table catering_pipeline add constraint catering_pipeline_stage_check check(stage in ('inquiry','quote_sent','confirmed','out','completed','lost'));
    ${read('0148_catering_lead_assignee.sql')}
    ${table('0110_catering_pipeline_events.sql','catering_pipeline_events')}
    alter table catering_pipeline_events drop column location_id;
    ${read('0191_pipeline_events_out_stage.sql')}
    create table public.catering_delivery_zones(id uuid primary key);
    ${table('0120_catering_quotes.sql','catering_quotes')}
    ${quotes0127}
    ${['customers','customer_identifiers','customer_consent_imports','customer_consent_events','customer_merge_suggestions','customer_suppressions'].map(n=>table('0234_customer_profiles.sql',n)).join('\n')}
    ${['customer_sha256','customer_root','customer_email_is_relay','customer_identity_lock','customer_resolve'].map(fn).join('\n')}
    ${consentView}
    ${fn('customer_marketing_export')}
    ${read('0243_cron_route_leases.sql')}
    ${lease0275}
  `);
  await db.exec(m0300);
  check(true,'real 0300 applied');

  // ---- Pre-flight refusals: each in a transaction; a refusal leaves no partial DDL. ----
  const noPartial=async label=>check((await one("select count(*)::int n from information_schema.columns where table_name='meta_lead_events' and column_name in ('ad_id','adset_id','webhook_ad_id','webhook_adgroup_id','ad_refs_at')")).n===0
    &&(await one("select to_regprocedure('public.meta_ad_ref(text)') x")).x===null
    &&(await one("select to_regprocedure('public.meta_lead_record(text,text,text,timestamptz,boolean)') x")).x!==null,`${label}: no partial DDL`);
  const refuse=async(sql,re,label)=>{await db.exec('begin;'+sql);await reject(()=>db.exec(migration),re,label);await db.exec('rollback');await noPartial(label);};
  await refuse(record0300.replace('create function','create or replace function').replace("'inserted',v_id is not null","'inserted',v_id is not null or true"),/0336: meta_lead_record drift \(body differs/,'0300 body drift refused');
  await refuse('create function public.meta_lead_record(p text) returns jsonb language sql as $$select null::jsonb$$;',/0336: meta_lead_record drift \(expected exactly/,'extra meta_lead_record overload refused');
  await refuse('alter function public.meta_lead_record(text,text,text,timestamptz,boolean) rename to meta_lead_record_old;',/0336: meta_lead_record drift/,'missing five-argument function refused');
  await refuse('alter table public.meta_lead_events add column ad_id text;',/0336: already applied/,'pre-existing ad_id column refused as already applied');
  await refuse('create function public.meta_ad_ref(p text) returns text language sql as $$select p$$;',/0336: already applied/,'pre-existing meta_ad_ref refused as already applied');
  await refuse('alter table public.meta_lead_events rename to meta_lead_events_old;',/0336: missing 0300/,'missing 0300 ledger refused');
  // A CRLF copy of the 0300 body is the same function, not drift.
  await db.exec('begin;'+record0300.replace('create function','create or replace function').replace(/\n/g,'\r\n'));
  await db.exec(migration.replace(/commit;\s*$/,''));
  check((await one("select count(*)::int n from information_schema.columns where table_name='meta_lead_events' and column_name='ad_id'")).n===1,'CRLF copy of the 0300 body passes the fingerprint');
  await db.exec('rollback'); await noPartial('CRLF trial rolled back');
  // Privilege sabotage is caught by the file's own assertions and rolls the whole file back.
  for(const [label,sabotage] of [
    ['table grant sabotage caught',['grant select on public.meta_lead_events to service_role;','grant select on public.meta_lead_events to service_role; grant insert on public.meta_lead_events to authenticated;']],
    ['column grant sabotage caught',['grant select on public.meta_lead_events to service_role;','grant select on public.meta_lead_events to service_role; grant update(ad_id) on public.meta_lead_events to service_role;']],
    ['function grant sabotage caught',["execute format('grant execute on function %s to service_role',f);","execute format('grant execute on function %s to service_role, anon',f);"]],
    ['PUBLIC function grant sabotage caught',["execute format('revoke all on function %s from public, anon, authenticated, service_role',f);","execute format('revoke all on function %s from anon, authenticated, service_role',f);"]],
  ]){
    assert.ok(migration.includes(sabotage[0]),label);
    await db.exec('begin;'); await reject(()=>db.exec(migration.replace(sabotage[0],sabotage[1])),/0336: meta (table privilege|column privilege|column grant|RPC|PUBLIC RPC)/,label); await db.exec('rollback'); await noPartial(label);
  }
  check(/notify pgrst, 'reload schema';\s*commit;\s*$/.test(migration),'file ends with the PostgREST schema reload, then commit');

  // ---- Apply. ----
  await db.exec(migration);
  check(true,'0336 applies on the real 0300');
  await reject(()=>db.exec(migration),/0336: already applied/,'re-apply refused by name');
  await db.exec('rollback');

  // ---- Overloads, privileges, definer settings. ----
  check((await one("select count(*)::int n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname='meta_lead_record'")).n===1,'exactly one meta_lead_record (no ambiguous overload)');
  check((await one("select to_regprocedure('public.meta_lead_record(text,text,text,timestamptz,boolean)') x")).x===null,'the five-argument signature is gone');
  for(const role of ['anon','authenticated','service_role']) for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])
    check((await one('select has_table_privilege($1,$2,$3) x',[role,'meta_lead_events',privilege])).x===(role==='service_role'&&privilege==='SELECT'),`${role} ${privilege} table ceiling`);
  check((await one("select count(*)::int n from pg_attribute where attrelid='public.meta_lead_events'::regclass and attnum>0 and attacl is not null")).n===0,'no column grants on meta_lead_events');
  check((await one("select count(*)::int n from pg_class c,lateral aclexplode(c.relacl) a where c.oid='public.meta_lead_events'::regclass and a.grantee=0")).n===0,'no PUBLIC table entry');
  const rpcs=['meta_ad_ref(text)','meta_lead_record(text,text,text,timestamptz,boolean,text,text)','meta_lead_record_ad_refs(text,uuid,text,text)','meta_lead_backfill_ad_refs(text,text,text)',
    'meta_lead_claim(text,uuid)','meta_lead_fail(text,uuid,text,boolean,text[])','meta_lead_intake_apply(text,uuid,uuid,uuid,uuid,jsonb,text[])','customer_consent_record_explicit(text,text,text,timestamptz,text,text)',
    'meta_lead_email_claim(text)','meta_lead_email_result(text,text,uuid,text)','portal_intake_attach(uuid,uuid,jsonb)','claim_cron_route(text)'];
  for(const f of rpcs){
    for(const role of ['anon','authenticated','service_role']) check((await one("select has_function_privilege($1,$2::regprocedure,'EXECUTE') x",[role,'public.'+f])).x===(role==='service_role'),`${f} ${role} execute`);
    check((await one("select count(*)::int n from pg_proc p,lateral aclexplode(p.proacl) a where p.oid=$1::regprocedure and a.grantee=0",['public.'+f])).n===0,`${f} no PUBLIC entry`);
  }
  for(const f of ['meta_lead_record(text,text,text,timestamptz,boolean,text,text)','meta_lead_record_ad_refs(text,uuid,text,text)','meta_lead_backfill_ad_refs(text,text,text)']){
    const p=await one('select prosecdef,proconfig from pg_proc where oid=$1::regprocedure',['public.'+f]);
    check(p.prosecdef&&p.proconfig.includes('search_path=pg_catalog, public'),`${f} definer/path`);
  }
  check((await one("select provolatile v,prosecdef d from pg_proc where oid='public.meta_ad_ref(text)'::regprocedure")).v==='i','meta_ad_ref immutable');
  await db.exec('set role anon');
  await reject(()=>refs('1',randomUUID(),'1','2'),/permission denied/,'anon cannot call the live writer');
  await reject(()=>named('meta_lead_record',five('900')),/permission denied/,'anon cannot call the record');
  await db.exec('reset role; set role authenticated');
  await reject(()=>backfill('1','1','2'),/permission denied/,'authenticated cannot call the backfill helper');
  await reject(()=>db.query('select * from meta_lead_events'),/permission denied/,'authenticated cannot read the ledger');
  await db.exec('reset role');

  // ---- meta_ad_ref never raises. ----
  for(const [input,out] of [['123','123'],[' 456 ','456'],['',null],['   ',null],['abc',null],['12a',null],['1'.repeat(30),'1'.repeat(30)],['1'.repeat(31),null],['-1',null],['1.5',null],[null,null]])
    check((await one('select public.meta_ad_ref($1) x',[input])).x===out,`meta_ad_ref(${JSON.stringify(input)}) = ${JSON.stringify(out)}`);

  await db.query('insert into locations(id) values($1)',[shop]);
  await db.query("insert into users values($1,'catering_mgr',true)",[manager]);
  await db.query("insert into catering_customers(id,name,email) values($1,'Synthetic',$2)",[customer,intake.email]);
  await db.exec('set role service_role');

  // ---- The OLD app's calls (main 6f34d736): five named arguments, then the whole worker path. ----
  check((await named('meta_lead_record',five('100'))).inserted===true,'old five-argument named call inserts (PostgREST shape)');
  const r100=await row('100');
  check(r100.webhook_ad_id===null&&r100.webhook_adgroup_id===null&&r100.ad_id===null&&r100.adset_id===null&&r100.ad_refs_at===null,'old call leaves every new column NULL');
  check((await one("select public.meta_lead_record('101','10','20','2026-11-16T12:00:00Z',true) r")).r.inserted===true,'old positional five-argument call inserts');
  const c100=await claim('100'); check(c100.claimed===true,'old worker claim works');
  const applied=await named('meta_lead_intake_apply',{p_leadgen_id:'100',p_lease_id:c100.lease,p_customer_id:customer,p_location_id:shop,p_assigned_to:manager,p_intake:intake,p_raw_keys:['full_name']});
  check(applied.state==='created','old worker apply creates the lead after 0336');
  const c101=await claim('101');
  check(await named('meta_lead_fail',{p_leadgen_id:'101',p_lease_id:c101.lease,p_error_code:'graph_timeout',p_retryable:true,p_raw_keys:[]}),'old worker failure write works after 0336');

  // ---- The new seven-argument call. ----
  check((await named('meta_lead_record',{...five('200'),p_webhook_ad_id:'555',p_webhook_adgroup_id:'666'})).inserted,'seven-argument named call inserts');
  let r=await row('200'); check(r.webhook_ad_id==='555'&&r.webhook_adgroup_id==='666'&&r.ad_id===null&&r.ad_refs_at===null,'webhook ids stored; Graph columns untouched');
  for(const [id,ad,group] of [['201','',''],['202','abc','12x'],['203','1'.repeat(31),'-5'],['204',null,null]]){
    check((await named('meta_lead_record',{...five(id),p_webhook_ad_id:ad,p_webhook_adgroup_id:group})).inserted,`receipt ${id} with malformed ids is still recorded`);
    r=await row(id); check(r.webhook_ad_id===null&&r.webhook_adgroup_id===null,`receipt ${id}: '' / malformed / over-long stored as NULL`);
  }
  check((await named('meta_lead_record',{...five('205'),p_webhook_ad_id:' 77 '})).inserted&&(await row('205')).webhook_ad_id==='77','whitespace around an id is trimmed');
  // Duplicate receipt immutability: different ids, different evidence, every column unchanged.
  const before200=await row('200');
  check((await named('meta_lead_record',{...five('200'),p_page_id:'11',p_enabled:false,p_webhook_ad_id:'999',p_webhook_adgroup_id:'888'})).inserted===false,'duplicate receipt answers inserted=false');
  assert.deepEqual(await row('200'),before200); check(true,'duplicate receipt leaves the row byte-identical');

  // ---- The live writer: fences after the lock, null-only fill. ----
  check(await refs('nope',randomUUID(),'1','2')==='not_found','live writer: unknown lead is not_found');
  let snap=await row('200');
  check(await refs('200',randomUUID(),'1','2')==='stale_lease','live writer: a received (unclaimed) row is stale_lease');
  assert.deepEqual(await row('200'),snap); check(true,'live writer: unclaimed refusal writes nothing');
  const c200=await claim('200'); snap=await row('200');
  check(await refs('200',randomUUID(),'1','2')==='stale_lease','live writer: wrong lease is stale_lease');
  check(await refs('200',null,'1','2')==='stale_lease','live writer: null lease is stale_lease');
  assert.deepEqual(await row('200'),snap); check(true,'live writer: wrong / null lease refusals write nothing');
  check(await refs('200',c200.lease,'1',null)==='recorded','live writer: lease holder records ad_id');
  r=await row('200'); check(r.ad_id==='1'&&r.adset_id===null&&r.ad_refs_at!==null,'live writer: only the given id filled, ad_refs_at stamped');
  check(await refs('200',c200.lease,'9','2')==='recorded','live writer: a later adset_id fills its own null column');
  r=await row('200'); check(r.ad_id==='1'&&r.adset_id==='2','live writer: a stored ad_id is never overwritten');
  const stamped=r.ad_refs_at;
  check(await refs('200',c200.lease,'7','8')==='unchanged','live writer: both stored → unchanged');
  r=await row('200'); check(r.ad_id==='1'&&r.adset_id==='2'&&r.ad_refs_at===stamped,'live writer: unchanged writes nothing');
  check(without(r,['ad_id','adset_id','ad_refs_at']).state==='processing'&&r.lease_id===c200.lease,'live writer: never touches state or lease');
  const c205=await claim('205');
  check(await refs('205',c205.lease,'','abc')==='unchanged'&&(await row('205')).ad_id===null,'live writer: malformed ids are NULL, nothing filled');
  await db.exec('reset role');
  await db.exec("update meta_lead_events set lease_until=clock_timestamp()-interval '1 second' where leadgen_id='205'");
  await db.exec('set role service_role');
  snap=await row('205');
  check(await refs('205',c205.lease,'1','2')==='stale_lease','live writer: an expired lease is stale_lease');
  assert.deepEqual(await row('205'),snap); check(true,'live writer: expired-lease refusal writes nothing');
  check(await refs('100',c100.lease,'1','2')==='stale_lease','live writer: a terminal (created) row is stale_lease, even with its old lease');

  // ---- The backfill helper: terminal only, three columns only. ----
  check(await backfill('nope','1','2')==='not_found','backfill: unknown lead is not_found');
  await named('meta_lead_record',{...five('300'),p_enabled:false});
  await named('meta_lead_record',five('301'));
  const states={disabled:'300',received:'301',processing:'200',retry:'101'};
  for(const [state,id] of Object.entries(states)){
    const s=await row(id); assert.equal(s.state,state);
    check(await backfill(id,'41','42')==='not_terminal',`backfill: refuses a ${state} receipt`);
    assert.deepEqual(await row(id),s); check(true,`backfill: ${state} refusal writes nothing`);
  }
  // Terminal rows: created (100), attached and needs_human.
  await named('meta_lead_record',five('400')); const c400=await claim('400');
  check((await named('meta_lead_intake_apply',{p_leadgen_id:'400',p_lease_id:c400.lease,p_customer_id:customer,p_location_id:shop,p_assigned_to:manager,p_intake:intake,p_raw_keys:[]})).state==='attached','fixture: attached receipt');
  await named('meta_lead_record',five('401')); const c401=await claim('401');
  await named('meta_lead_fail',{p_leadgen_id:'401',p_lease_id:c401.lease,p_error_code:'invalid_payload',p_retryable:false,p_raw_keys:['x']});
  for(const [state,id] of [['created','100'],['attached','400'],['needs_human','401']]){
    const s=await row(id); assert.equal(s.state,state);
    check(await backfill(id,' 41 ','42')==='recorded',`backfill: fills a ${state} receipt`);
    const after=await row(id);
    check(after.ad_id==='41'&&after.adset_id==='42'&&after.ad_refs_at!==null,`backfill: ${state} ids stored`);
    assert.deepEqual(without(after,['ad_id','adset_id','ad_refs_at']),without(s,['ad_id','adset_id','ad_refs_at'])); check(true,`backfill: every other ${state} column byte-identical`);
    check(await backfill(id,'51','52')==='unchanged'&&(await row(id)).ad_id==='41','backfill: never overwrites a stored id');
  }

  // ---- The documented rollback (NOT run on any database) parses and restores the old shape. ----
  await db.exec('reset role; begin;');
  await db.exec(`drop function public.meta_lead_record(text,text,text,timestamptz,boolean,text,text);
    drop function public.meta_lead_record_ad_refs(text,uuid,text,text);
    drop function public.meta_lead_backfill_ad_refs(text,text,text);
    ${record0300}
    revoke all on function public.meta_lead_record(text,text,text,timestamptz,boolean) from public, anon, authenticated, service_role;
    grant execute on function public.meta_lead_record(text,text,text,timestamptz,boolean) to service_role;`);
  await db.exec('set role service_role');
  check((await named('meta_lead_record',five('500'))).inserted&&(await row('500')).webhook_ad_id===null,'documented rollback: the 0300 call works with the columns kept');
  await db.exec('reset role; rollback;');
  check((await one("select to_regprocedure('public.meta_lead_record(text,text,text,timestamptz,boolean,text,text)') x")).x!==null,'rollback trial undone');

  console.log('two-session sim proof remains required (backfill refused under a live lease; live writer refused after expiry) — CC, sim only');
  console.log('schema-cache readiness (notify pgrst) remains required on sim — CC');
  console.log(`PASS ${checks} checks`);
} finally { await db.close(); }
