/** Offline SQL proof: node scripts/sql-harness-0294.mjs
 * In-memory PGlite ONLY. No env, network, external database or migration apply.
 * email_receipts is extracted verbatim from 0170, plus the real 0175 columns.
 * FK parents predate checked-in migrations: only their UUID id is needed here;
 * the referencing UUID declarations in 0170/0175 pin that type. No enum is
 * substituted with text. All 0294 columns/constraints run directly from its file.
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFileSync(`supabase/migrations/${name}`, 'utf8');
const migration = read('0294_inbound_router.sql');
const extract = (sql, pattern) => { const m = sql.match(pattern); assert.ok(m, String(pattern)); return m[0]; };
const receiptDdl = extract(read('0170_email_receipts.sql'), /create table if not exists public\.email_receipts \([\s\S]*?\n\);/);
const receiptAdditions = extract(read('0175_vendor_ordering_v2.sql'), /ALTER TABLE public\.email_receipts[\s\S]*?;/);
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const shop = id(1), otherShop = id(2), vendor = id(3), otherVendor = id(4), actor = id(5);
const tables = ['inbound_messages', 'inbound_address_aliases', 'vendor_location_accounts'];
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; console.log(`ok   ${message}`); };
async function setup(sql) {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      grant usage on schema public to anon,authenticated,service_role;
      alter default privileges grant all on tables to anon,authenticated,service_role;
      create table public.users(id uuid primary key);
      create table public.locations(id uuid primary key);
      create table public.vendors(id uuid primary key);
      create table public.vendor_deliveries(id uuid primary key);
      create table public.purchase_orders(id uuid primary key);
    `);
    await db.exec(receiptDdl);
    await db.exec(receiptAdditions);
    await db.exec(sql);
    await db.query('insert into locations(id) values($1),($2)', [shop, otherShop]);
    await db.query('insert into vendors(id) values($1),($2)', [vendor, otherVendor]);
    await db.query('insert into users(id) values($1)', [actor]);
    return db;
  } catch (error) { await db.close(); throw error; }
}
async function refuses(db, sql, params, code) {
  await assert.rejects(db.query(sql, params), error => error.code === code);
  check(true, `SQL refuses ${code}: ${sql.split(' ').slice(0, 4).join(' ')}`);
}
async function idempotency(db) {
  const sql = `insert into inbound_messages(provider_email_id,from_address)
    values($1,$2) on conflict(provider_email_id) do nothing returning id`;
  const first = await db.query(sql, ['synthetic-message', 'supplier@example.test']);
  const duplicate = await db.query(sql, ['synthetic-message', 'supplier@example.test']);
  assert.equal(first.rows.length, 1);
  assert.equal(duplicate.rows.length, 0);
  assert.equal((await db.query('select count(*)::int as n from inbound_messages')).rows[0].n, 1);
  return first.rows[0].id;
}

const db = await setup(migration);
try {
  for (const table of tables) {
    check((await db.query('select relrowsecurity from pg_class where oid=$1::regclass', [table])).rows[0].relrowsecurity, `${table} has RLS`);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
        const expected = role === 'service_role' && ['SELECT', 'INSERT', 'UPDATE'].includes(privilege);
        const result = (await db.query('select has_table_privilege($1,$2,$3) as allowed', [role, table, privilege])).rows[0];
        check(result.allowed === expected, `${role} ${table} ${privilege} = ${expected}`);
      }
    }
    check(!(await db.query(`select exists(select 1 from pg_class c,
      lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      where c.oid=$1::regclass and a.grantee=0) as allowed`, [table])).rows[0].allowed, `${table}: no PUBLIC grants`);
    check((await db.query(`select count(*)::int as n from pg_policy
      where polrelid=$1::regclass and polcmd='d' and pg_get_expr(polqual,polrelid)='false'`, [table])).rows[0].n === 1, `${table}: explicit delete denial`);
  }
  await db.exec('set role service_role');
  const messageId = await idempotency(db);
  check(true, 'stable provider_email_id admits one insert and duplicate is a no-op');
  for (const table of tables) await refuses(db, `delete from ${table}`, [], '42501');

  const aliasSql = 'insert into inbound_address_aliases(address,lane,location_id,created_by) values($1,$2,$3,$4)';
  await refuses(db, aliasSql, ['Shop@example.test', 'vendor_receipt', shop, actor], '23514');
  await refuses(db, aliasSql, ['shop@example.test', 'vendor_receipt', null, actor], '23514');
  await refuses(db, aliasSql, ['events@example.test', 'catering', shop, actor], '23514');
  await db.query(aliasSql, ['shop@example.test', 'vendor_receipt', shop, actor]);
  await db.query(aliasSql, ['events@example.test', 'catering', null, actor]);
  await refuses(db, aliasSql, ['shop@example.test', 'vendor_receipt', otherShop, actor], '23505');
  await db.query("update inbound_address_aliases set active=false,updated_by=$1 where address=$2", [actor, 'shop@example.test']);
  check((await db.query('select count(*)::int as n from inbound_address_aliases')).rows[0].n === 2, 'alias retirement retains history');

  const accountSql = 'insert into vendor_location_accounts(vendor_id,location_id,account_number,created_by) values($1,$2,$3,$4)';
  await db.query(accountSql, [vendor, shop, 'fixture-account-a', actor]);
  await refuses(db, accountSql, [vendor, otherShop, 'fixture-account-a', actor], '23505');
  await refuses(db, accountSql, [vendor, shop, 'fixture-account-b', actor], '23505');
  await db.query(accountSql, [otherVendor, otherShop, 'fixture-account-a', actor]);
  check(true, 'account uniqueness is vendor-scoped, with one account per vendor/shop');
  await refuses(db, "insert into inbound_messages(provider_email_id,from_address,lane) values('bad-lane','sender@example.test','other')", [], '23514');
  await refuses(db, "insert into inbound_messages(provider_email_id,from_address,route_reason) values('bad-reason','sender@example.test','other')", [], '23514');
  await db.query("update inbound_messages set content_state='failed',fetch_attempts=1,next_attempt_at=now()+interval '1 minute' where id=$1", [messageId]);
  const receipt = (await db.query("insert into email_receipts(source,inbound_message_id,attributed_by) values('inbound',$1,'address') returning id", [messageId])).rows[0];
  await db.query("update inbound_messages set email_receipt_id=$1,content_state='fetched' where id=$2", [receipt.id, messageId]);
  await refuses(db, "insert into email_receipts(source,inbound_message_id) values('inbound',$1)", [messageId], '23505');
  await refuses(db, "insert into email_receipts(source,attributed_by) values('upload','guess')", [], '23514');
  check(true, 'receipt link is recoverable, unique and attribution vocabulary is closed');
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`reset role; set role ${role}`);
    for (const table of tables) await refuses(db, `select * from ${table}`, [], '42501');
  }
} finally { await db.close(); }

// Run the SAME idempotency assertion against a real broken migration, not a mock.
const brokenSql = migration.replace('provider_email_id text not null unique,', 'provider_email_id text not null,');
assert.notEqual(brokenSql, migration, 'broken variant must remove the provider unique constraint');
const broken = await setup(brokenSql);
try {
  await broken.exec('set role service_role');
  await assert.rejects(idempotency(broken), error => error.code === '42P10');
  check(true, 'BROKEN VARIANT FAILS: missing provider UNIQUE rejects the actual ON CONFLICT insert (42P10)');
  await broken.query("insert into inbound_messages(provider_email_id,from_address) values('replay','sender@example.test'),('replay','sender@example.test')");
  check((await broken.query('select count(*)::int as n from inbound_messages')).rows[0].n === 2,
    'BROKEN VARIANT also permits duplicate provider ids without ON CONFLICT');
} finally { await broken.close(); }
console.log(`PASS: ${checks} checks; fixed migration passes and broken variant is detected.`);
