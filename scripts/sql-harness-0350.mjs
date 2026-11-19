/** Offline 0350 proof (item 21 PR 5, the settings writer). Ephemeral in-memory PGlite only: no credentials, no network.
 * Builds the 0344 stub schema (scripts/sql-harness-0344-lib.mjs), loads the REAL 0344 file, a stand-in for 0347's
 * readiness probe (catering_toast_link_ready) and, when a case needs it, a stand-in for 0348's reconciler, then the
 * REAL 0350 file, and proves:
 *   A. the pre-flight refuses without 0344 / without 0347 by name;
 *   B. who: Owner, CGS and MoO; never a GM, the catering manager, an AGM, an inactive MoO or nobody; the function is
 *      service-role only and the table is still written by nobody else;
 *   C. the whole row or nothing: a missing key, an unknown key, a wrong type, a tolerance out of range, a date that is
 *      not a date are all `invalid_settings`;
 *   D. every dependency refused BY NAME (never a constraint name): switch_needs_enabled, auto_needs_start_date,
 *      origin_listing_needs_origin_link, link_step_not_installed, automatic_not_installed;
 *   E. the first save inserts, the next updates; the row the person saw is compared (settings_moved), an unchanged
 *      save is `no_change`; a shop that does not exist or is inactive is location_not_found;
 *   F. ONE audit row per save, destructive, with the settings before and after and nothing else;
 *   G. a save waits for the reconcile advisory lock (taken first: pinned on the source).
 */
import { pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { SHOP, OTHER, id, read, migration as m0344, schema } from './sql-harness-0344-lib.mjs';

export const m0350 = read('0350_catering_toast_settings_writer.sql');
let checks = 0;
function check(ok, message) { checks++; if (!ok) throw new Error(`FAIL: ${message}`); }
const OWNER = id('2000', 21), CGS = id('2000', 22), MOO = id('2000', 23), GM = id('2000', 24), CM = id('2000', 25), AGM = id('2000', 26), GONE = id('2000', 27);
const CLOSED = id('1000', 3);
const one = async (db, q, p = []) => (await db.query(q, p)).rows[0];
const OFF = { enabled: false, ring_code_enabled: false, auto_link_enabled: false, origin_auto_link_enabled: false, include_toast_origin_leads: false,
  tolerance_cents: 5000, tolerance_pct: 0.15, auto_link_from_date: null };
const save = async (db, actor, shop, settings, expected = null) => (await one(db, `select set_catering_toast_settings($1, $2, $3, $4) r`, [actor, shop, JSON.stringify(settings), expected])).r;
async function refuses(db, run, code, message) {
  await db.exec('begin'); let error;
  try { await run(); } catch (e) { error = e; }
  await db.exec('rollback');
  check(String(error?.message ?? '') === code, `${message}: expected ${code}, got ${error?.message ?? 'success'}`);
}
const READY = `create function public.catering_toast_link_ready() returns boolean language sql stable as $$ select true $$`;
const RECONCILER = `create function public.reconcile_catering_toast(uuid, date, date) returns jsonb language sql as $$ select '{}'::jsonb $$`;

async function base({ ready = true, reconciler = false } = {}) {
  const db = new PGlite();
  await schema(db, check);
  await db.exec(`alter table locations add column active boolean not null default true;
    create table audit_log(id bigserial primary key, actor_id uuid, actor_role text, action text, resource_table text, resource_id uuid,
      metadata jsonb, destructive boolean, created_at timestamptz default now());
    grant all on all tables in schema public to service_role;`);
  await db.exec(m0344);
  if (ready !== null) await db.exec(ready ? READY : READY.replace('select true', 'select false'));
  if (reconciler) await db.exec(RECONCILER);
  await db.exec(`insert into locations(id, name, active) values ('${CLOSED}', 'Closed', false);
    insert into users values ('${OWNER}', 'owner', true), ('${CGS}', 'cgs', true), ('${MOO}', 'moo', true), ('${GM}', 'gm', true),
      ('${CM}', 'catering_mgr', true), ('${AGM}', 'agm', true), ('${GONE}', 'moo', false)`);
  return db;
}

async function main() {
  // A. Pre-flight.
  {
    const bare = new PGlite();
    await schema(bare, check);
    let error; try { await bare.exec(m0350); } catch (e) { error = e; }
    check(String(error?.message).includes('0350: apply 0344 first'), `without 0344: ${error?.message}`);
    const no0347 = await base({ ready: null });
    error = undefined; try { await no0347.exec(m0350); } catch (e) { error = e; }
    check(String(error?.message).includes('0350: apply 0347 first'), `without 0347: ${error?.message}`);
    const twice = await base();
    await twice.exec(m0350);
    error = undefined; try { await twice.exec(m0350); } catch (e) { error = e; }
    check(String(error?.message).includes('0350: set_catering_toast_settings already exists'), `applied twice: ${error?.message}`);
  }

  const db = await base();
  await db.exec(m0350);
  const ON = { ...OFF, enabled: true };

  // B. Who.
  const priv = await one(db, `select has_function_privilege('service_role', 'public.set_catering_toast_settings(uuid,uuid,jsonb,timestamptz)', 'execute') s,
    has_function_privilege('authenticated', 'public.set_catering_toast_settings(uuid,uuid,jsonb,timestamptz)', 'execute') a,
    has_function_privilege('anon', 'public.set_catering_toast_settings(uuid,uuid,jsonb,timestamptz)', 'execute') n,
    has_table_privilege('service_role', 'public.catering_toast_settings', 'insert') i, has_table_privilege('service_role', 'public.catering_toast_settings', 'update') u`);
  check(priv.s && !priv.a && !priv.n && !priv.i && !priv.u, 'service_role EXECUTE only; the table itself is still not writable');
  for (const [who, name] of [[GM, 'a GM'], [CM, 'the catering manager'], [AGM, 'an AGM'], [GONE, 'an inactive MoO'], [id('2000', 99), 'nobody']]) {
    await refuses(db, () => save(db, who, SHOP, ON), 'forbidden', `${name} is refused`);
  }
  await refuses(db, () => save(db, null, SHOP, ON), 'invalid_settings', 'no actor');
  check(Number((await one(db, `select count(*) n from catering_toast_settings`)).n) === 0 && Number((await one(db, `select count(*) n from audit_log`)).n) === 0,
    'a refusal writes nothing and audits nothing');

  // C. The whole row or nothing.
  const { enabled: _drop, ...missing } = ON;
  const bad = [[missing, 'a missing key'], [{ ...ON, note: 'free text' }, 'an unknown key'], [{ ...ON, enabled: 'true' }, 'a string for a switch'],
    [{ ...ON, enabled: null }, 'a null switch'], [{ ...ON, tolerance_cents: -1 }, 'a negative tolerance'], [{ ...ON, tolerance_cents: 100001 }, 'a tolerance over the limit'],
    [{ ...ON, tolerance_cents: 12.5 }, 'a fractional cents tolerance'], [{ ...ON, tolerance_cents: '5000' }, 'a string tolerance'],
    [{ ...ON, tolerance_pct: 1.5 }, 'a percent over 100'], [{ ...ON, tolerance_pct: 0.1234 }, 'a percent finer than the column'],
    [{ ...ON, auto_link_from_date: '11/19/2026' }, 'a date in another shape'], [{ ...ON, auto_link_from_date: '2026-02-30' }, 'a date that does not exist'],
    [{ ...ON, auto_link_from_date: 20261119 }, 'a number for the date'], [[], 'an array'], ['enabled', 'a string']];
  for (const [settings, name] of bad) await refuses(db, () => save(db, MOO, SHOP, settings), 'invalid_settings', `${name} is refused`);

  // D. Dependencies, by name.
  await refuses(db, () => save(db, MOO, SHOP, { ...OFF, ring_code_enabled: true }), 'switch_needs_enabled', 'a dependent switch without enabled');
  await refuses(db, () => save(db, MOO, SHOP, { ...ON, auto_link_enabled: true }), 'auto_needs_start_date', 'automatic linking without a start date');
  await refuses(db, () => save(db, MOO, SHOP, { ...ON, origin_auto_link_enabled: true }), 'auto_needs_start_date', 'origin linking without a start date');
  await refuses(db, () => save(db, MOO, SHOP, { ...ON, include_toast_origin_leads: true }), 'origin_listing_needs_origin_link', 'listing Toast-origin orders without origin linking');
  for (const key of ['ring_code_enabled', 'auto_link_enabled', 'origin_auto_link_enabled']) {
    await refuses(db, () => save(db, MOO, SHOP, { ...ON, [key]: true, auto_link_from_date: '2026-11-19' }), 'automatic_not_installed', `${key} before the reconciler (0348) is installed`);
  }
  {
    const notReady = await base({ ready: false });
    await notReady.exec(m0350);
    await refuses(notReady, () => save(notReady, MOO, SHOP, ON), 'link_step_not_installed', 'enabled while the link step is not ready');
    check((await save(notReady, MOO, SHOP, { ...OFF, tolerance_cents: 2500 })).tolerance_cents === 2500, 'a shop that stays off can still be saved without the link step');
  }
  {
    const full = await base({ reconciler: true });
    await full.exec(m0350);
    const all = { enabled: true, ring_code_enabled: true, auto_link_enabled: true, origin_auto_link_enabled: true, include_toast_origin_leads: true,
      tolerance_cents: 2500, tolerance_pct: 0.1, auto_link_from_date: '2026-11-19' };
    const saved = await save(full, OWNER, SHOP, all);
    check(saved.auto_link_enabled === true && saved.include_toast_origin_leads === true && saved.auto_link_from_date === '2026-11-19' && Number(saved.tolerance_pct) === 0.1,
      'with the reconciler installed every switch can be turned on');
  }

  // E. Insert, update, the row the person saw.
  const first = await save(db, MOO, SHOP, ON);
  check(first.enabled === true && first.location_id === SHOP && typeof first.updated_at === 'string', 'the first save inserts the row');
  await refuses(db, () => save(db, MOO, SHOP, { ...ON, tolerance_cents: 100 }), 'settings_moved', 'a save that saw no row, after one exists');
  await refuses(db, () => save(db, MOO, SHOP, { ...ON, tolerance_cents: 100 }, '2020-01-01T00:00:00Z'), 'settings_moved', 'a save that saw an older row');
  await refuses(db, () => save(db, MOO, SHOP, ON, first.updated_at), 'no_change', 'a save that changes nothing');
  const second = await save(db, CGS, SHOP, { ...ON, tolerance_cents: 100, tolerance_pct: 0.2 }, first.updated_at);
  check(second.tolerance_cents === 100 && Number(second.tolerance_pct) === 0.2 && second.updated_at !== first.updated_at, 'the next save updates it and moves updated_at');
  await refuses(db, () => save(db, MOO, SHOP, OFF, first.updated_at), 'settings_moved', 'the row the first person saw is gone');
  const off = await save(db, OWNER, SHOP, { ...OFF, tolerance_cents: 100, tolerance_pct: 0.2 }, second.updated_at);
  check(off.enabled === false && Number((await one(db, `select count(*) n from catering_toast_settings`)).n) === 1, 'turning a shop off keeps its one row');
  await refuses(db, () => save(db, MOO, id('1000', 9), ON), 'location_not_found', 'a shop that does not exist');
  await refuses(db, () => save(db, MOO, CLOSED, ON), 'location_not_found', 'an inactive shop');
  check((await save(db, MOO, OTHER, ON)).location_id === OTHER, 'another shop has its own row');

  // F. One audit row per save.
  const audit = (await db.query(`select actor_id::text a, actor_role r, action, resource_table t, resource_id::text rid, destructive d, metadata m from audit_log order by id`)).rows;
  check(audit.length === 4 && audit.every(a => a.action === 'catering.toast_settings_update' && a.d === true && a.t === 'catering_toast_settings'), `one destructive audit row per save (${audit.length})`);
  check(audit[0].a === MOO && audit[0].r === 'moo' && audit[0].rid === SHOP && audit[0].m.before === null && audit[0].m.after.enabled === true, 'the first row: who, which shop, no before, the after');
  check(audit[1].a === CGS && audit[1].m.before.tolerance_cents === 5000 && audit[1].m.after.tolerance_cents === 100, 'a later row carries before and after');
  check(JSON.stringify(Object.keys(audit[1].m).sort()) === '["after","before","location_id"]'
    && JSON.stringify(Object.keys(audit[1].m.after).sort()) === JSON.stringify(Object.keys(OFF).sort()), 'the metadata is the shop and the eight settings, nothing else');

  // G. The reconcile lock comes first.
  const src = (await one(db, `select prosrc from pg_proc where proname = 'set_catering_toast_settings'`)).prosrc;
  const lock = src.indexOf("pg_advisory_xact_lock(hashtext('ezcater-toast-reconcile'))");
  check(lock > 0 && lock < src.indexOf('from public.users u') && src.indexOf('from public.users u') < src.indexOf('insert into public.catering_toast_settings'),
    'lock order: the reconcile advisory lock, the actor, the settings row');
  const writers = (await db.query(`select proname from pg_proc where prosrc ~* '(insert into|update)\\s+public\\.catering_toast_settings' order by 1`)).rows.map(r => r.proname);
  check(writers.join() === 'set_catering_toast_settings', `ONE writer of the settings: ${writers}`);

  console.log(`sql-harness-0350: ${checks} checks passed`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.stack ?? e.message); process.exit(1); });
