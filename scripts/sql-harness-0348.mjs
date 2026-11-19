/** Offline 0348 proof (item 21 PR 4, the HOUSE RECONCILER). Ephemeral in-memory PGlite only: no credentials, no network.
 * Builds exactly what scripts/sql-harness-0347.mjs builds (the REAL 0221 view, 0225 transfer, 0229 publisher, 0231
 * planner, 0330 reconciler, the REAL 0344 and 0347 files), then the REAL 0348 file, and proves:
 *   A. equivalence: with no recorded note code, 0348's ezCater planner and house planner return 0347's rows exactly
 *      (with house links and ring codes present too), and a publication + ezCater reconcile write identical links;
 *   B. the ceiling and the pins: deny-all on the note-code table, service_role SELECT only; every function that inserts
 *      a link takes the reconcile lock first; the house reconciler has no exception block (no subtransaction) and never
 *      calls an ezCater writer; no house function updates ezcater_toast_links;
 *   C. OFF by default: no settings row, a shop that is off, or no automatic switch = nothing is written and the shared
 *      lock is never taken;
 *   D. ring-code auto-link: the link, the status, ONE run-level audit row, idempotent on the next run, and ezCater is
 *      then refused the check;
 *   E. the start date (Juan answer 7): an event before auto_link_from_date is never linked and stays a suggestion;
 *   F. the tombstone (plan r3 #5): auto-link -> unlink -> three runs including a recapture -> still unlinked; a human
 *      relink survives; unlink again -> blocked again;
 *   G. no Toast ring expected: no link while marked, linked once "ring expected";
 *   H. never over an owner, never on a dual-code check (neither source links), never when two house orders claim a
 *      check, never outside the D-1 .. D+7 window;
 *   I. Toast-origin auto-link (contract #4): its own switch; every live check of the order, never a voided one; never
 *      before the start date; never on an ezCater dining option; a Toast-origin lead whose code is on the check links
 *      by the code when only the code switch is on;
 *   J. the note codes (contract #3): the writer refuses text and drops unknown codes; a recorded ring code is evidence
 *      for the house planner, the house reconciler, the publisher guard (a dual_code skip) and the ezCater planner
 *      (not batch-claimed), only while it names the order's CURRENT capture; a recorded ezCater number makes the check
 *      dual code for the house side;
 *   K. ring codes for booked leads (ensure_catering_ring_codes): only with ring_code_enabled, only house leads with an
 *      event on or after the date, never a Toast-origin or no-ring lead, idempotent;
 *   L. a transfer (the REAL 0225 writer) ends an automatic link in its own transaction; the old shop never relinks it.
 *   M. EVIDENCE PENDING (review PORTAL4-r1): neither source admits a check whose current capture the one note lookup
 *      has not examined. Both placements of the two codes (house code as a name + ezCater number as a special request,
 *      and the reverse) in both arrival orders end the same way: nothing links before the lookup, and once it has
 *      recorded the note-typed code the check is dual code and neither links. A lookup that finds nothing lets the
 *      one source link; a recapture is pending again but never releases an incumbent; an order outside the lookup's
 *      scope never waits; a shop that is off, or has no ring code, never holds ezCater back.
 * PGlite has ONE backend: lock waits are not provable here (the sim two-session proof covers them).
 */
import { pathToFileURL } from 'node:url';
import { SHOP, OTHER, id, read } from './sql-harness-0344-lib.mjs';
import { CM, EO1, EO2, EO3, HA, HB, HC, setup, ringEz, one, all, refuses, reconcile, publish, ezLinks, decide, head, planEz } from './sql-harness-0347.mjs';

export const m0348 = read('0348_catering_toast_reconciler.sql');
let checks = 0;
function check(ok, message) { checks++; if (!ok) throw new Error(`FAIL: ${message}`); }

const HT = id('3000', 301), HU = id('3000', 302), HV = id('3000', 303), HW = id('3000', 304);
const snap = n => id('5000', n);
const planHouse = (db, from = '2026-11-01', to = '2026-11-30') => all(db, `select lead_id::text lead, order_guid, check_guid, toast_snapshot_id::text snap,
  business_date::text d, evidence, check_total_cents::text total, dual_code, owner, owner_lead_id::text owner_lead, blocked
  from plan_catering_toast($1, $2, $3, '[]') order by 1, 2, 3`, [SHOP, from, to]);
export const run = async (db, from = '2026-11-01', to = '2026-11-30', shop = SHOP) =>
  (await one(db, `select reconcile_catering_toast($1, $2, $3) r`, [shop, from, to])).r;
const houseLinks = (db, where = '') => all(db, `select lead_id::text lead, order_guid, check_guid, evidence, is_current cur, retired_reason reason,
  toast_snapshot_id::text snap, decision_id from catering_toast_links ${where} order by created_at, order_guid, check_guid`);
const current = (db, lead) => houseLinks(db, `where is_current and lead_id = '${lead}'`);
const settings = (db, s) => db.query(`insert into catering_toast_settings(location_id, enabled, ring_code_enabled, auto_link_enabled,
    origin_auto_link_enabled, auto_link_from_date) values ($1, $2, $3, $4, $5, $6)
  on conflict (location_id) do update set enabled = excluded.enabled, ring_code_enabled = excluded.ring_code_enabled,
    auto_link_enabled = excluded.auto_link_enabled, origin_auto_link_enabled = excluded.origin_auto_link_enabled,
    auto_link_from_date = excluded.auto_link_from_date`,
  [s.shop ?? SHOP, s.enabled ?? true, s.codes ?? false, s.auto ?? false, s.origin ?? false, s.from ?? null]);
const codes = db => db.exec(`update catering_pipeline set ring_code = 'CO-ACD34' where id = '${HA}' and ring_code is null;
  update catering_pipeline set ring_code = 'CO-ACD36' where id = '${HB}' and ring_code is null;
  update catering_pipeline set ring_code = 'CO-ACD37' where id = '${HC}' and ring_code is null`);
/** The one note lookup's write: `items` = [[order, snapshot, shop?]] examined captures, `found` = the codes on them. */
const look = async (db, items, found = []) => (await one(db, `select record_catering_toast_note_lookup($1, $2) r`,
  [JSON.stringify(items.map(([order, snapshot, shop = SHOP]) => ({ location_id: shop, order_guid: order, toast_snapshot_id: snapshot }))), JSON.stringify(found)])).r;
/** A code found on an examined capture: the capture is examined in the same call. Returns the number of codes stored. */
const record = async (db, rows) => Array.isArray(rows)
  ? (await look(db, rows.map(r => [r.order_guid, r.toast_snapshot_id, r.location_id]), rows)).codes
  : (await one(db, `select record_catering_toast_note_lookup('[]', $1) r`, [JSON.stringify(rows)])).r.codes;
/** A ring whose capture the note lookup has examined (nothing found): the state every automatic link needs. */
const ringC = async (db, snapshot, args) => { await ringEz(db, snapshot, args); await look(db, [[args.order, snapshot]]); };
const note = (order, check_, snapshot, code, shop = SHOP) => ({ location_id: shop, order_guid: order, check_guid: check_, toast_snapshot_id: snapshot, code });
const audits = async db => Number((await one(db, `select count(*) n from audit_log where action = 'catering.toast_reconciled'`)).n);
/** The capture reads sales_channel_map.reviewed_at (the note lookup's scope); the 0344 stub predates it. */
const REVIEWED = `alter table sales_channel_map add column reviewed_at timestamptz default now()`;
const fresh = async (s) => { const db = await setup({ with0347: true }); await db.exec(REVIEWED); await db.exec(m0348); if (s) await settings(db, s); return db; };

async function main() {
  // A. Equivalence with 0347 while no note code is recorded: both planners, with house evidence present.
  {
    const a = await setup({ with0347: true }), b = await fresh();
    await a.exec(REVIEWED);
    for (const db of [a, b]) {
      await settings(db, {});
      await codes(db);
      await ringEz(db, snap(1), { order: 'Z1', date: '2026-11-20', checks: [{ guid: 'Z1c', total: 50000, names: ['ABC-123 party'] }] });
      await ringEz(db, snap(2), { order: 'Z2', date: '2026-11-22', option: 'do-ez', checks: [{ guid: 'Z2a', total: 20000 }, { guid: 'Z2b', total: 30000 }] });
      await ringEz(db, snap(3), { order: 'Z3', date: '2026-11-25', checks: [{ guid: 'Z3c', total: 9000, names: ['XYZ-789'] }] });
      await ringEz(db, snap(4), { order: 'Z4', date: '2026-11-20', checks: [{ guid: 'Z4c', total: 20000, names: ['CO-ACD34'] }] });
      await ringEz(db, snap(5), { order: 'Z5', date: '2026-11-20', checks: [{ guid: 'Z5c', total: 20000, names: ['ABC-123', 'CO-ACD34'] }] });
      await ringEz(db, snap(6), { order: 'Z6', date: '2026-11-22', checks: [{ guid: 'Z6c', total: 20000 }] });
      if (db === b) await look(b, [['Z1', snap(1)], ['Z2', snap(2)], ['Z3', snap(3)], ['Z4', snap(4)], ['Z5', snap(5)], ['Z6', snap(6)]]);
      await decide(db, CM, HB, 'link', { loc: SHOP, order: 'Z6', check: 'Z6c' });
    }
    const pa = await planEz(a), pb = await planEz(b);
    check(pa.length >= 4 && JSON.stringify(pa) === JSON.stringify(pb), `ezCater planner equivalence (${pa.length} rows)`);
    const ha = await planHouse(a), hb = await planHouse(b);
    check(ha.length >= 4 && JSON.stringify(ha) === JSON.stringify(hb), `house planner equivalence (${ha.length} rows)`);
    const pub = { links: [{ toast_snapshot_id: snap(3), order_guid: 'Z3', check_guid: 'Z3c', selection_guid: 'Z3c-s0', business_date: '2026-11-25' }],
      maps: [], reviews: [], shadow: [] };
    for (const db of [a, b]) { await publish(db, EO3, pub); await reconcile(db); }
    check(JSON.stringify(await ezLinks(a)) === JSON.stringify(await ezLinks(b)) && (await ezLinks(b)).length >= 3, 'ezCater links identical with and without 0348');
    const one0347 = async (db, c) => (await one(db, `select catering_toast_check_house_code($1, $2, $3)::text h`, [SHOP, c[0], c[1]])).h;
    for (const c of [['Z4', 'Z4c'], ['Z5', 'Z5c'], ['Z1', 'Z1c']]) check(await one0347(a, c) === await one0347(b, c), `the dual-code test answers as 0347 did on ${c[1]}`);
    // A shop that is OFF (no settings row) never waits for the note lookup, ring codes or not: 0347's rows exactly.
    {
      const x = await setup({ with0347: true }), y = await fresh();
      for (const db of [x, y]) {
        await codes(db);
        await ringEz(db, snap(1), { order: 'Z1', date: '2026-11-20', checks: [{ guid: 'Z1c', total: 50000, names: ['ABC-123 party'] }] });
        await ringEz(db, snap(2), { order: 'Z2', date: '2026-11-22', option: 'do-ez', checks: [{ guid: 'Z2a', total: 20000 }, { guid: 'Z2b', total: 30000 }] });
      }
      const px = await planEz(x), py = await planEz(y);
      check(px.length === 3 && JSON.stringify(px) === JSON.stringify(py), `a shop that is off: the ezCater planner is 0347's with no lookup at all (${px.length} rows)`);
      // ... and so is the publisher guard: an unexamined capture never holds ezCater back at a shop that is off.
      for (const db of [x, y]) await publish(db, EO1, { links: [{ toast_snapshot_id: snap(1), order_guid: 'Z1', check_guid: 'Z1c', selection_guid: 'Z1c-s0', business_date: '2026-11-20' }], maps: [], reviews: [], shadow: [] });
      check((await ezLinks(y, `and check_guid = 'Z1c'`)).length === 1 && JSON.stringify(await ezLinks(x)) === JSON.stringify(await ezLinks(y)), 'a shop that is off: the publisher links as under 0347, with no lookup');
    }
    // The shop is on with NO automatic switch: nothing is written.
    check((await run(b)).skipped === 'off' && (await houseLinks(b)).length === 1, 'a shop with no automatic switch writes nothing');
  }

  // B. Ceiling and pins.
  {
    const db = await fresh();
    check((await one(db, `select count(*)::int n from pg_policies where tablename in ('catering_toast_note_codes', 'catering_toast_note_lookups')`)).n === 8, 'four deny-all policies on the note codes and on the lookup coverage');
    const priv = await one(db, `select has_table_privilege('service_role','public.catering_toast_note_codes','select') and has_table_privilege('service_role','public.catering_toast_note_lookups','select') s,
      has_table_privilege('service_role','public.catering_toast_note_codes','insert') or has_table_privilege('service_role','public.catering_toast_note_lookups','insert')
        or has_table_privilege('service_role','public.catering_toast_note_lookups','update') or has_table_privilege('service_role','public.catering_toast_note_lookups','delete') i,
      has_function_privilege('authenticated','public.reconcile_catering_toast(uuid,date,date)','execute') a,
      has_function_privilege('anon','public.record_catering_toast_note_lookup(jsonb,jsonb)','execute') or has_function_privilege('authenticated','public.catering_toast_uncovered_orders(uuid,date,date)','execute') n,
      has_function_privilege('service_role','public.reconcile_catering_toast(uuid,date,date)','execute') x,
      has_function_privilege('service_role','public.record_catering_toast_note_lookup(jsonb,jsonb)','execute') and has_function_privilege('service_role','public.catering_toast_uncovered_orders(uuid,date,date)','execute') y,
      has_function_privilege('service_role','public.ensure_catering_ring_codes(uuid,date)','execute') z`);
    check(priv.s && !priv.i && !priv.a && !priv.n && priv.x && priv.y && priv.z, 'service_role SELECT + the four RPCs; users nothing');
    const writers = await all(db, `select p.proname, p.prosrc from pg_proc p where p.prosrc ~* 'insert into public\\.(catering_toast_links|ezcater_toast_links)' order by 1`);
    for (const w of writers) {
      const lock = w.prosrc.indexOf("pg_advisory_xact_lock(hashtext('ezcater-toast-reconcile'))");
      check(lock >= 0 && lock < w.prosrc.search(/insert into public\.(catering_toast_links|ezcater_toast_links)/i), `${w.proname}: the reconcile lock comes before any link insert`);
    }
    check(writers.map(w => w.proname).join() === 'decide_catering_toast,publish_ezcater_shadow,reconcile_catering_toast,reconcile_ezcater_toast', `link writers: ${writers.map(w => w.proname)}`);
    const house = await all(db, `select proname from pg_proc where prosrc ~* 'update\\s+public\\.ezcater_toast_links' order by 1`);
    check(house.map(h => h.proname).join() === 'publish_ezcater_shadow,reconcile_ezcater_toast,transfer_catering_lead', 'no house function updates ezcater_toast_links');
    const src = (await one(db, `select prosrc from pg_proc where proname = 'reconcile_catering_toast'`)).prosrc.replace(/--[^\n]*/g, '');
    check(!/\bexception\s+when\b/i.test(src) && !/savepoint/i.test(src), 'the house reconciler has no exception block (no subtransaction)');
    check(!/reconcile_ezcater_toast|publish_ezcater_shadow/.test(src), 'the house reconciler never calls an ezCater writer');
    check(src.indexOf('for no key update') > src.indexOf('pg_advisory_xact_lock') && src.indexOf('insert into public.catering_toast_links') > src.indexOf('for no key update'),
      'lock order: the advisory lock, then the leads, then link rows');
    check((await one(db, `select catering_toast_link_ready() r`)).r === true, '0347\'s link step is still ready');
    const guard = (await one(db, `select prosrc from pg_proc where proname = 'ezcater_toast_links_house_guard'`)).prosrc;
    check(!/raise\s+exception/i.test(guard) && /exception when others then\n\s+return new;/.test(guard) && guard.includes('catering_toast_ezcater_admission_pending'),
      'the re-emitted publisher guard still never raises, and asks the evidence-pending rule');
    const noteWriters = await all(db, `select proname from pg_proc where prosrc ~* 'insert into public\\.catering_toast_note_(codes|lookups)' order by 1`);
    check(noteWriters.map(w => w.proname).join() === 'record_catering_toast_note_lookup', 'ONE writer of the note codes and the coverage');
  }

  // C. OFF by default.
  {
    const db = await fresh();
    await codes(db);
    await ringC(db, snap(11), { order: 'R1', date: '2026-11-20', checks: [{ guid: 'R1c', total: 20000, names: ['CO-ACD34 party'] }] });
    check((await run(db)).skipped === 'off', 'no settings row = off');
    await settings(db, { enabled: false });
    check((await run(db)).skipped === 'off', 'a shop that is off = off');
    await settings(db, { enabled: true });
    check((await run(db)).skipped === 'off', 'enabled without an automatic switch = off');
    check((await houseLinks(db)).length === 0 && await audits(db) === 0, 'nothing written, nothing audited while off');
    await refuses(db, () => db.query(`update catering_toast_settings set auto_link_enabled = true where location_id = $1`, [SHOP]),
      'catering_toast_settings_auto_needs_floor', 'an automatic switch without a start date is refused by the table');
    await refuses(db, () => run(db, '2026-11-01', '2026-10-01'), 'catering_toast_invalid_window', 'a reversed window is refused');
    await refuses(db, () => run(db, '2026-01-01', '2026-11-30'), 'catering_toast_invalid_window', 'a window over 62 days is refused');
  }

  // D. Ring-code auto-link.  E. The start date.  F. The tombstone.  G. No ring expected.
  {
    const db = await fresh({ auto: true, from: '2026-11-21' });
    await codes(db);
    await ringC(db, snap(11), { order: 'R1', date: '2026-11-20', checks: [{ guid: 'R1c', total: 20000, names: ['CO-ACD34 party'] }] });
    await ringC(db, snap(12), { order: 'R2', date: '2026-11-22', checks: [{ guid: 'R2c', total: 20000, names: ['co-acd36'] }] });
    let r = await run(db);
    check(r.added === 1 && r.ring_code === 1 && r.toast_origin === 0 && r.skipped.before_start_date === 1, `D/E: one link, one before the start date (${JSON.stringify(r)})`);
    const hb = await current(db, HB);
    check(hb.length === 1 && hb[0].check_guid === 'R2c' && hb[0].evidence === 'ring_code' && hb[0].decision_id === null && hb[0].snap === snap(12), 'D: HB holds R2c by its ring code, no decision');
    check((await current(db, HA)).length === 0, 'E: the event before the start date is not linked');
    check((await planHouse(db)).some(p => p.lead === HA && p.check_guid === 'R1c' && p.evidence === 'ring_code' && p.owner === null), 'E: it stays a suggestion (Juan answer 7)');
    check((await one(db, `select status from catering_reconciliation_status where lead_id = $1`, [HB])).status === 'matched', 'D: the lead is matched and leaves the not-rung list');
    check((await one(db, `select status from catering_reconciliation_status where lead_id = $1`, [HA])).status === 'not_rung_in_toast', 'E: the old order stays on the list');
    const a = await one(db, `select actor_id, destructive, metadata from audit_log where action = 'catering.toast_reconciled'`);
    check(await audits(db) === 1 && a.actor_id === null && a.destructive === false && a.metadata.added === 1 && a.metadata.link_ids.length === 1
      && a.metadata.location_id === SHOP, 'D: one run-level audit row: a system observation, ids and counts only');
    r = await run(db);
    check(r.added === 0 && r.already_linked === 1 && await audits(db) === 1, 'D: the next run adds nothing and audits nothing');
    // ezCater is refused the check now (0347's guard).
    await publish(db, EO2, { links: [{ toast_snapshot_id: snap(12), order_guid: 'R2', check_guid: 'R2c', selection_guid: 'R2c-s0', business_date: '2026-11-22' }], maps: [], reviews: [], shadow: [] });
    await reconcile(db);
    check((await ezLinks(db, `and check_guid = 'R2c'`)).length === 0, 'D: ezCater never takes the check the reconciler linked');
    // The start date moves back: the old order links on the next run.
    await settings(db, { auto: true, from: '2026-11-01' });
    r = await run(db);
    check(r.added === 1 && (await current(db, HA)).length === 1, 'E: with the start date moved back, the order links');

    // F. Tombstone.
    await decide(db, CM, HB, 'unlink', { loc: SHOP, order: 'R2', check: 'R2c', expected: null });
    check((await current(db, HB)).length === 0, 'F: a person unlinked the automatic link');
    r = await run(db); await run(db);
    check(r.added === 0 && r.skipped.blocked === 1 && (await current(db, HB)).length === 0, 'F: two runs later it is still unlinked (blocked)');
    await ringC(db, snap(13), { order: 'R2', date: '2026-11-22', checks: [{ guid: 'R2c', total: 21000, names: ['CO-ACD36'] }] });
    r = await run(db);
    check(r.added === 0 && (await current(db, HB)).length === 0, 'F: a recapture does not dodge the tombstone');
    await decide(db, CM, HB, 'link', { loc: SHOP, order: 'R2', check: 'R2c', expected: await head(db, HB, 'R2', 'R2c') });
    r = await run(db);
    const relinked = await current(db, HB);
    check(relinked.length === 1 && relinked[0].evidence === 'manual' && r.already_linked === 2, 'F: the human relink survives a run, as the human link');
    await decide(db, CM, HB, 'unlink', { loc: SHOP, order: 'R2', check: 'R2c', expected: await head(db, HB, 'R2', 'R2c') });
    r = await run(db);
    check(r.skipped.blocked === 1 && (await current(db, HB)).length === 0, 'F: unlinked again = blocked again');
    check(Number((await one(db, `select count(*) n from catering_toast_links where is_current = false and retired_reason = 'unlinked'`)).n) === 2, 'F: both unlinks are on their rows');

    // G. No Toast ring expected.
    await ringC(db, snap(14), { order: 'R3', date: '2026-11-24', checks: [{ guid: 'R3c', total: 9000, names: ['CO-ACD37'] }] });
    await decide(db, CM, HC, 'no_ring_expected', { reason: 'comped' });
    r = await run(db); await run(db);
    check(r.skipped.no_ring_expected === 1 && (await current(db, HC)).length === 0, 'G: no link while the order is marked no Toast ring expected');
    await decide(db, CM, HC, 'ring_expected', { expected: await head(db, HC) });
    r = await run(db);
    check(r.added === 1 && (await current(db, HC))[0]?.check_guid === 'R3c', 'G: "ring expected" brings the automatic link back');
  }

  // H. Never over an owner, never on a dual-code check, never two house orders on one check, never out of the window.
  {
    const db = await fresh({ auto: true, from: '2026-11-01' });
    await codes(db);
    // ezCater holds X1c (EO3's number), then the check gains HC's code.
    await ringC(db, snap(21), { order: 'X1', date: '2026-11-24', checks: [{ guid: 'X1c', total: 9000, names: ['XYZ-789'] }] });
    await reconcile(db);
    check((await ezLinks(db, `and check_guid = 'X1c'`)).length === 1, 'H: ezCater holds X1c');
    await ringC(db, snap(22), { order: 'X1', date: '2026-11-24', checks: [{ guid: 'X1c', total: 9000, names: ['XYZ-789', 'CO-ACD37'] }] });
    await reconcile(db);
    let r = await run(db);
    check(r.added === 0 && r.skipped.owned === 1 && (await ezLinks(db, `and check_guid = 'X1c'`)).length === 1 && (await current(db, HC)).length === 0,
      'H: the reconciler never links over ezCater, and ezCater keeps its links');
    // An unowned dual-code check: neither source links (plan r3 #4), in either arrival order.
    await ringC(db, snap(23), { order: 'D1', date: '2026-11-20', checks: [{ guid: 'D1c', total: 50000, names: ['ABC-123', 'CO-ACD34'] }] });
    r = await run(db);
    check(r.skipped.dual_code === 1 && (await current(db, HA)).length === 0, 'H: house first: the dual-code check is not linked');
    await publish(db, EO1, { links: [{ toast_snapshot_id: snap(23), order_guid: 'D1', check_guid: 'D1c', selection_guid: 'D1c-s0', business_date: '2026-11-20' }], maps: [], reviews: [], shadow: [] });
    await reconcile(db);
    r = await run(db);
    check((await ezLinks(db, `and check_guid = 'D1c'`)).length === 0 && (await current(db, HA)).length === 0 && r.skipped.dual_code === 1,
      'H: then ezCater: still neither links; a person decides');
    check((await one(db, `select kind from catering_toast_conflicts where check_guid = 'D1c'`))?.kind === 'dual_code', 'H: the conflict is recorded for the ezCater side');
    // Two ring codes on one check.
    await ringC(db, snap(24), { order: 'T1', date: '2026-11-21', checks: [{ guid: 'T1c', total: 20000, names: ['CO-ACD34', 'CO-ACD36'] }] });
    r = await run(db);
    check(r.skipped.two_house_orders === 2 && (await houseLinks(db, `where check_guid = 'T1c'`)).length === 0, 'H: two house orders on one check: neither links');
    // A person settles it: not a match for HB, then the code links HA.
    await decide(db, CM, HB, 'not_a_match', { loc: SHOP, order: 'T1', check: 'T1c' });
    r = await run(db);
    check((await current(db, HA)).some(l => l.check_guid === 'T1c') && r.skipped.blocked === 1, 'H: after "not a match" on one, the other links');
    // Out of the window (the check is rung ten days after the event): never automatic.
    const far = await fresh({ auto: true, origin: true, from: '2026-11-01' });
    await far.exec(`insert into catering_pipeline(id, location_id, event_date, stage, lead_source, estimated_revenue_cents) values ('${HT}', '${SHOP}', '2026-11-10', 'confirmed', 'toast_catering', 15000);
      insert into toast_catering_orders(location_id, order_guid, business_date, lead_id) values ('${SHOP}', 'F1', '2026-11-25', '${HT}')`);
    await ringC(far, snap(25), { order: 'F1', date: '2026-11-25', checks: [{ guid: 'F1c', total: 15000 }] });
    r = await run(far);
    check(r.added === 0 && r.skipped.out_of_window === 1, 'H: a check outside the day-before to a-week-after window is never linked automatically');
    await refuses(far, () => decide(far, CM, HT, 'link', { loc: SHOP, order: 'F1', check: 'F1c' }), 'check_out_of_window', 'H: the same window the human Link refuses');
  }

  // I. Toast-origin auto-link (contract #4, Juan answer 5).
  {
    const db = await fresh({ auto: true, origin: false, from: '2026-11-10' });
    await db.exec(`insert into catering_pipeline(id, location_id, event_date, stage, lead_source, estimated_revenue_cents) values
        ('${HT}', '${SHOP}', '2026-11-23', 'confirmed', 'toast_catering', 15000), ('${HU}', '${SHOP}', '2026-11-23', 'confirmed', 'toast_catering', 8000),
        ('${HV}', '${SHOP}', '2026-11-05', 'completed', 'toast_catering', 7000), ('${HW}', '${SHOP}', '2026-11-23', 'confirmed', 'toast_catering', 6000);
      update catering_pipeline set ring_code = 'CO-ACD39' where id = '${HW}';
      insert into toast_catering_orders(location_id, order_guid, business_date, lead_id) values
        ('${SHOP}', 'TO1', '2026-11-23', '${HT}'), ('${SHOP}', 'TO2', '2026-11-23', '${HU}'), ('${SHOP}', 'TO0', '2026-11-05', '${HV}'), ('${SHOP}', 'TO3', '2026-11-23', '${HW}')`);
    await ringC(db, snap(31), { order: 'TO1', date: '2026-11-23', checks: [{ guid: 'TO1a', total: 10000 }, { guid: 'TO1b', total: 5000 }, { guid: 'TO1v', total: 900, voided: true }] });
    await ringC(db, snap(32), { order: 'TO2', date: '2026-11-23', option: 'do-ez', checks: [{ guid: 'TO2c', total: 8000 }] });
    await ringC(db, snap(33), { order: 'TO0', date: '2026-11-05', checks: [{ guid: 'TO0c', total: 7000 }] });
    await ringC(db, snap(34), { order: 'TO3', date: '2026-11-23', checks: [{ guid: 'TO3c', total: 6000, names: ['CO-ACD39'] }] });
    let r = await run(db);
    const hw = await current(db, HW);
    check(r.toast_origin === 0 && r.ring_code === 1 && hw.length === 1 && hw[0].evidence === 'ring_code',
      `I: origin switch off: only the Toast-origin lead with its CODE on the check links, by the code (${JSON.stringify(r)})`);
    check(r.skipped.switch_off === 4 && (await current(db, HT)).length === 0, 'I: origin evidence alone waits for its own switch');
    await settings(db, { auto: false, origin: true, from: '2026-11-10' });
    r = await run(db);
    const ht = await current(db, HT);
    check(r.toast_origin === 2 && ht.length === 2 && ht.every(l => l.evidence === 'toast_origin') && ht.map(l => l.check_guid).join() === 'TO1a,TO1b',
      'I: origin switch on: every live check of the order, never the voided one');
    check(r.skipped.ezcater_dining_option === 1 && (await current(db, HU)).length === 0, 'I: a Toast order on an ezCater dining option is never linked by origin');
    check(r.skipped.before_start_date === 1 && (await current(db, HV)).length === 0, 'I: an event before the start date is never linked by origin');
    check((await one(db, `select status from catering_reconciliation_status where lead_id = $1`, [HT])).status === 'matched', 'I: the Toast-origin lead is matched');
    r = await run(db);
    check(r.added === 0 && r.already_linked === 3 && await audits(db) === 2, 'I: idempotent; one audit row per run that added a link');
    // include_toast_origin_leads is permitted only with the origin switch (0344's CHECK).
    await refuses(db, () => db.query(`update catering_toast_settings set origin_auto_link_enabled = false, include_toast_origin_leads = true where location_id = $1`, [SHOP]),
      'catering_toast_settings_origin_listing', 'I: Toast-origin leads are listed only while origin linking is on');
  }

  // J. The note codes (contract #3).
  {
    const db = await fresh({ auto: true, from: '2026-11-01' });
    await codes(db);
    await ringC(db, snap(41), { order: 'N1', date: '2026-11-22', checks: [{ guid: 'N1c', total: 20000, names: ['Open Item'] }] });
    await refuses(db, () => record(db, [note('N1', 'N1c', snap(41), 'please no onions')]), 'catering_toast_note_codes_invalid', 'J: note TEXT is refused by the writer');
    await refuses(db, () => record(db, { location_id: SHOP }), 'catering_toast_note_codes_invalid', 'J: a non-array is refused');
    await refuses(db, () => look(db, [['N1', snap(41)]], [{ ...note('N1', 'N1c', snap(41), 'CO-ACD36'), note: 'allergy: nuts' }]), 'catering_toast_note_codes_invalid', 'J: no extra key rides in with a code');
    await refuses(db, () => one(db, `select record_catering_toast_note_lookup($1, '[]')`, [JSON.stringify([{ location_id: SHOP, order_guid: 'N1', toast_snapshot_id: snap(41), text: 'x' }])]),
      'catering_toast_note_lookup_invalid', 'J: no extra key rides in with an examined capture');
    check((await look(db, [], [note('N1', 'N1c', snap(41), 'CO-ACD36')])).codes === 0, 'J: a code whose capture this call did not examine is dropped');
    check((await look(db, [['N1', id('5999', 1)]])).examined === 0, 'J: coverage is stored only for the current capture');
    check(await record(db, [note('N1', 'N1c', snap(41), 'QQQ-999')]) === 0, 'J: a code that is no known code is dropped');
    check(await record(db, [note('N1', 'N1c', id('5999', 1), 'CO-ACD36')]) === 0, 'J: a code for a capture that is not the current one is dropped');
    check(await record(db, [note('N1', 'NOPE', snap(41), 'CO-ACD36')]) === 0, 'J: a code for a check the capture does not have is dropped');
    check(await record(db, [note('N1', 'N1c', snap(41), 'CO-ACD36', OTHER)]) === 0, 'J: a code for another shop is dropped');
    check((await planHouse(db)).every(p => !(p.lead === HB && p.check_guid === 'N1c' && p.evidence === 'ring_code')), 'J: before the lookup, the note-typed code is invisible');
    check(await record(db, [note('N1', 'N1c', snap(41), 'co-acd36'), note('N1', 'N1c', snap(41), 'CO-ACD36')]) === 1, 'J: a known ring code is recorded once, normalized');
    const row = await one(db, `select code_norm, toast_snapshot_id::text snap from catering_toast_note_codes`);
    check(row.code_norm === 'COACD36' && row.snap === snap(41), 'J: only the normalized code and its capture are stored');
    check((await planHouse(db)).some(p => p.lead === HB && p.check_guid === 'N1c' && p.evidence === 'ring_code'), 'J: the house planner now reads it as ring-code evidence');
    check((await one(db, `select catering_toast_check_house_code($1, 'N1', 'N1c')::text h`, [SHOP])).h === HB, 'J: the dual-code test (the publisher guard) sees it');
    // The publisher guard: an ezCater publication onto that check is skipped as dual code.
    await publish(db, EO2, { links: [{ toast_snapshot_id: snap(41), order_guid: 'N1', check_guid: 'N1c', selection_guid: 'N1c-s0', business_date: '2026-11-22' }], maps: [], reviews: [], shadow: [] });
    check((await ezLinks(db, `and check_guid = 'N1c'`)).length === 0 && (await one(db, `select kind, house_lead_id::text h from catering_toast_conflicts where check_guid = 'N1c'`))?.h === HB,
      'J: the unchanged publisher skips the check (dual_code), naming the house lead');
    // The ezCater planner: an ezCater-option check with a note-typed ring code is not batch-claimed.
    await ringC(db, snap(42), { order: 'N2', date: '2026-11-22', option: 'do-ez', checks: [{ guid: 'N2c', total: 50000 }] });
    check((await planEz(db)).some(p => p.check_guid === 'N2c' && p.evidence === 'daily_batch'), 'J: without a note code the batch plans the check');
    await record(db, [note('N2', 'N2c', snap(42), 'CO-ACD36')]);
    check((await planEz(db)).every(p => p.check_guid !== 'N2c'), 'J: with the recorded ring code the ezCater planner leaves it (planner and guard agree)');
    await reconcile(db);
    check((await ezLinks(db, `and check_guid = 'N2c'`)).length === 0, 'J: the ezCater reconciler does not take it');
    let r = await run(db);
    const hb = await current(db, HB);
    check(r.ring_code === 2 && hb.map(l => l.check_guid).join() === 'N1c,N2c' && hb.every(l => l.evidence === 'ring_code'), `J: the house reconciler links by the recorded note code (${JSON.stringify(r)})`);
    // Only the CURRENT capture counts.
    await ringC(db, snap(43), { order: 'N3', date: '2026-11-24', checks: [{ guid: 'N3c', total: 9000, names: ['Open Item'] }] });
    await record(db, [note('N3', 'N3c', snap(43), 'CO-ACD37')]);
    await ringC(db, snap(44), { order: 'N3', date: '2026-11-24', checks: [{ guid: 'N3c', total: 9000, names: ['Open Item'] }] });
    r = await run(db);
    check(r.added === 0 && (await current(db, HC)).length === 0 && (await one(db, `select catering_toast_check_house_code($1, 'N3', 'N3c') h`, [SHOP])).h === null,
      'J: after a recapture the recorded code no longer counts (until the lookup finds it again)');
    check(await record(db, [note('N3', 'N3c', snap(43), 'CO-ACD37')]) === 0, 'J: a lookup fenced to the OLD capture records nothing');
    check((await look(db, [['N3', snap(43)]])).examined === 0 && (await one(db, `select toast_snapshot_id::text s from catering_toast_note_lookups where order_guid = 'N3'`)).s === snap(44),
      'J: nor does it move the coverage off the current capture');
    check(await record(db, [note('N3', 'N3c', snap(44), 'CO-ACD37')]) === 1 && Number((await one(db, `select count(*) n from catering_toast_note_codes where order_guid = 'N3'`)).n) === 1,
      'J: found again on the new capture: the same row, re-fenced');
    r = await run(db);
    check(r.ring_code === 1 && (await current(db, HC))[0]?.snap === snap(44), 'J: and then it links');
    // A recorded ezCater NUMBER makes the check dual code for the house side: neither links.
    const dual = await fresh({ auto: true, from: '2026-11-01' });
    await codes(dual);
    await ringC(dual, snap(45), { order: 'M1', date: '2026-11-24', checks: [{ guid: 'M1c', total: 9000, names: ['CO-ACD37'] }] });
    check(await record(dual, [note('M1', 'M1c', snap(45), 'XYZ-789')]) === 1, 'J: a known ezCater order number is recorded too');
    check((await planHouse(dual)).find(p => p.lead === HC && p.check_guid === 'M1c')?.dual_code === true, 'J: the house planner flags the check dual code');
    r = await run(dual);
    check(r.added === 0 && r.skipped.dual_code === 1, 'J: the reconciler does not link a check that also carries a note-typed ezCater number');
  }

  // K. Ring codes for booked leads.
  {
    const db = await fresh({ enabled: true });
    const ensure = async (from = '2026-11-21') => (await one(db, `select ensure_catering_ring_codes($1, $2) n`, [SHOP, from])).n;
    await db.exec(`insert into catering_pipeline(id, location_id, event_date, stage, lead_source, estimated_revenue_cents) values
        ('${HT}', '${SHOP}', '2026-11-23', 'confirmed', 'toast_catering', 15000), ('${HU}', '${SHOP}', '2026-11-26', 'new', 'portal', 8000),
        ('${HV}', '${SHOP}', '2026-11-27', 'confirmed', 'portal', 8000), ('${HW}', '${OTHER}', '2026-11-27', 'confirmed', 'portal', 8000);
      insert into toast_catering_orders(location_id, order_guid, business_date, lead_id) values ('${SHOP}', 'TO1', '2026-11-23', '${HT}')`);
    check(await ensure() === 0, 'K: no code while ring_code_enabled is off');
    await settings(db, { codes: true });
    await decide(db, CM, HV, 'no_ring_expected', { reason: 'comped' });
    check(await ensure() === 2, 'K: the two booked house leads on or after the date get a code');
    const got = await all(db, `select id::text id, ring_code from catering_pipeline where ring_code is not null order by event_date`);
    check(got.map(g => g.id).join() === [HB, HC].join() && got.every(g => /^CO-[ACDEFGHJKLMNPQRTUVWXY34679]{5}$/.test(g.ring_code)),
      'K: never an earlier event, an unbooked lead, a Toast-origin lead, a no-ring lead, an ezCater lead or another shop');
    check(await ensure() === 0, 'K: idempotent');
    await refuses(db, () => db.query(`select ensure_catering_ring_codes(null, '2026-11-01')`), 'catering_toast_invalid_window', 'K: a missing shop is refused');
  }

  // L. A transfer ends an automatic link; the old shop never relinks it.
  {
    const db = await fresh({ auto: true, from: '2026-11-01' });
    await codes(db);
    await ringC(db, snap(51), { order: 'R1', date: '2026-11-20', checks: [{ guid: 'R1c', total: 20000, names: ['CO-ACD34'] }] });
    await run(db);
    check((await current(db, HA)).length === 1, 'L: linked by the code');
    await one(db, `select transfer_catering_lead($1, $2, $3, 'capacity') r`, [HA, OTHER, CM]);
    const ended = await houseLinks(db, `where lead_id = '${HA}'`);
    check(ended.length === 1 && ended[0].cur === false && ended[0].reason === 'lead_moved', 'L: the transfer ended the link in its own transaction');
    const r = await run(db);
    check(r.added === 0 && (await current(db, HA)).length === 0, 'L: the old shop does not relink a lead that left');
    check((await run(db, '2026-11-01', '2026-11-30', OTHER)).skipped === 'off', 'L: the other shop is off: nothing there either');
    check(Number((await one(db, `select count(*) n from catering_toast_links h join ezcater_toast_links z on z.is_current and z.location_id = h.location_id
      and z.order_guid = h.order_guid and z.check_guid = h.check_guid where h.is_current`)).n) === 0, 'L: no check has two owners');
  }

  // M. EVIDENCE PENDING (review PORTAL4-r1): neither source admits a check on incomplete note evidence.
  {
    // M1. A house code as an ITEM NAME and an ezCater number as a SPECIAL REQUEST, automatic linking on.
    for (const first of ['house', 'ezcater']) {
      const db = await fresh({ auto: true, from: '2026-11-01' });
      await codes(db);
      await ringEz(db, snap(61), { order: 'P1', date: '2026-11-20', checks: [{ guid: 'P1c', total: 20000, names: ['CO-ACD34'] }] });
      check((await one(db, `select catering_toast_note_evidence_complete($1, 'P1') c`, [SHOP])).c === false, `M1 (${first} first): the capture is not examined yet`);
      let r = await run(db);
      check(r.added === 0 && r.skipped.evidence_pending === 1 && (await current(db, HA)).length === 0, `M1 (${first} first): the house reconciler waits for the note lookup (${JSON.stringify(r)})`);
      // The lookup examines the capture and finds EO1's number typed as a special request.
      check((await look(db, [['P1', snap(61)]], [note('P1', 'P1c', snap(61), 'ABC-123')])).codes === 1, `M1 (${first} first): the lookup records the ezCater number`);
      const pub = () => publish(db, EO1, { links: [{ toast_snapshot_id: snap(61), order_guid: 'P1', check_guid: 'P1c', selection_guid: 'P1c-s0', business_date: '2026-11-20' }], maps: [], reviews: [], shadow: [] });
      if (first === 'house') { r = await run(db); await pub(); await reconcile(db); } else { await pub(); await reconcile(db); r = await run(db); }
      check(r.skipped.dual_code === 1 && (await current(db, HA)).length === 0 && (await ezLinks(db, `and check_guid = 'P1c'`)).length === 0,
        `M1 (${first} first): with the evidence complete it is a dual-code check: neither links`);
      check((await one(db, `select kind from catering_toast_conflicts where check_guid = 'P1c'`))?.kind === 'dual_code', `M1 (${first} first): the conflict is recorded`);
    }

    // M2. The reverse: an ezCater number as an ITEM NAME and a house code as a SPECIAL REQUEST, at an enabled shop with ring codes.
    for (const first of ['house', 'ezcater']) {
      const old = await setup({ with0347: true });
      await old.exec(`insert into catering_toast_settings(location_id, enabled) values ('${SHOP}', true)`);
      const db = await fresh({ auto: true, from: '2026-11-01' });
      for (const x of [old, db]) { await codes(x); await ringEz(x, snap(62), { order: 'Q1', date: '2026-11-20', checks: [{ guid: 'Q1c', total: 50000, names: ['ABC-123'] }] }); }
      check((await planEz(old)).some(p => p.check_guid === 'Q1c'), `M2 (${first} first): under 0347 alone the ezCater planner takes the check at once`);
      check((await planEz(db)).every(p => p.check_guid !== 'Q1c') && (await one(db, `select catering_toast_ezcater_admission_pending($1, 'Q1') p`, [SHOP])).p === true,
        `M2 (${first} first): the ezCater planner waits for the note lookup`);
      await reconcile(db);
      const pub = () => publish(db, EO1, { links: [{ toast_snapshot_id: snap(62), order_guid: 'Q1', check_guid: 'Q1c', selection_guid: 'Q1c-s0', business_date: '2026-11-20' }], maps: [], reviews: [], shadow: [] });
      await pub();
      check((await ezLinks(db, `and check_guid = 'Q1c'`)).length === 0 && Number((await one(db, `select count(*) n from catering_toast_conflicts`)).n) === 0,
        `M2 (${first} first): neither the reconciler nor the publisher admits it, and nothing is recorded as a conflict yet`);
      // The lookup examines the capture and finds HA's ring code typed as a special request.
      await look(db, [['Q1', snap(62)]], [note('Q1', 'Q1c', snap(62), 'CO-ACD34')]);
      let r;
      if (first === 'house') { r = await run(db); await pub(); await reconcile(db); } else { await pub(); await reconcile(db); r = await run(db); }
      check(r.skipped.dual_code === 1 && (await current(db, HA)).length === 0 && (await ezLinks(db, `and check_guid = 'Q1c'`)).length === 0,
        `M2 (${first} first): with the evidence complete it is a dual-code check: neither links (${JSON.stringify(r)})`);
      check((await one(db, `select kind, house_lead_id::text h from catering_toast_conflicts where check_guid = 'Q1c'`))?.h === HA, `M2 (${first} first): the conflict names the house lead`);
    }

    // M3. The lookup finds nothing: ezCater links at its next run. A capture is pending again after a recapture,
    // but an INCUMBENT is never released by it (contract #2).
    {
      const db = await fresh({ from: null });
      await codes(db);
      await ringEz(db, snap(63), { order: 'Q2', date: '2026-11-24', checks: [{ guid: 'Q2c', total: 9000, names: ['XYZ-789'] }] });
      await reconcile(db);
      check((await ezLinks(db, `and check_guid = 'Q2c'`)).length === 0, 'M3: pending: not linked yet');
      const uncovered = async () => (await all(db, `select order_guid, toast_snapshot_id::text snap from catering_toast_uncovered_orders($1, '2026-11-01', '2026-11-30')`, [SHOP]));
      check(JSON.stringify(await uncovered()) === JSON.stringify([{ order_guid: 'Q2', snap: snap(63) }]), 'M3: the capture is listed for the next lookup');
      check((await look(db, [['Q2', snap(63)]])).examined === 1 && (await uncovered()).length === 0, 'M3: examined, nothing found: no longer listed');
      await reconcile(db);
      check((await ezLinks(db, `and check_guid = 'Q2c'`))[0]?.o === EO3, 'M3: with complete evidence and no house code, ezCater links');
      await ringEz(db, snap(64), { order: 'Q2', date: '2026-11-24', checks: [{ guid: 'Q2c', total: 9000, names: ['XYZ-789'] }] });
      check((await uncovered())[0]?.snap === snap(64) && (await one(db, `select catering_toast_ezcater_admission_pending($1, 'Q2') p`, [SHOP])).p === true, 'M3: a recapture is pending again');
      await reconcile(db);
      const kept = await ezLinks(db, `and check_guid = 'Q2c'`);
      check(kept.length === 1 && kept[0].o === EO3 && kept[0].snap === snap(64), 'M3: the incumbent keeps its check through the recapture, re-homed, while the evidence is pending');
    }

    // M4. Out of the lookup's scope (not a reviewed catering dining option): no note there is ever evidence, so nothing waits.
    {
      const db = await fresh({ auto: true, from: '2026-11-01' });
      await codes(db);
      await ringEz(db, snap(65), { order: 'S1', date: '2026-11-20', option: 'do-dine', checks: [{ guid: 'S1c', total: 20000, names: ['CO-ACD34'] }] });
      await ringEz(db, snap(66), { order: 'S2', date: '2026-11-24', option: 'do-dine', checks: [{ guid: 'S2c', total: 9000, names: ['XYZ-789'] }] });
      check((await one(db, `select catering_toast_note_evidence_complete($1, 'S1') c`, [SHOP])).c === true, 'M4: an order outside the scope is complete without a lookup');
      const r = await run(db); await reconcile(db);
      check(r.ring_code === 1 && (await current(db, HA))[0]?.check_guid === 'S1c' && (await ezLinks(db, `and check_guid = 'S2c'`)).length === 1, 'M4: both sources link there at once');
      check((await one(db, `select catering_toast_note_evidence_complete($1, 'NOPE') c`, [SHOP])).c === false, 'M4: an order that is not captured is never complete');
    }

    // M5. Toast-origin with NO ring code anywhere: the house side still waits (an ezCater number may be a note); ezCater never does.
    {
      const db = await fresh({ origin: true, from: '2026-11-01' });
      await db.exec(`insert into catering_pipeline(id, location_id, event_date, stage, lead_source, estimated_revenue_cents) values ('${HT}', '${SHOP}', '2026-11-23', 'confirmed', 'toast_catering', 15000);
        insert into toast_catering_orders(location_id, order_guid, business_date, lead_id) values ('${SHOP}', 'TO1', '2026-11-23', '${HT}')`);
      await ringEz(db, snap(67), { order: 'TO1', date: '2026-11-23', checks: [{ guid: 'TO1a', total: 15000 }] });
      await ringEz(db, snap(68), { order: 'Q3', date: '2026-11-24', checks: [{ guid: 'Q3c', total: 9000, names: ['XYZ-789'] }] });
      let r = await run(db); await reconcile(db);
      check(r.skipped.evidence_pending === 1 && (await current(db, HT)).length === 0, 'M5: the origin link waits for the lookup');
      check((await ezLinks(db, `and check_guid = 'Q3c'`)).length === 1, 'M5: with no ring code at the shop, ezCater never waits');
      await look(db, [['TO1', snap(67)]]);
      r = await run(db);
      check(r.toast_origin === 1 && (await current(db, HT)).length === 1, 'M5: examined, nothing found: linked by origin');
    }
  }

  console.log(`sql-harness-0348: ${checks} checks passed`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.stack ?? e.message); process.exit(1); });
