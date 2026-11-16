/**
 * Offline proof of migration 0326 (audit W20/B196): vendor_mail_mutate re-emitted with the inbound
 * message locked FOR NO KEY UPDATE instead of FOR UPDATE. Real 0170/0175/0294/0297/0299/0326 DDL on
 * synthetic rows in PGlite; no network.
 *
 *   A. Every 0299 scenario (92 checks: ACL, replay, revision CAS, assign / redrive / forward, the
 *      runbook recovery, rollback on an event failure) re-run with 0326 applied on top: the body is
 *      otherwise unchanged, so each must still pass.
 *   B. This file's own checks: 0326 refuses by name unless 0299's body is installed (and leaves the
 *      installed body untouched), is idempotent, changes exactly one lock clause, and keeps the
 *      private-engine privilege ceiling.
 *
 * One PGlite backend is ONE session: the deadlock itself (two sessions) is proven on the sim by
 * scripts/sim/receiving-0326-0327-lock-check-management.mjs, which CC runs when applying 0326.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const FILE = '0326_vendor_mail_mutate_lock_order.sql';
const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const extract = (file, pattern) => { const found = read(file).match(pattern); assert.ok(found, `real prerequisite ${file}`); return found[0]; };
let checks = 0;
const check = (ok, label) => { assert.ok(ok, label); checks++; console.log(`ok ${label}`); };

// ── A. the 0299 scenarios on the 0326 body ──────────────────────────────────────────────────────
const inherited = execFileSync(process.execPath, [fileURLToPath(new URL('./sql-harness-0299.mjs', import.meta.url))], {
  encoding: 'utf8', timeout: 240000, env: { ...process.env, VENDOR_MAIL_HARNESS_APPEND: FILE },
});
const passed = /PASS 0299 \+ 0326: (\d+) checks/.exec(inherited);
check(passed !== null && Number(passed[1]) >= 90, `every 0299 scenario passes on the 0326 body (${passed?.[1] ?? 0} checks)`);

// ── B. this migration's own guard, idempotency, diff and ceiling ────────────────────────────────
const SIG = 'public.vendor_mail_mutate(uuid,integer,uuid,uuid,uuid,text,jsonb)';
const db = new PGlite();
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const source = async () => (await one(`select prosrc from pg_proc where oid='${SIG}'::regprocedure`)).prosrc;
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
    ${extract('0170_email_receipts.sql', /create table if not exists public\.email_receipts \([\s\S]*?\n\);/i)}
    ${extract('0170_email_receipts.sql', /insert into storage\.buckets[\s\S]*?on conflict \(id\) do nothing;/i)}
    ${extract('0175_vendor_ordering_v2.sql', /ALTER TABLE public\.email_receipts[\s\S]*?;/i)}
  `);
  await db.exec(read('0294_inbound_router.sql'));

  // Before 0297: refused by name, nothing created.
  await assert.rejects(() => db.exec(read(FILE)), /0326: 0297 \(vendor mail\) must be applied first/);
  await db.exec('rollback');
  check((await one("select to_regprocedure($1) f", [SIG])).f === null, 'refuses before 0297 and creates nothing');

  // 0297 only: the installed body is NOT 0299's, so 0326 refuses and leaves it as it was.
  await db.exec(read('0297_vendor_mail.sql'));
  const body0297 = await source();
  await assert.rejects(() => db.exec(read(FILE)), /0326: 0299 \(vendor mail body hash\) must be applied first/);
  await db.exec('rollback');
  check(await source() === body0297, 'refuses over the 0297 body and leaves it untouched');

  await db.exec(read('0299_vendor_mail_b2.sql'));
  const body0299 = await source();
  check(body0299.includes("lane='vendor_receipt' for update;") && !body0299.includes('for no key update'), '0299 locks the inbound message FOR UPDATE (the bug)');

  await db.exec(read(FILE));
  const body0326 = await source();
  check(body0326 === body0299.replace("lane='vendor_receipt' for update;", "lane='vendor_receipt' for no key update;"),
    'installed body = 0299 with exactly one lock clause changed');
  check((body0326.match(/for no key update/g) ?? []).length === 1, 'exactly one FOR NO KEY UPDATE: the inbound message');
  check(body0326.includes('where id=m.email_receipt_id for update;'), 'the receipt row is still locked FOR UPDATE, after the message');
  check(body0326.indexOf('for no key update') < body0326.indexOf('where id=m.email_receipt_id for update;'), 'lock order: message, then receipt');

  await db.exec(read(FILE));
  check(await source() === body0326, 're-applying 0326 is a no-op');

  const f = await one(`select prosecdef, proconfig from pg_proc where oid='${SIG}'::regprocedure`);
  check(f.prosecdef === true && f.proconfig.includes('search_path=pg_catalog, public'), 'still SECURITY DEFINER with the pinned search_path');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal((await one(`select has_function_privilege($1,'${SIG}','EXECUTE') ok`, [role])).ok, false);
  }
  check((await one(`select count(*)::int n from pg_proc p, lateral aclexplode(p.proacl) a where p.oid='${SIG}'::regprocedure and a.grantee=0`)).n === 0,
    'the engine stays private: no anon / authenticated / service_role / PUBLIC execute');
  for (const [name, args] of [['vendor_mail_act', 'uuid,integer,uuid,uuid,uuid,text,jsonb'], ['vendor_mail_forward_claim', 'uuid,integer,uuid,uuid,uuid,jsonb'], ['vendor_mail_forward_result', 'uuid,integer,uuid,uuid,uuid,jsonb']]) {
    const w = `public.${name}(${args})`;
    assert.equal((await one(`select has_function_privilege('service_role','${w}','EXECUTE') ok`)).ok, true);
    assert.equal((await one(`select has_function_privilege('authenticated','${w}','EXECUTE') ok`)).ok, false);
    assert.equal((await one(`select has_function_privilege('anon','${w}','EXECUTE') ok`)).ok, false);
  }
  check(true, 'the three wrappers keep service_role-only execute');

  // A broken ceiling is caught by the migration's own assertion (and rolled back).
  await db.exec(`grant execute on function ${SIG} to service_role`);
  await db.exec(read(FILE));
  check((await one(`select has_function_privilege('service_role','${SIG}','EXECUTE') ok`)).ok === false, 're-apply closes a drifted grant on the engine');
  await assert.rejects(() => db.exec(read(FILE).replace(
    `revoke all on function ${SIG} from public, anon, authenticated, service_role;`,
    `grant execute on function ${SIG} to authenticated;`)), /0326: vendor_mail_mutate must stay private/);
  await db.exec('rollback');
  check((await one(`select has_function_privilege('authenticated','${SIG}','EXECUTE') ok`)).ok === false, 'a variant that opens the engine fails its own assertion and rolls back');

  console.log(`PASS 0326: ${checks} checks (single-session PGlite; the two-session deadlock proof is the sim script)`);
} finally { await db.close(); }
