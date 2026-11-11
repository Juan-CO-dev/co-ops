/** 0300 offline proof: real parent DDL/helpers and migration; synthetic fixtures only. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const read=n=>readFileSync(new URL(`../supabase/migrations/${n}`,import.meta.url),'utf8');
const migration=read('0300_meta_leads.sql');
function table(file,name) { const m=read(file).match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`,'i')); assert.ok(m,name); return m[0]; }
const lease0275=read('0275_schedule_weeks.sql').match(/alter table public\.cron_route_leases drop constraint cron_route_leases_job_check,[\s\S]*?grant execute on function public\.claim_cron_route\(text\) to service_role;/i)?.[0];
assert.ok(lease0275);
const profiles=read('0234_customer_profiles.sql');
function fn(name) {const m=profiles.match(new RegExp(`create function public\\.${name}\\([\\s\\S]*?\\$\\$;`,'i')); assert.ok(m,name); return m[0];}
const consentView=profiles.match(/create view public\.customer_consent_current[\s\S]*?e\.id desc;/i)?.[0];
assert.ok(consentView);
const db=new PGlite(); let checks=0;
const check=(v,s)=>{assert.ok(v,s);checks++;console.log(`ok ${s}`);};
const one=async(s,a=[])=>(await db.query(s,a)).rows[0];
const rpc=async(n,a)=>(await one(`select public.${n}(${a.map((_,i)=>`$${i+1}`).join(',')}) result`,a)).result;
const reject=async(f,re,s)=>{await assert.rejects(f,re);check(true,s);};
const shop=randomUUID(),manager=randomUUID(),customer=randomUUID();
const intake={contact_name:'Synthetic',email:'synthetic@example.test',company:'Unverified text',headcount:20,event_date:'2027-01-02',fulfillment:'pickup',notes:'Synthetic note',language:'en'};
async function receive(id,enabled=true){return rpc('meta_lead_record',[id,'10','20','2026-11-11T12:00:00Z',enabled]);}
async function claim(id){const lease=randomUUID(); const result=await rpc('meta_lead_claim',[id,lease]);return {lease,...result};}
const apply=(id,lease,c=customer)=>rpc('meta_lead_intake_apply',[id,lease,c,shop,manager,intake,['full_name','email','unknown']]);
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to public,anon,authenticated,service_role;
    alter default privileges in schema public grant all on functions to public,anon,authenticated,service_role;
    create table locations(id uuid primary key,active boolean default true);
    create table users(id uuid primary key,role text,active boolean);
    ${table('0108_catering_scaffold_capture.sql','catering_customers')}
    ${table('0108_catering_scaffold_capture.sql','catering_pipeline')}
    alter table catering_pipeline add column contact_phone text;
    alter table catering_pipeline drop constraint catering_pipeline_stage_check;
    alter table catering_pipeline add constraint catering_pipeline_stage_check check(stage in ('inquiry','quote_sent','confirmed','out','completed','lost'));
    ${read('0148_catering_lead_assignee.sql')}
    ${table('0110_catering_pipeline_events.sql','catering_pipeline_events')}
    alter table catering_pipeline_events drop column location_id;
    ${read('0191_pipeline_events_out_stage.sql')}
    ${['customers','customer_identifiers','customer_consent_imports','customer_consent_events','customer_merge_suggestions','customer_suppressions'].map(n=>table('0234_customer_profiles.sql',n)).join('\n')}
    ${['customer_sha256','customer_root','customer_email_is_relay','customer_identity_lock','customer_resolve'].map(fn).join('\n')}
    ${consentView}
    ${fn('customer_marketing_export')}
    ${read('0243_cron_route_leases.sql')}
    ${lease0275}
  `);
  // Each sabotage lives in a transaction; failed preflight rolls it back too.
  const refusePreflight=async(sql,re,label)=>{
    await db.exec('begin;'+sql);
    await reject(()=>db.exec(migration),re,label);
    await db.exec('rollback');
    check((await one("select to_regclass('public.meta_lead_events') x")).x===null,`${label}: no partial DDL`);
  };
  for(const helper of ['customer_identity_lock()', 'customer_resolve(text,text,text,text,text,uuid,timestamptz,text,text)', 'customer_email_is_relay(text)', 'customer_sha256(text)']) {
    await refusePreflight(`alter function public.${helper} rename to missing_helper`,/missing 0234 helper/,`missing ${helper} refused`);
  }
  for(const [table,column] of [['users','role'],['catering_pipeline','contact_phone']]) {
    await refusePreflight(`alter table public.${table} rename column ${column} to missing_column`,new RegExp(`missing ${table}.${column}`),`missing ${table}.${column} refused`);
  }
  for(const [table,name] of [['customers','customers_sources_check'],['customer_consent_events','customer_consent_events_source_check']]) {
    await refusePreflight(`alter table public.${table} drop constraint ${name}; alter table public.${table} add constraint ${name} check(true)`,new RegExp(`${name} drift`),`${name} drift refused`);
    await refusePreflight(`alter table public.${table} drop constraint ${name}`,new RegExp(`${name} drift`),`${name} absent refused`);
  }
  await refusePreflight('create table meta_lead_events(id text)',/already applied/,'already applied refused');
  await refusePreflight("alter table cron_route_leases drop constraint cron_route_leases_job_check; alter table cron_route_leases add constraint cron_route_leases_job_check check(job in ('unknown-job'))",/cron_route_leases_job_check is neither/,'unknown cron set refused');
  const union=lease0275.replaceAll("'schedule-draft'", "'schedule-draft', 'catering-inbox-delivery', 'meta-leads'");
  await db.exec('begin;'+union+"insert into cron_route_leases(job,lease_until) values('catering-inbox-delivery',clock_timestamp()+interval '330 seconds');");
  await db.exec(migration.replace(/commit;\s*$/, ''));
  check((await one("select count(*)::int n from cron_route_leases where job='catering-inbox-delivery'")).n===1,'post-0298 union applies with existing inbox lease');
  check(!(await rpc('claim_cron_route',['catering-inbox-delivery'])),'existing inbox lease remains held');
  await db.exec('rollback');
  await reject(()=>db.exec(migration.replace('revoke all on public.%I from public, anon, authenticated, service_role','revoke all on public.%I from anon, authenticated')),/meta table privilege escape/,'permissive ACL sabotage caught');
  await db.exec('rollback');
  check((await one("select to_regclass('public.meta_lead_events') x")).x===null,'failed migration rolls back');
  await db.exec(migration);
  check(true,'pre-0298 four-set applies');
  for(const role of ['anon','authenticated','service_role']) for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) {
    check((await one('select has_table_privilege($1,$2,$3) x',[role,'meta_lead_events',privilege])).x===(role==='service_role'&&privilege==='SELECT'),`${role} ${privilege} ceiling`);
  }
  for(const {oid,proname,prosecdef,proconfig} of (await db.query("select oid,proname,prosecdef,proconfig from pg_proc where proname like 'meta_lead_%' or proname='customer_consent_record_explicit'")).rows){
    check(prosecdef&&proconfig.includes('search_path=pg_catalog, public'),`${proname} definer/path`);
    for(const role of ['anon','authenticated','service_role']) check((await one("select has_function_privilege($1,$2::oid,'EXECUTE') x",[role,oid])).x===(role==='service_role'),`${proname} ${role} execute`);
  }
  await db.query('insert into locations(id) values($1)',[shop]);
  await db.query("insert into users values($1,'catering_mgr',true)",[manager]);
  await db.query("insert into catering_customers(id,name,email) values($1,'Synthetic',$2)",[customer,intake.email]);
  await db.exec('set role service_role');
  check((await receive('1',false)).inserted,'switch off receipt');
  check(!(await receive('1',true)).inserted,'duplicate does not reactivate disabled event');
  check(!(await claim('1')).claimed,'disabled cannot be claimed');
  check((await receive('2')).inserted,'enabled receipt');
  const c=await claim('2');check(c.claimed&&c.page_id==='10'&&c.form_id==='20','claim returns immutable evidence');
  check(!(await claim('2')).claimed,'live lease excludes second worker');
  await reject(()=>apply('2',randomUUID()),/stale_lease/,'stale worker cannot write');
  const created=await apply('2',c.lease);check(created.state==='created','first submission creates lead only');
  check((await apply('2',c.lease)).pipeline_id===created.pipeline_id,'apply replay keeps same lead');
  await receive('3');const c3=await claim('3');const attached=await apply('3',c3.lease);
  const attachEvent=await one("select * from catering_pipeline_events where pipeline_id=$1 and note like 'Meta lead form 3%'",[created.pipeline_id]);
  check(attachEvent.from_stage===attachEvent.to_stage&&attachEvent.note.includes('no stage change'),'attach records no stage change');
  check(['Name: Synthetic','Phone:','Event date: 2027-01-02','Headcount: 20','Fulfillment: pickup','Notes: Synthetic note'].every(v=>attachEvent.note.includes(v)),'attach has fixed readable fields');
  check(!attachEvent.note.includes('Unverified text')&&!attachEvent.note.includes('language')&&!attachEvent.note.includes('{'),'attach never serializes raw intake');
  check(attached.state==='attached'&&attached.pipeline_id===created.pipeline_id,'same customer second submission attaches');
  check((await one('select count(*)::int n from catering_pipeline')).n===1,'one pipeline for two submissions');
  check((await one("select intake_snapshot from meta_lead_events where leadgen_id='3'")).intake_snapshot===null,'attach snapshot erased');
  const before=await one('select * from catering_pipeline where id=$1',[created.pipeline_id]);
  await receive('4');const c4=await claim('4');await apply('4',c4.lease);
  assert.deepEqual(await one('select * from catering_pipeline where id=$1',[created.pipeline_id]),before);check(true,'attach does not modify any lead column');
  await db.exec('reset role');
  for(const stage of ['confirmed','out']){
    await db.query('update catering_pipeline set stage=$1 where id=$2',[stage,created.pipeline_id]);
    const id=stage==='confirmed'?'5':'6';await receive(id);const cl=await claim(id);
    check((await apply(id,cl.lease)).error_code==='closed_lead',`${stage} needs human`);
  }
  await db.query("update catering_pipeline set stage='inquiry' where id=$1",[created.pipeline_id]);
  await db.query("insert into catering_pipeline(customer_id,contact_name,stage) values($1,'Other','quote_sent')",[customer]);
  await receive('7');const c7=await claim('7');check((await apply('7',c7.lease)).error_code==='ambiguous_leads','multiple candidates need human');
  await receive('8');const c8=await claim('8');
  await reject(()=>rpc('meta_lead_fail',['8',c8.lease,'provider secret token',true,[]]),/check constraint/,'closed errors reject arbitrary provider text');
  check(await rpc('meta_lead_fail',['8',c8.lease,'graph_timeout',true,[]]),'transient failure retries');
  check(!(await claim('8')).claimed,'backoff enforced');
  await receive('13');const c13=await claim('13');
  await db.exec("update meta_lead_events set lease_until=clock_timestamp()-interval '1 second' where leadgen_id='13'");
  check(!(await rpc('meta_lead_fail',['13',c13.lease,'database',true,[]])),'expired lease cannot finalize failure');
  const newer=await claim('13');check(newer.claimed&&newer.attempts===2,'expired lease is reclaimed with attempt increment');
  await reject(()=>apply('13',c13.lease),/stale_lease/,'reclaimed lease fences previous worker');
  await db.exec("update meta_lead_events set attempts=5,lease_until=clock_timestamp()-interval '1 second' where leadgen_id='13'");
  check(!(await claim('13')).claimed,'attempt ceiling prevents sixth claim');
  check((await one("select state,error_code from meta_lead_events where leadgen_id='13'")).error_code==='attempts_exhausted','abandoned final attempt moves to human queue');
  await reject(()=>db.query("update meta_lead_events set portal_token_id=$1 where leadgen_id='2'",[randomUUID()]),/check constraint/,'token requires snapshot nulling');
  await db.query("update meta_lead_events set portal_token_id=$1,intake_snapshot=null where leadgen_id='2'",[randomUUID()]);
  check(true,'A9 paired token and erasure permitted');
  const consentArgs=['optin@example.test','email','meta_lead_form','2026-11-11T12:00:00Z','9:email_marketing_opt_in','meta-email-marketing-v2'];
  await db.exec('set role service_role');
  check((await rpc('customer_consent_record_explicit',consentArgs)).recorded,'explicit tick creates consent event');
  check(!(await rpc('customer_consent_record_explicit',consentArgs)).recorded,'evidence replay is idempotent');
  const exported=(await db.query("select * from customer_marketing_export('email')")).rows;
  check(exported.length===1&&exported[0].value==='optin@example.test','marketing export includes only explicitly opted-in subject');
  await reject(()=>rpc('customer_consent_record_explicit',['other@example.test',...consentArgs.slice(1)]),/consent_evidence_conflict/,'evidence cannot change address');
  await reject(()=>rpc('customer_consent_record_explicit',['relay@doordash.com',...consentArgs.slice(1,4),'10:email_marketing_opt_in',consentArgs[5]]),/consent_relay/,'relay refused');
  const count=(await one('select count(*)::int n from customer_consent_events')).n;
  // Unticked is an absence of a call, tested in worker tests; the SQL ledger receipt itself must not create consent.
  await receive('11');check((await one('select count(*)::int n from customer_consent_events')).n===count,'receipt alone creates no consent');
  await db.exec('reset role');
  await db.exec("insert into customer_suppressions(kind,value_sha256,reason) values('email',customer_sha256('erased@example.test'),'delete_request')");
  await reject(()=>rpc('customer_consent_record_explicit',['erased@example.test',...consentArgs.slice(1,4),'12:email_marketing_opt_in',consentArgs[5]]),/consent_suppressed/,'suppressed hash refused');
  await receive('16');const wideKeysClaim=await claim('16');
  const wideKeys=Array.from({length:100},(_,i)=>String(i).padStart(3,'0')+'界'.repeat(77));
  check(await rpc('meta_lead_fail',['16',wideKeysClaim.lease,'invalid_payload',false,wideKeys]),'bounded Unicode raw keys fit ledger byte ceiling');
  check((await one("select cardinality(raw_keys) n from meta_lead_events where leadgen_id='16'")).n===100,'all bounded raw keys retained without values');
  const concurrentCustomer=randomUUID();
  const concurrentIntake={...intake,email:'concurrent@example.test'};
  await db.query("insert into catering_customers(id,name,email) values($1,'Concurrent',$2)",[concurrentCustomer,concurrentIntake.email]);
  await Promise.all([receive('14'),receive('15')]);
  const concurrentClaims=await Promise.all([claim('14'),claim('15')]);
  // Concurrent JS calls deliberately share PGlite's one PostgreSQL session. This
  // proves the invocation/result contract, not independent-session lock waiting.
  await db.exec('set role service_role');
  const concurrentResults=await Promise.all(['14','15'].map((id,i)=>rpc('meta_lead_intake_apply',[
    id,concurrentClaims[i].lease,concurrentCustomer,shop,manager,concurrentIntake,['email'],
  ])));
  assert.deepEqual(concurrentResults.map(r=>r.state).sort(),['attached','created']);
  check(concurrentResults[0].pipeline_id===concurrentResults[1].pipeline_id,'concurrent same-email invocations create one lead plus attach');
  check((await one('select count(*)::int n from catering_pipeline where customer_id=$1',[concurrentCustomer])).n===1,'concurrent same-email invocations leave exactly one pipeline');
  await db.exec('reset role');
  check(await rpc('claim_cron_route',['meta-leads']),'backstop house lease works');
  check(!(await rpc('claim_cron_route',['meta-leads'])),'backstop house lease excludes overlap');
  console.log(`PASS ${checks} checks. Offline single-session proof; simultaneous two-session sim proof remains required before apply.`);
} finally {await db.close();}
