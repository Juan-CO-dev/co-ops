/** 0296 proof: real migration in isolated PGlite, synthetic fixtures, no network. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const migration = read('0296_catering_inbox.sql');
// Actual parent CREATE TABLE bodies, including constraints and foreign keys. Only
// unrelated auth/location/delivery/receipt prerequisites are bounded stubs below.
function table(file, name) {
  const match = read(file).match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`, 'i'));
  assert.ok(match, `${name} source DDL found`);
  return match[0];
}
const externalRefDDL = read('0149_ezcater_intake.sql').match(/alter table public\.catering_pipeline add column external_ref text;\s*create unique index catering_pipeline_external_ref_uq[\s\S]*?;/i)?.[0];
assert.ok(externalRefDDL, '0149 real external reference column and unique index found');
const db = new PGlite();
let checks = 0;
const check = (ok, label) => { assert.ok(ok, label); checks++; console.log(`ok ${label}`); };
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
const one = async (sql, args = []) => (await query(sql, args))[0];
const reject = async (fn, pattern, label) => { await assert.rejects(fn, pattern); check(true, label); };
const shop = randomUUID(), elsewhere = randomUUID(), manager = randomUUID(), gm = randomUUID(), wrongGM = randomUUID();
const owner = randomUUID(), inactive = randomUUID(), agm = randomUUID();
const sessions = new Map();
const rpc = async (name, args) => (await one(`select public.${name}(${args.map((_, i) => `$${i+1}`).join(',')}) result`, args)).result;
const content = (extra = {}) => ({ sender_address: 'sender@example.test', subject: 'Catering request', body_text: 'Need catering', body_original_bytes: 13, body_truncated: false, body_from_html: false, received_at: '2026-11-11T12:00:00Z', ...extra });
const result = (extra = {}) => ({ classification: 'intake', identity_status: 'new_sender', disposition: 'drafted', rule_version: '1', ...extra });
const draft = { language: 'en', template_key: 'intake', template_version: '1', params: {portalUrl:'https://example.test/order',tenantName:'Synthetic',channel:'provider',status:'received'}, preview_text: 'Start your catering request.' };
async function record(extra = {}, request = randomUUID()) {
  const inbound = randomUUID();
  await db.query('insert into inbound_messages(id,provider_email_id) values ($1,$2)', [inbound, inbound]);
  await db.exec('set role service_role');
  try { return await rpc('record_catering_inbound', [inbound, 0, request, content(extra)]); }
  finally { await db.exec('reset role'); }
}
async function finalize(message, payload = result(), supplied = draft, request = randomUUID(), revision = 0) {
  await db.exec('set role service_role');
  try { return await rpc('finalize_catering_inbound', [message, revision, request, payload, supplied]); }
  finally { await db.exec('reset role'); }
}
async function act(message, actor, action, assigned = null, revision = 1, request = randomUUID(), session = sessions.get(actor)) {
  await db.exec('set role service_role');
  try { return await rpc('act_on_catering_inbox', [message, revision, request, actor, session, action, assigned]); }
  finally { await db.exec('reset role'); }
}
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to public,anon,authenticated,service_role;
    alter default privileges in schema public grant all on functions to public,anon,authenticated,service_role;
    create table locations(id uuid primary key);
    create table users(id uuid primary key, role text not null, active boolean not null, created_at timestamptz not null default now());
    create table sessions(id uuid primary key,user_id uuid references users(id),revoked_at timestamptz,expires_at timestamptz not null);
    create table user_locations(user_id uuid references users(id),location_id uuid references locations(id),active boolean not null);
    create table catering_delivery_zones(id uuid primary key);
    create table email_receipts(id uuid primary key);
    ${table('0108_catering_scaffold_capture.sql', 'catering_customers')}
    ${table('0108_catering_scaffold_capture.sql', 'catering_pipeline')}
    ${read('0148_catering_lead_assignee.sql')}
    ${externalRefDDL}
    ${table('0120_catering_quotes.sql', 'catering_quotes')}
    ${table('0294_inbound_router.sql', 'inbound_messages')}
  `);
  // A deliberately broken ACL reset must trip the migration's own assertions and
  // transaction rollback must remove its entire partial schema.
  await reject(() => db.exec(migration.replace("revoke all on public.%I from public, anon, authenticated, service_role", "revoke all on public.%I from anon, authenticated")), /inbox table privilege escape/, 'broken permissive ACL variant detected');
  await db.exec('rollback');
  check((await one("select to_regclass('public.catering_inbound_messages') value")).value === null, 'failed migration rolls back schema atomically');
  await db.exec(migration);
  for (const name of ['catering_inbound_messages','catering_inbox_drafts','catering_inbox_events','catering_inbox_settings']) {
    for (const role of ['anon','authenticated','service_role']) {
      for (const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) {
        const row = await one('select has_table_privilege($1,$2,$3) allowed', [role,name,privilege]);
        assert.equal(row.allowed, role === 'service_role' && privilege === 'SELECT', `${role} ${name} ${privilege}`);
      }
      const columns = await query('select column_name from information_schema.columns where table_name=$1', [name]);
      for (const { column_name } of columns) for (const privilege of ['SELECT','INSERT','UPDATE','REFERENCES']) {
        assert.equal((await one('select has_column_privilege($1,$2,$3,$4) allowed',[role,name,column_name,privilege])).allowed, role === 'service_role' && privilege === 'SELECT');
      }
    }
    check((await one('select relrowsecurity enabled from pg_class where oid=$1::regclass',[name])).enabled, `${name}: complete table/column ACL and RLS`);
  }
  for (const { oid, proname, prosecdef, proconfig } of await query("select oid,proname,prosecdef,proconfig from pg_proc where proname in ('record_catering_inbound','finalize_catering_inbound','act_on_catering_inbox','catering_inbox_can_access')")) {
    assert.equal(prosecdef,true); assert.ok(proconfig.includes('search_path=pg_catalog, public'));
    for (const role of ['anon','authenticated','service_role']) assert.equal((await one('select has_function_privilege($1,$2::oid,\'EXECUTE\') allowed',[role,oid])).allowed,role==='service_role' && proname!=='catering_inbox_can_access');
    check(true, `${proname}: definer/search_path/execution ceiling`);
  }
  check((await one('select mode from catering_inbox_settings')).mode === 'shadow','singleton seeded shadow');
  await reject(() => db.exec("insert into catering_inbox_settings values(false,'live')"), /check constraint/, 'second settings key refused');
  await db.query('insert into locations values ($1),($2)',[shop,elsewhere]);
  for (const [id,role,active] of [[manager,'catering_mgr',true],[gm,'gm',true],[wrongGM,'gm',true],[owner,'owner',true],[inactive,'catering_mgr',false],[agm,'agm',true]]) {
    await db.query('insert into users(id,role,active) values ($1,$2,$3)',[id,role,active]);
    const session = randomUUID(); sessions.set(id,session);
    await db.query("insert into sessions values ($1,$2,null,clock_timestamp()+interval '1 hour')",[session,id]);
  }
  await db.query('insert into user_locations values ($1,$2,true),($3,$4,true)',[gm,shop,wrongGM,elsewhere]);
  const customer = randomUUID(), otherCustomer = randomUUID(), lead = randomUUID(), quote = randomUUID();
  await db.query("insert into catering_customers(id,name,email) values ($1,'Synthetic','sender@example.test'),($2,'Other','other@example.test')",[customer,otherCustomer]);
  await db.query("insert into catering_pipeline(id,customer_id,contact_name,stage,location_id,assigned_to) values ($1,$2,'Synthetic','inquiry',$3,$4)",[lead,customer,shop,gm]);
  await db.query('insert into catering_quotes(id,customer_id,pipeline_id,location_id) values ($1,$2,$3,$4)',[quote,customer,lead,shop]);
  const external='synthetic-order';
  await db.query("update catering_pipeline set external_ref=$1,lead_source='ezcater' where id=$2",[external,lead]);
  const nullLead=randomUUID(), badLead=randomUUID(), duplicate=randomUUID(), retired=randomUUID(), retiredLead=randomUUID();
  await db.query("insert into catering_customers(id,name,email,active) values ($1,'Duplicate active','duplicate@example.test',true),($2,'Duplicate retired','duplicate@example.test',false),($3,'Retired','retired@example.test',false)",[duplicate,randomUUID(),retired]);
  await db.query("insert into catering_pipeline(id,customer_id,contact_name,stage,location_id,assigned_to) values ($1,$2,'Null','inquiry',$3,null),($4,$2,'Bad','inquiry',$3,$5),($6,$7,'Retired','inquiry',$3,null)",[nullLead,customer,shop,badLead,agm,retiredLead,retired]);
  await db.query("insert into users(id,role,active,created_at) values ($1,'catering_mgr',true,'2000-01-01')",[randomUUID()]);
  await db.query('insert into user_locations values ($1,$2,true)',[manager,shop]);
  // Install guards BEFORE any inbox writer; fixtures above are the only artifact writes.
  await db.exec("create function forbid_artifact_write() returns trigger language plpgsql as $$ begin raise exception 'artifact_write_forbidden'; end $$;");
  for (const table of ['catering_customers','catering_pipeline','catering_quotes']) {
    await db.exec(`create trigger inbox_attach_only before insert or update or delete on ${table} for each row execute function forbid_artifact_write()`);
    check(true, `${table}: all writes forbidden before inbox writers`);
  }
  for (const {proname,prosrc} of await query("select proname,prosrc from pg_proc where proname in ('record_catering_inbound','finalize_catering_inbound','act_on_catering_inbox')")) {
    assert.doesNotMatch(prosrc, /(insert into|update|delete from)\s+public\.(catering_customers|catering_pipeline|catering_quotes)\b/i);
    check(true, `${proname}: source contains no artifact writes`);
  }
  const pipelineBefore = await query('select * from catering_pipeline order by id');
  const quotesBefore = await query('select * from catering_quotes order by id');
  const customersBefore = await query('select * from catering_customers order by id');
  const transport=randomUUID(), ingestRequest=randomUUID();
  await db.query('insert into inbound_messages(id,provider_email_id) values ($1,$2)',[transport,transport]);
  let first;
  await db.exec('set role service_role');
  try {
    first=await rpc('record_catering_inbound',[transport,0,ingestRequest,content()]);
    check((await rpc('record_catering_inbound',[transport,0,ingestRequest,content()])).replayed,'ingest identical request replay');
    await reject(() => rpc('record_catering_inbound',[transport,0,ingestRequest,content({subject:'Changed'})]),/request_conflict/,'ingest request payload mismatch refused');
    const retry=await rpc('record_catering_inbound',[transport,0,randomUUID(),content({subject:'Changed'})]);
    check(retry.message_id===first.message_id && (await one('select subject from catering_inbound_messages where id=$1',[first.message_id])).subject==='Catering request','transport dedupe preserves first evidence');
    await reject(() => rpc('record_catering_inbound',[transport,1,randomUUID(),content()]),/invalid_input/,'ingest expected revision validated');
  } finally { await db.exec('reset role'); }
  await reject(() => record({headers:{authorization:'secret'}}),/invalid_headers/,'header allowlist rejects credential header');
  await reject(() => record({body_text:'x'.repeat(262145),body_original_bytes:262145}),/check constraint/,'body cap enforced in SQL');
  const m = await record();
  const finRequest = randomUUID();
  const attached = result({identity_status:'resolved',catering_customer_id:customer,lead_id:lead,quote_id:quote,location_id:shop});
  await finalize(m.message_id, attached,draft,finRequest);
  check((await finalize(m.message_id, attached,draft,finRequest)).replayed,'finalize identical request replay');
  await reject(() => finalize(m.message_id, result(),draft,finRequest), /request_conflict/, 'finalize changed replay refused');
  await reject(() => finalize(m.message_id), /stale_revision/, 'finalize stale CAS refused');
  check((await one('select assigned_to from catering_inbound_messages where id=$1',[m.message_id])).assigned_to===gm,'lead assignee snapshotted');
  for (const actor of [wrongGM,inactive,agm]) await reject(() => act(m.message_id,actor,'handle'), /forbidden/, 'ineligible actor refused');
  for (const assignee of [wrongGM,inactive,agm]) await reject(() => act(m.message_id,manager,'reassign',assignee), /invalid_assignee/, 'assignee scope/state/role rechecked');
  const actRequest=randomUUID();
  await act(m.message_id,gm,'reassign',manager,1,actRequest);
  check((await act(m.message_id,gm,'reassign',manager,1,actRequest)).replayed,'action identical replay');
  await reject(() => act(m.message_id,gm,'reassign',owner,1,actRequest), /request_conflict/, 'action changed replay refused');
  await reject(() => act(m.message_id,gm,'handle'), /stale_revision/, 'action stale CAS refused');
  check((await one('select assigned_to from catering_pipeline where id=$1',[lead])).assigned_to===gm,'reassign leaves lead unchanged');
  await db.query('update sessions set revoked_at=now() where id=$1',[sessions.get(gm)]);
  await reject(() => act(m.message_id,gm,'reassign',manager,1,actRequest), /forbidden/, 'replay freshly checks revoked session');
  await act(m.message_id,owner,'handle',null,2);
  check((await one('select revision,disposition from catering_inbound_messages where id=$1',[m.message_id])).revision===3,'handle advances revision');
  await reject(() => act(m.message_id,owner,'handle',null,3), /invalid_state/, 'terminal handled state refused');
  for (const extra of [{subject:'Re: catering'},{headers:{'in-reply-to':'original'}},{headers:{references:'original'}},{subject:'RV: catering'},...['[EXTERNAL] RE:','Re[2]:','AW:','RES:','SV(3)\uff1a'].map(subject=>({subject}))]) {
    const follow = await record(extra); await finalize(follow.message_id);
    const row = await one('select disposition,reason,(select count(*)::int from catering_inbox_drafts d where d.message_id=m.id) drafts from catering_inbound_messages m where id=$1',[follow.message_id]);
    check(row.disposition==='needs_human' && row.reason==='thread_followup' && row.drafts===0,'followup strips draft in SQL');
  }
  const fresh=await record();
  for (const patch of [{catering_customer_id:otherCustomer},{location_id:elsewhere},{lead_id:null},{quote_id:randomUUID()}]) await reject(() => finalize(fresh.message_id,{...attached,...patch}), /identity_mismatch|artifact_mismatch/, 'mismatched identity/artifact refused');
  const retiredMessage=await record({sender_address:'retired@example.test'});
  await reject(() => finalize(retiredMessage.message_id,result({identity_status:'resolved',catering_customer_id:retired,lead_id:retiredLead,location_id:shop})), /identity_mismatch/, 'deactivated identity not revived');
  await finalize(fresh.message_id,result({disposition:'needs_human',reason:'identity_unresolved'}),null);
  await reject(() => act(fresh.message_id,gm,'handle'), /forbidden/, 'GM cannot access unattached row');
  await act(fresh.message_id,manager,'handle');
  const expiry=await record(); await finalize(expiry.message_id);
  await db.query("update sessions set expires_at=clock_timestamp()-interval '1 second' where id=$1",[sessions.get(manager)]);
  await reject(() => act(expiry.message_id,manager,'handle'),/forbidden/,'expired session freshly refused');
  await db.query("update sessions set expires_at=clock_timestamp()+interval '1 hour' where id=$1",[sessions.get(manager)]);
  await db.query('update users set active=false where id=$1',[manager]);
  await reject(() => act(expiry.message_id,manager,'handle'),/forbidden/,'deactivated actor freshly refused');
  await db.query('update users set active=true where id=$1',[manager]);
  assert.deepEqual(await query('select * from catering_customers order by id'),customersBefore);
  check(true,'all writers leave customer rows byte-for-byte unchanged');
  assert.deepEqual(await query('select * from catering_pipeline order by id'),pipelineBefore);
  assert.deepEqual(await query('select * from catering_quotes order by id'),quotesBefore);
  check(true,'all writers leave pipeline and quote rows byte-for-byte unchanged');
  const invalid=await record();
  await reject(() => finalize(invalid.message_id,result({classification:'platform_notification'})), /draft_ineligible/, 'platform notifications cannot draft');
  await reject(() => finalize(invalid.message_id,result(),{...draft,language:'fr'}), /check constraint/, 'draft constraint failure rolls back finalization');
  check((await one('select revision from catering_inbound_messages where id=$1',[invalid.message_id])).revision===0,'failed draft insert preserves message revision');
  check((await one('select count(*)::int count from catering_inbox_events where message_id=$1',[invalid.message_id])).count===1,'failed draft insert appends no finalize event');
  for (const [field,value] of [['classification','unknown_class'],['identity_status','created'],['reason','freeform']]) {
    await reject(() => db.query(`update catering_inbound_messages set ${field}=$1 where id=$2`,[value,invalid.message_id]), /check constraint/, `${field} closed CHECK rejects unknown value`);
  }
  for (const params of [{...draft.params,portalUrl:'https://example.test/order?token=secret'}, {...draft.params,status:'lost'}, {...draft.params,recipient:'injected@example.test'}]) {
    await reject(() => finalize(invalid.message_id,result(),{...draft,params}), /invalid_draft/, 'unsafe draft params refused');
  }
  for (const sender_address of ['masked+123@example.test','sender@relay.example.test','sender@doordash.com','notify@mail.ezcater.com','notify@mail.tripleseat.com']) {
    const masked=await record({sender_address});
    await reject(() => finalize(masked.message_id), /draft_ineligible/, 'relay/platform cannot forge new_sender draft');
  }
  const notification=result({classification:'platform_notification',identity_status:'masked',disposition:'notification',lead_id:lead,quote_id:quote,location_id:shop});
  const platform=await record({sender_address:'notify@mail.ezcater.com',external_ref:external});
  await finalize(platform.message_id,notification,null);
  const platformRow=await one('select catering_customer_id,lead_id,quote_id,(select count(*)::int from catering_inbox_drafts where message_id=m.id) drafts from catering_inbound_messages m where id=$1',[platform.message_id]);
  check(platformRow.catering_customer_id===null && platformRow.lead_id===lead && platformRow.quote_id===quote && platformRow.drafts===0,'platform external-ref attachment has no direct customer or draft');
  for (const extra of [{external_ref:'different-order'},{sender_address:'notify@tripleseat.com'},{sender_address:'notify@evilezcater.com'}]) {
    const mismatch=await record({sender_address:'notify@mail.ezcater.com',external_ref:external,...extra});
    await reject(() => finalize(mismatch.message_id,notification,null), /artifact_mismatch/, 'platform reference/source/domain mismatch refused');
  }
  const followAttached=await record({subject:'Re: original catering request',headers:{references:'original'}});
  await finalize(followAttached.message_id,attached);
  const followRow=await one('select catering_customer_id,lead_id,quote_id,reason,(select count(*)::int from catering_inbox_drafts where message_id=m.id) drafts from catering_inbound_messages m where id=$1',[followAttached.message_id]);
  check(followRow.catering_customer_id===customer && followRow.lead_id===lead && followRow.quote_id===quote && followRow.reason==='thread_followup' && followRow.drafts===0,'followup preserves customer/lead/quote attachment without draft');

  for (const disposition of ['needs_human','noise','notification']) {
    const payload=result({disposition,classification:disposition==='noise'?'noise':disposition==='notification'?'platform_notification':'unclassified',reason:disposition==='needs_human'?'urgent':null});
    const initial=await record();
    await reject(()=>finalize(initial.message_id,payload,draft),/draft_ineligible/,`${disposition}: supplied draft refused`);
    const follow=await record({subject:'RE: order'});
    await finalize(follow.message_id,payload,draft);
    const row=await one('select disposition,reason,(select count(*)::int from catering_inbox_drafts where message_id=m.id) drafts from catering_inbound_messages m where id=$1',[follow.message_id]);
    check(row.disposition===disposition && row.reason===payload.reason && row.drafts===0,`${disposition}: followup preserves verdict and strips draft`);
  }
  const dupe=await record({sender_address:'duplicate@example.test'});
  await reject(()=>finalize(dupe.message_id,result({identity_status:'resolved',catering_customer_id:duplicate})),/identity_mismatch/,'inactive duplicate email refuses identity');
  const finalized=await record(); await finalize(finalized.message_id);
  await reject(()=>finalize(finalized.message_id,result(),draft,randomUUID(),1),/already_finalized/,'re-finalize at current revision refused');
  for (const [lead_id,label] of [[nullLead,'null'],[badLead,'ineligible']]) {
    const fallback=await record();
    await finalize(fallback.message_id,result({identity_status:'resolved',catering_customer_id:customer,lead_id,location_id:shop}));
    check((await one('select assigned_to from catering_inbound_messages where id=$1',[fallback.message_id])).assigned_to===manager,`${label} lead assignee falls back to scoped catering manager`);
  }
  await reject(()=>act(finalized.message_id,manager,'handle',null,1,randomUUID(),sessions.get(owner)),/forbidden/,'different user session refused');
  const noArtifact=await record();
  await reject(()=>finalize(noArtifact.message_id,result({classification:'troubleshoot_ours',identity_status:'resolved',catering_customer_id:customer})),/draft_ineligible/,'ours without lead or quote refused');
  for (const sender_address of ['Sender@example.test',' sender@example.test','not-an-address','a@@example.test',42])
    await reject(()=>record({sender_address}),/invalid_sender/,'noncanonical or invalid sender refused');
  assert.deepEqual(await query('select * from catering_customers order by id'),customersBefore);
  assert.deepEqual(await query('select * from catering_pipeline order by id'),pipelineBefore);
  assert.deepEqual(await query('select * from catering_quotes order by id'),quotesBefore);
  check(true,'final artifact snapshots unchanged with all guards active');
  console.log(`PASS 0296: ${checks} checks (single-session PGlite; concurrency requires separate sim proof)`);
} finally { await db.close(); }
