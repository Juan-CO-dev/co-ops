/** 0325 two-session lock proof over the Supabase Management API. SIM ONLY — run by CC after 0325 is applied to sim.
 *   node scripts/sim-0325-po-lock-check-management.mjs --ref=jepgzucrvklhqpthowsc
 * The ref is checked by projectRef(simOnly=true) BEFORE the token is read; the token is read from
 * ~/.supabase-token in-process and is never printed. Nothing here sends an email or touches a real order.
 * Every request is ONE transaction. A holder runs its statement, then pg_sleep(6) with its locks held; the racer
 * starts while the holder sleeps and must be observed BLOCKED by the holder's backend (pg_blocking_pids + an
 * ungranted pg_locks row), then end with the named outcome after the holder commits.
 * Pairings:
 *   E1  a draft line edit (held) ‖ confirm_purchase_order with the PRE-edit lines → the confirm waits, then refuses
 *       lines_changed; the PO stays a draft with no snapshot (B109: the edit is never silently left out).
 *   E2  confirm_purchase_order (held) ‖ a line edit → the edit waits (trigger FOR SHARE), then refuses po_not_draft;
 *       po_lines still equals the snapshot (B109/B110).
 *   R1  remove_vendor_contact(C1) (held) ‖ remove_vendor_contact(C2) on a vendor with exactly 2 → the second waits
 *       on the vendor row, then refuses last_contact; exactly one active contact left (B191).
 *   R2  the same for vendor_ordering_details → last_ordering_detail.
 * Fixtures (all tagged SIM-0325-<tag>): an INACTIVE actor user, an INACTIVE fixture location, an INACTIVE fixture
 * vendor (nobody orders from it) with one SKU, two contacts and two ordering details, two fixture POs (display codes
 * SIM-0325-<tag>-E1 / -E2). Cleanup: append-only — the vendor, SKU, contacts and details are deactivated, the POs
 * stay as harmless fixture rows at the inactive location (ids printed). Nothing is deleted.
 * Exit 0 = every pairing PASS, 1 = a pairing FAILED, 2 = refused / not runnable.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { managementQuery, projectRef, literal as q } from './supabase-management-query.mjs';

let ref;
try { ref = projectRef(process.argv.slice(2), true); } catch (e) { console.error(`REFUSED: ${e.message}`); process.exit(2); }
const query = managementQuery(ref, readFileSync(join(homedir(), '.supabase-token'), 'utf8').trim());

const sleep = ms => new Promise(r => setTimeout(r, ms));
const HOLD_MS = 6000;
const results = [];
const record = (pairing, pass, detail) => { results.push({ pairing, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${pairing} — ${detail}`); };

function wrap(name, body, { hold = 0, commit = true } = {}) {
  return `begin isolation level read committed;
    set local statement_timeout='40s'; set local lock_timeout='25s';
    set local application_name=${q(name)}; set local role service_role;
    do $zz$ declare v_out text; v_n int; begin
      begin
        ${body}
        perform set_config('zz0325.out', 'ok:' || coalesce(v_out, 'null'), true);
      exception when others then
        perform set_config('zz0325.out', 'err:' || sqlstate || ':' || sqlerrm, true);
      end;
    end $zz$;
    ${hold ? `select pg_sleep(${hold / 1000});` : ''}
    select current_setting('zz0325.out', true) as out;
    ${commit ? 'commit' : 'rollback'};`;
}
function parse(out) {
  if (typeof out !== 'string') return { ok: false, code: 'no_output', msg: String(out) };
  if (out.startsWith('ok:')) { const t = out.slice(3); let v = t; try { v = JSON.parse(t); } catch {} return { ok: true, value: v }; }
  const [, code, ...rest] = out.split(':');
  return { ok: false, code, msg: rest.join(':') };
}
const sendTx = async sql => {
  try { return parse((await query(sql)).at(-1)?.out); }
  catch (e) { return { ok: false, code: 'transport', msg: e.message }; }
};
const run = (name, body, opts = {}) => sendTx(wrap(name, body, opts));
const one = async sql => (await query(sql)).at(-1);

async function proveRace(tag, holderBody, racerBody) {
  const hName = `zz0325-${tag}-h-${randomUUID().slice(0, 8)}`, rName = `zz0325-${tag}-r-${randomUUID().slice(0, 8)}`;
  const holder = run(hName, holderBody, { hold: HOLD_MS }).then(r => ({ ...r, at: Date.now() }));
  let racer;
  try {
    let readyAt = null;
    for (let i = 0; i < 60 && !readyAt; i++) {
      const rows = await query(`select exists(select 1 from pg_stat_activity where application_name=${q(hName)} and wait_event='PgSleep') as ready`);
      if (rows[0]?.ready === true) readyAt = Date.now(); else await sleep(200);
    }
    if (!readyAt) { const h = await holder; return { error: `holder never reached pg_sleep (${show(h)})`, holder: h }; }
    await sleep(500);
    const racerStart = Date.now();
    racer = run(rName, racerBody).then(r => ({ ...r, at: Date.now() }));
    let waitTypes = [];
    for (let i = 0; i < 20 && !waitTypes.length; i++) {
      const rows = await query(`select distinct l.locktype from pg_stat_activity r
        join pg_locks l on l.pid = r.pid and not l.granted
        join pg_stat_activity h on h.pid = any(pg_blocking_pids(r.pid))
        where r.application_name=${q(rName)} and h.application_name=${q(hName)} and h.pid <> r.pid`);
      if (rows.length) waitTypes = rows.map(x => x.locktype); else await sleep(200);
    }
    const [h, r] = await Promise.all([holder, racer]);
    const remaining = HOLD_MS - (racerStart - readyAt);
    return { holder: h, racer: r, waitTypes, racerElapsed: r.at - racerStart, remaining, finishedAfter: r.at - racerStart >= remaining - 750 };
  } finally { await Promise.all([holder, racer].filter(Boolean)); }
}
const show = r => r.ok ? JSON.stringify(r.value) : `${r.code} ${r.msg}`;
const raceSummary = x => x.error ? x.error : `racer blocked on [${x.waitTypes.join(',') || 'NOTHING'}] by the holder; racer ${x.racerElapsed} ms (holder had ~${x.remaining} ms left)`;
const raceOk = x => !x.error && x.holder.ok && x.waitTypes.length > 0 && x.finishedAfter;
const isRefusal = (r, name) => !r.ok && r.code === 'P0001' && r.msg === name;

// ── fixture ──
const tag = randomBytes(4).toString('hex');
const NAME = `SIM-0325-${tag}`;
const id = () => randomUUID();
const F = { U: id(), L: id(), V: id(), S: id(), PO1: id(), PO2: id(), L1: id(), L2: id(), C1: id(), C2: id(), D1: id(), D2: id() };
const U = x => `${q(x)}::uuid`;

function fixtureSQL() {
  const po = (poId, lineId, suffix) => `
    insert into public.purchase_orders (id, location_id, vendor_id, display_code, status, created_by)
      values (${U(poId)}, ${U(F.L)}, ${U(F.V)}, ${q(`${NAME}-${suffix}`)}, 'draft', ${U(F.U)});
    insert into public.po_lines (id, po_id, sku_id, order_qty, order_unit_label, note)
      values (${U(lineId)}, ${U(poId)}, ${U(F.S)}, 2, 'cs', ${q(NAME)});`;
  return `begin;
    insert into public.users (id, name, role, pin_hash, active) values (${U(F.U)}, ${q(NAME)}, 'key_holder', ${q(`sim0325-not-a-hash-${randomUUID()}`)}, false);
    insert into public.locations (id, name, code, type, active, created_by) values (${U(F.L)}, ${q(NAME)}, ${q(NAME)}, 'permanent', false, ${U(F.U)});
    insert into public.vendors (id, name, active, created_by, updated_by) values (${U(F.V)}, ${q(NAME)}, false, ${U(F.U)}, ${U(F.U)});
    insert into public.vendor_items (id, name, vendor_id, active, created_by, notes) values (${U(F.S)}, ${q(`${NAME} sku`)}, ${U(F.V)}, false, ${U(F.U)}, ${q(NAME)});
    insert into public.vendor_contacts (id, vendor_id, name, created_by, updated_by) values
      (${U(F.C1)}, ${U(F.V)}, ${q(`${NAME} c1`)}, ${U(F.U)}, ${U(F.U)}), (${U(F.C2)}, ${U(F.V)}, ${q(`${NAME} c2`)}, ${U(F.U)}, ${U(F.U)});
    insert into public.vendor_ordering_details (id, vendor_id, method, value, created_by, updated_by) values
      (${U(F.D1)}, ${U(F.V)}, 'other', ${q(`${NAME} d1`)}, ${U(F.U)}, ${U(F.U)}), (${U(F.D2)}, ${U(F.V)}, 'other', ${q(`${NAME} d2`)}, ${U(F.U)}, ${U(F.U)});
    ${po(F.PO1, F.L1, 'E1')}
    ${po(F.PO2, F.L2, 'E2')}
    select 1 as made;
    commit;`;
}
const expectedLines = lineId => `jsonb_build_array(jsonb_build_object('id', ${q(lineId)}, 'sku_id', ${q(F.S)}, 'order_qty', 2, 'order_unit_label', 'cs'))`;
const snapshot = code => `jsonb_build_object('displayCode', ${q(code)}, 'lines', jsonb_build_array(jsonb_build_object('skuId', ${q(F.S)}, 'qty', 2, 'unitLabel', 'cs')))`;
const confirmBody = (poId, lineId, code) => `perform public.confirm_purchase_order(${U(poId)}, ${expectedLines(lineId)}, ${snapshot(code)}, ${U(F.U)}, clock_timestamp(), null); v_out := 'confirmed';`;
const editBody = lineId => `update public.po_lines set order_qty = 10 where id = ${U(lineId)}; get diagnostics v_n = row_count; v_out := json_build_object('rows', v_n)::text;`;

let exitCode = 0;
let fixtureMade = false;
try {
  const ready = await one(`select to_regprocedure('public.confirm_purchase_order(uuid,jsonb,jsonb,uuid,timestamptz,timestamptz)') is not null
      and to_regprocedure('public.remove_vendor_contact(uuid,uuid)') is not null
      and exists(select 1 from pg_trigger where tgname = 'po_lines_draft_only' and not tgisinternal) as ok`);
  if (!ready?.ok) { console.error('REFUSED: 0325 is not applied on this database'); process.exit(2); }
  await one(fixtureSQL());
  fixtureMade = true;
  console.log(`FIXTURE ${NAME}: ${JSON.stringify(F)}`);

  // E1: the edit commits first; the confirm (built from the pre-edit lines) waits, then refuses lines_changed.
  try {
    const x = await proveRace('e1', editBody(F.L1), confirmBody(F.PO1, F.L1, `${NAME}-E1`));
    const s = await one(`select status, confirmed_snapshot is null as no_snap, (select order_qty::text from public.po_lines where id = ${U(F.L1)}) as qty from public.purchase_orders where id = ${U(F.PO1)}`);
    const ok = raceOk(x) && x.holder.value?.rows === 1 && isRefusal(x.racer, 'lines_changed') && s.status === 'draft' && s.no_snap && Number(s.qty) === 10;
    record('E1 line edit (held) ‖ confirm with the pre-edit lines → confirm waits, refuses lines_changed; PO stays a draft', ok,
      `${raceSummary(x)}; holder ${show(x.holder)}; racer ${show(x.racer)}; after ${JSON.stringify(s)}`);
  } catch (e) { record('E1 edit ‖ confirm', false, e.message); }

  // E2: the confirm commits first; the edit waits on the trigger's FOR SHARE, then refuses po_not_draft.
  try {
    const x = await proveRace('e2', confirmBody(F.PO2, F.L2, `${NAME}-E2`), editBody(F.L2));
    const s = await one(`select status, (confirmed_snapshot->'lines'->0->>'qty') as snap_qty, (select order_qty::text from public.po_lines where id = ${U(F.L2)}) as qty from public.purchase_orders where id = ${U(F.PO2)}`);
    const ok = raceOk(x) && x.holder.value === 'confirmed' && isRefusal(x.racer, 'po_not_draft') && s.status === 'confirmed' && Number(s.snap_qty) === 2 && Number(s.qty) === 2;
    record('E2 confirm (held) ‖ line edit → edit waits, refuses po_not_draft; po_lines equals the snapshot', ok,
      `${raceSummary(x)}; holder ${show(x.holder)}; racer ${show(x.racer)}; after ${JSON.stringify(s)}`);
  } catch (e) { record('E2 confirm ‖ edit', false, e.message); }

  for (const [tagR, fn, table, a, b, last] of [
    ['r1', 'remove_vendor_contact', 'vendor_contacts', F.C1, F.C2, 'last_contact'],
    ['r2', 'remove_vendor_ordering_detail', 'vendor_ordering_details', F.D1, F.D2, 'last_ordering_detail'],
  ]) {
    try {
      const body = rowId => `perform public.${fn}(${U(rowId)}, ${U(F.U)}); v_out := 'removed';`;
      const x = await proveRace(tagR, body(a), body(b));
      const s = await one(`select count(*)::int as active from public.${table} where vendor_id = ${U(F.V)} and active`);
      const ok = raceOk(x) && x.holder.value === 'removed' && isRefusal(x.racer, last) && s.active === 1;
      record(`${tagR.toUpperCase()} ${fn} ‖ ${fn} (vendor with exactly 2) → second waits on the vendor row, refuses ${last}; 1 left`, ok,
        `${raceSummary(x)}; holder ${show(x.holder)}; racer ${show(x.racer)}; active after ${s.active}`);
    } catch (e) { record(`${tagR} removal race`, false, e.message); }
  }
} catch (e) {
  console.error(`ERROR: ${e.message}`);
  exitCode = 2;
} finally {
  if (fixtureMade) {
    try {
      await one(`begin;
        update public.vendor_contacts set active = false, updated_at = now() where vendor_id = ${U(F.V)} and active;
        update public.vendor_ordering_details set active = false, updated_at = now() where vendor_id = ${U(F.V)} and active;
        update public.vendor_items set active = false where id = ${U(F.S)};
        update public.vendors set active = false where id = ${U(F.V)};
        update public.locations set active = false where id = ${U(F.L)};
        select 1 as done; commit;`);
      console.log(`CLEANUP ${NAME}: fixture vendor, SKU, contacts and details deactivated; fixture POs ${F.PO1}, ${F.PO2} kept (inactive location ${F.L}); nothing deleted`);
    } catch (e) { console.error(`CLEANUP FAILED for ${NAME}: ${e.message} — fixture ids above`); exitCode = 2; }
  }
}
const failed = results.filter(r => !r.pass);
if (exitCode === 0 && failed.length) exitCode = 1;
console.log(`${failed.length ? 'FAIL' : 'PASS'} 0325 lock proof: ${results.length - failed.length}/${results.length} pairings`);
process.exit(exitCode);
