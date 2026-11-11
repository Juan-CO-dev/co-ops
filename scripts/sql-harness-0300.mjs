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
const intake={contact_name:'Synthetic',email:'synthetic@example.test',company:'Unverified text',headcount:20,event_date:'2027-01-02',fulfillment:'pickup',notes:'Synthetic note',language:'en',secondary_email:'profile@example.test'};
const quotes0120=table('0120_catering_quotes.sql','catering_quotes');
const quotes0127=read('0127_catering_portal_orders.sql').match(/ALTER TABLE catering_quotes DROP CONSTRAINT catering_quotes_status_check;[\s\S]*?CHECK \(origin IN \('self_serve','staff'\)\);/i)?.[0];
assert.ok(quotes0127);
const pipeline0129=read('0129_order_artifact_intake.sql').match(/ALTER TABLE public\.catering_pipeline\s+ADD COLUMN contact_phone[\s\S]*?dropoff_door\s+text;/i)?.[0];
assert.ok(pipeline0129);
const pipeline0139=read('0139_catering_pipeline_geo_routing.sql').match(/ALTER TABLE public\.catering_pipeline\s+ADD COLUMN geo_lat[\s\S]*?fulfillment_routed boolean NOT NULL DEFAULT false;/i)?.[0];
assert.ok(pipeline0139);
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
    ${pipeline0129}
    ${pipeline0139}
    alter table catering_pipeline drop constraint catering_pipeline_stage_check;
    alter table catering_pipeline add constraint catering_pipeline_stage_check check(stage in ('inquiry','quote_sent','confirmed','out','completed','lost'));
    ${read('0148_catering_lead_assignee.sql')}
    ${table('0110_catering_pipeline_events.sql','catering_pipeline_events')}
    alter table catering_pipeline_events drop column location_id;
    ${read('0191_pipeline_events_out_stage.sql')}
    create table public.catering_delivery_zones(id uuid primary key);
    ${quotes0120}
    ${quotes0127}
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
  for(const {oid,proname,prosecdef,proconfig} of (await db.query("select oid,proname,prosecdef,proconfig from pg_proc where proname like 'meta_lead_%' or proname in ('customer_consent_record_explicit','portal_intake_apply')")).rows){
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
  check(attachEvent.note.includes('Secondary email (Meta profile): profile@example.test'),'attach note carries the Meta profile email as a secondary contact');
  const createdLead=await one('select * from catering_pipeline where id=$1',[created.pipeline_id]);
  check(createdLead.notes.includes('Secondary email (Meta profile): profile@example.test')&&createdLead.customer_id===customer,'created lead stores the Meta email as a note, never as the identity');
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
  const consentArgs=['optin@example.test','email','meta_lead_form','2026-11-11T12:00:00Z','9:email_marketing_opt_in','meta-email-marketing-v3'];
  await db.exec('set role service_role');
  await reject(()=>rpc('customer_consent_record_explicit',[...consentArgs.slice(0,5),'meta-email-marketing-v2']),/consent_invalid/,'superseded v2 checkbox text version refused');
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

  // ── Build 2: the continuation email ledger (A3 / A6 / A9) ──────────────────────────────────
  const person=async(name)=>{const id=randomUUID(); await db.query("insert into catering_customers(id,name,email) values($1,$2,$3)",[id,name,`${name.toLowerCase()}@example.test`]); return id;};
  const createLead=async(id,c)=>{await receive(id); const cl=await claim(id); const r=await rpc('meta_lead_intake_apply',[id,cl.lease,c,shop,manager,{...intake,email:(await one('select email from catering_customers where id=$1',[c])).email},['email']]); return r;};
  const ledger=(id)=>one('select * from meta_lead_events where leadgen_id=$1',[id]);
  const emailClaim=(id)=>rpc('meta_lead_email_claim',[id]);
  const emailResult=(id,state,token,provider)=>rpc('meta_lead_email_result',[id,state,token,provider]);
  await db.exec('set role service_role');
  const alice=await person('Alice'); const aliceLead=await createLead('20',alice);
  check(aliceLead.state==='created'&&(await ledger('20')).email_state==='pending','created lead starts email pending');
  check(!(await emailResult('20','sent',randomUUID(),'re_1')),'result before claim is refused');
  const claimed=await emailClaim('20');
  const parked=await ledger('20');
  check(claimed.claimed===true&&parked.state==='needs_human'&&parked.error_code==='email_unknown'&&parked.email_state==='unknown'&&parked.email_attempted_at!==null&&parked.intake_snapshot!==null,'claim parks the row as unknown before any send');
  check((await emailClaim('20')).reason==='not_claimable','second claim refused');
  await reject(()=>emailResult('20','sent',null,'re_1'),/invalid_email_result/,'sent needs the token');
  await reject(()=>emailResult('20','sent',randomUUID(),' '),/invalid_email_result/,'sent needs the provider id');
  await reject(()=>emailResult('20','mailed',randomUUID(),'re_1'),/invalid_email_result/,'unknown result state refused');
  const token20=randomUUID();
  check(await emailResult('20','sent',token20,'re_1'),'confirmed provider id records sent');
  const sent=await ledger('20');
  check(sent.state==='created'&&sent.error_code===null&&sent.email_state==='sent'&&sent.portal_token_id===token20&&sent.email_provider_id==='re_1'&&sent.intake_snapshot===null,'sent restores created, pairs the token with the snapshot erasure');
  check(!(await emailResult('20','failed',token20,null)),'a second result never rewrites a sent row');
  const aliceAgain=await createLead('21',alice);
  check(aliceAgain.state==='attached'&&(await ledger('21')).email_state==='not_applicable'&&(await emailClaim('21')).reason==='not_claimable','an attached submission never claims an email');
  const bob=await person('Bob'); await createLead('22',bob); await emailClaim('22');
  const token22=randomUUID();
  check(await emailResult('22','unknown',token22,null),'unknown result accepted with its token');
  const unknown=await ledger('22');
  check(unknown.state==='needs_human'&&unknown.email_state==='unknown'&&unknown.portal_token_id===token22&&unknown.intake_snapshot===null&&unknown.completed_at!==null,'unknown keeps the token, erases the snapshot, parks the lead');
  await db.exec('reset role');
  await db.query("update catering_pipeline set stage='completed' where customer_id=$1",[bob]);
  await db.exec('set role service_role');
  const bobLater=await createLead('23',bob);
  check(bobLater.state==='created','a completed lead lets the next submission create a new one');
  check((await emailClaim('23')).reason==='capped','second email to one address inside 24 h is capped in SQL');
  const capped=await ledger('23');
  check(capped.state==='needs_human'&&capped.error_code==='email_capped'&&capped.email_state==='capped'&&capped.intake_snapshot===null&&capped.email_attempted_at===null&&capped.portal_token_id===null,'capped parks the lead with no token and no snapshot');
  const carol=await person('Carol'); await createLead('24',carol); await emailClaim('24'); const token24=randomUUID();
  check(await emailResult('24','failed',token24,null),'failed result accepted');
  const failed=await ledger('24');
  check(failed.state==='needs_human'&&failed.error_code==='email_failed'&&failed.email_state==='failed'&&failed.portal_token_id===token24&&failed.intake_snapshot===null,'failed records the undelivered token and erases the snapshot');
  const dave=await person('Dave'); await createLead('25',dave); await emailClaim('25');
  check(await emailResult('25','suppressed',null,null),'suppressed result accepted');
  const suppressed=await ledger('25');
  check(suppressed.email_state==='suppressed'&&suppressed.error_code==='configuration'&&suppressed.email_attempted_at===null&&suppressed.intake_snapshot===null,'suppressed names configuration and counts no attempt');
  const erin=await person('Erin'); await createLead('26',erin); await emailClaim('26');
  check(await emailResult('26','capped',null,null),'JS rate-limit cap result accepted');
  check((await ledger('26')).email_state==='capped'&&(await ledger('26')).email_attempted_at===null,'rate-limited send counts no attempt');
  await db.exec('reset role');
  await reject(()=>db.query("update meta_lead_events set email_state='sent' where leadgen_id='25'"),/check constraint/,'sent without token and provider id is refused by CHECK');
  await db.exec('set role service_role');

  // ── Build 2: portal_intake_apply (A1) ───────────────────────────────────────────────────────
  const portalIntake={contact_name:'Alice Portal',location_id:shop,event_date:'2027-03-04',headcount:12,is_delivery:true,contact_phone:'+12025550100',
    delivery_address:'1 Example St',time_window:'11-12',event_type:'Lunch',dietary_notes:'None',event_name:'Offsite',dropoff_door:'Side',geo_lat:38.9,geo_lng:-77.0,fulfillment_routed:true,company:'Alice Co'};
  const portalApply=(c,p,i=portalIntake)=>rpc('portal_intake_apply',[c,p,i]);
  const attach=await portalApply(alice,aliceLead.pipeline_id);
  const attachedQuote=await one('select * from catering_quotes where id=$1',[attach.quote_id]);
  check(attach.attached===true&&attach.pipeline_id===aliceLead.pipeline_id&&attachedQuote.pipeline_id===aliceLead.pipeline_id&&attachedQuote.customer_id===alice&&attachedQuote.status==='draft'&&attachedQuote.origin==='self_serve'&&attachedQuote.location_id===shop&&attachedQuote.is_delivery===true,'portal continuation attaches ONLY a draft quote to the owned open lead');
  check((await one('select count(*)::int n from catering_pipeline where customer_id=$1',[alice])).n===1&&(await one('select count(*)::int n from catering_pipeline_events where pipeline_id=$1 and to_stage=$2 and from_stage is null',[aliceLead.pipeline_id,'inquiry'])).n===1,'attach creates no lead and no stage event');
  const again=await portalApply(alice,aliceLead.pipeline_id);
  check(again.attached===false&&again.pipeline_id!==aliceLead.pipeline_id,'a lead with a live quote falls back to a new portal lead');
  const portalLead=await one('select * from catering_pipeline where id=$1',[again.pipeline_id]);
  check(portalLead.lead_source==='portal'&&portalLead.stage==='inquiry'&&portalLead.customer_id===alice&&portalLead.delivery_address==='1 Example St'&&portalLead.time_window==='11-12'&&portalLead.event_type==='Lunch'&&portalLead.dietary_notes==='None'&&portalLead.event_name==='Offsite'&&portalLead.dropoff_door==='Side'&&portalLead.geo_lat===38.9&&portalLead.geo_lng===-77&&portalLead.fulfillment_routed===true&&portalLead.company==='Alice Co'&&portalLead.contact_phone==='+12025550100','create branch stores every intake column like today');
  check((await one('select count(*)::int n from catering_pipeline_events where pipeline_id=$1 and from_stage is null and to_stage=$2',[again.pipeline_id,'inquiry'])).n===1,'create branch writes the inquiry stage event');
  const frank=await person('Frank');
  const foreign=await portalApply(frank,aliceLead.pipeline_id);
  check(foreign.attached===false&&foreign.pipeline_id!==aliceLead.pipeline_id&&(await one('select customer_id from catering_pipeline where id=$1',[aliceLead.pipeline_id])).customer_id===alice,'another customer never attaches to a lead they do not own');
  const grace=await person('Grace'); const graceLead=await createLead('27',grace);
  await db.exec('reset role');
  await db.query("update catering_pipeline set stage='confirmed' where id=$1",[graceLead.pipeline_id]);
  await db.exec('set role service_role');
  check((await portalApply(grace,graceLead.pipeline_id)).attached===false,'a confirmed lead is never reopened by the portal');
  const heidi=await person('Heidi');
  await db.exec('reset role');
  const bare=await one("insert into catering_pipeline(customer_id,contact_name,stage,lead_source) values($1,'Heidi','inquiry','meta_lead_form') returning id",[heidi]);
  await db.exec('set role service_role');
  const filled=await portalApply(heidi,bare.id);
  check(filled.attached===true&&(await one('select location_id from catering_pipeline where id=$1',[bare.id])).location_id===shop,'attach fills a null lead location from the intake');
  await reject(()=>portalApply(heidi,null,{...portalIntake,location_id:randomUUID()}),/invalid_location/,'unknown location refused');
  await reject(()=>portalApply(heidi,null,{...portalIntake,contact_name:' '}),/invalid_intake/,'blank contact name refused');
  await reject(()=>portalApply(randomUUID(),null),/invalid_customer/,'unknown customer refused');
  await db.exec('reset role');
  console.log(`PASS ${checks} checks. Offline single-session proof; simultaneous two-session sim proof remains required before apply.`);
} finally {await db.close();}
