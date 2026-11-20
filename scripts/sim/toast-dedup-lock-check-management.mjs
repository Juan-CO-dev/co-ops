/** FILE ONLY: CC runs after 0351 on SIM, before 0351 reaches prod. No direct DB URL or pg needed.
 * SUPABASE_ACCESS_TOKEN=<operator environment>; node scripts/sim/toast-dedup-lock-check-management.mjs --ref=jepgzucrvklhqpthowsc
 * The two-session half of the 0351 proof (plan r3 section 2, r5 P1, review TOASTDUP-r1 P1). The PGlite proof
 * (tests/toast-snapshot-dedup-migration.test.ts) is single-session; this proves, on real Postgres, with two REAL
 * concurrent connections (two simultaneous Management API requests) and a third as observer:
 *   L1. a capture page + finish holding toast_orders: the apply WAITS (an ungranted lock blocked by the capture's
 *       backend), the capture commits, the apply completes.
 *   L2. the apply holding its lock: a capture (run insert -> page -> finish) WAITS at its toast_orders insert, the
 *       apply commits, the capture completes. No deadlock.
 *   L3. the apply holding its lock: toast_modified_save fails 55P03 after its own 1 s lock_timeout (its documented
 *       retry) and succeeds when run again.
 *   L4. the apply holding its lock: reads of toast_orders_latest and the ezCater planner are NOT blocked.
 *   L5. a page that names a candidate's stored hash: the apply refuses candidate_in_running_run; once that run
 *       finishes (the pointer moves to the candidate) it refuses candidate_now_target. Nothing is deleted.
 *   L6. a transaction opened BEFORE the manifest began that holds an UNCOMMITTED reference to a candidate (a row
 *       naming its id, no foreign key): the apply refuses open_transaction_older_than_manifest; once that transaction
 *       has committed, the apply's reference scan (which runs after the guard) refuses candidate_now_evidence.
 *       Nothing is deleted at any point.
 *   L7. an older transaction that only read: refused while open; the batch applies once it has ended.
 *   And pg_stat_database.deadlocks is the same before and after.
 * WRITES only: a new fixture shop (deactivated at the end), synthetic 1999-dated Toast rows for it (the manifests'
 * cutoff is 1999-12-31, so no real sim snapshot can ever be listed), and manifest / registry / audit rows for those.
 * No retries: an interrupted request may have committed; the printed fixture id lets CC retire it.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { literal as q, managementQuery, projectRef } from '../supabase-management-query.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const settled = promise => promise.then(rows => ({ ok: true, rows }), error => ({ ok: false, error: String(error?.message ?? error) }));
export const DAY = '1999-01-05';
export const CUTOFF = '1999-12-31';
const HOLD_SECONDS = 3;

export function fixture() {
  const shop = randomUUID();
  return { shop, tag: `SIM-0351-${shop.slice(0, 8)}` };
}
export const fixtureSQL = f => `begin;
  insert into public.locations(id,name,code,type,active) values(${q(f.shop)},${q(f.tag)},${q(f.tag)},'permanent',true);
  insert into public.toast_modified_cursors(location_id,coverage_start) values(${q(f.shop)},'1998-12-01');
  commit;`;
export const retireSQL = f => `update public.locations set active=false where id=${q(f.shop)} and code=${q(f.tag)}`;

/** One order's capture entry. `salt` changes ONLY the content hash: the same stored content under another hash is
 *  exactly what the pre-PR-1 churn stored. Fixtures are synthetic, so they never touch toastContentHash. */
export function entry(guid, salt, { amount = 1000, modified = `${DAY}T17:00:00Z`, payment = false } = {}) {
  const order = { order_guid: guid, business_date: DAY, opened_at: `${DAY}T16:00:00Z`, closed_at: null, paid_at: null, modified_at: modified,
    promised_at: null, source: 'SIM', revenue_center_guid: null, dining_option_guid: null, server_guid: null, deleted: false, voided: false,
    excess_food: false, third_party_provider_guid: null, third_party_provider_name: null, selection_units: [{ selection_guid: `${guid}-s`, quantity: 1 }] };
  const checks = [{ check_guid: `${guid}-c`, amount_cents: amount, tax_cents: 0, total_cents: amount, voided: false, deleted: false, accounting: null }];
  // toast_modified_save writes only when the payments differ from the pointer's: a sweep entry needs one.
  const payments = payment ? [{ check_guid: `${guid}-c`, payment_guid: `${guid}-p`, type: 'CASH', payment_status: 'CAPTURED', refund_status: 'NONE',
    amount_cents: amount, tip_cents: 0, paid_business_date: DAY, refund_amount_cents: null, refund_tip_cents: null, refund_business_date: null,
    void_business_date: null, server_guid: null, sales_refund_cents: 0 }] : [];
  return { order, checks, discounts: [], service_charges: [], payments, salt };
}
export const entriesSQL = entries => `(select jsonb_agg((e - 'salt') || jsonb_build_object('content_hash',
  encode(sha256(convert_to((e->'order'->>'order_guid') || '|' || (e->>'salt'), 'UTF8')), 'hex'))) from jsonb_array_elements(${q(JSON.stringify(entries))}::jsonb) e)`;
/** plpgsql statements: a run, its one page and (unless finish = false) its finish, through the REAL writers. */
export function captureStatements(f, entries, { finish = true, run = randomUUID() } = {}) {
  return `insert into public.toast_capture_runs(id,location_id,business_date,started_at) values(${q(run)},${q(f.shop)},${q(DAY)},clock_timestamp());
    perform public.toast_capture_page(${q(run)},${q(f.shop)},${q(DAY)},1,${entriesSQL(entries)});
    ${finish ? `perform public.toast_capture_finish(${q(run)},${q(f.shop)},${q(DAY)},1);` : ''}`;
}
export const finishStatement = (f, run) => `perform public.toast_capture_finish(${q(run)},${q(f.shop)},${q(DAY)},1);`;
export const modifiedSaveStatement = (f, entries) => `perform public.toast_modified_save(${q(f.shop)},${entriesSQL(entries)});`;
export const applyStatement = m => `perform public.toast_snapshot_dedup_apply(${m.version}, ${q(m.digest)}, 1,
  (select jsonb_build_object('snapshots', b.snapshots, 'checks', b.checks, 'discounts', b.discounts, 'service_charges', b.service_charges, 'payments', b.payments)
     from public.toast_snapshot_dedup_batches b join public.toast_snapshot_dedup_manifests x on x.id = b.manifest_id where x.version = ${m.version} and b.batch = 1));`;

/** One transaction on its own backend. The statements run inside a plpgsql block that records 'ok' or the SQLSTATE and
 *  message, so a named refusal is read as DATA (the transport exposes no server error text). role = service_role is what
 *  the app's capture uses; the cleanup functions are postgres-only, so they run as the session's own role. */
export function transactionSQL(name, statements, { role = null, hold = 0 } = {}) {
  return `begin isolation level read committed;
  set local statement_timeout='25s';
  set local application_name=${q(name)};
  ${role ? `set local role ${role};` : ''}
  do $zz$ begin
    begin ${statements} perform set_config('zz.out', 'ok', true);
    exception when others then perform set_config('zz.out', sqlstate || ' ' || sqlerrm, true); end;
  end $zz$;
  ${hold ? `select pg_sleep(${hold});` : ''}
  select current_setting('zz.out', true) as out, pg_backend_pid() as pid; commit;`;
}
const out = result => (result.ok ? result.rows[0]?.out : `transport: ${result.error}`);

async function sleeping(query, name) {
  const rows = await query(`select exists(select 1 from pg_stat_activity where application_name=${q(name)} and wait_event='PgSleep') as s`);
  return rows[0]?.s === true;
}
async function waitSleeping(query, name) {
  for (let i = 0; i < 60; i++) { if (await sleeping(query, name)) return true; await pause(100); }
  return false;
}
async function blockedBy(query, holderName, racerName) {
  for (let i = 0; i < 30; i++) {
    const rows = await query(`select exists(select 1 from pg_stat_activity h join pg_stat_activity r on h.pid = any(pg_blocking_pids(r.pid))
      join pg_locks l on l.pid = r.pid and not l.granted
      where h.application_name=${q(holderName)} and r.application_name=${q(racerName)} and h.pid<>r.pid) as blocked`);
    if (rows[0]?.blocked === true) return true;
    await pause(100);
  }
  return false;
}
/** `count` equal captures of one order (count - 1 exact duplicates of the last, which is the pointer target). */
async function seedDuplicates(query, f, guid, count) {
  for (let i = 0; i < count; i++) {
    const r = await query(transactionSQL(`dd-seed-${guid}`, captureStatements(f, [entry(guid, `v${i}`)]), { role: 'service_role' }));
    assert.equal(r[0]?.out, 'ok', `seed ${guid} #${i}`);
  }
}
/** A manifest over the 1999 fixture dates only. Its version is the next free one on this database. */
async function buildManifest(query) {
  const rows = await query(`begin;
    create temp table zz_v on commit drop as select coalesce(max(version), 0) + 1 as v from public.toast_snapshot_dedup_manifests;
    select public.toast_snapshot_dedup_begin((select v from zz_v), ${q(CUTOFF)});
    select public.toast_snapshot_dedup_build_range((select v from zz_v), '1999-01-01', '2000-01-01');
    select public.toast_snapshot_dedup_finish((select v from zz_v), 1000) as r; commit;`);
  const r = rows[0]?.r;
  assert.ok(r && typeof r.version === 'number' && /^[0-9a-f]{64}$/.test(r.digest), 'manifest built');
  return r;
}
const manifestState = async (query, m) => (await query(`select m.status, m.applied_batches,
  (select count(*)::int from public.toast_snapshot_registry g where g.manifest_id = m.id) as deleted,
  (public.toast_snapshot_dedup_verify(m.version)->>'ok')::boolean as verify_ok
  from public.toast_snapshot_dedup_manifests m where m.version = ${m.version}`))[0];
const deadlocks = async query => Number((await query('select deadlocks from pg_stat_database where datname = current_database()'))[0]?.deadlocks);
export const abandonActiveSQL = `select public.toast_snapshot_dedup_abandon(version) from public.toast_snapshot_dedup_manifests where status in ('building','built','applying')`;

export async function runProof(query, log = console.log) {
  assert.equal((await query(`select to_regclass('public.toast_snapshot_registry') is not null as ok`))[0]?.ok, true, '0351 must be applied');
  assert.equal((await query(`select count(*)::int as n from public.toast_snapshot_dedup_manifests where status in ('building','built','applying')`))[0]?.n, 0,
    'a manifest is in flight on this database; this proof never abandons one it did not build');
  const f = fixture();
  log(`fixture shop ${f.shop} (${f.tag})`);
  const before = await deadlocks(query);
  await query(fixtureSQL(f));
  try {
    // L1. the apply waits for a capture that already holds toast_orders, then completes.
    await seedDuplicates(query, f, 'l1', 3);
    let m = await buildManifest(query);
    assert.equal(m.items, 2, 'L1 manifest lists the two duplicates');
    let holder = settled(query(transactionSQL('dd-l1-h', captureStatements(f, [entry('l1-other', 'a')]), { role: 'service_role', hold: HOLD_SECONDS })));
    assert.ok(await waitSleeping(query, 'dd-l1-h'), 'L1 capture holds toast_orders in pg_sleep');
    let racer = settled(query(transactionSQL('dd-l1-r', applyStatement(m))));
    assert.ok(await blockedBy(query, 'dd-l1-h', 'dd-l1-r'), 'L1 the apply has an ungranted lock blocked by the capture');
    assert.equal(out(await holder), 'ok', 'L1 capture commits');
    assert.equal(out(await racer), 'ok', 'L1 apply completes after the capture');
    assert.deepEqual(await manifestState(query, m), { status: 'applied', applied_batches: 1, deleted: 2, verify_ok: true });
    log('L1. the apply waited for the capture, then deleted its 2 duplicates; verify ok');

    // L2. a capture waits for the apply at its toast_orders insert, then completes.
    await seedDuplicates(query, f, 'l2', 3);
    m = await buildManifest(query);
    holder = settled(query(transactionSQL('dd-l2-h', applyStatement(m), { hold: HOLD_SECONDS })));
    assert.ok(await waitSleeping(query, 'dd-l2-h'), 'L2 apply holds its lock in pg_sleep');
    racer = settled(query(transactionSQL('dd-l2-r', captureStatements(f, [entry('l2-other', 'a')]), { role: 'service_role' })));
    assert.ok(await blockedBy(query, 'dd-l2-h', 'dd-l2-r'), 'L2 the capture has an ungranted lock blocked by the apply');
    assert.equal(out(await holder), 'ok', 'L2 apply commits');
    assert.equal(out(await racer), 'ok', 'L2 capture completes after the apply');
    assert.deepEqual(await manifestState(query, m), { status: 'applied', applied_batches: 1, deleted: 2, verify_ok: true });
    log('L2. the capture waited at its toast_orders insert, then committed; no deadlock');

    // L3. the modified sweep fails after its own 1 s lock_timeout and succeeds on its next run.
    await seedDuplicates(query, f, 'l3', 2);
    m = await buildManifest(query);
    holder = settled(query(transactionSQL('dd-l3-h', applyStatement(m), { hold: HOLD_SECONDS })));
    assert.ok(await waitSleeping(query, 'dd-l3-h'), 'L3 apply holds its lock in pg_sleep');
    const sweep = [entry('l3-mod', 'a', { modified: `${DAY}T18:00:00Z`, payment: true })];
    const refused = out(await settled(query(transactionSQL('dd-l3-r', modifiedSaveStatement(f, sweep), { role: 'service_role' }))));
    assert.match(String(refused), /^55P03 /, `L3 the modified sweep fails lock_not_available (got: ${String(refused).slice(0, 80)})`);
    assert.ok(await sleeping(query, 'dd-l3-h'), 'L3 the sweep gave up while the apply still held its lock');
    assert.equal(out(await holder), 'ok', 'L3 apply commits');
    assert.equal(out(await settled(query(transactionSQL('dd-l3-r2', modifiedSaveStatement(f, sweep), { role: 'service_role' })))), 'ok', 'L3 the sweep succeeds when run again');
    log('L3. toast_modified_save failed 55P03 after its 1 s lock_timeout, then succeeded on re-run');

    // L4. readers are not blocked by the apply's lock.
    await seedDuplicates(query, f, 'l4', 2);
    m = await buildManifest(query);
    holder = settled(query(transactionSQL('dd-l4-h', applyStatement(m), { hold: HOLD_SECONDS })));
    assert.ok(await waitSleeping(query, 'dd-l4-h'), 'L4 apply holds its lock in pg_sleep');
    const read = out(await settled(query(transactionSQL('dd-l4-r', `perform count(*) from public.toast_orders_latest;
      perform count(*) from public.plan_ezcater_toast(); perform count(*) from public.toast_orders; perform count(*) from public.toast_capture_run_orders;`))));
    assert.equal(read, 'ok', 'L4 reads complete');
    assert.ok(await sleeping(query, 'dd-l4-h'), 'L4 the reads returned while the apply still held its lock');
    assert.equal(out(await holder), 'ok', 'L4 apply commits');
    log('L4. reads of toast_orders_latest, the ezCater planner, toast_orders and the memberships were not blocked');

    // L5. a candidate named again by a capture is refused by name, before and after that run finishes.
    await seedDuplicates(query, f, 'l5', 2);
    m = await buildManifest(query);
    const run = randomUUID();
    assert.equal((await query(transactionSQL('dd-l5-page', captureStatements(f, [entry('l5', 'v0')], { finish: false, run }), { role: 'service_role' })))[0]?.out, 'ok');
    assert.match(String(out(await settled(query(transactionSQL('dd-l5-a', applyStatement(m)))))), /candidate_in_running_run/, 'L5 refuses while the run is open');
    assert.equal((await query(transactionSQL('dd-l5-finish', finishStatement(f, run), { role: 'service_role' })))[0]?.out, 'ok');
    assert.match(String(out(await settled(query(transactionSQL('dd-l5-b', applyStatement(m)))))), /candidate_now_target/, 'L5 refuses once the pointer moved to the candidate');
    assert.deepEqual(await manifestState(query, m), { status: 'built', applied_batches: 0, deleted: 0, verify_ok: true });
    await query(`select public.toast_snapshot_dedup_abandon(${m.version})`);
    log('L5. candidate_in_running_run, then candidate_now_target; nothing deleted; manifest abandoned');

    // L6. an older transaction holding an UNCOMMITTED reference to the candidate (review TOASTDUP-r1 P1): the apply refuses
    // because that transaction is open; the moment it has committed, the apply's scans (which run AFTER the guard) see
    // the reference and refuse by name. At no point is the payload deleted.
    await seedDuplicates(query, f, 'l6', 2);
    const reference = `insert into public.fact_order_snapshot(location_id, business_date, order_guid, snapshot_id, run_member, check_count)
      select o.location_id, o.business_date, 'l6-ref', o.id, true, 1 from public.toast_orders o
       where o.location_id = ${q(f.shop)} and o.order_guid = 'l6'
         and not exists (select 1 from public.toast_order_latest_pointers p where p.snapshot_id = o.id);`;
    holder = settled(query(transactionSQL('dd-l6-h', reference, { hold: 9 })));
    assert.ok(await waitSleeping(query, 'dd-l6-h'), 'L6 the older transaction is open in pg_sleep with its reference uncommitted');
    m = await buildManifest(query);
    assert.ok(m.items >= 1, 'L6 the manifest lists the candidate (the reference is invisible to the build)');
    assert.match(String(out(await settled(query(transactionSQL('dd-l6-a', applyStatement(m)))))), /open_transaction_older_than_manifest/, 'L6 refuses while the older transaction is open');
    assert.ok(await sleeping(query, 'dd-l6-h'), 'L6 the refusal came while the older transaction was still open');
    assert.equal(out(await holder), 'ok', 'L6 the older transaction commits its reference');
    assert.match(String(out(await settled(query(transactionSQL('dd-l6-b', applyStatement(m)))))), /candidate_now_evidence/, 'L6 once committed, the scan after the guard sees the reference');
    assert.deepEqual(await manifestState(query, m), { status: 'built', applied_batches: 0, deleted: 0, verify_ok: true });
    await query(`select public.toast_snapshot_dedup_abandon(${m.version})`);
    log('L6. open_transaction_older_than_manifest while the reference was uncommitted, then candidate_now_evidence once it committed; nothing deleted');

    // L7. an older transaction that only READ: refused while it is open; the batch applies once it has ended.
    await seedDuplicates(query, f, 'l7', 2);
    holder = settled(query(transactionSQL('dd-l7-h', `perform count(*) from public.toast_orders_latest t where t.location_id = ${q(f.shop)};`, { hold: 9 })));
    assert.ok(await waitSleeping(query, 'dd-l7-h'), 'L7 the old transaction is open in pg_sleep');
    m = await buildManifest(query);
    assert.match(String(out(await settled(query(transactionSQL('dd-l7-a', applyStatement(m)))))), /open_transaction_older_than_manifest/, 'L7 refuses while the older transaction is open');
    assert.ok(await sleeping(query, 'dd-l7-h'), 'L7 the refusal came while the older transaction was still open');
    assert.deepEqual(await manifestState(query, m), { status: 'built', applied_batches: 0, deleted: 0, verify_ok: true });
    assert.equal(out(await holder), 'ok');
    assert.equal(out(await settled(query(transactionSQL('dd-l7-b', applyStatement(m))))), 'ok', 'L7 applies once the older transaction ended');
    assert.deepEqual(await manifestState(query, m), { status: 'applied', applied_batches: 1, deleted: m.items, verify_ok: true });
    log('L7. open_transaction_older_than_manifest while an older reader was open; applied after it ended');

    assert.equal(await deadlocks(query), before, 'pg_stat_database.deadlocks unchanged');
    log(`deadlocks unchanged (${before})`);
    return f;
  } finally {
    // Only manifests over the 1999 fixture cutoff are this proof's; never touch another.
    await query(`select public.toast_snapshot_dedup_abandon(version) from public.toast_snapshot_dedup_manifests
      where status in ('building','built','applying') and cutoff_date = ${q(CUTOFF)}`).catch(() => undefined);
    await query(retireSQL(f));
    log(`fixture shop ${f.shop} deactivated (its 1999 rows stay on sim as evidence)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const ref = projectRef(process.argv.slice(2), true);
    const query = managementQuery(ref, process.env.SUPABASE_ACCESS_TOKEN);
    await runProof(query);
    console.log('PASS 0351 two-session lock proof');
  } catch (error) {
    console.error(`FAIL ${error?.message ?? error}`);
    process.exitCode = 1;
  }
}
