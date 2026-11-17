/** FILE ONLY: CC runs after 0337 on SIM, before 0337 reaches prod. No direct DB URL or pg needed.
 * SUPABASE_ACCESS_TOKEN=<operator environment>; node scripts/sim/fact-0337-lock-check-management.mjs --ref=jepgzucrvklhqpthowsc
 * The two-session half of the 0337 proof (plan r3 §1, Astra's interleaving). The PGlite harness
 * (tests/fact-layer-0337-harness.test.ts) is single-session; this proves, on real Postgres:
 *   A. NO WAIT: while a fact replace for D1 holds its day lock and its fact rows (in pg_sleep), a
 *      toast_modified_save batch spanning D1 + D2 AND a full-day capture finish for D2 both COMMIT
 *      without waiting (the holder is still sleeping when they return; no 55P03 under 0237's 1 s lock_timeout).
 *   B. The next diff lists BOTH days (the holder committed a build over a source that moved under it).
 *   C. Two builders of ONE day queue on the advisory lock (an ungranted lock blocked by the holder).
 *   D. Rebuilding drains the diff for the fixture shop.
 * WRITES only a new fixture shop (deactivated at the end) and synthetic 2001 Toast rows + facts for it.
 * No retries: an interrupted request may have committed; the printed fixture id lets CC retire it.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { literal as q, managementQuery, projectRef } from '../supabase-management-query.mjs';
import { proveRace, transactionSQL } from './checklist-0276-lock-check-management.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const settled = promise => promise.then(rows => ({ ok: true, rows }), error => ({ ok: false, error: String(error?.message ?? error) }));
export const D1 = '2001-01-01', D2 = '2001-01-02';
export const VERSION = 'orders-v1';

export function fixture() {
  const shop = randomUUID();
  return { shop, tag: `SIM-0337-${shop.slice(0, 8)}` };
}
export function entry(guid, date, { modified = `${date}T17:00:00Z`, payment = false } = {}) {
  const checks = [{ check_guid: `${guid}-c`, amount_cents: 1000, tax_cents: 100, total_cents: 1100, voided: false, deleted: false, accounting: null }];
  const order = { order_guid: guid, business_date: date, opened_at: `${date}T16:00:00Z`, closed_at: null, paid_at: null, modified_at: modified,
    promised_at: null, source: 'SIM', revenue_center_guid: null, dining_option_guid: null, server_guid: null, deleted: false, voided: false,
    excess_food: false, third_party_provider_guid: null, third_party_provider_name: null, selection_units: [] };
  const payments = payment ? [{ check_guid: `${guid}-c`, payment_guid: `${guid}-p-${modified}`, type: 'CASH', payment_status: 'CAPTURED',
    refund_status: 'NONE', amount_cents: 1100, tip_cents: 0, paid_business_date: date, refund_amount_cents: null, refund_tip_cents: null,
    refund_business_date: null, void_business_date: null, server_guid: null, sales_refund_cents: 0 }] : [];
  const body = { order, checks, discounts: [], service_charges: [], payments };
  return { content_hash: createHash('sha256').update(JSON.stringify(body)).digest('hex'), ...body };
}
export function fixtureSQL(f) {
  return `begin;
    insert into public.locations(id,name,code,type,active) values(${q(f.shop)},${q(f.tag)},${q(f.tag)},'permanent',true);
    insert into public.toast_modified_cursors(location_id,coverage_start) values(${q(f.shop)},'2000-12-01');
    commit;`;
}
export function fullCaptureSQL(f, date, entries) {
  const run = randomUUID();
  return `insert into public.toast_capture_runs(id,location_id,business_date,started_at) values(${q(run)},${q(f.shop)},${q(date)},clock_timestamp());
    select public.toast_capture_page(${q(run)},${q(f.shop)},${q(date)},1,${q(JSON.stringify(entries))}::jsonb);
    select public.toast_capture_finish(${q(run)},${q(f.shop)},${q(date)},1)`;
}
export const modifiedSaveSQL = (f, entries) => `select public.toast_modified_save(${q(f.shop)},${q(JSON.stringify(entries))}::jsonb) as changed`;
/** A minimal valid payload built from the source itself (unpriced checks, no lines/refunds): enough for a lock proof. */
export function replaceSQL(f, date) {
  const L = q(f.shop), D = q(date);
  return `select public.fact_replace_order_day(${L},${D},${q(VERSION)},public.fact_order_day_fingerprint(${L},${D},${q(VERSION)}),
    (select coalesce(jsonb_agg(jsonb_build_object('order_guid',p.order_guid,'snapshot_id',p.snapshot_id,
      'check_count',(select count(*) from public.toast_order_checks c where c.snapshot_id=p.snapshot_id))),'[]'::jsonb)
      from public.toast_order_latest_pointers p where p.location_id=${L} and p.business_date=${D}),
    (select coalesce(jsonb_agg(jsonb_build_object('order_guid',p.order_guid,'check_guid',c.check_guid,'snapshot_id',c.snapshot_id,
      'order_voided',false,'order_deleted',false,'check_voided',c.voided,'check_deleted',c.deleted,'excess_food',false,
      'line_price_state','unpriced')),'[]'::jsonb)
      from public.toast_order_latest_pointers p join public.toast_order_checks c on c.snapshot_id=p.snapshot_id
      where p.location_id=${L} and p.business_date=${D}),
    '[]'::jsonb,'[]'::jsonb) as result`;
}
export const staleSQL = f => `select day_business_date::text as d from public.fact_order_days_stale('2001-01-01',5000,${q(VERSION)})
  where day_location_id=${q(f.shop)} order by 1`;
export const retireSQL = f => `update public.locations set active=false where id=${q(f.shop)} and code=${q(f.tag)}`;

async function sleeping(query, name) {
  const rows = await query(`select exists(select 1 from pg_stat_activity where application_name=${q(name)} and wait_event='PgSleep') as s`);
  return rows[0]?.s === true;
}

export async function runProof(query, log = console.log) {
  const f = fixture();
  log(`fixture shop ${f.shop} (${f.tag})`);
  await query(fixtureSQL(f));
  try {
    await query(transactionSQL('fact-seed-1', fullCaptureSQL(f, D1, [entry('a', D1, { payment: true }), entry('b', D1)])));
    await query(transactionSQL('fact-seed-2', fullCaptureSQL(f, D2, [entry('c', D2, { payment: true })])));
    await query(transactionSQL('fact-seed-b1', replaceSQL(f, D1)));
    await query(transactionSQL('fact-seed-b2', replaceSQL(f, D2)));
    assert.deepEqual(await query(staleSQL(f)), [], 'seeded days built');

    // A. capture never waits on a builder.
    const holder = settled(query(transactionSQL('fact-h', replaceSQL(f, D1), true)));
    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) { ready = await sleeping(query, 'fact-h'); if (!ready) await pause(100); }
    assert.ok(ready, 'holder must hold the D1 day lock in pg_sleep');
    const t0 = Date.now();
    const mod = await settled(query(transactionSQL('fact-mod', modifiedSaveSQL(f, [
      entry('a', D1, { payment: true, modified: `${D1}T18:00:00Z` }), entry('c', D2, { payment: true, modified: `${D2}T18:00:00Z` })]))));
    const full = await settled(query(transactionSQL('fact-full', fullCaptureSQL(f, D2, [entry('c', D2, { payment: true, modified: `${D2}T19:00:00Z` })]))));
    const elapsed = Date.now() - t0;
    assert.ok(mod.ok, `modified save must commit (no 55P03): ${mod.error ?? ''}`);
    assert.ok(full.ok, `full-day finish must commit: ${full.error ?? ''}`);
    assert.ok(await sleeping(query, 'fact-h'), 'both captures returned while the builder still held its lock');
    log(`A. capture committed in ${elapsed} ms while the D1 build slept`);
    const h = await holder;
    assert.ok(h.ok, `holder build must commit: ${h.error ?? ''}`);

    // B. the diff sees both moved days.
    assert.deepEqual((await query(staleSQL(f))).map(r => r.d), [D1, D2], 'next diff lists D1 and D2');
    log('B. diff lists D1 and D2');

    // C. two builders of one day queue on the advisory lock.
    const racer = await proveRace(query, replaceSQL(f, D1), replaceSQL(f, D1), 'fact-race');
    assert.ok(racer.ok, 'queued builder commits after the holder');
    log('C. second builder of D1 waited on the day lock, then committed');

    // D. drain.
    await query(transactionSQL('fact-drain', replaceSQL(f, D2)));
    assert.deepEqual(await query(staleSQL(f)), [], 'diff drained for the fixture shop');
    log('D. diff drained');
    return f;
  } finally {
    await query(retireSQL(f));
    log(`fixture shop ${f.shop} deactivated (its 2001 rows stay on sim as evidence)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const ref = projectRef(process.argv.slice(2), true);
    const query = managementQuery(ref, process.env.SUPABASE_ACCESS_TOKEN);
    await runProof(query);
    console.log('PASS 0337 two-session lock proof');
  } catch (error) {
    console.error(`FAIL ${error?.message ?? error}`);
    process.exitCode = 1;
  }
}
