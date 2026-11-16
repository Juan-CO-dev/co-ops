/** FILE ONLY: CC runs after 0315 on SIM. Never loads .env or a direct DB URL.
 * SUPABASE_ACCESS_TOKEN=<operator environment>; node scripts/sim/opening-phase2-0315-lock-check-management.mjs --ref=jepgzucrvklhqpthowsc
 *
 * The two-session proof of migration 0315 (audit W14: B080, B181, B078, B182) that one PGlite
 * backend cannot give. Self-allocated SIM-0315 fixtures only; history retained, own config
 * retired. No retries: an interrupted request may have committed — the printed ids let CC
 * retire stranded fixtures by hand. Never reuses operational users, shops or history.
 *
 * Each API request owns ONE transaction.
 *   A. LOCK MATRIX (rollback): the three opening Phase 2 writers — save, undo, finalize — in all
 *      nine ordered pairs on one opening. The holder calls the real RPC and sleeps holding its
 *      locks; the 0276 observer proves the racer is an ungranted lock BLOCKED BY the holder plus
 *      the elapsed wait; both roll back. This is the instance lock 0315 adds: before it, none
 *      of these pairs waited.
 *   B. COMMITTED OUTCOMES: what the order decides once the holder COMMITS.
 *        finalize → undo      undo refused phase2_not_eligible; the finalized rows stay live (B080)
 *        undo → finalize      finalize refused phase2_incomplete; the opening stays open
 *        save → finalize      finalize names the NEW row, never the superseded one
 *        finalize → save      save refused phase2_not_eligible
 *        save → undo(old row) undo refused revoke_conflict — a named refusal, no deadlock (B181)
 *        undo → save          the save lands on the re-opened row: exactly one live row
 *   C. SINGLE-SESSION PROBES (committed): the draft's same-tab compare-and-set (B078) and the
 *      item-tracking refusal of a generic correction (B182).
 *
 * The fixture items are single-box rows (no recipe), so no catalog row is written; the batch
 * session order (session before completion) is structural and pinned offline by
 * tests/opening-counts-batch-prep-migration.test.ts and scripts/sql-harness-0315.mjs.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { literal as q, managementQuery, projectRef } from '../supabase-management-query.mjs';
import { proveRace, transactionSQL } from './checklist-0276-lock-check-management.mjs';
import { rollbackQuery } from './checklist-0287-lock-check-management.mjs';

export const writers = ['save', 'undo', 'finalize'];
/** All nine ordered pairs, a writer against itself included. */
export const pairings = writers.flatMap(a => writers.map(b => [a, b]));
export const outcomes = [
  ['finalize', 'undo'], ['undo', 'finalize'], ['save', 'finalize'],
  ['finalize', 'save'], ['save', 'undoOld'], ['undo', 'save'],
];
export const signatures = [
  'public.save_phase2_item_atomic(uuid,uuid,uuid,numeric,jsonb,jsonb,text,text,jsonb)',
  'public.revoke_phase2_item_atomic(uuid,uuid,uuid,text,text)',
  'public.submit_phase2_atomic(uuid,uuid,boolean,uuid,text,text)',
  'public.save_opening_phase1_draft(uuid,uuid,jsonb,uuid,uuid,bigint)',
  'public.checklist_revoke_with_reason(uuid,uuid,text,text)',
];

export function fixture() {
  const f = Object.fromEntries(['actor', 'shop', 'opening', 'closing', 'itemA', 'itemB', 'trackItem', 'tabA', 'tabB']
    .map(key => [key, randomUUID()]));
  f.tag = `SIM-0315-${f.opening}`;
  // One opening per matrix pair and per committed outcome, one still-open opening for the
  // draft probe, one closing for the item-tracking probe.
  f.cases = Array.from({ length: pairings.length + outcomes.length }, () =>
    Object.fromEntries(['instance', 'phase1A', 'phase1B', 'savedA', 'savedB'].map(key => [key, randomUUID()])));
  f.draft = { instance: randomUUID() };
  f.track = { instance: randomUUID(), completion: randomUUID() };
  return f;
}

const phase1 = '{"phase1":{"closer_count":2,"spot_check_status":"verified","opener_recount":null,"ground_truth_count":2,"prep_need":null,"par_value":null}}';
const phase2 = n => JSON.stringify({ phase2: { phase: 2, closer_count: 2, spot_check_status: 'verified', opener_recount: null,
  ground_truth_count: 2, prep_need: null, opener_prepped: n, delta_vs_prep_need: null, over_under_status: 'at_par',
  over_under_reason_category: null, over_under_reason_text: null, directed_by: null } });

/** Every opening starts where a prepper stands mid Phase 2: Phase 1 done, both rows saved. */
export function fixtureSQL(f) {
  return `begin;
    insert into public.locations(id,name,code,type,active) values(${q(f.shop)},${q(f.tag)},${q(f.tag)},'permanent',true);
    insert into public.users(id,name,role,pin_hash,active) values(${q(f.actor)},${q(f.tag)},'key_holder','SIM-NO-VALID-CREDENTIAL',true);
    insert into public.user_locations(user_id,location_id,active) values(${q(f.actor)},${q(f.shop)},true);
    insert into public.checklist_templates(id,location_id,type,name,active) values
      (${q(f.opening)},${q(f.shop)},'opening',${q(f.tag)},true),
      (${q(f.closing)},${q(f.shop)},'closing',${q(f.tag)},true);
    insert into public.checklist_template_items(id,template_id,label,min_role_level,active,prep_meta) values
      (${q(f.itemA)},${q(f.opening)},${q(`${f.tag}-A`)},3,true,'{"openingPhase2":true,"section":"SIM"}'::jsonb),
      (${q(f.itemB)},${q(f.opening)},${q(`${f.tag}-B`)},3,true,'{"openingPhase2":true,"section":"SIM"}'::jsonb);
    insert into public.checklist_template_items(id,template_id,label,min_role_level,active,ref_track_item_completion,references_template_item_id) values
      (${q(f.trackItem)},${q(f.closing)},${q(`${f.tag}-TRACK`)},3,true,true,${q(f.itemA)});
    insert into public.checklist_instances(id,template_id,location_id,date,status) values
      ${f.cases.map((c, i) => `(${q(c.instance)},${q(f.opening)},${q(f.shop)},date '2099-01-01'+${i},'phase1_complete')`).join(',')},
      (${q(f.draft.instance)},${q(f.opening)},${q(f.shop)},date '2099-06-01','open'),
      (${q(f.track.instance)},${q(f.closing)},${q(f.shop)},date '2099-06-01','open');
    insert into public.checklist_completions(id,instance_id,template_item_id,completed_by,completed_at,prep_data) values
      ${f.cases.flatMap(c => [
        `(${q(c.phase1A)},${q(c.instance)},${q(f.itemA)},${q(f.actor)},clock_timestamp()-interval '10 minutes',${q(phase1)}::jsonb)`,
        `(${q(c.phase1B)},${q(c.instance)},${q(f.itemB)},${q(f.actor)},clock_timestamp()-interval '10 minutes',${q(phase1)}::jsonb)`,
        `(${q(c.savedA)},${q(c.instance)},${q(f.itemA)},${q(f.actor)},clock_timestamp()-interval '5 minutes',${q(phase2(1))}::jsonb)`,
        `(${q(c.savedB)},${q(c.instance)},${q(f.itemB)},${q(f.actor)},clock_timestamp()-interval '5 minutes',${q(phase2(1))}::jsonb)`,
      ]).join(',')},
      (${q(f.track.completion)},${q(f.track.instance)},${q(f.trackItem)},${q(f.actor)},clock_timestamp()-interval '5 minutes',null); commit;`;
}
export function retireSQL(f) {
  return `begin;
    update public.checklist_template_items set active=false where template_id in (${q(f.opening)},${q(f.closing)}) and id in (${q(f.itemA)},${q(f.itemB)},${q(f.trackItem)});
    update public.checklist_templates set active=false where id in (${q(f.opening)},${q(f.closing)}) and name=${q(f.tag)};
    update public.user_locations set active=false where location_id=${q(f.shop)} and user_id=${q(f.actor)};
    update public.users set active=false where id=${q(f.actor)} and name=${q(f.tag)};
    update public.locations set active=false where id=${q(f.shop)} and code=${q(f.tag)}; commit;`;
}

/** The live Phase 2 row of item A, resolved inside the racing transaction (after any lock wait). */
const liveA = (f, c) => `(select id from public.checklist_completions where instance_id=${q(c.instance)} and template_item_id=${q(f.itemA)}
  and prep_data ? 'phase2' and superseded_at is null and revoked_at is null)`;
export function calls(f, c) {
  return {
    save: `select public.save_phase2_item_atomic(${q(c.instance)},${q(f.actor)},${q(f.itemA)},7,null,null,null,null,null) as result`,
    undo: `select public.revoke_phase2_item_atomic(${q(c.instance)},${liveA(f, c)},${q(f.actor)},'re_enter_count',null) as result`,
    // The row the prepper's screen still shows: the id from BEFORE a concurrent save.
    undoOld: `select public.revoke_phase2_item_atomic(${q(c.instance)},${q(c.savedA)},${q(f.actor)},'re_enter_count',null) as result`,
    finalize: `select public.submit_phase2_atomic(${q(c.instance)},${q(f.actor)}) as result`,
  };
}
/** A statement that COMMITS only if `sql` is refused with the named P0001 code. */
export function refusalSQL(sql, expected) {
  assert.ok(['phase2_not_eligible', 'phase2_incomplete', 'revoke_conflict', 'phase1_not_open', 'reference_row_not_correctable'].includes(expected));
  return `do $proof$ declare refused boolean := false; begin
    begin ${sql.replace(/^select /, 'perform ').replace(/ as result$/, '')};
    exception when sqlstate 'P0001' then
      if position(${q(expected)} in sqlerrm) > 0 then refused := true; else raise; end if;
    end;
    if not refused then raise exception 'expected refusal missing' using errcode='XX000'; end if;
  end $proof$`;
}
export function evidenceSQL(f, c) {
  return `select
    (select status from public.checklist_instances where id=${q(c.instance)}) as status,
    (select count(*)::int from public.checklist_submissions where instance_id=${q(c.instance)}) as submissions,
    (select count(*)::int from public.checklist_completions where instance_id=${q(c.instance)} and prep_data ? 'phase2'
      and superseded_at is null and revoked_at is null) as live,
    (select count(*)::int from public.checklist_completions where instance_id=${q(c.instance)} and template_item_id=${q(f.itemA)}
      and prep_data ? 'phase2' and superseded_at is null and revoked_at is null) as live_a,
    (select coalesce(bool_and(x.superseded_at is null and x.revoked_at is null), true) from public.checklist_submissions s
      cross join lateral unnest(s.completion_ids) as named(id) join public.checklist_completions x on x.id=named.id
      where s.instance_id=${q(c.instance)}) as named_live,
    (select coalesce(bool_or(named.id=${q(c.savedA)}), false) from public.checklist_submissions s
      cross join lateral unnest(s.completion_ids) as named(id) where s.instance_id=${q(c.instance)}) as names_old_a`;
}
/** What each committed order must leave behind. `racer` is the second statement of the pair. */
export const expectations = {
  'finalize>undo': { racer: 'phase2_not_eligible', status: 'phase2_complete', submissions: 1, live: 2, live_a: 1, named_live: true, names_old_a: true },
  'undo>finalize': { racer: 'phase2_incomplete', status: 'phase1_complete', submissions: 0, live: 1, live_a: 0, named_live: true, names_old_a: false },
  'save>finalize': { racer: null, status: 'phase2_complete', submissions: 1, live: 2, live_a: 1, named_live: true, names_old_a: false },
  'finalize>save': { racer: 'phase2_not_eligible', status: 'phase2_complete', submissions: 1, live: 2, live_a: 1, named_live: true, names_old_a: true },
  'save>undoOld': { racer: 'revoke_conflict', status: 'phase1_complete', submissions: 0, live: 2, live_a: 1, named_live: true, names_old_a: false },
  'undo>save': { racer: null, status: 'phase1_complete', submissions: 0, live: 2, live_a: 1, named_live: true, names_old_a: false },
};
export function assertEvidence(row, expected) {
  for (const key of ['status', 'submissions', 'live', 'live_a', 'named_live', 'names_old_a']) {
    assert.equal(row?.[key], expected[key], `committed outcome: ${key}`);
  }
}

export const requiredColumns = {
  locations: ['id', 'name', 'code', 'type', 'active'], users: ['id', 'name', 'role', 'pin_hash', 'active'],
  user_locations: ['user_id', 'location_id', 'active'], checklist_templates: ['id', 'location_id', 'type', 'name', 'active'],
  checklist_template_items: ['id', 'template_id', 'label', 'min_role_level', 'active', 'prep_meta', 'ref_track_item_completion', 'references_template_item_id'],
  checklist_instances: ['id', 'template_id', 'location_id', 'date', 'status'],
  checklist_completions: ['id', 'instance_id', 'template_item_id', 'completed_by', 'completed_at', 'prep_data'],
};
/** FIRST request: read-only. 0315 applied (the three locks, the draft writer, the columns), service_role may execute. */
export async function preflight(query) {
  const rows = await query(`begin read only; set local statement_timeout = '10s';
    select signature, to_regprocedure(signature) is not null as present,
      coalesce(has_function_privilege('service_role', to_regprocedure(signature), 'EXECUTE'), false) as executable,
      coalesce((select strpos(lower(p.prosrc), 'for no key update') > 0 from pg_proc p where p.oid = to_regprocedure(signature)), false) as parent_lock,
      (select count(*)::int from information_schema.columns where table_schema='public' and table_name='opening_phase1_drafts'
        and column_name in ('client_tab','client_seq')) as draft_columns
    from unnest(array[${signatures.map(q).join(',')}]::text[]) as required(signature); commit;`);
  for (const signature of signatures) {
    const row = rows.find(r => r.signature === signature);
    assert.ok(row?.present === true && row?.executable === true, '0315 preflight: required function or service_role EXECUTE missing');
    if (/phase2/.test(signature)) assert.equal(row.parent_lock, true, '0315 preflight: an opening Phase 2 writer has no instance lock (0315 not applied)');
    assert.equal(row.draft_columns, 2, '0315 preflight: opening_phase1_drafts has no revision columns');
  }
  return rows;
}
export async function fixturePreflight(query) {
  const tables = Object.keys(requiredColumns).map(q).join(',');
  const columns = await query(`select table_name,column_name,is_nullable,column_default,is_identity,is_generated from information_schema.columns where table_schema='public' and table_name in (${tables})`);
  for (const [table, names] of Object.entries(requiredColumns)) for (const name of names) {
    assert.ok(columns.some(c => c.table_name === table && c.column_name === name), 'fixture schema must contain every inserted column');
  }
  for (const c of columns) assert.ok(c.is_nullable !== 'NO' || c.column_default != null || c.is_identity === 'YES'
    || c.is_generated === 'ALWAYS' || requiredColumns[c.table_name]?.includes(c.column_name), 'fixture schema has omitted required column');
  const enums = await query(`select c.relname as table_name,a.attname as column_name,e.enumlabel
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    join pg_type t on t.oid=a.atttypid join pg_enum e on e.enumtypid=t.oid
    where n.nspname='public' and c.relname in (${tables})`);
  const values = { 'locations.type': ['permanent'], 'users.role': ['key_holder'], 'checklist_templates.type': ['opening', 'closing'],
    'checklist_instances.status': ['open', 'phase1_complete'] };
  for (const e of enums) {
    if (!requiredColumns[e.table_name]?.includes(e.column_name)) continue;
    const expected = values[`${e.table_name}.${e.column_name}`];
    assert.ok(expected && expected.every(label => enums.some(v => v.table_name === e.table_name && v.column_name === e.column_name && v.enumlabel === label)), 'fixture enum label mismatch');
  }
}

const draftSQL = (f, tab, seq, n) => `select public.save_opening_phase1_draft(${q(f.draft.instance)},${q(f.shop)},
  ${q(JSON.stringify({ version: 1, items: {}, sections: {}, n }))}::jsonb,${q(f.actor)},${tab === null ? 'null' : q(tab)},${seq === null ? 'null' : seq}) as result`;

export async function runProof(query, log = console.log, raceOptions = {}) {
  // FIRST request, before allocation or fixture emission.
  await preflight(query);
  await fixturePreflight(query);
  const f = fixture();
  log(`FIXTURE allocated ${JSON.stringify(f)}`);
  const check = async (name, fn) => {
    try { await fn(); log(`PASS ${name}`); }
    catch (error) { log(`FAIL ${name}`); throw error; }
  };
  const transact = (name, sql) => query(transactionSQL(`${f.tag}-${name}`, sql));
  try {
    await check('fixture creation', () => query(fixtureSQL(f)));

    // A. The lock matrix: every ordered pair WAITS; nothing is kept.
    for (const [i, [a, b]] of pairings.entries()) await check(`ordered lock pair ${a} -> ${b}`, async () => {
      const c = f.cases[i], ops = calls(f, c);
      const before = await query(evidenceSQL(f, c));
      const result = await proveRace(rollbackQuery(query), ops[a], ops[b], `${f.tag}-${i}`, raceOptions);
      assert.equal(result.ok, true, 'waiter must succeed after holder rollback');
      assert.deepEqual(await query(evidenceSQL(f, c)), before, 'both matrix transactions must roll back');
    });

    // B. Committed outcomes: the holder commits, the racer meets the state it left.
    for (const [i, [a, b]] of outcomes.entries()) await check(`committed order ${a} -> ${b}`, async () => {
      const c = f.cases[pairings.length + i], ops = calls(f, c), expected = expectations[`${a}>${b}`];
      const racer = expected.racer === null ? ops[b] : refusalSQL(ops[b], expected.racer);
      const result = await proveRace(query, ops[a], racer, `${f.tag}-o${i}`, raceOptions);
      // ok means: the racer waited, then did exactly what was expected of it (a refusal is
      // proven INSIDE its transaction by refusalSQL; a deadlock, or any other error, fails here).
      assert.equal(result.ok, true, expected.racer === null ? 'the waiting writer must succeed' : `the waiting writer must be refused ${expected.racer}`);
      assertEvidence((await query(evidenceSQL(f, c)))[0], expected);
    });

    // C. The draft: an older request from the same tab writes nothing.
    await check('draft: same-tab compare-and-set', async () => {
      const send = async (tab, seq, n) => (await transact(`draft-${n}`, draftSQL(f, tab, seq, n)))[0]?.result;
      assert.equal((await send(f.tabA, 2, 2))?.applied, true);
      assert.equal((await send(f.tabA, 1, 1))?.applied, false, 'an older request from the same tab is refused');
      assert.equal((await send(f.tabA, 3, 3))?.applied, true);
      assert.equal((await send(f.tabB, 1, 4))?.applied, true, 'another tab keeps last-write-wins');
      assert.equal((await send(null, null, 5))?.applied, true, 'a request with no revision applies');
      const stored = await query(`select draft->>'n' as n, client_tab is null as no_tab from public.opening_phase1_drafts where instance_id=${q(f.draft.instance)}`);
      assert.equal(stored[0]?.n, '5'); assert.equal(stored[0]?.no_tab, true);
      // Past Phase 1 the write itself refuses (any finalized matrix opening will do).
      const closed = f.cases[pairings.length];
      await transact('draft-closed', refusalSQL(`select public.save_opening_phase1_draft(${q(closed.instance)},${q(f.shop)},'{"version":1}'::jsonb,${q(f.actor)},${q(f.tabA)},9) as result`, 'phase1_not_open'));
    });

    // C. The item-tracking tick: no generic correction.
    await check('item-tracking tick refuses a generic correction', async () => {
      await transact('track', refusalSQL(`select public.checklist_revoke_with_reason(${q(f.track.completion)},${q(f.actor)},'other',${q(f.tag)}) as result`, 'reference_row_not_correctable'));
      const rows = await query(`select revoked_at is null as live from public.checklist_completions where id=${q(f.track.completion)}`);
      assert.equal(rows[0]?.live, true);
    });
    log(`PASS 0315: ${pairings.length} ordered lock pairs with observed waits; ${outcomes.length} committed orders; draft compare-and-set; item-tracking refusal`);
  } finally {
    await check('own fixture configuration retired; append-only evidence retained', async () => {
      await query(retireSQL(f));
      const rows = await query(`select
        not exists(select 1 from public.users where id=${q(f.actor)} and active)
        and not exists(select 1 from public.locations where id=${q(f.shop)} and active)
        and not exists(select 1 from public.user_locations where location_id=${q(f.shop)} and user_id=${q(f.actor)} and active)
        and not exists(select 1 from public.checklist_templates where id in (${q(f.opening)},${q(f.closing)}) and active)
        and not exists(select 1 from public.checklist_template_items where template_id in (${q(f.opening)},${q(f.closing)}) and active) as retired`);
      assert.equal(rows[0]?.retired, true);
    });
  }
}
export function main(args = process.argv.slice(2)) {
  const ref = projectRef(args, true);
  return runProof(managementQuery(ref, process.env.SUPABASE_ACCESS_TOKEN));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(() => main()).catch(() => {
    console.error('FAIL 0315 Management API proof: check SIM target, preflight, connectivity and invariants; interrupted requests may need fixture retirement');
    process.exitCode = 1;
  });
}
