/** FILE ONLY, SIM ONLY: the two-session proof of 0351's CUTOVER locks (the file itself, not the cleanup apply; that is
 * scripts/sim/toast-dedup-lock-check-management.mjs). CC 2026-11-22: the final lock upgrade (step 11, the FK drop's
 * ACCESS EXCLUSIVE on the memberships and the snapshots) had never been proven against concurrent sessions.
 *
 * Needs the PRE-0351 catalog (0351 reverted on sim). EVERY cutover below is ROLLED BACK: the file runs as written, with
 * only an application_name, the apply script's lock_timeout and a statement_timeout set after its `begin`, an optional
 * pg_sleep before step 11 or before step 12, and its final `commit` replaced by `rollback`. Real concurrent sessions are
 * simultaneous Management API requests (each request is one backend), as in the cleanup proof.
 *
 *   X1. reader first, SNAPSHOTS then MEMBERSHIPS: an open transaction runs the live fact-build reader
 *       (fact_order_days_stale, which reads toast_orders), sleeps while the cutover reaches step 11, then reads the
 *       memberships the way lib/toast/captured-day.ts does. This is the upgrade's cycle shape (any ad-hoc SQL such as
 *       scripts/toast-hash-acceptance.sql that reads both in one transaction has it).
 *   X2. reader first, MEMBERSHIPS then SNAPSHOTS (the other order).
 *   X3. cutover first: the cutover holds its ACCESS EXCLUSIVE (paused before step 12); both readers wait, then complete.
 *   X4. capture first: a live capture (run -> toast_capture_page -> toast_capture_finish) holds its locks; the cutover
 *       waits it out and completes.
 *   X5. cutover first, capture queued: the cutover holds SHARE ROW EXCLUSIVE (paused before step 11); a live capture
 *       queues at its toast_orders insert; the upgrade must not wait for the queued capture; the capture completes after.
 *   X6. toast_capture_finish (reads both tables, FK-checks the snapshots) runs while the cutover is paused before step 11:
 *       not blocked (its locks are compatible with SHARE ROW EXCLUSIVE).
 * For each: both sessions' outcomes (a session's SQLSTATE is read as data) and pg_stat_database.deadlocks before/after.
 * WRITES (sim): one fixture shop (deactivated at the end) and its 1999-dated capture rows; nothing else commits.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { literal as q } from '../supabase-management-query.mjs';
import { fixture, fixtureSQL, retireSQL, entry, captureStatements, finishStatement, transactionSQL, DAY } from './toast-dedup-lock-check-management.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const settled = promise => promise.then(rows => ({ ok: true, rows }), error => ({ ok: false, error: String(error?.message ?? error) }));
const outOf = result => (result.ok ? (result.rows.at(-1)?.out ?? result.rows[0]?.out ?? 'ok') : `error: ${result.error.slice(0, 300)}`);
const HOLD = 4;

/** The file, rolled back. Refuses any shape it does not recognise rather than guessing. */
export function cutoverSQL(sql, { name, before11 = 0, before12 = 0 }) {
  const parts = text => text.split('\n').length;
  assert.equal(sql.split('\nbegin;\n').length, 2, 'one begin');
  assert.equal(sql.split('\ncommit;\n').length, 2, 'one commit');
  const s11 = '\n-- 11. LAST lock', s12 = '\n-- 12. Final assertions.';
  assert.equal(sql.split(s11).length, 2, 'step 11 marker');
  assert.equal(sql.split(s12).length, 2, 'step 12 marker');
  const head = `\nbegin;\nset local application_name = ${q(name)};\nset local lock_timeout = '10s';\nset local statement_timeout = '90s';\n`;
  const out = sql.replace('\nbegin;\n', head)
    .replace(s11, `\nselect pg_sleep(${Number(before11)});${s11}`)
    .replace(s12, `\nselect pg_sleep(${Number(before12)});${s12}`)
    .replace('\ncommit;\n', `\nselect 'cutover_ok' as out, pg_backend_pid() as pid;\nrollback;\n`);
  assert.ok(parts(out) === parts(sql) + 6, 'only the instrumentation lines were added');
  return out;
}

const deadlocks = async query => Number((await query('select deadlocks from pg_stat_database where datname = current_database()'))[0]?.deadlocks);
async function state(query, name) {
  const rows = await query(`select wait_event_type, wait_event, state from pg_stat_activity where application_name = ${q(name)}`);
  return rows[0] ?? null;
}
async function until(query, name, predicate, tries = 80) {
  for (let i = 0; i < tries; i++) { const s = await state(query, name); if (s && predicate(s)) return true; await pause(100); }
  return false;
}
const sleepingNow = s => s.wait_event === 'PgSleep';
async function blockedBy(query, holderName, racerName, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const rows = await query(`select exists(select 1 from pg_stat_activity h join pg_stat_activity r on h.pid = any(pg_blocking_pids(r.pid))
      where h.application_name=${q(holderName)} and r.application_name=${q(racerName)} and h.pid<>r.pid) as b`);
    if (rows[0]?.b === true) return true;
    await pause(50);
  }
  return false;
}

const readSnapshots = `perform count(*) from public.fact_order_days_stale(current_date - 30, 5000, 'cutover-proof');`;
const readMemberships = f => `perform count(*) from (select snapshot_id, order_guid from public.toast_capture_run_orders
  where location_id = ${q(f.shop)} and business_date = ${q(DAY)} order by order_guid) m;`;

/** One scenario against one file. Returns the two outcomes, the deadlock delta and what was observed in between. */
async function scenario(query, sql, label, f, kind) {
  const d0 = await deadlocks(query);
  const cut = `dd-cut-${label}`, peer = `dd-peer-${label}`;
  let m, p; const seen = {};
  if (kind === 'X1' || kind === 'X2') {
    const [first, second] = kind === 'X1' ? [readSnapshots, readMemberships(f)] : [readMemberships(f), readSnapshots];
    p = settled(query(transactionSQL(peer, `${first} perform pg_sleep(${HOLD}); ${second}`)));
    assert.ok(await until(query, peer, sleepingNow), `${label} reader holds its first table in pg_sleep`);
    m = settled(query(cutoverSQL(sql, { name: cut })));
    seen.cutover_blocked_by_reader = await blockedBy(query, peer, cut);
  } else if (kind === 'X3') {
    m = settled(query(cutoverSQL(sql, { name: cut, before12: HOLD })));
    assert.ok(await until(query, cut, sleepingNow), `${label} cutover holds ACCESS EXCLUSIVE in pg_sleep`);
    p = settled(query(transactionSQL(peer, `${readSnapshots} ${readMemberships(f)}`)));
    seen.reader_blocked_by_cutover = await blockedBy(query, cut, peer);
  } else if (kind === 'X4') {
    p = settled(query(transactionSQL(peer, captureStatements(f, [entry(`${label}-a`, 'a')]), { role: 'service_role', hold: HOLD })));
    assert.ok(await until(query, peer, sleepingNow), `${label} capture holds its locks in pg_sleep`);
    m = settled(query(cutoverSQL(sql, { name: cut })));
    seen.cutover_blocked_by_capture = await blockedBy(query, peer, cut);
  } else if (kind === 'X5') {
    m = settled(query(cutoverSQL(sql, { name: cut, before11: HOLD })));
    assert.ok(await until(query, cut, sleepingNow), `${label} cutover holds SHARE ROW EXCLUSIVE in pg_sleep`);
    p = settled(query(transactionSQL(peer, captureStatements(f, [entry(`${label}-a`, 'a')]), { role: 'service_role' })));
    seen.capture_queued_behind_cutover = await blockedBy(query, cut, peer);
  } else if (kind === 'X6') {
    const run = randomUUID();
    assert.equal((await query(transactionSQL(`${peer}-page`, captureStatements(f, [entry(`${label}-a`, 'a')], { finish: false, run }), { role: 'service_role' })))[0]?.out, 'ok');
    m = settled(query(cutoverSQL(sql, { name: cut, before11: HOLD })));
    assert.ok(await until(query, cut, sleepingNow), `${label} cutover holds SHARE ROW EXCLUSIVE in pg_sleep`);
    const t0 = Date.now();
    p = settled(query(transactionSQL(peer, finishStatement(f, run), { role: 'service_role' })));
    const pr = await p; seen.finish_ms = Date.now() - t0;
    seen.finish_done_while_cutover_paused = (await state(query, cut))?.wait_event === 'PgSleep';
    p = Promise.resolve(pr);
  }
  const [mr, pr] = [await m, await p];
  const t = Date.now();
  const d1 = await deadlocks(query);
  return { label, cutover: outOf(mr), peer: outOf(pr), deadlocks_added: d1 - d0, ...seen, settled_at: t };
}

export const KINDS = ['X1', 'X2', 'X3', 'X4', 'X5', 'X6'];

/** files: { name: sqlText }. Returns every scenario's record; asserts nothing about the outcomes (the caller judges). */
export async function runCutoverProof(query, files, log = console.log, kinds = KINDS) {
  assert.equal((await query(`select to_regclass('public.toast_snapshot_registry') is null as ok`))[0]?.ok, true, 'needs the PRE-0351 catalog on sim');
  const f = fixture();
  log(`fixture shop ${f.shop} (${f.tag})`);
  await query(fixtureSQL(f));
  // The membership reads need rows to read: one committed capture for the fixture shop.
  assert.equal((await query(transactionSQL('dd-cut-seed', captureStatements(f, [entry('seed', 'v0')]), { role: 'service_role' })))[0]?.out, 'ok');
  const records = [];
  try {
    for (const [fileName, sql] of Object.entries(files)) {
      for (const kind of kinds) {
        const r = await scenario(query, sql, `${fileName}-${kind}`.toLowerCase(), f, kind);
        records.push({ file: fileName, kind, ...r });
        log(JSON.stringify({ file: fileName, kind, ...r }));
        await pause(1500);
      }
    }
    assert.equal((await query(`select to_regclass('public.toast_snapshot_registry') is null as ok`))[0]?.ok, true, 'every cutover rolled back');
    return { fixture: f, records };
  } finally {
    await query(retireSQL(f));
    log(`fixture shop ${f.shop} deactivated (its 1999 rows stay on sim as evidence)`);
  }
}

// CLI (sim only, PRE-0351 catalog): SUPABASE_ACCESS_TOKEN=<operator environment> node scripts/sim/toast-dedup-cutover-lock-check.mjs --ref=<sim>
// Runs X1-X6 against the file in this checkout and asserts: every cutover and every peer ok, no deadlock added.
if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  const { managementQuery, projectRef } = await import('../supabase-management-query.mjs');
  const { readFileSync } = await import('node:fs');
  try {
    const query = managementQuery(projectRef(process.argv.slice(2), true), process.env.SUPABASE_ACCESS_TOKEN);
    const { records } = await runCutoverProof(query, { FILE: readFileSync('supabase/migrations/0351_toast_snapshot_dedup.sql', 'utf8') });
    const bad = records.filter(r => r.cutover !== 'cutover_ok' || r.peer !== 'ok' || r.deadlocks_added !== 0);
    if (bad.length) throw new Error(`cutover proof: ${JSON.stringify(bad)}`);
    console.log('PASS 0351 cutover two-session proof (X1-X6, no deadlock)');
  } catch (error) { console.error(`FAIL ${error?.message ?? error}`); process.exitCode = 1; }
}
