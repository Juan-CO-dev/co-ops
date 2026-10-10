// Isolated SQL harness: no env, credentials, network or production database.
// PGlite serializes queries; this proves SQL/grants/expiry, not a multi-session lock stress test.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
try {
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(readFileSync('supabase/migrations/0243_cron_route_leases.sql', 'utf8'));
  const claim = async (job) => (await db.query('select public.claim_cron_route($1) as claimed', [job])).rows[0].claimed;
  await db.exec('set role service_role');
  assert.equal(await claim('toast-sales-today'), true);
  assert.equal(await claim('toast-sales-today'), false);
  assert.equal(await claim('toast-catering-scan'), true);
  assert.equal(await claim('toast-catering-scan'), false);
  await assert.rejects(() => claim('digest-tick'), /invalid_cron_route/);
  await assert.rejects(() => claim(null), /invalid_cron_route/);
  await assert.rejects(() => db.exec("update public.cron_route_leases set lease_until = now()"), /permission denied/);
  await db.exec('reset role');
  const before = (await db.query("select lease_until from public.cron_route_leases where job='toast-sales-today'")).rows[0].lease_until;
  assert.equal(await claim('toast-sales-today'), false);
  const after = (await db.query("select lease_until from public.cron_route_leases where job='toast-sales-today'")).rows[0].lease_until;
  assert.deepEqual(before, after); // rejected duplicates do not extend the lease
  const remaining = (await db.query("select extract(epoch from lease_until-clock_timestamp())::float as seconds from public.cron_route_leases where job='toast-sales-today'")).rows[0].seconds;
  assert.ok(remaining > 300 && remaining <= 330);
  await db.exec("update public.cron_route_leases set lease_until = clock_timestamp() - interval '1 second' where job='toast-sales-today'");
  await db.exec('set role service_role');
  const contenders = await Promise.all(Array.from({ length: 20 }, () => claim('toast-sales-today')));
  assert.equal(contenders.filter(Boolean).length, 1);
  assert.equal(await claim('toast-catering-scan'), false);
  await db.exec('reset role');
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(() => claim('toast-sales-today'), /permission denied/);
    await assert.rejects(() => db.exec('select * from public.cron_route_leases'), /permission denied/);
    await db.exec('reset role');
  }
  assert.equal((await db.query('select count(*)::int as n from public.cron_route_leases')).rows[0].n, 2);
  console.log('PASS: claim winner, duplicates, independent routes, expiry recovery, no extension, 330s duration, bounded rows, role grants.');
} finally { await db.close(); }
