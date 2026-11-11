/** Real 0170/0175/0294/0297 DDL, isolated synthetic PGlite; no network. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID as uuid } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const migration = read('0297_vendor_mail.sql');
const extract = (file, pattern) => { const found=read(file).match(pattern); assert.ok(found,`real prerequisite ${file}`); return found[0]; };
const db = new PGlite();
let checks=0;
const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
const one=async(sql,args=[]) => (await q(sql,args))[0];
const check=(ok,label) => { assert.ok(ok,label); checks++; console.log(`ok ${label}`); };
const reject=async(fn,re,label) => { await assert.rejects(fn,re); check(true,label); };
const shop=uuid(), other=uuid(), vendor=uuid(), po=uuid(), delivery=uuid();
const actors=Object.fromEntries(['gm','wrongGM','owner','moo','cgs','agm','prep_mgr','social_media_mgr','shift_lead','inactive'].map(k=>[k,uuid()]));
const sessions=new Map();
async function service(fn) { await db.exec('set role service_role'); try { return await fn(); } finally { await db.exec('reset role'); } }
async function rpc(name,args) { return service(async()=> (await one(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) result`,args)).result); }
const act=(id,actor,action,payload={},rev=0,request=uuid(),session=sessions.get(actor))=>rpc('vendor_mail_act',[id,rev,request,actor,session,action,payload]);
async function message(location=shop,lane='vendor_receipt') { const id=uuid(); await db.query('insert into inbound_messages(id,provider_email_id,location_id,lane) values($1::uuid,$1::text,$2,$3)',[id,location,lane]); return id; }
async function receipt(id,location=shop) { const rid=uuid(); await db.query("insert into email_receipts(id,source,inbound_message_id,location_id) values($1,'inbound',$2,$3)",[rid,id,location]); await db.query('update inbound_messages set email_receipt_id=$1 where id=$2',[rid,id]); return rid; }
const count=async(id,type)=>(await one('select count(*)::int n from vendor_mail_events where inbound_message_id=$1 and event_type=$2',[id,type])).n;
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to public,anon,authenticated,service_role;
    alter default privileges in schema public grant all on functions to public,anon,authenticated,service_role;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table locations(id uuid primary key,active boolean not null default true);
    create table vendors(id uuid primary key,active boolean not null default true);
    create table users(id uuid primary key,role text not null,active boolean not null);
    create table sessions(id uuid primary key,user_id uuid references users(id),revoked_at timestamptz,expires_at timestamptz not null);
    create table user_locations(user_id uuid references users(id),location_id uuid references locations(id),active boolean not null);
    create table vendor_deliveries(id uuid primary key);
    create table purchase_orders(id uuid primary key);
    ${extract('0170_email_receipts.sql',/create table if not exists public\.email_receipts \([\s\S]*?\n\);/i)}
    ${extract('0170_email_receipts.sql',/insert into storage\.buckets[\s\S]*?on conflict \(id\) do nothing;/i)}
    ${extract('0175_vendor_ordering_v2.sql',/ALTER TABLE public\.email_receipts[\s\S]*?;/i)}
  `);
  await db.exec(read('0294_inbound_router.sql'));
  const older=uuid(),newer=uuid(),catering=uuid();
  await db.query("insert into inbound_messages(id,provider_email_id,lane,received_at) values($1::uuid,$1::text,'vendor_receipt','2026-11-01'),($2::uuid,$2::text,'vendor_receipt','2026-11-02'),($3::uuid,$3::text,'catering','2026-10-01')",[older,newer,catering]);
  await reject(()=>db.exec(migration.replace('revoke all on public.%I from public,anon,authenticated,service_role','revoke all on public.%I from anon,authenticated')),/vendor mail table privilege escape/,'broken permissive ACL variant detected');
  await db.exec('rollback');
  check((await one("select to_regclass('public.vendor_mail_events') value")).value===null,'failed migration rolls back schema');
  await db.exec(migration);
  const bucket=await one("select * from storage.buckets where id='receipts'");
  check(bucket.public===false && bucket.allowed_mime_types===null && Number(bucket.file_size_limit)===41943040,'private existing bucket widened to 40 MiB with no MIME gate');
  check((await one('select reference_code from inbound_messages where id=$1',[older])).reference_code==='VM-1' && (await one('select reference_code from inbound_messages where id=$1',[newer])).reference_code==='VM-2','references backfilled in received order');
  check(await count(older,'baseline')===1 && await count(catering,'baseline')===0,'vendor-only historical baselines');
  for (const table of ['vendor_mail_events','vendor_mail_read']) {
    const columns=await q('select column_name from information_schema.columns where table_name=$1',[table]);
    for (const role of ['anon','authenticated','service_role']) {
      for (const p of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) assert.equal((await one('select has_table_privilege($1,$2,$3) ok',[role,table,p])).ok,role==='service_role' && p==='SELECT');
      for(const {column_name} of columns) for(const p of ['SELECT','INSERT','UPDATE','REFERENCES']) assert.equal((await one('select has_column_privilege($1,$2,$3,$4) ok',[role,table,column_name,p])).ok,role==='service_role' && p==='SELECT');
    }
    check(true,`${table}: SELECT-only table and column ceiling`);
  }
  const permitted=['lane','location_id','route_reason','content_state','fetch_attempts','next_attempt_at','last_error','lease_token','email_receipt_id','attachment_manifest','archive_state','archive_error'].sort();
  const actual=(await q("select column_name from information_schema.columns where table_name='inbound_messages' and has_column_privilege('service_role','public.inbound_messages',column_name,'UPDATE')")).map(r=>r.column_name).sort();
  assert.deepEqual(actual,permitted); check(true,'exact inbound worker UPDATE grant list');
  for(const f of await q("select oid,proname,prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace and proname like 'vendor_mail_%'")) {
    assert.equal(f.prosecdef,true); assert.ok(f.proconfig.includes('search_path=pg_catalog, public'));
    for(const role of ['anon','authenticated','service_role']) assert.equal((await one("select has_function_privilege($1,$2::oid,'EXECUTE') ok",[role,f.oid])).ok,role==='service_role' && ['vendor_mail_act','vendor_mail_forward_claim','vendor_mail_forward_result'].includes(f.proname));
    check(true,`${f.proname}: private helpers and bounded RPC grants`);
  }
  await db.query('insert into locations(id) values($1),($2)',[shop,other]);
  await db.query('insert into vendors(id) values($1)',[vendor]);
  await db.query('insert into purchase_orders values($1)',[po]); await db.query('insert into vendor_deliveries values($1)',[delivery]);
  for(const [role,id] of Object.entries(actors)) { await db.query('insert into users values($1,$2,$3)',[id,role==='wrongGM'||role==='inactive'?'gm':role,role!=='inactive']); const sid=uuid(); sessions.set(id,sid); await db.query("insert into sessions values($1,$2,null,clock_timestamp()+interval '1 hour')",[sid,id]); }
  await db.query('insert into user_locations values($1,$2,true),($3,$4,true)',[actors.gm,shop,actors.wrongGM,other]);
  const forged=uuid();
  await service(()=>db.query("insert into inbound_messages(id,provider_email_id,lane,reference_code,revision,handled_by,handled_at,handled_reason,manual_location_id,manual_vendor_id) values($1::uuid,$1::text,'vendor_receipt','VM-FORGED',99,$2,now(),'forged',$3,$4)",[forged,actors.owner,shop,vendor]));
  const sanitized=await one('select reference_code,revision,handled_by,handled_at,handled_reason,manual_location_id,manual_vendor_id from inbound_messages where id=$1',[forged]);
  check(sanitized.reference_code!=='VM-FORGED' && sanitized.revision===0 && Object.entries(sanitized).filter(([key])=>!['reference_code','revision'].includes(key)).every(([,value])=>value===null),'service INSERT cannot forge human projection');
  const m=await message(); check(await count(m,'received')===1,'vendor insert creates system received event');
  const rid=await receipt(m); check(await count(m,'receipt')===1,'receipt INSERT trigger');
  for(const [field,value] of [['content_state','failed'],['last_error','provider_error'],['location_id',other],['email_receipt_id',null],['lane','noise'],['lane','vendor_receipt']]) { const before=await count(m,'transport'); await db.query(`update inbound_messages set ${field}=$1 where id=$2`,[value,m]); check(await count(m,'transport')===before+1,`transport trigger ${field}=${value}`); }
  await db.query('update inbound_messages set email_receipt_id=$1,location_id=$2 where id=$3',[rid,shop,m]);
  for(const [field,value] of [['parse_state','failed'],['location_id',other],['linked_po_id',po],['linked_delivery_id',delivery],['attribution_conflict',true]]) { const before=await count(m,'receipt'); await db.query(`update email_receipts set ${field}=$1 where id=$2`,[value,rid]); check(await count(m,'receipt')===before+1,`receipt trigger ${field}`); }
  const cm=await message(null,'catering'); const cr=await receipt(cm,null); await db.query("update inbound_messages set content_state='failed',last_error='provider_error',location_id=$1 where id=$2",[shop,cm]); await db.query("update email_receipts set parse_state='failed',location_id=$1,linked_po_id=$2,linked_delivery_id=$3,attribution_conflict=true where id=$4",[shop,po,delivery,cr]);
  check((await one('select count(*)::int n from vendor_mail_events where inbound_message_id=$1',[cm])).n===0,'all catering insert/update transitions excluded');
  check((await one('select count(*)::int n from vendor_mail_events where actor_id is not null')).n===0,'machine observations have system actor');
  const target=await message();
  const canonical=await message(shop); await receipt(canonical,null);
  const canonicalLocation=(await one('select effective_location_id from vendor_mail_read where id=$1',[canonical])).effective_location_id;
  check(canonicalLocation===null && !(await one('select vendor_mail_can_access($1,$2) ok',[actors.gm,canonicalLocation])).ok,'receipt null shop overrides transport shop for GM access');
  await reject(()=>act(canonical,actors.gm,'handle',{reason:'Done'}),/forbidden/,'receipt null shop denies GM RPC');
  for(const role of ['wrongGM','inactive','agm','prep_mgr','social_media_mgr','shift_lead']) await reject(()=>act(target,actors[role],'handle',{reason:'Done'}),/forbidden/,`${role} refused`);
  const request=uuid(); await act(target,actors.gm,'handle',{reason:'Done'},0,request);
  check((await act(target,actors.gm,'handle',{reason:'Done'},0,request)).replayed,'handle replay precedes revision check');
  await reject(()=>act(target,actors.gm,'handle',{reason:'Changed'},0,request),/request_conflict/,'handle payload fingerprint conflict');
  await reject(()=>act(target,actors.gm,'handle',{reason:'Done'}),/stale_revision/,'expected revision enforced');
  await reject(()=>act(target,actors.gm,'handle',{reason:'Done'},1),/invalid_state/,'handled terminal guard');
  await db.query('update sessions set revoked_at=now() where id=$1',[sessions.get(actors.gm)]);
  await reject(()=>act(target,actors.gm,'handle',{reason:'Done'},0,request),/forbidden/,'replay rechecks revoked session');
  await db.query('update sessions set revoked_at=null where id=$1',[sessions.get(actors.gm)]);
  await reject(()=>act(target,actors.gm,'handle',{reason:'Done'},0,request,sessions.get(actors.owner)),/forbidden/,'different actor session refused');
  await db.query("update sessions set expires_at=now()-interval '1 second' where id=$1",[sessions.get(actors.gm)]);
  await reject(()=>act(target,actors.gm,'handle',{reason:'Done'},0,request),/forbidden/,'expired session refused');
  await db.query("update sessions set expires_at=now()+interval '1 hour' where id=$1",[sessions.get(actors.gm)]);
  await db.query('update user_locations set active=false where user_id=$1',[actors.gm]);
  await reject(()=>act(target,actors.gm,'handle',{reason:'Done'},0,request),/forbidden/,'replay rechecks membership');
  await db.query('update user_locations set active=true where user_id=$1',[actors.gm]);
  await db.query('update users set active=false where id=$1',[actors.gm]);
  await reject(()=>act(target,actors.gm,'handle',{reason:'Done'},0,request),/forbidden/,'replay rechecks active actor');
  await db.query('update users set active=true where id=$1',[actors.gm]);
  const unknown=await message(null); await reject(()=>act(unknown,actors.gm,'handle',{reason:'Done'}),/forbidden/,'GM null-shop refused');
  for(const role of ['moo','owner','cgs']) await act(await message(null),actors[role],'handle',{reason:'Done'});
  check(true,'level 8+ null-shop access');
  const ar=uuid(); await act(unknown,actors.owner,'assign',{location_id:shop,vendor_id:vendor},0,ar);
  check((await act(unknown,actors.owner,'assign',{location_id:shop,vendor_id:vendor},0,ar)).replayed,'assignment replay');
  await reject(()=>act(unknown,actors.owner,'assign',{location_id:other},0,ar),/request_conflict/,'assignment payload conflict');
  await reject(()=>act(unknown,actors.owner,'assign',{location_id:other},1),/already_attributed/,'assignment cannot move attributed shop');
  const assignedReceipt=await receipt(unknown,other);
  const preserved=await one('select location_id,vendor_guess_id,attributed_by from email_receipts where id=$1',[assignedReceipt]);
  check(preserved.location_id===shop && preserved.vendor_guess_id===vendor && preserved.attributed_by==='manual','manual assignment survives later receipt INSERT');
  const invalidAssignment=await message(null);
  for(const payload of [{location_id:{}},{vendor_id:42},{location_id:'not-a-uuid'}]) await reject(()=>act(invalidAssignment,actors.owner,'assign',payload),/invalid_input/,'invalid assignment JSON/UUID refused');
  const lease=await message(); await db.query('update inbound_messages set lease_token=$1 where id=$2',[uuid(),lease]);
  await reject(()=>act(lease,actors.owner,'assign',{vendor_id:vendor}),/worker_busy/,'assignment refuses worker lease');
  await reject(()=>act(m,actors.owner,'assign',{vendor_id:vendor}),/linked_evidence/,'assignment refuses linked PO/delivery');
  const redrive=await message(); await db.query("update inbound_messages set content_state='failed',last_error='provider_error',fetch_attempts=3 where id=$1",[redrive]); const rr=uuid();
  await act(redrive,actors.gm,'redrive',{},0,rr); check((await act(redrive,actors.gm,'redrive',{},0,rr)).replayed,'redrive replay');
  const reset=await one('select content_state,last_error,fetch_attempts from inbound_messages where id=$1',[redrive]); check(reset.content_state==='pending' && reset.last_error===null && reset.fetch_attempts===0,'redrive resets worker state');
  const forward=await message(), claim='a'+uuid().slice(1), fbody={recipient:'recipient@example.test',sender:'sender@example.test',note:'FYI',body:'Invoice',attachments:[]};
  const callForward=(name,payload,rev,req=uuid(),actor=actors.gm)=>rpc(name,[forward,rev,req,actor,sessions.get(actor),payload]);
  await callForward('vendor_mail_forward_claim',fbody,0,claim);
  check((await callForward('vendor_mail_forward_claim',fbody,0,claim)).replayed,'forward claim replay');
  await reject(()=>callForward('vendor_mail_forward_claim',{...fbody,body:'Changed'},0,claim),/request_conflict/,'forward claim payload conflict');
  await db.query("update vendor_mail_events set created_at=clock_timestamp()-interval '25 hours' where request_id=$1",[claim]);
  const outcome={claim_request_id:claim.toUpperCase(),outcome:'accepted',provider_id:'provider-test'},resultRequest=uuid();
  await reject(()=>callForward('vendor_mail_forward_result',outcome,1,uuid(),actors.owner),/invalid_claim/,'forward result bound to claim actor');
  await callForward('vendor_mail_forward_result',outcome,1,resultRequest);
  check((await callForward('vendor_mail_forward_result',outcome,1,resultRequest)).replayed,'forward result replay');
  check(await count(forward,'forward_result')===1,'old forward claim result replays without duplicate');
  await reject(()=>callForward('vendor_mail_forward_result',{...outcome,claim_request_id:claim.toLowerCase()},1,resultRequest),/request_conflict/,'forward result replay fingerprints original UUID spelling');
  await reject(()=>callForward('vendor_mail_forward_result',{...outcome,claim_request_id:claim.toLowerCase()},2),/already_resulted/,'forward claim UUID casing cannot bypass one result');
  await reject(()=>callForward('vendor_mail_forward_result',{...outcome,provider_id:'other'},1,resultRequest),/request_conflict/,'forward result payload conflict');
  await reject(()=>callForward('vendor_mail_forward_result',outcome,2),/already_resulted/,'forward claim has one result');
  const rollback=await message();
  await db.exec("create function deny_vendor_event() returns trigger language plpgsql as $$ begin raise exception 'event_failure'; end $$; create trigger deny_vendor_event before insert on vendor_mail_events for each row execute function deny_vendor_event();");
  await reject(()=>act(rollback,actors.owner,'handle',{reason:'Done'}),/event_failure/,'event failure refuses human action');
  check((await one('select handled_at,revision from inbound_messages where id=$1',[rollback])).handled_at===null && (await one('select revision from inbound_messages where id=$1',[rollback])).revision===0,'event failure rolls back projection');
  await reject(()=>db.query("update inbound_messages set content_state='failed' where id=$1",[rollback]),/event_failure/,'event failure refuses machine transition');
  check((await one('select content_state from inbound_messages where id=$1',[rollback])).content_state==='pending','event failure rolls back machine state');
  console.log(`PASS 0297: ${checks} checks (single-session PGlite; concurrency requires separate sim proof)`);
} finally { await db.close(); }
