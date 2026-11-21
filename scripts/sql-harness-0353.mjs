/** Offline 0353 proof (nav PR 6, plan r3 8.8). Ephemeral in-memory PGlite only: no credentials, no network.
 * Runs the REAL 0353 file against a minimal schema (scripts/sql-harness-0353-lib.mjs) and proves: the pre-flight, the
 * backfill both ways (live shape, data not name, the effective-template pick, the V1-instance / V2-effective fixture),
 * one marked station per shop, replacing and clearing it, deactivation, the lock order, the two flags together, who may
 * write, the grants, and two deliberately broken variants (the mid-day writer without its clear step; a backfill using
 * r1's "all items are references" rule), each printed as EXPECTED FAIL.
 * PGlite is ONE session: a true simultaneous run is scripts/sim/stations-0353-two-sessions.mjs, on sim, by CC.
 */
import { PGlite } from '@electric-sql/pglite';
import {
  CLOSING_MANAGER, FLOOR_SECTIONS, id, LIVE_SECTIONS, liveShop, merge, readMigration, SCHEMA, seed, SHOP_C, SHOP_NONE, SHOP_P, SHOP_X,
  versionShop,
} from './sql-harness-0353-lib.mjs';

const migration = readMigration('0353_station_day_flags.sql');
let checks = 0;
function check(ok, message) { checks++; if (!ok) throw new Error(message); }
const one = async (db, q, p = []) => (await db.query(q, p)).rows[0];
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

const P_TPL = id(11), C_TPL = id(12), X_TPL = id(13), P_RETIRED = id(14), P_FUTURE = id(15), C_OTHER_TPL = id(16);
const GM_P = id(31), GM_C = id(32), AGM_P = id(33), CAT_P = id(34), GM_OFF = id(35), MOO = id(36), OWNER = id(37), CGS = id(38);
const sid = (base, name) => id(base + LIVE_SECTIONS.indexOf(name));
const P = name => sid(100, name), C = name => sid(200, name);

function backfillSpec() {
  return merge(
    liveShop(SHOP_P, 'P', P_TPL, { stationBase: 100 }),
    liveShop(SHOP_C, 'C', C_TPL, { stationBase: 200 }),
    {
      locations: [{ id: SHOP_X, code: 'X' }, { id: SHOP_NONE, code: 'N' }],
      stations: [
        // P: a section whose only reference is one of seven items; one whose only reference is inactive; references
        // that sit only in a retired or a future-dated template.
        { id: id(150), location: SHOP_P, name: 'One of seven', sort: 20 },
        { id: id(151), location: SHOP_P, name: 'Inactive ref', sort: 21 },
        { id: id(152), location: SHOP_P, name: 'Retired ref', sort: 22 },
        { id: id(153), location: SHOP_P, name: 'Future ref', sort: 23 },
        // C: a reference in ANOTHER shop's template never marks C's same-named station.
        { id: id(250), location: SHOP_C, name: 'One of seven', sort: 20 },
        // X: a station NAMED Closing Manager whose items hold no reference.
        { id: id(300), location: SHOP_X, name: CLOSING_MANAGER, sort: 1 },
        // N: no active closing template at all.
        { id: id(400), location: SHOP_NONE, name: CLOSING_MANAGER, sort: 1 },
      ],
      templates: [
        { id: X_TPL, location: SHOP_X },
        { id: P_RETIRED, location: SHOP_P, active: false, createdAt: '2026-12-01T00:00:00Z' },
        { id: P_FUTURE, location: SHOP_P, effectiveFrom: '2099-01-01', createdAt: '2026-12-02T00:00:00Z' },
        { id: C_OTHER_TPL, location: SHOP_NONE, active: false },
      ],
      items: [
        ...[...Array(6)].map(() => ({ template: P_TPL, station: 'One of seven' })), { template: P_TPL, station: 'One of seven', ref: 'cash_report' },
        { template: P_TPL, station: 'Inactive ref', ref: 'am_prep', active: false }, { template: P_TPL, station: 'Inactive ref' },
        { template: P_TPL, station: 'Retired ref' }, { template: P_RETIRED, station: 'Retired ref', ref: 'am_prep' },
        { template: P_TPL, station: 'Future ref' }, { template: P_FUTURE, station: 'Future ref', ref: 'am_prep' },
        { template: X_TPL, station: CLOSING_MANAGER, label: 'Count the drawer' }, { template: X_TPL, station: CLOSING_MANAGER, label: 'Lock up' },
        { template: C_OTHER_TPL, station: CLOSING_MANAGER, ref: 'pm_report' },
      ],
      users: [
        { id: GM_P, role: 'gm' }, { id: GM_C, role: 'gm' }, { id: AGM_P, role: 'agm' }, { id: CAT_P, role: 'catering_mgr' },
        { id: GM_OFF, role: 'gm', active: false }, { id: MOO, role: 'moo' }, { id: OWNER, role: 'owner' }, { id: CGS, role: 'cgs' },
      ],
      memberships: [
        { user: GM_P, location: SHOP_P }, { user: GM_C, location: SHOP_C }, { user: AGM_P, location: SHOP_P },
        { user: CAT_P, location: SHOP_P }, { user: GM_OFF, location: SHOP_P },
      ],
    },
  );
}

async function fresh(spec, { schema = SCHEMA } = {}) {
  const db = new PGlite();
  await db.exec(schema);
  if (spec) await seed(db, spec);
  return db;
}
const marked = async (db) => (await db.query('select id from stations where not_phase_station order by id')).rows.map(r => r.id);
const midDay = async (db, loc) => (await db.query('select id from stations where starts_mid_day and location_id = $1 order by id', [loc])).rows.map(r => r.id);
/** One writer call; inside a test transaction it runs under a savepoint, so a refusal leaves the transaction usable. */
async function call(db, fn, actor, loc, station, on) {
  const tx = db.isInTransaction();
  if (tx) await db.exec('savepoint w');
  try {
    const r = { ok: (await one(db, `select public.${fn}($1,$2,$3,$4) r`, [actor, loc, station, on])).r };
    if (tx) await db.exec('release savepoint w');
    return r;
  } catch (e) {
    if (tx) await db.exec('rollback to savepoint w; release savepoint w');
    return { error: e.message, code: e.code };
  }
}
const mid = (db, actor, loc, station, on) => call(db, 'set_station_mid_day_trigger', actor, loc, station, on);
const notPhase = (db, actor, loc, station, on) => call(db, 'set_station_not_phase', actor, loc, station, on);

async function preflight() {
  const db = await fresh(backfillSpec());
  await db.exec(migration);
  let refused = false;
  try { await db.exec(migration); } catch (e) { refused = /0353: stations\.starts_mid_day already exists/.test(e.message); if (db.isInTransaction()) await db.exec('rollback'); }
  check(refused, 'A: a second apply is refused by name');
  await db.close();
  const bare = new PGlite();
  let noStations = false;
  try { await bare.exec(migration); } catch (e) { noStations = /0353: expected public\.stations/.test(e.message); }
  check(noStations, 'A: without stations the apply is refused');
  await bare.close();
}

async function backfill(db) {
  const got = new Set(await marked(db));
  const want = new Set([P(CLOSING_MANAGER), C(CLOSING_MANAGER), id(150)]);
  for (const name of LIVE_SECTIONS) {
    check(got.has(P(name)) === (name === CLOSING_MANAGER), `B': P ${name} ${name === CLOSING_MANAGER ? 'true' : 'false'}`);
    check(got.has(C(name)) === (name === CLOSING_MANAGER), `B': C ${name} ${name === CLOSING_MANAGER ? 'true' : 'false'}`);
  }
  check(got.has(id(150)), 'B\': a section whose only reference is one of seven items is marked');
  check(!got.has(id(151)), 'B\': an inactive reference item does not count');
  check(!got.has(id(152)) && !got.has(id(153)), 'B\': a reference only in a retired or future-dated template does not count');
  check(!got.has(id(250)), 'B\': a reference in one shop\'s template never marks another shop\'s same-named station');
  check(!got.has(id(300)), 'B\': a station NAMED Closing Manager with no reference is not marked (data, not name)');
  check(!got.has(id(400)), 'B\': a shop with no active closing template is left unmarked');
  check(got.size === want.size && [...want].every(x => got.has(x)), `B': exactly the expected ids, got ${[...got]}`);
  check((await one(db, 'select count(*)::int n from stations where starts_mid_day')).n === 0, 'B\': no station starts mid-day after apply');
  const audit = await one(db, `select action, destructive, metadata from audit_log where metadata->>'migration' = '0353_station_day_flags'`);
  check(audit && audit.action === 'station.not_phase_station' && audit.destructive === true, 'B\': one migration audit row');
  check(JSON.stringify(audit.metadata.backfill_station_ids) === JSON.stringify([...want].sort()), 'B\': the audit row lists exactly the marked ids');
  check((await one(db, `select count(*)::int n from audit_log`)).n === 1, 'B\': exactly one audit row');
}

async function versions() {
  for (const [variant, expo, cm] of [['a', true, true], ['b', false, false]]) {
    const db = await fresh(versionShop(variant, { today: TODAY }));
    await db.exec(migration);
    const got = new Set(await marked(db));
    const st = name => id(900 + LIVE_SECTIONS.indexOf(name));
    check(got.has(st('Expo Station')) === expo, `B' V1/V2 (${variant}): Expo Station ${expo} (V2 decides, never the V1 instance)`);
    check(got.has(st(CLOSING_MANAGER)) === cm, `B' V1/V2 (${variant}): Closing Manager ${cm}`);
    check(got.size === Number(expo) + Number(cm), `B' V1/V2 (${variant}): nothing else marked`);
    await db.close();
  }
}

async function oneMarked(db) {
  await db.exec('begin');
  try {
    const a = await mid(db, GM_P, SHOP_P, P('Crunchy Boi Station'), true);
    const c = await mid(db, GM_C, SHOP_C, C('Expo Station'), true);
    check(a.ok?.changed === true && c.ok?.changed === true, 'B: mark A at P and C at C');
    check((await midDay(db, SHOP_P)).length === 1 && (await midDay(db, SHOP_C)).length === 1, 'B: both stand, one per shop');
    let code = null;
    await db.exec('savepoint raw');
    try { await db.query('update stations set starts_mid_day = true where id = $1', [P('Expo Station')]); } catch (e) { code = e.code; }
    await db.exec('rollback to savepoint raw');
    check(code === '23505', `B: a raw second mark at P is 23505 from the index, got ${code}`);
  } finally { if (db.isInTransaction()) await db.exec('rollback'); }
}

async function replace(db) {
  await db.exec('begin');
  try {
    await mid(db, GM_P, SHOP_P, P('Crunchy Boi Station'), true);
    const b = await mid(db, GM_P, SHOP_P, P('Expo Station'), true);
    check(b.ok?.changed === true && b.ok?.previous_station_id === P('Crunchy Boi Station'), 'C: marking B names A as the previous');
    const now = await midDay(db, SHOP_P);
    check(now.length === 1 && now[0] === P('Expo Station'), `C: A false, B true, one row; got ${now}`);
    const same = await mid(db, GM_P, SHOP_P, P('Expo Station'), true);
    check(same.ok?.changed === false, 'C: marking the marked station again changes nothing');
    const off = await mid(db, GM_P, SHOP_P, P('Expo Station'), false);
    check(off.ok?.changed === true && (await midDay(db, SHOP_P)).length === 0, 'C: unmark B, none marked');
  } finally { if (db.isInTransaction()) await db.exec('rollback'); }
}
/** Case C as a predicate, for the broken variant. */
async function caseCHolds(db) {
  await db.exec('begin');
  try {
    await mid(db, GM_P, SHOP_P, P('Crunchy Boi Station'), true);
    const b = await mid(db, GM_P, SHOP_P, P('Expo Station'), true);
    const now = await midDay(db, SHOP_P);
    return { holds: b.ok?.changed === true && now.length === 1 && now[0] === P('Expo Station'), error: b.error };
  } finally { if (db.isInTransaction()) await db.exec('rollback'); }
}

async function deactivation(db) {
  const A = P('Crunchy Boi Station'), B = P('Expo Station');
  const deactivate = s => db.query('update stations set active = false where id = $1 and active', [s]); // as the sync does
  const reactivate = s => db.query('update stations set active = true where id = $1', [s]);
  await db.exec('begin');
  try {
    await mid(db, GM_P, SHOP_P, A, true);
    await deactivate(A);
    check((await midDay(db, SHOP_P))[0] === A, 'D: the flag stays through deactivation');
    check((await mid(db, GM_P, SHOP_P, A, true)).error === 'station_unavailable', 'D: marking an inactive station is station_unavailable');
    await mid(db, GM_P, SHOP_P, B, true);
    check(JSON.stringify(await midDay(db, SHOP_P)) === JSON.stringify([B]), 'D: marking B while A is inactive clears A');
    await reactivate(A);
    check(JSON.stringify(await midDay(db, SHOP_P)) === JSON.stringify([B]), 'D: reactivating A leaves B the only marked one');
  } finally { if (db.isInTransaction()) await db.exec('rollback'); }
  await db.exec('begin');
  try {
    await mid(db, GM_P, SHOP_P, A, true);
    await deactivate(A);
    await reactivate(A);
    check(JSON.stringify(await midDay(db, SHOP_P)) === JSON.stringify([A]), 'D: nobody marks another, reactivation restores A as the only marked one');
    await deactivate(P(CLOSING_MANAGER));
    await reactivate(P(CLOSING_MANAGER));
    check((await marked(db)).includes(P(CLOSING_MANAGER)), 'D: not_phase_station stays with its row through deactivate and reactivate');
  } finally { if (db.isInTransaction()) await db.exec('rollback'); }
}

async function interleave(db) {
  // T1 marks A and commits; T2, which read the page before T1, marks B: exactly B.
  await db.exec('begin');
  const seenByT2 = await midDay(db, SHOP_P);
  await mid(db, GM_P, SHOP_P, P('Crunchy Boi Station'), true);
  await db.exec('commit');
  await db.exec('begin');
  const t2 = await mid(db, MOO, SHOP_P, P('Expo Station'), true);
  await db.exec('commit');
  check(seenByT2.length === 0 && t2.ok?.changed === true, 'E: T2 marks B after T1 committed A');
  check(JSON.stringify(await midDay(db, SHOP_P)) === JSON.stringify([P('Expo Station')]), 'E: exactly B');
  await db.exec(`update stations set starts_mid_day = false where location_id = '${SHOP_P}'`);
}

async function twoFlags(db) {
  await db.exec('begin');
  try {
    check((await mid(db, GM_P, SHOP_P, P(CLOSING_MANAGER), true)).error === 'station_not_phase', 'E\': a not-phase station cannot be the trigger');
    await mid(db, GM_P, SHOP_P, P('Crunchy Boi Station'), true);
    const r = await notPhase(db, GM_P, SHOP_P, P('Crunchy Boi Station'), true);
    check(r.ok?.changed === true && r.ok?.cleared_mid_day === true, 'E\': not-phase on the trigger clears it (cleared_mid_day)');
    check((await midDay(db, SHOP_P)).length === 0, 'E\': none marked after');
    const again = await notPhase(db, GM_P, SHOP_P, P('Crunchy Boi Station'), true);
    check(again.ok?.changed === false && again.ok?.cleared_mid_day === false, 'E\': setting it again changes nothing');
    const off = await notPhase(db, GM_P, SHOP_P, P('Crunchy Boi Station'), false);
    check(off.ok?.changed === true && !(await marked(db)).includes(P('Crunchy Boi Station')), 'E\': clearing it');
    check((await midDay(db, SHOP_P)).length === 0, 'E\': clearing not-phase never re-marks the trigger');
    const cm = await notPhase(db, GM_P, SHOP_P, P(CLOSING_MANAGER), false);
    check(cm.ok?.changed === true && !(await marked(db)).includes(P(CLOSING_MANAGER)), 'E\': a GM can clear the backfilled flag');
  } finally { if (db.isInTransaction()) await db.exec('rollback'); }
}

async function who(db) {
  const cases = [
    [GM_P, SHOP_P, true, 'GM member'], [GM_C, SHOP_P, false, 'GM non-member'], [AGM_P, SHOP_P, false, 'AGM'],
    [CAT_P, SHOP_P, false, 'catering manager'], [GM_OFF, SHOP_P, false, 'inactive GM'],
    [MOO, SHOP_P, true, 'MoO'], [OWNER, SHOP_C, true, 'owner'], [CGS, SHOP_C, true, 'CGS'],
  ];
  for (const fn of ['set_station_mid_day_trigger', 'set_station_not_phase']) {
    for (const [actor, loc, allowed, label] of cases) {
      await db.exec('begin');
      try {
        const station = loc === SHOP_P ? P('Expo Station') : C('Expo Station');
        const r = await call(db, fn, actor, loc, station, true);
        check(allowed ? r.ok !== undefined : r.error === 'role_insufficient', `F ${fn}: ${label} ${allowed ? 'yes' : 'no'} (${r.error ?? 'ok'})`);
      } finally { if (db.isInTransaction()) await db.exec('rollback'); }
    }
    check((await call(db, fn, GM_P, SHOP_P, C('Expo Station'), true)).error === 'station_unavailable', `F ${fn}: another shop's station is station_unavailable`);
  }
}

async function grants(db) {
  for (const f of ['set_station_mid_day_trigger(uuid,uuid,uuid,boolean)', 'set_station_not_phase(uuid,uuid,uuid,boolean)']) {
    for (const role of ['anon', 'authenticated']) check(!(await one(db, `select has_function_privilege($1, 'public.${f}', 'EXECUTE') ok`, [role])).ok, `G: ${role} cannot execute ${f}`);
    check((await one(db, `select has_function_privilege('service_role', 'public.${f}', 'EXECUTE') ok`)).ok, `G: service_role executes ${f}`);
    check((await one(db, `select prosecdef from pg_proc where oid = 'public.${f}'::regprocedure`)).prosecdef, `G: ${f} is security definer`);
  }
  for (const role of ['anon', 'authenticated', 'service_role']) {
    check(!(await one(db, `select has_function_privilege($1, 'public.station_setup_actor_ok(uuid,uuid)', 'EXECUTE') ok`, [role])).ok, `G: ${role} cannot execute the helper`);
  }
}

let db;
try {
  await preflight();

  // H1. Broken variant: the mid-day writer WITHOUT its clear step fails case C (a skipped coordination collides at
  // the index, and the collision is mid_day_trigger_conflict, never a bare 23505: E (3)).
  const noClear = migration.replace(
    "    update public.stations set starts_mid_day = false where location_id = p_location_id and starts_mid_day and id <> p_station_id;\n", '');
  check(noClear !== migration, 'H: the clear step was removed from the broken variant');
  const broken = await fresh(backfillSpec());
  await broken.exec(noClear);
  const c = await caseCHolds(broken);
  check(!c.holds && c.error === 'mid_day_trigger_conflict', `H: without the clear step case C fails with mid_day_trigger_conflict, got ${c.error}`);
  await broken.close();
  console.log('EXPECTED FAIL 0353 broken variant: the mid-day writer without its clear step fails case C (mid_day_trigger_conflict)');

  // H2. Broken variant: r1's backfill rule ("ALL active items are references") keeps Closing Manager a phase station.
  const allRefs = migration.replace('and ti.report_reference_type is not null)\n    returning s.id',
    'and ti.report_reference_type is not null) and not exists (select 1 from public.checklist_template_items tj where tj.template_id = eff.id and tj.active and btrim(tj.station) = s.name and tj.report_reference_type is null)\n    returning s.id');
  check(allRefs !== migration, 'H: the backfill rule was swapped in the broken variant');
  const r1 = await fresh(backfillSpec());
  await r1.exec(allRefs);
  check(!(await marked(r1)).includes(P(CLOSING_MANAGER)), 'H: r1\'s "all references" rule leaves Closing Manager unmarked (B\' fails)');
  await r1.close();
  console.log('EXPECTED FAIL 0353 broken variant: the "all items are references" backfill leaves Closing Manager a phase station');

  db = await fresh(backfillSpec());
  await db.exec(migration);
  await backfill(db);
  await versions();
  await grants(db);
  await oneMarked(db);
  await replace(db);
  check((await caseCHolds(db)).holds, 'C: holds on the real file');
  await deactivation(db);
  await interleave(db);
  await twoFlags(db);
  await who(db);
  check(FLOOR_SECTIONS.length === 4, 'fixture sanity');
  console.log('REQUIRED (not run here): the two-session proof scripts/sim/stations-0353-two-sessions.mjs, on sim, by CC at apply time.');
  console.log(`PASS 0353: ${checks} checks`);
} catch (e) { console.error(`FAIL 0353: ${e.stack ?? e}`); process.exitCode = 1; }
finally { if (db) await db.close(); }
