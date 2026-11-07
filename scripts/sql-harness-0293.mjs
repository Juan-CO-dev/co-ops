/** Offline PostgreSQL proof of 0293. Synthetic rows; in-memory PGlite only.
 * node scripts/sql-harness-0293.mjs
 * Executes the real 0211, 0259 and 0293 migrations and the unchanged shop lane writer.
 * Base schema predates checked-in migration 0044. Its bounded tables retain UUID,
 * numeric(10,2), date, timestamptz and boolean types. Domain additions are extracted
 * from their actual migrations: role/sku_class/price_basis are checked TEXT, NOT
 * enums (0058/0157/0210); provenance is deliberately unconstrained TEXT (0177).
 * No enum is substituted by text. This single backend cannot prove lock blocking.
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFileSync(`supabase/migrations/${name}`, 'utf8');
const old = read('0259_sku_shop_versions.sql');
const migration = read('0293_vendor_import_shop.sql');
const extract = (sql, pattern) => { const found = sql.match(pattern); assert.ok(found, String(pattern)); return found[0]; };
const functionSql = (sql, name) => extract(sql, new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?end(?:;\\s*| )\\$\\$;`, 'i'));
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), shop = id(2), otherShop = id(3), vendor = id(4), sku = id(5);
let checks = 0, batchNumber = 100;
const check = (ok, message) => { assert.ok(ok, message); checks++; console.log(`ok   ${message}`); };
const db = new PGlite();
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
async function refuses(fn, code) {
  let error;
  try { await fn(); } catch (e) { error = e; }
  check(error && error.message.includes(code), `refuses ${code}${error ? ` (${error.message})` : ' (unexpected success)'}`);
}

try {
  const globalGuard = "  if exists (select 1 from public.vendor_import_batches where id = p_batch_id and location_id is not null) then\n    raise exception 'shop_batch_requires_shop_apply';\n  end if;\n";
  check(functionSql(migration, 'apply_vendor_import').replaceAll('\r\n', '\n').replace(globalGuard, '') ===
    functionSql(old, 'apply_vendor_import').replaceAll('\r\n', '\n'), 'global re-emit differs from 0259 ONLY by scope guard');
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges grant execute on functions to anon, authenticated;
    create table users(id uuid primary key, role text not null, active boolean not null default true);
    create table locations(id uuid primary key, active boolean not null default true);
    create table user_locations(user_id uuid references users(id), location_id uuid references locations(id), active boolean not null default true);
    create table vendors(id uuid primary key, source_kind text, active boolean not null default true);
    create table vendor_items(id uuid primary key, vendor_id uuid references vendors(id), name text not null,
      active boolean not null default true, location_id uuid references locations(id), item_number text,
      pack_format text, each_container_label text, units_per_pack integer, each_size numeric, each_measure text);
    create table measure_units(label text primary key, active boolean not null default true);
    create table vendor_price_history(id uuid primary key default gen_random_uuid(),
      vendor_item_id uuid not null references vendor_items(id), unit_price numeric(10,2) not null,
      effective_date date not null, recorded_at timestamptz not null default now(), recorded_by uuid references users(id));
    create table location_sku_settings(sku_id uuid, location_id uuid, auto_weekday_par numeric, auto_weekend_par numeric);
  `);
  await db.exec(extract(read('0058_role_model_renumber.sql'), /ALTER TABLE public\.users ADD CONSTRAINT users_role_check CHECK \([\s\S]*?\);/));
  await db.exec(extract(read('0157_item_taxonomy.sql'), /alter table public\.vendor_items[\s\S]*?;/));
  const recipeFields = read('0097_recipe_model_fields.sql');
  for (const column of ['avg_oz_per_each', 'dimension', 'to_base_factor']) {
    await db.exec(extract(recipeFields, new RegExp(`alter table (?:vendor_items|measure_units) add column ${column}[^;]*;`)));
  }
  await db.exec(read('0177_vendor_price_history_provenance.sql'));
  await db.exec(read('0210_vendor_items_price_basis.sql'));
  await db.exec(read('0159_sku_pack_levels.sql'));
  await db.exec(read('0211_vendor_import.sql'));
  await db.exec(old);
  await db.exec(migration);
  await db.exec('grant select, insert, update on all tables in schema public to service_role');
  await db.query('insert into users(id,role) values($1,\'gm\')', [actor]);
  await db.query('insert into locations(id) values($1),($2)', [shop, otherShop]);
  await db.query('insert into user_locations(user_id,location_id) values($1,$2)', [actor, shop]);
  await db.query('insert into vendors(id) values($1)', [vendor]);
  await db.query('insert into vendor_items(id,vendor_id,name,price_basis) values($1,$2,\'Harness item\',\'per_case\')', [sku, vendor]);
  const initial = await one("insert into vendor_price_history(vendor_item_id,unit_price,effective_date) values($1,10,'2026-11-01') returning id", [sku]);

  async function snapshot(location = shop) {
    const lane = location === null ? undefined : await one('select id from sku_price_lanes where sku_id=$1 and location_id=$2 and active', [sku, location]);
    const head = await one(`select id,unit_price::float8 as unit_price,effective_date::text as effective_date from vendor_price_history
      where vendor_item_id=$1 and (($2::uuid is null and location_id is null) or price_lane_id=$2)
      order by effective_date desc,recorded_at desc,id desc limit 1`, [sku, lane?.id ?? null]);
    return { ...head, name: 'Harness item', price_basis: 'per_case', item_number: null, pack_levels: [], measures: [],
      based_on: lane ? 'shop' : 'global', price_lane_id: lane?.id ?? null, pack_location_id: null };
  }
  async function stage(location = shop, before = null, after = null, source = null) {
    const number = ++batchNumber;
    before ??= await snapshot(location);
    after ??= { unit_price: 12, effective_date: '2026-11-05' };
    const batch = { vendor_id: vendor, location_id: location, adapter: 'harness', adapter_version: '1',
      source_name: 'synthetic.csv', source_sha256: source ?? `synthetic-${number}`, exported_at: '2026-11-05', row_count: 1,
      report: { before_state: { '1:price': before } }, created_by: actor };
    const observation = { source_row: 1, kind: 'price', reason: 'price_changed', match: { rule: 'name_exact', sku_id: sku, candidates: [] },
      row: { description: 'Harness item', exported_at: '2026-11-05' }, proposed: after };
    const result = (await one('select stage_vendor_import($1::jsonb,$2::jsonb) as r', [JSON.stringify(batch), JSON.stringify([observation])])).r;
    return { id: result.batch_id, created: result.created, digest: number.toString(16).padStart(64, '0'),
      ops: [{ action: 'sku.price_supersede', sku_id: sku, source_row: 1, before, after }] };
  }
  const apply = (batch, fn = 'apply_vendor_import_shop', overrides = {}) => one(`select ${fn}($1,$2,$3,$4::jsonb) as r`,
    [batch.id, overrides.digest ?? batch.digest, overrides.actor ?? actor, JSON.stringify(overrides.ops ?? batch.ops)]).then(row => row.r);
  const countPrices = async () => (await one('select count(*)::int as n from vendor_price_history')).n;

  for (const name of ['stage_vendor_import(jsonb,jsonb)', 'apply_vendor_import(uuid,text,uuid,jsonb)', 'apply_vendor_import_shop(uuid,text,uuid,jsonb)']) {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      check((await one('select has_function_privilege($1,$2,\'EXECUTE\') as allowed', [role, name])).allowed === (role === 'service_role'), `${role} execute ${name}`);
    }
    check(!(await one(`select exists(select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid=$1::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') as allowed`, [name])).allowed, `PUBLIC cannot execute ${name}`);
  }
  await db.exec('set role service_role');
  const staged = await stage();
  const beforeCount = await countPrices();
  await refuses(() => apply(staged, 'apply_vendor_import'), 'shop_batch_requires_shop_apply');
  check(await countPrices() === beforeCount, 'global refusal writes no price');

  // The EXACT same guard assertion against the old body must fail. Roll back all
  // old-writer changes, including the replacement function, before testing 0293.
  await db.exec('reset role; begin');
  await db.exec(functionSql(old, 'apply_vendor_import'));
  await db.exec('set local role service_role');
  const brokenResult = await apply(staged, 'apply_vendor_import');
  const leaked = await one('select location_id,price_lane_id from vendor_price_history where id=$1', [brokenResult.ops[0].new_ids[0]]);
  let detected = false;
  try { assert.equal(await countPrices(), beforeCount, 'global guard must not append a shop batch to global history'); }
  catch (error) { detected = error.code === 'ERR_ASSERTION'; }
  check(detected && leaked.location_id === null && leaked.price_lane_id === null,
    'BROKEN VARIANT: same no-global-write assertion FAILS against actual unguarded 0259');
  await db.exec('rollback; set role service_role');
  await refuses(() => apply(staged, 'apply_vendor_import'), 'shop_batch_requires_shop_apply');
  check(await countPrices() === beforeCount, 'FIXED VARIANT: no-global-write assertion PASSES against 0293');

  const first = await apply(staged);
  const price = await one('select location_id,price_lane_id,unit_price::float8 as unit_price from vendor_price_history where id=$1', [first.ops[0].new_ids[0]]);
  const lane = await one('select * from sku_price_lanes where id=$1', [price.price_lane_id]);
  check(price.location_id === shop && price.price_lane_id === lane.id && price.unit_price === 12, 'shop price carries location_id and price_lane_id');
  check(lane.based_on_price_id === initial.id && first.ops[0].lane_created === true, 'first shop price opens lane based on global head');
  const ledger = (await one('select result from vendor_import_applies where batch_id=$1', [staged.id])).result;
  check(JSON.stringify(ledger.ops[0].before) === JSON.stringify(first.ops[0].before) && JSON.stringify(ledger.ops[0].after) === JSON.stringify(first.ops[0].after), 'apply ledger records before and after');
  const replay = await apply(staged);
  check(JSON.stringify(replay) === JSON.stringify(ledger) && await countPrices() === beforeCount + 1, 'same digest replays stored result without another price');
  await refuses(() => apply(staged, 'apply_vendor_import_shop', { digest: 'f'.repeat(64) }), 'batch_already_applied');
  const second = await stage(shop, null, { unit_price: 13, effective_date: '2026-11-06' });
  check(second.ops[0].before.based_on === 'shop' && second.ops[0].before.id === first.ops[0].new_ids[0], 'second batch snapshots own lane head');
  const secondResult = await apply(second);
  check(secondResult.ops[0].price_lane_id === lane.id && secondResult.ops[0].lane_created === false, 'second price appends through existing lane');

  const global = await stage(null);
  await refuses(() => apply(global), 'global_batch_requires_global_apply');
  const globalApplied = await apply(global, 'apply_vendor_import');
  check((await one('select location_id from vendor_price_history where id=$1', [globalApplied.ops[0].new_ids[0]])).location_id === null, 'global writer retains global behavior');
  const pack = await stage();
  await refuses(() => apply(pack, 'apply_vendor_import_shop', { ops: [{ ...pack.ops[0], action: 'sku.pack_level_supersede' }] }), 'unsupported_op');
  check((await one('select count(*)::int as n from vendor_import_applies where batch_id=$1', [pack.id])).n === 0, 'pack refusal rolls claim back');
  const stale = await stage();
  await one("select save_sku_shop_price($1,$2,20,'2026-11-07',$3,null,null)", [sku, shop, actor]);
  const staleCount = await countPrices();
  await refuses(() => apply(stale), 'stale_before_state');
  check(await countPrices() === staleCount, 'stale lane snapshot refuses without partial writes');
  const other = await stage(otherShop);
  await refuses(() => apply(other), 'forbidden');
  for (const role of ['agm', 'social_media_mgr']) {
    await db.query('update users set role=$1 where id=$2', [role, actor]);
    await refuses(() => apply(other), 'forbidden');
  }
  await db.query("update users set role='moo' where id=$1", [actor]);
  check((await apply(other)).ops[0].lane_created === true, 'MoO may apply another shop without membership');
  await db.query("update users set role='gm' where id=$1", [actor]);
  const foreign = await stage();
  await db.query('update vendor_items set location_id=$1 where id=$2', [otherShop, sku]);
  await refuses(() => apply(foreign), 'foreign_sku');
  await db.query('update vendor_items set location_id=null where id=$1', [sku]);
  await db.query('select retire_sku_price_lane($1,$2,$3)', [sku, shop, actor]);
  const inherited = await stage();
  check(inherited.ops[0].before.based_on === 'global' && inherited.ops[0].before.price_lane_id === null,
    'retired lane returns staging to explicit global fallback');
  await db.query("insert into vendor_price_history(vendor_item_id,unit_price,effective_date) values($1,21,'2026-11-06')", [sku]);
  await refuses(() => apply(inherited), 'stale_before_state');
  const laneAppears = await stage();
  await one("select save_sku_shop_price($1,$2,22,'2026-11-07',$3,null,null)", [sku, shop, actor]);
  await refuses(() => apply(laneAppears), 'stale_before_state');
  const scopeSource = 'same-synthetic-file';
  const ownScope = await stage(shop, null, null, scopeSource);
  const globalScope = await stage(null, null, null, scopeSource);
  const sameScope = await stage(shop, null, null, scopeSource);
  check(ownScope.id !== globalScope.id && sameScope.id === ownScope.id && !sameScope.created, 'staging identity separates shops/global and deduplicates same scope');
  await db.query("update vendor_import_batches set status='superseded' where id=$1", [ownScope.id]);
  check((await stage(shop, null, null, scopeSource)).id !== ownScope.id, 'superseded batch permits fresh staging');
  console.log(`PASS 0293: ${checks} checks, including broken-variant proof; in-memory only.`);
} finally {
  await db.close();
}
