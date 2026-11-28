/** FILE ONLY: the lead runs it on the SIM project after 0361 is applied there, never on prod. Management API only:
 * no .env, no direct database URL, no pg driver.
 *   SUPABASE_ACCESS_TOKEN=<operator environment>; node scripts/sim/toast-labor-0361-two-sessions.mjs --ref=jepgzucrvklhqpthowsc
 *   optional: --rest            one real-path check through the sim REST endpoint (needs `node --import tsx` and .env.sim)
 *   optional: --retire=<shop>   redo the retirement of an interrupted run (the shop must carry its SIM-0361 tag)
 *
 * Two-session proof of public.toast_time_entries_apply_newer (0361). Each Management API request is ONE database
 * session. A session runs ONE transaction and answers with what ITS OWN calls returned: every call is a plpgsql `do`
 * block that stores its result (or `{"sqlstate":...}` from its exception handler) in a session-level setting
 * (`set_config('co_ops.s0361_<n>', ..., false)`), and the last statement, AFTER `commit`, selects those settings and
 * pg_backend_pid(). Sessions are tagged with `set local application_name` (unique per run, case and role, as the 0276
 * proveRace does); a third request (the observer, polled) must see the racer WAITING on a lock (`wait_event_type =
 * 'Lock'`, an ungranted pg_locks row) with the holder's pid in pg_blocking_pids, BEFORE the holder's request ends.
 * Both sessions are awaited (allSettled) before anything else happens; the retirement runs last, in a finally.
 *
 * Fixture: a fresh INACTIVE shop with no Toast restaurant guid (cases 1 to 9 and --rest), a second shop inserted
 * INACTIVE and switched ACTIVE only for case 10 (link_toast_employee needs an active shop), one GM user with an
 * unusable credential and a membership at that second shop. Every in/out/stamp/business date is in 2001.
 * Retirement deletes nothing: the fixture's time entries are marked deleted = true (and read back), the link is
 * retired with the real unlink_toast_employee, membership / user / shops are set inactive. These races COMMIT.
 * Output: allocated ids, counts, case names, PASS / FAIL lines. Never a row's content, never server error text
 * (only SQLSTATEs and this job's fixed codes), never the token. Never retries a request.
 */
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PROD_REF, SIM_REF, literal as q } from '../supabase-management-query.mjs';

export { PROD_REF, SIM_REF };
export const MANAGEMENT_URL = `https://api.supabase.com/v1/projects/${SIM_REF}/database/query`;
export const SIM_REST_ORIGIN = `https://${SIM_REF}.supabase.co`;
export const HOLD_SECONDS = 7;
export const TAG_PREFIX = 'SIM-0361-';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** A failure whose text is ours (fixed), never the server's. */
export class Refusal extends Error {
  constructor(fixed) { super(fixed); this.fixed = fixed; }
}
const fixedMessage = error => (error instanceof Refusal ? error.fixed : 'unexpected error (no detail printed)');
const safeState = s => (typeof s === 'string' && /^[0-9A-Z]{5}$/.test(s) ? s : 'unknown');

// ── arguments ───────────────────────────────────────────────────────────────────────────────────
export function parseArgs(args) {
  let ref = null, rest = false, retire = null;
  for (const arg of args) {
    if (arg.startsWith('--ref=') && ref === null) ref = arg.slice(6);
    else if (arg === '--rest' && !rest) rest = true;
    else if (arg.startsWith('--retire=') && retire === null) retire = arg.slice(9);
    else return { ok: false, reason: 'unknown or repeated flag (allowed: --ref=<sim ref>, --rest, --retire=<shop id>)' };
  }
  if (ref === null || ref === '') return { ok: false, reason: `--ref is required and must be the SIM project ${SIM_REF}` };
  if (ref === PROD_REF) return { ok: false, reason: `--ref names the PRODUCTION project ${PROD_REF}; this proof runs on the SIM project ${SIM_REF} only` };
  if (ref !== SIM_REF) return { ok: false, reason: `--ref is not the SIM project ${SIM_REF}; refusing every other project (production is ${PROD_REF})` };
  if (retire !== null && !UUID.test(retire)) return { ok: false, reason: '--retire needs the fixture shop id (a uuid)' };
  if (rest && retire !== null) return { ok: false, reason: '--rest and --retire do not go together' };
  return { ok: true, ref, rest, retire };
}

// ── the driver: one POST per query, no retries, no response logging ────────────────────────────────
export function managementDriver(ref, token, fetcher) {
  if (ref !== SIM_REF) throw new Refusal('the driver only talks to the SIM project');
  if (typeof token !== 'string' || token === '' || /\s/.test(token)) throw new Refusal('set SUPABASE_ACCESS_TOKEN in the operator environment');
  if (typeof fetcher !== 'function') throw new Refusal('no fetcher');
  return async sql => {
    let response;
    try {
      response = await fetcher(MANAGEMENT_URL, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql }), signal: AbortSignal.timeout(90_000), redirect: 'error',
      });
    } catch {
      throw new Refusal('management request failed (transport)');
    }
    if (!response || !response.ok) {
      try { await response?.body?.cancel?.(); } catch { /* the body is never read */ }
      throw new Refusal(`management request failed (HTTP ${Number(response?.status) || 0})`);
    }
    let rows;
    try { rows = await response.json(); } catch { throw new Refusal('management request failed (unreadable answer)'); }
    if (!Array.isArray(rows)) throw new Refusal('management request failed (unexpected answer)');
    return rows;
  };
}

// ── fixture ─────────────────────────────────────────────────────────────────────────────────────
export function fixture(ids = {}) {
  const shop = ids.shop ?? randomUUID(), linkShop = ids.linkShop ?? randomUUID(), user = ids.user ?? randomUUID();
  const tag = `${TAG_PREFIX}${shop}`;
  return { shop, linkShop, user, tag, linkTag: `${tag}-L`, employee: `${tag}-emp`, linkEmployee: `${tag}-lnk` };
}
export const fixtureIds = f => ({ shop: f.shop, linkShop: f.linkShop, user: f.user, tag: f.tag });
export const keyOf = (f, name) => `${f.tag}-${name}`;

/** Stamps m0 < m1 < m2, all in 2001 (before every built labor week). */
export const M = Object.freeze({ m0: '2001-03-05T15:00:00Z', m1: '2001-03-05T18:00:00Z', m2: '2001-03-05T23:00:00Z' });
export const DAY = '2001-03-05';
const IN_AT = '2001-03-05T14:00:00Z', OUT_AT = '2001-03-05T22:00:00Z';
export const PULL_COLUMNS = ['location_id', 'time_entry_guid', 'business_date', 'employee_guid', 'employee_first_name', 'job_guid',
  'job_name', 'in_at', 'out_at', 'hours', 'overtime_hours', 'auto_clocked_out', 'deleted', 'source_modified_at'];
const COLUMN_TYPES = { location_id: 'uuid', business_date: 'date', in_at: 'timestamptz', out_at: 'timestamptz', hours: 'numeric',
  overtime_hours: 'numeric', auto_clocked_out: 'boolean', deleted: 'boolean', source_modified_at: 'timestamptz' };

/** One pull row. shape: open (no out), closed, archived (closed + deleted). Synthetic names only. */
export function entry(f, key, { stamp, shape, shop = f.shop, employee = f.employee }) {
  const closed = shape !== 'open';
  return {
    location_id: shop, time_entry_guid: key, business_date: DAY, employee_guid: employee, employee_first_name: 'Testa',
    job_guid: `${f.tag}-job`, job_name: 'Mocko Line', in_at: IN_AT, out_at: closed ? OUT_AT : null, hours: closed ? 8 : null,
    overtime_hours: closed ? 0 : null, auto_clocked_out: false, deleted: shape === 'archived', source_modified_at: stamp,
  };
}

export const requiredColumns = {
  locations: ['id', 'name', 'code', 'type', 'active', 'toast_restaurant_guid'],
  users: ['id', 'name', 'role', 'pin_hash', 'active'],
  user_locations: ['user_id', 'location_id', 'active'],
  toast_time_entries: [...PULL_COLUMNS, 'pulled_at'],
};

/** Both shops are inserted INACTIVE and with NO Toast restaurant guid, so no pull ever reads them. */
export function fixtureSQL(f) {
  return `begin;
    insert into public.locations(id,name,code,type,active,toast_restaurant_guid) values
      (${q(f.shop)}::uuid,${q(f.tag)},${q(f.tag)},'permanent',false,null),
      (${q(f.linkShop)}::uuid,${q(f.linkTag)},${q(f.linkTag)},'permanent',false,null);
    insert into public.users(id,name,role,pin_hash,active) values(${q(f.user)}::uuid,${q(f.tag)},'gm','SIM-NO-VALID-CREDENTIAL',true);
    insert into public.user_locations(user_id,location_id,active) values(${q(f.user)}::uuid,${q(f.linkShop)}::uuid,true);
    commit;`;
}
/** Case 10 only: link_toast_employee / unlink_toast_employee need an ACTIVE shop. Still no Toast guid. */
export const activateLinkShopSQL = f =>
  `update public.locations set active=true where id=${q(f.linkShop)}::uuid and code=${q(f.linkTag)} and toast_restaurant_guid is null`;

export function preflightSQL() {
  const all = Object.entries(requiredColumns).flatMap(([t, cs]) => cs.map(c => `${t}.${c}`));
  const arr = xs => `array[${xs.map(q).join(',')}]::text[]`;
  const guard = "to_regprocedure('public.toast_time_entries_apply_newer(jsonb)')";
  const link = "to_regprocedure('public.link_toast_employee(uuid,uuid,text,uuid,text)')";
  const unlink = "to_regprocedure('public.unlink_toast_employee(uuid,uuid,uuid)')";
  return `with cols as (
      select table_name::text as t, column_name::text as c, is_nullable, column_default, is_identity, is_generated
        from information_schema.columns where table_schema='public' and table_name in (${Object.keys(requiredColumns).map(q).join(',')}))
    select
      array(select x from unnest(${arr(all)}) x where not exists (select 1 from cols where t||'.'||c = x)) as missing_columns,
      array(select t||'.'||c from cols where is_nullable='NO' and column_default is null and is_identity<>'YES'
              and is_generated<>'ALWAYS' and t||'.'||c <> all(${arr(all)}) order by 1) as unfilled_required,
      ${guard} is not null as has_guard,
      coalesce(has_function_privilege('service_role', ${guard}, 'EXECUTE'), false) as guard_service,
      coalesce(has_function_privilege('authenticated', ${guard}, 'EXECUTE'), true) as guard_authenticated,
      coalesce(has_function_privilege('anon', ${guard}, 'EXECUTE'), true) as guard_anon,
      (${link} is not null and ${unlink} is not null) as has_link,
      coalesce(has_function_privilege('service_role', ${link}, 'EXECUTE') and has_function_privilege('service_role', ${unlink}, 'EXECUTE'), false) as link_service,
      (select count(*)::int from pg_trigger g where g.tgrelid = to_regclass('public.toast_time_entries')
         and g.tgname in ('toast_time_entries_link_user','toast_time_entries_link_lock') and not g.tgisinternal and g.tgenabled='O') as link_triggers`;
}
export async function preflight(query) {
  const row = (await query(preflightSQL()))[0];
  if (!row) throw new Refusal('preflight answered nothing');
  const names = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && /^[a-z_]+\.[a-z_]+$/.test(x)) : []);
  if (names(row.missing_columns).length) throw new Refusal(`missing column(s) ${names(row.missing_columns).join(', ')}`);
  if (names(row.unfilled_required).length) throw new Refusal(`required column(s) the fixture does not fill: ${names(row.unfilled_required).join(', ')}`);
  if (row.has_guard !== true) throw new Refusal('public.toast_time_entries_apply_newer(jsonb) is not installed (apply 0361 to the sim first)');
  if (row.guard_service !== true) throw new Refusal('service_role cannot execute toast_time_entries_apply_newer');
  if (row.guard_authenticated !== false) throw new Refusal('authenticated may execute toast_time_entries_apply_newer (grant escaped)');
  if (row.guard_anon !== false) throw new Refusal('anon may execute toast_time_entries_apply_newer (grant escaped)');
  if (row.has_link !== true || row.link_service !== true) throw new Refusal('0233 link_toast_employee / unlink_toast_employee missing or not executable by service_role');
  if (Number(row.link_triggers) !== 2) throw new Refusal('0233 triggers on toast_time_entries missing or disabled');
}

// ── sessions ────────────────────────────────────────────────────────────────────────────────────
export const SLEEP = Object.freeze({ kind: 'sleep' });
export const FIXED_CODES = ['toast_labor_invalid_payload', 'toast_labor_row_vanished', 'invalid_payload', 'employee_already_linked',
  'user_already_linked', 'link_rejected', 'link_not_found', 'role_insufficient', 'location_access_denied', 'assignee_unavailable'];

const valueSQL = (column, value) => (value === null || value === undefined ? 'null'
  : typeof value === 'number' ? `${Number(value)}::numeric`
  : typeof value === 'boolean' ? String(value)
  : `${q(value)}${COLUMN_TYPES[column] ? `::${COLUMN_TYPES[column]}` : ''}`);

/** MAIN's unconditional statement (lib/toast/labor.ts upsert, as SQL): every column = excluded.column. */
export function upsertSQL(rows) {
  const cols = [...PULL_COLUMNS, 'pulled_at'];
  const values = rows.map(r => `(${PULL_COLUMNS.map(c => valueSQL(c, r[c])).join(', ')}, clock_timestamp())`).join(',\n        ');
  return `insert into public.toast_time_entries (${cols.join(', ')})
      values ${values}
      on conflict (location_id, time_entry_guid) do update set ${cols.filter(c => c !== 'location_id' && c !== 'time_entry_guid').map(c => `${c} = excluded.${c}`).join(', ')};
      get diagnostics v_n = row_count;
      v := jsonb_build_object('rows', v_n);`;
}
export function callBody(call) {
  if (call.kind === 'apply') return `v := public.toast_time_entries_apply_newer(${q(JSON.stringify(call.rows))}::jsonb);`;
  if (call.kind === 'upsert') return upsertSQL(call.rows);
  if (call.kind === 'link') return `v := public.link_toast_employee(null, ${q(call.shop)}::uuid, ${q(call.employee)}, ${q(call.user)}::uuid, 'auto');`;
  if (call.kind === 'unlink') {
    if (!UUID.test(call.linkId)) throw new Refusal('link id is not a uuid');
    return `v := public.unlink_toast_employee(${q(call.actor)}::uuid, ${q(call.shop)}::uuid, ${q(call.linkId)}::uuid);`;
  }
  throw new Refusal('unknown call kind');
}
const slotName = i => `co_ops.s0361_${i + 1}`;
function doBlock(slot, name, call) {
  const fail = `jsonb_build_object('tag', ${q(name)}, 'sqlstate', sqlstate, 'code',
          case when sqlerrm = any(array[${FIXED_CODES.map(q).join(',')}]) then sqlerrm end)::text`;
  return `do $s0361$
    declare v jsonb; v_n integer;
    begin
      begin
        ${callBody(call)}
        perform set_config(${q(slot)}, jsonb_build_object('tag', ${q(name)}, 'ok', v)::text, false);
      exception
        when deadlock_detected then perform set_config(${q(slot)}, ${fail}, false);
        when others then perform set_config(${q(slot)}, ${fail}, false);
      end;
    end
    $s0361$;`;
}
/** ONE session = ONE request = ONE transaction as service_role; the answer is selected after the commit. */
export function sessionSQL(name, steps, { holdSeconds = HOLD_SECONDS } = {}) {
  const calls = steps.filter(s => s.kind !== 'sleep');
  if (!calls.length) throw new Refusal('a session needs a call');
  let n = 0;
  const body = steps.map(s => (s.kind === 'sleep' ? `select pg_sleep(${Number(holdSeconds)});` : doBlock(slotName(n++), name, s))).join('\n    ');
  return `select ${calls.map((_, i) => `set_config(${q(slotName(i))}, '', false)`).join(', ')};
    begin isolation level read committed;
    set local statement_timeout = '60s'; set local lock_timeout = '30s';
    set local application_name = ${q(name)};
    set local role service_role;
    ${body}
    commit;
    select ${calls.map((_, i) => `current_setting(${q(slotName(i))}, true) as s${i + 1}`).join(', ')}, pg_backend_pid() as pid;`;
}
/** Each call's own answer: { ok } | { sqlstate, code } | { missing }. A setting left by another request is refused by its tag. */
export function parseSession(rows, name, count) {
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (!row) return null;
  const calls = [];
  for (let i = 0; i < count; i++) {
    const raw = row[`s${i + 1}`];
    let parsed = null;
    try { parsed = typeof raw === 'string' && raw !== '' ? JSON.parse(raw) : null; } catch { parsed = null; }
    if (!parsed || parsed.tag !== name) calls.push({ missing: true });
    else if (typeof parsed.sqlstate === 'string') calls.push({ sqlstate: safeState(parsed.sqlstate), code: FIXED_CODES.includes(parsed.code) ? parsed.code : null });
    else calls.push({ ok: parsed.ok });
  }
  return { pid: Number(row.pid), calls };
}

export const readySQL = holder =>
  `select exists(select 1 from pg_stat_activity where application_name=${q(holder)} and wait_event='PgSleep') as ready`;
/** The racer is WAITING on a lock and the holder's backend is among its blockers. */
export const observerSQL = (holder, racer, lockType = null) => `select r.pid as racer_pid, h.pid as holder_pid
    from pg_stat_activity r
    join pg_locks l on l.pid = r.pid and not l.granted${lockType ? ` and l.locktype = ${q(lockType)}` : ''}
    join pg_stat_activity h on h.pid = any(pg_blocking_pids(r.pid))
   where r.application_name = ${q(racer)} and h.application_name = ${q(holder)}
     and r.wait_event_type = 'Lock' and h.pid <> r.pid
   limit 1`;
export const evidenceSQL = (shop, keys) => `select time_entry_guid as key, deleted, out_at is not null as closed,
    extract(epoch from source_modified_at)::bigint as stamp_epoch, user_id::text as user_id
    from public.toast_time_entries where location_id = ${q(shop)}::uuid and time_entry_guid in (${keys.map(q).join(',')})
    order by time_entry_guid collate "C"`;

// ── cases ───────────────────────────────────────────────────────────────────────────────────────
export const COUNT_KEYS = ['received', 'inserted', 'updated', 'unchanged', 'skipped_same_stamp', 'skipped_older', 'skipped_no_stamp', 'duplicates'];
export function counts(partial) {
  const out = Object.fromEntries(COUNT_KEYS.map(k => [k, Number(partial[k] ?? 0)]));
  out.received = COUNT_KEYS.filter(k => k !== 'received' && k !== 'duplicates').reduce((s, k) => s + out[k], 0) + out.duplicates;
  return out;
}
const apply = rows => ({ kind: 'apply', rows });
const fin = (deleted, closed, stamp, extra = {}) => ({ deleted, closed, stamp, ...extra });

export function cases(f) {
  const e = (name, stamp, shape) => entry(f, keyOf(f, name), { stamp, shape });
  const pair = (id, label, keys, holderRow, racerRow, holderCount, racerCount, final, seeded) => ({
    id, label, keys, seeded, shop: f.shop, lockType: null,
    holder: [apply([e(keys[0], ...holderRow)]), SLEEP], racer: [apply([e(keys[0], ...racerRow)])],
    expectHolder: [counts(holderCount)], expectRacer: [counts(racerCount)], final: { [keys[0]]: final },
  });
  const twoKey = name => [`${name}-k1`, `${name}-k2`]; // k1 sorts first under collate "C"
  const k8a = twoKey('c08a'), k8b = twoKey('c08b'), k9 = twoKey('c09');
  const holderTwoKeys = keys => [apply([e(keys[0], M.m1, 'open')]), SLEEP, apply([e(keys[1], M.m1, 'open')])];
  return [
    pair('1', 'key absent, the newer version holds, the older waits: inserted, then skipped_older', ['c01'],
      [M.m2, 'closed'], [M.m1, 'open'], { inserted: 1 }, { skipped_older: 1 }, fin(false, true, M.m2), false),
    pair('2', 'key absent, the older version holds, the newer waits: inserted, then updated', ['c02'],
      [M.m1, 'open'], [M.m2, 'closed'], { inserted: 1 }, { updated: 1 }, fin(false, true, M.m2), false),
    pair('3', 'key stored, the newer holds, the older waits: updated, then skipped_older', ['c03'],
      [M.m2, 'closed'], [M.m1, 'open'], { updated: 1 }, { skipped_older: 1 }, fin(false, true, M.m2), true),
    pair('4', 'key stored, the older holds, the newer waits: updated, then updated', ['c04'],
      [M.m1, 'open'], [M.m2, 'closed'], { updated: 1 }, { updated: 1 }, fin(false, true, M.m2), true),
    pair('5', 'the archive (m2) holds, a stale live row (m1) waits: the row stays archived at m2', ['c05'],
      [M.m2, 'archived'], [M.m1, 'open'], { updated: 1 }, { skipped_older: 1 }, fin(true, true, M.m2), true),
    pair('6', 'a stale live row (m1) holds, the archive (m2) waits: the row ends archived at m2', ['c06'],
      [M.m1, 'open'], [M.m2, 'archived'], { updated: 1 }, { updated: 1 }, fin(true, true, M.m2), true),
    pair('7', 'equal stamps, same content: inserted, then unchanged', ['c07'],
      [M.m1, 'closed'], [M.m1, 'closed'], { inserted: 1 }, { unchanged: 1 }, fin(false, true, M.m1), false),
    {
      id: '8a', label: 'K1 < K2 both stored; holder K1, pause, K2; racer K2 live + K1 archived (K2 listed first): no deadlock',
      keys: k8a, seeded: true, shop: f.shop, lockType: null, holder: holderTwoKeys(k8a),
      racer: [apply([e(k8a[1], M.m2, 'closed'), e(k8a[0], M.m2, 'archived')])],
      expectHolder: [counts({ updated: 1 }), counts({ updated: 1 })], expectRacer: [counts({ updated: 2 })],
      final: { [k8a[0]]: fin(true, true, M.m2), [k8a[1]]: fin(false, true, M.m2) },
    },
    {
      id: '8b', label: 'the inverse: racer K2 archived + K1 live (K2 listed first): no deadlock',
      keys: k8b, seeded: true, shop: f.shop, lockType: null, holder: holderTwoKeys(k8b),
      racer: [apply([e(k8b[1], M.m2, 'archived'), e(k8b[0], M.m2, 'closed')])],
      expectHolder: [counts({ updated: 1 }), counts({ updated: 1 })], expectRacer: [counts({ updated: 2 })],
      final: { [k8b[0]]: fin(false, true, M.m2), [k8b[1]]: fin(true, true, M.m2) },
    },
    {
      id: '9', label: "CONTROL: the same holder against main's unconditional upsert (K2 before K1): exactly one session's own 40P01",
      keys: k9, seeded: true, shop: f.shop, lockType: null, holder: holderTwoKeys(k9),
      racer: [{ kind: 'upsert', rows: [e(k9[1], M.m2, 'closed'), e(k9[0], M.m2, 'archived')] }],
      control: true,
      // Holder the victim: its K1 update commits, then the racer's upsert overwrites both keys (m2).
      finalIfHolderVictim: { [k9[0]]: fin(true, true, M.m2), [k9[1]]: fin(false, true, M.m2) },
      // Racer the victim: its statement is undone, the holder's two updates (m1, open) stand.
      finalIfRacerVictim: { [k9[0]]: fin(false, false, M.m1), [k9[1]]: fin(false, false, M.m1) },
    },
    {
      id: '10', label: "link_toast_employee holds the exclusive 'toast-link' lock; a guarded insert waits on it, then reads the committed link",
      keys: ['c10'], seeded: false, shop: f.linkShop, lockType: 'advisory', link: true,
      holder: [{ kind: 'link', shop: f.linkShop, employee: f.linkEmployee, user: f.user }, SLEEP],
      racer: [apply([entry(f, keyOf(f, 'c10'), { stamp: M.m1, shape: 'closed', shop: f.linkShop, employee: f.linkEmployee })])],
      expectRacer: [counts({ inserted: 1 })], final: { c10: fin(false, true, M.m1, { user: f.user }) },
    },
  ];
}
export const seedRows = f => cases(f).filter(c => c.seeded).flatMap(c => c.keys).map(name => entry(f, keyOf(f, name), { stamp: M.m0, shape: 'open' }));
export const plannedKeys = f => [...cases(f).flatMap(c => c.keys), 'rest'].map(name => keyOf(f, name));
export const sessionName = (f, c, role) => `${f.tag}-c${c.id.padStart(2, '0')}-${role}`;

// ── judging (fixed texts only) ──────────────────────────────────────────────────────────────────
/**
 * The deployed contract (lib/toast/labor.ts parseLaborGuardCounts): a plain object holding EXACTLY the eight keys,
 * each a JS number that is a safe integer >= 0, `received` = the sum of the other seven. Null when it holds; else
 * a fixed text naming the kind of violation (never a value from the server).
 */
export function guardCountsViolation(answer) {
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) return 'is not an object';
  const keys = Object.keys(answer);
  if (keys.some(k => !COUNT_KEYS.includes(k))) return 'carries an unexpected key';
  for (const key of COUNT_KEYS) {
    if (!Object.hasOwn(answer, key)) return `lacks the key ${key}`;
    const v = answer[key];
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) return `count ${key} is not a non-negative integer`;
  }
  const rest = COUNT_KEYS.filter(k => k !== 'received').reduce((s, k) => s + answer[k], 0);
  if (answer.received !== rest) return 'received is not the sum of the other counts';
  return null;
}
/** A GUARDED call's answer only (apply_newer, via a session or --rest): strict shape first, then exact counts. */
export function judgeCounts(who, got, want) {
  if (!got || got.missing) return `${who} answer missing`;
  if (got.sqlstate) return `${who} reported SQLSTATE ${got.sqlstate}${got.code ? ` (${got.code})` : ''}`;
  const violation = guardCountsViolation(got.ok);
  if (violation) return `${who} answer ${violation}`;
  for (const key of COUNT_KEYS) if (got.ok[key] !== want[key]) return `${who} count ${key} is not ${want[key]}`;
  return null;
}
function judgeFinal(f, evidence, final) {
  for (const [name, want] of Object.entries(final)) {
    const row = evidence.find(r => r.key === keyOf(f, name));
    if (!row) return `stored row ${name} missing`;
    if (row.deleted !== want.deleted) return `stored row ${name}: deleted is not ${want.deleted}`;
    if (row.closed !== want.closed) return `stored row ${name}: ${want.closed ? 'not closed' : 'closed'}`;
    if (Number(row.stamp_epoch) !== Date.parse(want.stamp) / 1000) return `stored row ${name}: stamp is not the expected version`;
    if ('user' in want && (row.user_id ?? null) !== want.user) return `stored row ${name}: user_id is not ${want.user === null ? 'cleared' : 'the linked fixture user'}`;
  }
  return null;
}
function judgeControl(c, holder, racer, evidence, f) {
  const [h1, h2] = holder.calls, [r1] = racer.calls;
  if ([h1, h2, r1].some(x => !x || x.missing)) return 'a session answer is missing';
  const holderDead = h2.sqlstate === '40P01', racerDead = r1.sqlstate === '40P01';
  if (holderDead === racerDead) return holderDead ? 'both sessions reported 40P01' : 'no session reported its own 40P01 (the fixture did not deadlock)';
  const bad = judgeCounts('holder call 1', h1, counts({ updated: 1 }));
  if (bad) return bad;
  if (holderDead) {
    if (r1.sqlstate) return `racer reported SQLSTATE ${r1.sqlstate}`;
    if (Number(r1.ok?.rows) !== 2) return 'racer upsert did not write 2 rows';
    return judgeFinal(f, evidence, c.finalIfHolderVictim);
  }
  const bad2 = judgeCounts('holder call 2', h2, counts({ updated: 1 }));
  if (bad2) return bad2;
  return judgeFinal(f, evidence, c.finalIfRacerVictim);
}

const settle = (promise, onDone) => promise.then(
  rows => { onDone?.(); return { ok: true, rows }; },
  error => { onDone?.(); return { ok: false, reason: fixedMessage(error) }; });

/** Holder, readiness, racer, observer; BOTH sessions settled before this returns, whatever happened. */
export async function runCase(query, f, c, opts, state) {
  const hName = sessionName(f, c, 'h'), rName = sessionName(f, c, 'r');
  const sleep = opts.sleep ?? pause, pollMs = opts.pollMs ?? 150;
  let holderDone = false, holder = null, racer = null, observed = null, ready = false;
  try {
    holder = settle(query(sessionSQL(hName, c.holder, opts)), () => { holderDone = true; });
    state.pending.add(holder);
    for (let i = 0; i < (opts.readyPolls ?? 60) && !ready && !holderDone; i++) {
      const rows = await query(readySQL(hName));
      if (rows[0]?.ready === true) ready = true; else await sleep(pollMs);
    }
    if (ready) {
      racer = settle(query(sessionSQL(rName, c.racer, opts)));
      state.pending.add(racer);
      for (let i = 0; i < (opts.observePolls ?? 40) && !observed && !holderDone; i++) {
        const rows = await query(observerSQL(hName, rName, c.lockType));
        const row = rows[0];
        if (row && !holderDone) observed = { holderPid: Number(row.holder_pid), racerPid: Number(row.racer_pid) };
        else await sleep(pollMs);
      }
    }
  } finally {
    await Promise.allSettled([holder, racer].filter(Boolean));
  }
  if (!ready) return 'the holder never reached its pause';
  const [h, r] = await Promise.all([holder, racer]);
  if (!h.ok) return `holder request failed: ${h.reason}`;
  if (!r.ok) return `racer request failed: ${r.reason}`;
  const hs = parseSession(h.rows, hName, c.holder.filter(s => s.kind !== 'sleep').length);
  const rs = parseSession(r.rows, rName, c.racer.length);
  if (!hs || !rs) return 'a session answer is missing';
  if (!observed) return 'the racer was never observed blocked by the holder';
  if (observed.holderPid !== hs.pid || observed.racerPid !== rs.pid) return 'the observed backends are not the two sessions';
  const evidence = await query(evidenceSQL(c.shop, c.keys.map(k => keyOf(f, k))));
  for (const row of evidence) state.written.add(row.key);
  if (c.control) return judgeControl(c, hs, rs, evidence, f);
  if (c.link) {
    const link = hs.calls[0];
    if (!link || link.missing) return 'holder answer missing';
    if (link.sqlstate) return `holder reported SQLSTATE ${link.sqlstate}${link.code ? ` (${link.code})` : ''}`;
    if (link.ok?.changed !== true || typeof link.ok?.id !== 'string' || !UUID.test(link.ok.id)) return 'link_toast_employee did not make a new link';
    state.linkId = link.ok.id;
  } else {
    for (let i = 0; i < c.expectHolder.length; i++) {
      const bad = judgeCounts(`holder call ${i + 1}`, hs.calls[i], c.expectHolder[i]);
      if (bad) return bad;
    }
  }
  const bad = judgeCounts('racer', rs.calls[0], c.expectRacer[0]);
  if (bad) return bad;
  return judgeFinal(f, evidence, c.final);
}

async function unlinkSession(query, f, linkId, name) {
  const s = parseSession(await query(sessionSQL(name, [{ kind: 'unlink', actor: f.user, shop: f.linkShop, linkId }])), name, 1);
  const call = s?.calls[0];
  if (!call || call.missing) throw new Refusal('unlink answer missing');
  if (call.sqlstate) throw new Refusal(`unlink_toast_employee reported SQLSTATE ${call.sqlstate}${call.code ? ` (${call.code})` : ''}`);
  return call.ok;
}

// ── --rest (one real-path check; written, run only by the lead) ─────────────────────────────────
export async function defaultRestClient() {
  let loader;
  try { loader = await import('./launch-readiness/env.ts'); } catch { throw new Refusal('--rest needs `node --import tsx` (the sim env loader is TypeScript)'); }
  const loaded = loader.loadSimEnv(fileURLToPath(new URL('../../', import.meta.url)));
  if (!loaded.ok) throw new Refusal(`the sim env loader refused (${loaded.reasons.length} reason(s))`);
  const url = String(loaded.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, ''), key = loaded.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url !== SIM_REST_ORIGIN || !key) throw new Refusal('the sim env does not name the SIM project');
  const { createClient } = await import('@supabase/supabase-js');
  const guarded = (input, init = {}) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!href.startsWith(`${SIM_REST_ORIGIN}/rest/v1/`)) throw new Refusal('REST request outside the sim');
    return fetch(input, { ...init, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(30_000) });
  };
  return createClient(SIM_REST_ORIGIN, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: guarded },
  });
}
export async function restCheck(f, makeClient, state) {
  const client = await makeClient();
  const key = keyOf(f, 'rest');
  const rows = [entry(f, key, { stamp: M.m1, shape: 'closed' })];
  const code = err => (typeof err?.code === 'string' && /^([0-9A-Z]{5}|PGRST\d{3})$/.test(err.code) ? err.code : 'unknown');
  const want = [counts({ inserted: 1 }), counts({ unchanged: 1 })];
  for (let i = 0; i < 2; i++) {
    let answer;
    try { answer = await client.rpc('toast_time_entries_apply_newer', { p_rows: rows }); } catch { throw new Refusal(`rest call ${i + 1} failed (transport)`); }
    if (answer?.error) throw new Refusal(`rest call ${i + 1} refused (${code(answer.error)})`);
    state.written.add(key);
    const bad = judgeCounts(`rest call ${i + 1}`, { ok: answer?.data }, want[i]);
    if (bad) throw new Refusal(bad);
  }
}

// ── retirement: nothing is deleted ──────────────────────────────────────────────────────────────
export const activeLinksSQL = f => `select id::text as id from public.toast_employee_links
    where location_id=${q(f.linkShop)}::uuid and employee_guid=${q(f.linkEmployee)} and active`;
export function retireEntriesSQL(f) {
  return `begin; set local role service_role;
    update public.toast_time_entries set deleted=true
     where location_id in (${q(f.shop)}::uuid, ${q(f.linkShop)}::uuid) and time_entry_guid like ${q(`${f.tag}-%`)}
       and time_entry_guid in (${plannedKeys(f).map(q).join(',')}) and not deleted;
    commit;`;
}
export const entriesReadBackSQL = f => `select count(*)::int as total, count(*) filter (where not deleted)::int as live
    from public.toast_time_entries where location_id in (${q(f.shop)}::uuid, ${q(f.linkShop)}::uuid)
     and time_entry_guid like ${q(`${f.tag}-%`)} and time_entry_guid in (${plannedKeys(f).map(q).join(',')})`;
export function retireConfigSQL(f) {
  return `begin;
    update public.user_locations set active=false where user_id=${q(f.user)}::uuid and location_id=${q(f.linkShop)}::uuid
       and user_id in (select id from public.users where id=${q(f.user)}::uuid and name=${q(f.tag)});
    update public.users set active=false where id=${q(f.user)}::uuid and name=${q(f.tag)};
    update public.locations set active=false where id=${q(f.shop)}::uuid and code=${q(f.tag)};
    update public.locations set active=false where id=${q(f.linkShop)}::uuid and code=${q(f.linkTag)};
    commit;`;
}
export const configReadBackSQL = f => `select
    (select count(*) from public.users where id=${q(f.user)}::uuid and active)
  + (select count(*) from public.user_locations where user_id=${q(f.user)}::uuid and active)
  + (select count(*) from public.locations where id in (${q(f.shop)}::uuid, ${q(f.linkShop)}::uuid) and active) as active_left`;

export async function retire(query, f, state, log) {
  try {
    let unlinked = 0;
    for (const link of await query(activeLinksSQL(f))) {
      if (typeof link.id !== 'string' || !UUID.test(link.id)) throw new Refusal('an active fixture link has no usable id');
      const out = await unlinkSession(query, f, link.id, `${f.tag}-retire-unlink`);
      if (out?.changed === true) unlinked++;
    }
    await query(retireEntriesSQL(f));
    const back = (await query(entriesReadBackSQL(f)))[0];
    const total = Number(back?.total), live = Number(back?.live);
    if (!(live === 0)) throw new Refusal('fixture time entries still live after the retirement');
    if (!(total >= state.written.size && total <= plannedKeys(f).length)) throw new Refusal('fixture time-entry count does not match what the run wrote');
    await query(retireConfigSQL(f));
    if (Number((await query(configReadBackSQL(f)))[0]?.active_left) !== 0) throw new Refusal('fixture membership, user or shop still active');
    log(`RETIRED fixture ${f.tag}: ${total} time entries marked deleted, ${unlinked} link(s) unlinked at retirement, membership / user / shops inactive`);
    return true;
  } catch (error) {
    log(`FAIL 0361 retirement: ${fixedMessage(error)}; redo it with --retire=${f.shop}`);
    return false;
  }
}
export const retireLookupSQL = shop => `select l.id::text as id, l.name, l.code,
    (select x.id::text from public.locations x where x.code = l.code || '-L') as link_shop,
    (select u.id::text from public.users u where u.name = l.code) as user_id
    from public.locations l where l.id = ${q(shop)}::uuid`;
export async function retireOnly(query, shop, log) {
  let row;
  try { row = (await query(retireLookupSQL(shop)))[0]; } catch (error) { log(`FAIL 0361 retirement: ${fixedMessage(error)}`); return 1; }
  const tag = `${TAG_PREFIX}${shop}`;
  if (!row || row.code !== tag || row.name !== tag) { log(`REFUSED: shop ${shop} does not carry its ${TAG_PREFIX} tag; nothing retired`); return 2; }
  if (!UUID.test(row.link_shop ?? '') || !UUID.test(row.user_id ?? '')) { log(`REFUSED: the ${tag} fixture is incomplete (link shop or user missing); retire it by hand`); return 2; }
  const f = fixture({ shop, linkShop: row.link_shop, user: row.user_id });
  log(`FIXTURE retiring ${JSON.stringify(fixtureIds(f))}`);
  return (await retire(query, f, { written: new Set(), pending: new Set(), linkId: null }, log)) ? 0 : 1;
}

// ── the proof ───────────────────────────────────────────────────────────────────────────────────
export async function runProof(query, log = console.log, opts = {}) {
  try { await preflight(query); } catch (error) { log(`FAIL 0361 preflight: ${fixedMessage(error)}; nothing written`); return 1; }
  const f = fixture();
  log(`FIXTURE allocated ${JSON.stringify(fixtureIds(f))}`);
  const state = { pending: new Set(), written: new Set(), linkId: null };
  let failed = false, passed = 0, stage = 'fixture';
  try {
    await query(fixtureSQL(f));
    stage = 'seed';
    const seeds = seedRows(f);
    const seed = parseSession(await query(sessionSQL(`${f.tag}-seed`, [apply(seeds)])), `${f.tag}-seed`, 1);
    const seedBad = judgeCounts('seed', seed?.calls[0], counts({ inserted: seeds.length }));
    if (seedBad) throw new Refusal(seedBad);
    for (const row of seeds) state.written.add(row.time_entry_guid);
    for (const c of cases(f)) {
      stage = `case ${c.id}`;
      if (c.link) await query(activateLinkShopSQL(f));
      let reason = await runCase(query, f, c, opts, state);
      if (!reason && c.link) {
        const out = await unlinkSession(query, f, state.linkId, `${f.tag}-c10-unlink`);
        if (out?.changed !== true || Number(out?.cleared) !== 1) reason = 'unlink_toast_employee did not retire the link and clear the row';
        else reason = judgeFinal(f, await query(evidenceSQL(f.linkShop, [keyOf(f, 'c10')])), { c10: fin(false, true, M.m1, { user: null }) });
      }
      if (reason) { log(`FAIL 0361 case ${c.id}: ${reason}`); failed = true; break; }
      log(`PASS 0361 case ${c.id}: ${c.label}`);
      passed++;
    }
    if (!failed && opts.rest) {
      stage = 'rest';
      await restCheck(f, opts.restClient ?? defaultRestClient, state);
      log('PASS 0361 rest: rpc("toast_time_entries_apply_newer") through the sim REST endpoint: inserted 1, then unchanged 1');
    }
    if (!failed) log(`PASS 0361 two-session proof: ${passed} cases`);
  } catch (error) {
    failed = true;
    log(`FAIL 0361 ${stage}: ${fixedMessage(error)}`);
  } finally {
    // Never retire while a session may still hold a lock or still be writing.
    await Promise.allSettled([...state.pending]);
    if (!(await retire(query, f, state, log))) failed = true;
  }
  return failed ? 1 : 0;
}

export async function main(args = process.argv.slice(2), env = process.env, log = console.log, deps = {}) {
  const parsed = parseArgs(args);
  if (!parsed.ok) { log(`REFUSED: ${parsed.reason}`); return 2; }
  const token = env.SUPABASE_ACCESS_TOKEN;
  if (typeof token !== 'string' || token === '' || /\s/.test(token)) { log('REFUSED: set SUPABASE_ACCESS_TOKEN in the operator environment'); return 2; }
  const query = managementDriver(parsed.ref, token, deps.fetcher ?? globalThis.fetch);
  if (parsed.retire) return retireOnly(query, parsed.retire, log);
  return runProof(query, log, { ...deps, rest: parsed.rest });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(code => { process.exitCode = code; }, () => {
    console.error('FAIL 0361 two-session proof: unexpected error (no detail printed)');
    process.exitCode = 1;
  });
}
