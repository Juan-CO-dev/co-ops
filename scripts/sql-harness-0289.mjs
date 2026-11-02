/** Offline, ephemeral PostgreSQL proof: real 0273 then real 0289. No network or env.
 * Single-backend PGlite cannot prove blocking; CC runs the separate sim lock proof.
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFileSync(`supabase/migrations/${name}`, 'utf8');
const old = read('0273_landing_order_click_counts.sql');
const migration = read('0289_marketing_scorecard.sql');
const sales = read('0232_reports_sales_reads.sql');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const owner = id(1), moo = id(2), cgs = id(3), inactive = id(4), gm = id(5), loc = id(10), loc2 = id(11);
const q = v => v === null ? 'null' : `'${String(v).replaceAll("'", "''")}'`;
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
async function scalar(db, sql) { return Object.values((await db.query(sql)).rows[0])[0]; }
async function refuses(db, sql, name) {
  try { await db.exec(sql); } catch (e) { check(e.message.includes(name), `${name}: got ${e.message}`); return; }
  throw new Error(`Expected ${name}: ${sql}`);
}
async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create role other_owner;
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges grant execute on functions to anon,authenticated;
    create table users(id uuid primary key, role text, active boolean);
    create table locations(id uuid primary key);
    insert into users values('${owner}','owner',true),('${moo}','moo',true),('${cgs}','cgs',true),('${inactive}','owner',false),('${gm}','gm',true);
    insert into locations values('${loc}'),('${loc2}');
    create table toast_capture_runs(location_id uuid,business_date date,status text);
    create table ezcater_orders(id uuid primary key,subtotal_cents bigint);
    create table ezcater_reconciliation_status(order_id uuid,location_id uuid,event_date date,status text);
    create table fixture_facts(location_id uuid,business_date date,snapshot_id uuid,order_guid text,check_guid text,
      opened_at timestamptz,server_guid text,dining_option text,channel text,provider text,sale_class text,
      amount_cents bigint,tax_cents bigint,selection_units jsonb);`);
  // Preserve the real 0232 signature, with a bounded fixture relation in place of capture joins.
  const signature = sales.match(/create function public\.sales_report_facts[\s\S]*?language sql stable as/)[0];
  const guard = sales.match(/create function public\.sales_report_assert_window[\s\S]*?end \$\$;/)[0];
  await db.exec(`${signature} $$ select * from public.fixture_facts where location_id=p_location_id and business_date between p_from and p_to $$; ${guard}`);
  await db.exec(old);
  return db;
}
const db = await setup();
try {
  await db.exec(migration);
  check(await scalar(db, "select count(*)=0 from landing_order_click_counts"), 'empty ET migration');
  const today = await scalar(db, "select (clock_timestamp() at time zone 'America/New_York')::date::text");
  const date = n => `(${q(today)}::date + ${n})`;
  const milestone = (actor=owner, kind='first_ad_spend', day=date(0), corrects=null, reason=null) =>
    `select record_marketing_milestone(${q(actor)},${q(kind)},${day},${q(corrects)},${q(reason)})`;
  for (const actor of [null,inactive,gm,id(99)]) await refuses(db,milestone(actor),'actor_not_allowed');
  for (const kind of [null,'bad']) await refuses(db,milestone(owner,kind),'entry_invalid');
  for (const day of ['null',date(-366),date(366)]) await refuses(db,milestone(owner,'first_ad_spend',day),'date_invalid');
  await refuses(db,milestone(owner,'first_ad_spend',date(0),id(99)),'correction_target_not_head');
  const root = await scalar(db,milestone(moo));
  await refuses(db,milestone(),'correction_target_not_head');
  await refuses(db,milestone(owner,'first_ad_spend',date(0),root),'reason_required');
  await refuses(db,milestone(moo,'first_ad_spend',date(0),root,'fix'),'milestone_locked');
  const head = await scalar(db,milestone(owner,'first_ad_spend',date(-1),root,'fix'));
  check(head !== root,'owner correction appends');
  await refuses(db,milestone(owner,'first_ad_spend',date(0),root,'stale'),'correction_target_not_head');
  check(await scalar(db,'select count(*)=2 from marketing_milestones'),'milestone history retained');
  const snapshot = (actor=moo, mid=head, from=date(-29), to=date(-2), version='1::smallint', payload="'{}'::jsonb", coverage="'{}'::jsonb", corrects=null, reason=null) =>
    `select record_marketing_baseline_snapshot(${q(actor)},${q(mid)},${from},${to},${version},${payload},${coverage},${q(corrects)},${q(reason)})`;
  for (const mid of [null,root,id(99)]) await refuses(db,snapshot(moo,mid),'baseline_window_mismatch');
  await refuses(db,snapshot(moo,head,date(-28)),'baseline_window_mismatch');
  for (const args of [[moo,head,date(-29),date(-2),'null'],[moo,head,date(-29),date(-2),'0::smallint'],[moo,head,date(-29),date(-2),'1::smallint','null'],[moo,head,date(-29),date(-2),'1::smallint',"'{}'::jsonb",'null'],[moo,head,date(-29),date(-2),'1::smallint',"to_jsonb(repeat('x',65537))"]]) await refuses(db,snapshot(...args),'entry_invalid');
  const snap = await scalar(db,snapshot());
  await refuses(db,snapshot(),'snapshot_exists');
  await refuses(db,snapshot(moo,head,date(-29),date(-2),'1::smallint',"'{}'", "'{}'",snap,'fix'),'actor_not_allowed');
  await refuses(db,snapshot(owner,head,date(-29),date(-2),'1::smallint',"'{}'", "'{}'",snap),'reason_required');
  const snap2 = await scalar(db,snapshot(cgs,head,date(-29),date(-2),'1::smallint',"'{}'", "'{}'",snap,'fix'));
  check(snap2 !== snap,'CGS snapshot correction appends');
  await refuses(db,snapshot(owner,head,date(-29),date(-2),'1::smallint',"'{}'", "'{}'",snap,'stale'),'correction_target_not_head');
  const future = await scalar(db,milestone(cgs,'first_ad_spend',date(2),head,'future'));
  await refuses(db,snapshot(owner,future,date(-26),date(1)),'baseline_not_due');
  const entry = (overrides={}) => {
    const a = {actor:owner,kind:'meta_spend',location:null,platform:null,from:today,to:null,amount:0,count:null,note:null,corrects:null,reason:null,...overrides};
    return `select record_marketing_manual_entry(${q(a.actor)},${q(a.kind)},${q(a.location)},${q(a.platform)},${q(a.from)},${a.to===null ? date(6) : q(a.to)},${q(a.amount)},${q(a.count)},${q(a.note)},${q(a.corrects)},${q(a.reason)})`;
  };
  for (const bad of [{kind:null},{kind:'bad'},{from:null},{amount:null},{amount:-1},{amount:100000001},{count:0},{location:loc},{platform:'other'},{note:'x'.repeat(201)},{reason:'x'.repeat(301)},{kind:'promo_spend',platform:null},{kind:'promo_spend',platform:'bad'},{kind:'promo_spend',platform:'other',location:id(99)},{kind:'email_list_size',amount:null,count:null,to:today},{kind:'email_list_size',amount:null,count:-1,to:today},{kind:'email_list_size',amount:0,count:1,to:today},{to:today}]) await refuses(db,entry(bad),'entry_invalid');
  const ent = await scalar(db,entry());
  await refuses(db,entry().replace(date(6),'null'),'entry_invalid');
  await refuses(db,entry().replace(date(6),date(30)),'entry_invalid');
  await refuses(db,entry({actor:gm}),'actor_not_allowed');
  await refuses(db,entry(),'entry_exists_use_correct');
  await refuses(db,entry({corrects:id(99),reason:'fix'}),'correction_target_not_head');
  await refuses(db,entry({corrects:ent}),'reason_required');
  check(await scalar(db,entry({corrects:ent,reason:'fix',amount:100000000}))!==ent,'entry append correction at amount ceiling');
  await refuses(db,entry({corrects:ent,reason:'stale'}),'correction_target_not_head');
  await scalar(db,entry({kind:'email_list_size',amount:null,count:0,to:today})); checks++;
  await scalar(db,entry({kind:'promo_spend',platform:'other',location:loc})); checks++;
  const create = (code,actor=owner) => `select landing_ad_code_create(${q(actor)},${q(code)})`;
  const retire = code => `select landing_ad_code_retire('${owner}',${q(code)})`;
  await refuses(db,create('forbidden',gm),'actor_not_allowed');
  await refuses(db,retire('subsim-photo').replace(owner,gm),'actor_not_allowed');
  await refuses(db,snapshot(gm),'actor_not_allowed');
  for (const code of [null,'BAD','', 'a'.repeat(65)]) { await refuses(db,create(code),'code_invalid'); await refuses(db,retire(code),'code_invalid'); }
  await refuses(db,create('unattributed'),'code_reserved'); await refuses(db,retire('unattributed'),'code_reserved');
  check(await scalar(db,create('campaign'))===3,'next lifetime slot');
  await refuses(db,create('campaign'),'code_taken');
  await db.exec("select increment_landing_order_click('dupont','campaign'); select increment_landing_order_click('dupont','campaign');");
  await db.exec(retire('campaign'));
  await refuses(db,retire('campaign'),'already_retired'); await refuses(db,retire('absent'),'already_retired');
  await refuses(db,create('campaign'),'code_taken');
  await db.exec("select increment_landing_order_click('dupont','campaign'); select increment_landing_order_click('dupont','unregistered');");
  const taps = (await db.query(`select * from marketing_order_taps(${date(0)},${date(0)})`)).rows;
  check(taps.length===2 && taps.some(t=>t.ad_code==='campaign' && !t.active && Number(t.click_count)===2) && taps.some(t=>t.ad_code==='unattributed' && Number(t.click_count)===2),'retired attribution preserved; future retired and unknown taps unattributed');
  check(await scalar(db,`select bool_and(day_et=${date(0)} and day_et=(now() at time zone 'America/New_York')::date) from landing_order_click_counts`),'counter uses ET day');
  for (const sql of ["select increment_landing_order_click(null,'a')","select increment_landing_order_click('bad','a')"]) await refuses(db,sql,'invalid_store');
  for (const ad of ['null',q('a'.repeat(65))]) await refuses(db,`select increment_landing_order_click('dupont',${ad})`,'invalid_ad');
  await db.exec("insert into landing_ad_codes(code,slot) values('last-slot',1024)");
  await refuses(db,create('over-cap'),'slots_exhausted');
  await db.exec(`select * from marketing_order_taps(${date(-365)},${date(0)})`); checks++;
  for (const [a,b] of [['null',date(0)],[date(0),'null'],[date(1),date(0)],[date(-366),date(0)]]) await refuses(db,`select * from marketing_order_taps(${a},${b})`,'taps_window_invalid');
  // Boundary, missing, unknown, all non-sales, duplicated order across online buckets, and scope sentinels.
  const facts = [['online',500000,'sale','o1',null],['online',500001,'sale','o2',null],['app',null,'sale','o1',null],['unknown',100,'sale','o3',null],['unknown',200,'sale','o4','unreviewed'],...['void','gift_card','excess_food','ezcater_linked'].map(c=>['online',900,c,c,null])];
  for (const [i,[channel,amount,cls,order,label]] of facts.entries()) await db.exec(`insert into fixture_facts(location_id,business_date,order_guid,check_guid,channel,amount_cents,sale_class,dining_option) values('${loc}',${date(0)},${q(order)},'c${i}',${q(channel)},${q(amount)},${q(cls)},${q(label)})`);
  await db.exec(`insert into fixture_facts(location_id,business_date,order_guid,check_guid,channel,amount_cents,sale_class) values('${loc2}',${date(0)},'wrong-shop','x','online',123,'sale'),('${loc}',${date(-1)},'wrong-day','y','online',123,'sale');
    insert into toast_capture_runs values('${loc}',${date(0)},'completed'),('${loc}',${date(0)},'completed'),('${loc}',${date(-1)},'completed'),('${loc2}',${date(0)},'completed'),('${loc}',${date(1)},'failed');
    insert into ezcater_orders values('${id(20)}',500001),('${id(21)}',null),('${id(22)}',999),('${id(23)}',999);
    insert into ezcater_reconciliation_status values('${id(20)}','${loc}',${date(0)},'matched'),('${id(21)}','${loc}',${date(0)},'pending'),('${id(22)}','${loc2}',${date(0)},'matched'),('${id(23)}','${loc}',${date(-1)},'matched');`);
  const result = await scalar(db,`select marketing_scorecard_days('${loc}',${date(0)},${date(0)})`);
  check(result.channels.length===2 && result.channels.reduce((n,c)=>n+c.checks,0)===2,'non-sales, unknown, >500k and out-of-scope rows absent from channels');
  check(result.channels.find(c=>c.channel==='online').cents===500000,'500000 included');
  check(result.channels.find(c=>c.channel==='app').amount_missing===1,'null amount counted missing');
  check(result.large_checks.length===1 && result.large_checks[0].amount_cents===500001,'500001 Toast excluded and listed');
  check(result.unknown_labels.length===2 && result.unknown_labels.some(u=>u.label==='(no dining option)') && result.unknown_labels.reduce((n,u)=>n+u.cents,0)===300,'unknown labels individually disclosed');
  check(result.direct_online_orders[0].orders===1,'cross-channel order dedup');
  check(result.ezcater.length===2 && result.ezcater.find(e=>e.status==='matched').subtotal_cents===500001 && result.ezcater.find(e=>e.status==='matched').large_orders===1,'ezCater counted and flagged, bounded by shop and event date');
  check(result.ezcater.find(e=>e.status==='pending').amount_missing===1,'ezCater null missing');
  check(result.captured_days.length===1 && result.captured_days[0]===today,'completed coverage distinct and scoped');
  const empty = await scalar(db,`select marketing_scorecard_days('${loc}',${date(1)},${date(1)})`);
  check(Object.values(empty).every(a=>a.length===0),'empty arrays; failed captures not coverage');
  await db.exec(`select marketing_scorecard_days('${loc}',${date(-27)},${date(0)})`); checks++;
  for (const from of [date(-28),date(-31),date(1)]) await refuses(db,`select marketing_scorecard_days('${loc}',${from},${date(0)})`,'sales_report_window_too_wide');
  await refuses(db,`select marketing_scorecard_days(null,${date(0)},${date(0)})`,'sales_report_invalid_window');
  await refuses(db,`select marketing_scorecard_days('${loc}',null,${date(0)})`,'sales_report_invalid_window');
  const tables = ['marketing_milestones','marketing_manual_entries','marketing_baseline_snapshots','landing_ad_codes','landing_order_click_counts'];
  for (const table of tables) {
    check(await scalar(db,`select relrowsecurity from pg_class where oid='${table}'::regclass`),`${table} RLS`);
    check(Number(await scalar(db,`select count(*) from pg_policy where polrelid='${table}'::regclass`))===4,`${table} four policies`);
    check(await scalar(db,`select bool_and(coalesce(pg_get_expr(polqual,polrelid),'false')='false' and coalesce(pg_get_expr(polwithcheck,polrelid),'false')='false') from pg_policy where polrelid='${table}'::regclass`),`${table} all policy predicates false`);
    check(await scalar(db,`select has_table_privilege('service_role','${table}','SELECT') and not has_table_privilege('service_role','${table}','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') and not has_any_column_privilege('service_role','${table}','INSERT,UPDATE,REFERENCES')`),`${table} SELECT ceiling`);
    for (const role of ['anon','authenticated']) check(!await scalar(db,`select has_table_privilege('${role}','${table}','SELECT,INSERT,UPDATE,DELETE')`),`${table} ${role} no grants`);
    await db.exec(`begin; grant select,insert,update,delete on ${table} to authenticated; set local role authenticated;`);
    check(Number(await scalar(db,`select count(*) from ${table}`))===0,`${table} deny read even with grant`);
    await db.exec('rollback');
  }
  const funcs = (await db.query("select oid::regprocedure::text signature,prosecdef,proconfig,provolatile from pg_proc where pronamespace='public'::regnamespace and (proname like 'record_marketing_%' or proname in ('marketing_scorecard_days','marketing_order_taps','landing_ad_code_create','landing_ad_code_retire','increment_landing_order_click','marketing_assert_actor'))")).rows;
  check(funcs.length===9,'all function ACLs enumerated');
  for (const f of funcs) {
    check(f.prosecdef && f.proconfig.includes('search_path=pg_catalog, public'),`${f.signature} definer path`);
    for (const role of ['anon','authenticated']) check(!await scalar(db,`select has_function_privilege('${role}',${q(f.signature)},'EXECUTE')`),`${f.signature} ${role} denied`);
    check(await scalar(db,`select has_function_privilege('service_role',${q(f.signature)},'EXECUTE')`)===!f.signature.startsWith('marketing_assert_actor('),`${f.signature} service ACL`);
    if (/marketing_scorecard_days|marketing_order_taps/.test(f.signature)) check(f.provolatile==='s','read RPC stable');
  }
  await db.exec('set role service_role');
  await scalar(db,milestone(owner,'landing_live')); checks++;
  await refuses(db,"update landing_ad_codes set active=false where code='subsim-photo'",'permission denied');
  await db.exec('reset role');
  await refuses(db,migration,'0289: already installed'); await db.exec('rollback');
} finally { await db.close(); }
for (const mode of ['nonempty','owner']) {
  const fixture = await setup();
  try {
    if (mode==='nonempty') await fixture.exec("select increment_landing_order_click('dupont','subsim-photo')");
    else await fixture.exec('alter table users owner to other_owner');
    await refuses(fixture,migration,mode==='nonempty'?'0289: counter must be empty':'0289: function owner must own every touched table');
    await fixture.exec('rollback');
    check(await scalar(fixture,"select to_regclass('public.marketing_milestones') is null"),'failed migration fully rolled back');
    check(!await scalar(fixture,"select exists(select 1 from information_schema.columns where table_name='landing_order_click_counts' and column_name='day_et')"),'failed rekey rolled back');
  } finally { await fixture.close(); }
}
console.log(`0289 SQL harness: ${checks} checks passed (offline PGlite; concurrency requires sim proof).`);
