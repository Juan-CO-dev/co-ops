/** Offline, ephemeral PostgreSQL proof: real 0273, 0289, then 0292. No network or env.
 * Single-backend PGlite cannot prove blocking; CC runs the separate sim lock proof.
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFileSync(`supabase/migrations/${name}`, 'utf8');
const old = read('0273_landing_order_click_counts.sql');
const migration = read('0289_marketing_scorecard.sql');
const intentMigration = read('0292_landing_click_intent.sql');
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
  await db.exec("select increment_landing_order_click('dupont','subsim-photo')");
  const window = "(now() at time zone 'America/New_York')::date";
  const total = () => scalar(db, `select sum(click_count)::int from marketing_order_taps(${window},${window})`);
  const before = await total();
  await db.exec(intentMigration);
  check(await total() === before, 'migration preserves existing scorecard total');
  check(await scalar(db,"select bool_and(intent='legacy') from landing_order_click_counts"), 'existing rows become legacy');
  const call = (store,intent) => db.query('select increment_landing_order_click($1,$2,$3)',[store,'subsim-photo',intent]);
  async function partition() {
    for (const intent of ['legacy','pickup','delivery','visit']) {
      const store = intent==='delivery' ? 'any' : 'dupont';
      await call(store,intent); await call(store,intent);
    }
    const rows = (await db.query("select intent,click_count::int n from landing_order_click_counts order by intent")).rows;
    check(rows.length===4 && rows.every(row=>row.n===(row.intent==='legacy'?3:2)), 'each intent increments its own row');
    check(await total()===9, 'old scorecard total includes all intent rows once');
    check(await scalar(db,`select sum(click_count)::int from marketing_order_tap_intents(${window},${window})`)===9, 'split equals old scorecard total');
  }
  const definition=await scalar(db,"select pg_get_functiondef('increment_landing_order_click(text,text,text)'::regprocedure)");
  await db.exec('begin');
  await db.exec(definition.replace('1, p_intent)', "1, case when p_intent = 'delivery' then p_intent else 'legacy' end)"));
  let detected=false;
  try { await partition(); } catch(e) { detected=e.message.includes("each intent increments its own row"); }
  await db.exec('rollback');
  check(detected,'broken intent writer must fail partition behavior');
  console.log('EXPECTED FAIL 0292 broken variant: intent collapsed to legacy; partition proof rejected it');
  await partition();
  await db.exec("set role service_role; select increment_landing_order_click(p_ad_code=>'subsim-photo',p_store_key=>'dupont'); reset role");
  check(await total()===10,'named two-argument default remains executable');
  for (const intent of [null,'bad']) await refuses(db,`select increment_landing_order_click('dupont','subsim-photo',${q(intent)})`,'invalid_intent');
  for (const intent of ['legacy','pickup','visit']) await refuses(db,`select increment_landing_order_click('any','subsim-photo','${intent}')`,'invalid_store');
  for (const store of [null,'dupont','capitol-hill','bad']) await refuses(db,`select increment_landing_order_click(${q(store)},'subsim-photo','delivery')`,'invalid_store');
  for (const intent of ['legacy','pickup','visit']) await refuses(db,`insert into landing_order_click_counts(day_utc,day_et,store_key,ad_code,ad_slot,click_count,intent) values(current_date,current_date,'any','unattributed',1,1,'${intent}')`,'landing_order_click_counts_store_intent_check');
  await refuses(db,"insert into landing_order_click_counts(day_utc,day_et,store_key,ad_code,ad_slot,click_count,intent) values(current_date,current_date,'dupont','unattributed',1,1,'delivery')",'landing_order_click_counts_store_intent_check');
  await call('dupont','pickup');
  await db.exec("update landing_ad_codes set active=false where code='subsim-photo'");
  await call('any','delivery');
  check(await scalar(db,"select click_count::int from landing_order_click_counts where ad_code='unattributed' and intent='delivery'")===1,'retired code redirects attribution');
  const funcs=(await db.query("select oid,proname,pronargs,prosecdef,proconfig from pg_proc where proname in ('increment_landing_order_click','marketing_order_taps','marketing_order_tap_intents')")).rows;
  check(funcs.length===3 && funcs.find(f=>f.proname==='increment_landing_order_click').pronargs===3,'single defaulted writer signature');
  for (const f of funcs) {
    check(f.prosecdef && f.proconfig.includes('search_path=pg_catalog, public'),'definer search path');
    for (const role of ['anon','authenticated','service_role']) check(await scalar(db,`select has_function_privilege('${role}',${f.oid},'EXECUTE')`) === (role==='service_role'),'restricted execute '+role);
  }
  await refuses(db,"select * from marketing_order_tap_intents(null,current_date)",'taps_window_invalid');
  check(!await scalar(db,"select has_table_privilege('service_role','landing_order_click_counts','INSERT,UPDATE,DELETE')"),'service table remains read only');
  console.log(`PASS 0292: ${checks} checks; offline only, no two-session lock proof`);
} catch(e) {console.error(`FAIL 0292: ${e.stack??e}`); process.exitCode=1;}
finally {await db.close();}
