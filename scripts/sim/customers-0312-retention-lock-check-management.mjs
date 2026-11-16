/** FILE ONLY: CC runs after 0312 on SIM. Never loads .env or a direct DB URL. NOT run by the builder.
 * SUPABASE_ACCESS_TOKEN=<operator environment>; node scripts/sim/customers-0312-retention-lock-check-management.mjs --ref=jepgzucrvklhqpthowsc
 * W12/B070 two-session proof: a Meta-lead consent write (holder) takes customer_identity_lock(), makes a
 * long-unseen fixture person active again, and sleeps; the retention sweep (racer) must BLOCK on that lock
 * before it reads candidates, then erase NOBODY once the holder commits. Before 0312 the racer blocked only
 * inside customer_erase, after its candidate snapshot, and erased the person who had just become active.
 * Blast radius: the sweep runs with p_cutoff 1990-01-02, so only people last seen before that date are
 * candidates; the pre-flight refuses unless there are none but the fixture. Synthetic addresses only
 * (@example.test), no real customer is touched. Commits its own owner user + one customer + one email.
 * Afterwards the fixture person is erased by delete request (append-only; nothing deleted) and the user
 * retired. No retries: interrupted requests may have committed; the printed ids let CC retire them by hand.
 *
 * W12/B070 r1 (review P2) adds the IMPORT FINISH pairing, both commit orders (runImportPairings):
 *   I.  the finish holds the identity lock, the sweep races: the sweep must BLOCK, then erase nobody (the
 *       person the import opted in keeps their address and opt-in);
 *   II. the sweep holds the identity lock (it has checked and erased its candidate), the finish races: the
 *       finish must BLOCK until the sweep commits, then complete; the person erased first stays erased,
 *       opted out and out of the marketing file. Before r1 the finish never took the identity lock and
 *       could commit an opt-in between the sweep's re-check and its erase.
 * Its fixture: two synthetic people last seen 1990-01-01 and two imports of source toast_marketing_api
 * dated 1990-01-01. Person B is created only AFTER pairing I passes, right before import B is staged
 * (r2, review P2): an unconsented B present during pairing I is a correct sweep candidate at the 1990-01-02
 * cutoff, so pairing I's sweep would erase B (erased: 1) and the proof would abort before pairing II.
 * scripts/sql-harness-0312.mjs runs this exact sequence serially on PGlite to prove the fixture's eligibility; the pre-flight refuses unless every import of that source on sim is one of this proof's
 * own (so no real diff baseline moves) and none is running. The completed fixture imports stay (append-only;
 * consent history is never deleted): a later toast_marketing_api import on sim diffs against them and is not
 * a baseline. The blast-radius counts are the sweep's own candidates (live, unmerged), so a re-run passes.
 */
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { literal as q, managementQuery, projectRef } from '../supabase-management-query.mjs';
import { proveRace } from './checklist-0276-lock-check-management.mjs';

export const CUTOFF = '1990-01-02T00:00:00Z';
export const signatures = [
  'public.customer_retention_sweep(uuid,timestamptz,integer)',
  'public.customer_consent_record_explicit(text,text,text,timestamptz,text,text)',
  'public.customer_erase(uuid,uuid,text)',
  'public.customer_orders_sync_voided(uuid,date)',
];
export const userColumns = ['id', 'name', 'role', 'pin_hash', 'active'];
export function fixture() {
  const actor = randomUUID(), customer = randomUUID();
  return { actor, customer, tag: `SIM-0312-${actor}`, email: `sim-0312-${actor}@example.test`,
    evidence: `${randomInt(1_000_000_000, 9_999_999_999)}:w12_sim_retention` };
}
export function fixtureSQL(f) {
  return `begin;
    insert into public.users(id,name,role,pin_hash,active) values(${q(f.actor)},${q(f.tag)},'owner','SIM-NO-VALID-CREDENTIAL',true);
    insert into public.customers(id,full_name,first_seen_at,last_seen_at,sources)
      values(${q(f.customer)},${q(f.tag)},timestamptz '1990-01-01 00:00+00',timestamptz '1990-01-01 00:00+00',array['toast_pos']);
    insert into public.customer_identifiers(customer_id,kind,value,value_sha256,source,first_seen_at,last_seen_at)
      values(${q(f.customer)},'email',${q(f.email)},encode(sha256(convert_to(${q(f.email)},'UTF8')),'hex'),'toast_pos',
        timestamptz '1990-01-01 00:00+00',timestamptz '1990-01-01 00:00+00');
    commit;`;
}
export function retireSQL(f) {
  // Erase (by delete request) only the fixture person; retire only the fixture user. Nothing is deleted.
  return `begin;
    select public.customer_erase(${q(f.actor)},${q(f.customer)},'delete_request');
    update public.users set active=false where id=${q(f.actor)} and name=${q(f.tag)};
    commit;`;
}
export const holderSQL = (f) => `select public.customer_consent_record_explicit(${q(f.email)},'email','meta_lead_form',clock_timestamp(),${q(f.evidence)},'meta-email-marketing-v3') as result`;
export const racerSQL = (f) => `select public.customer_retention_sweep(${q(f.actor)},timestamptz ${q(CUTOFF)},200) as result`;

export async function preflight(query) {
  const grants = await query(`begin read only; set local statement_timeout='10s';
    select signature, to_regprocedure(signature) is not null as present,
      coalesce(has_function_privilege('service_role',to_regprocedure(signature),'EXECUTE'),false) as executable
    from unnest(array[${signatures.map(q).join(',')}]::text[]) as required(signature); commit;`);
  assert.ok(signatures.every(s => grants.some(r => r.signature===s && r.present===true && r.executable===true)),
    '0312 functions and service_role EXECUTE must be present (apply 0312 to SIM first)');
  const columns = await query(`select column_name,is_nullable,column_default,is_identity,is_generated
    from information_schema.columns where table_schema='public' and table_name='users'`);
  for (const name of userColumns) assert.ok(columns.some(c => c.column_name===name), 'fixture column missing');
  for (const c of columns) assert.ok(c.is_nullable!=='NO' || c.column_default!=null || c.is_identity==='YES'
    || c.is_generated==='ALWAYS' || userColumns.includes(c.column_name), 'fixture schema has omitted required column');
  const blast = await query(`select count(*)::int as n from public.customers where merged_into is null and erased_at is null and last_seen_at < timestamptz ${q(CUTOFF)}`);
  assert.equal(blast[0]?.n, 0, 'another person is a candidate at the proof cutoff: refuse rather than erase them');
}

export async function runProof(query, log=console.log, raceOptions={}) {
  await preflight(query);
  const f = fixture();
  log(`FIXTURE allocated ${JSON.stringify({ actor: f.actor, customer: f.customer, tag: f.tag })}`);
  try {
    await query(fixtureSQL(f));
    const result = await proveRace(query, holderSQL(f), racerSQL(f), f.tag, raceOptions);
    assert.equal(result.ok, true, 'the sweep must commit');
    const sweep = result.rows?.[0]?.result;
    assert.equal(sweep?.erased, 0, 'the sweep must erase nobody: the person became active under the lock');
    const after = await query(`select
      (select erased_at is null from public.customers where id=${q(f.customer)}) as live,
      (select count(*)::int from public.customer_identifiers where customer_id=${q(f.customer)}) as identifiers,
      (select count(*)::int from public.customer_suppressions where value_sha256=encode(sha256(convert_to(${q(f.email)},'UTF8')),'hex')) as suppressions,
      (select status from public.customer_consent_current where customer_id=${q(f.customer)} and channel='email') as consent`);
    assert.deepEqual(after[0], { live: true, identifiers: 1, suppressions: 0, consent: 'opted_in' }, 'the fixture keeps identity and consent');
    log('PASS the sweep blocked on the identity lock, then erased nobody; the fixture kept its address and opt-in');
  } finally {
    await query(retireSQL(f));
    const rows = await query(`select not exists(select 1 from public.users where id=${q(f.actor)} and active)
      and exists(select 1 from public.customers where id=${q(f.customer)} and erased_at is not null) as retired`);
    assert.equal(rows[0]?.retired, true, 'owned fixture must be retired');
    log('PASS fixture user retired and fixture person erased by delete request');
  }
}
// ── W12/B070 r1: the import finish against the sweep, both orders ─────────────────────────────────
export const IMPORT_SOURCE = 'toast_marketing_api';
export const EXPORT_DATE = '1990-01-01';
export const importSignatures = [
  'public.customer_consent_import_begin(uuid,text,text,date,boolean,integer)',
  'public.customer_consent_import_chunk(uuid,uuid,integer,jsonb)',
  'public.customer_consent_import_finish(uuid,uuid,boolean)',
  'public.customer_retention_sweep(uuid,timestamptz,integer)',
  'public.customer_erase(uuid,uuid,text)',
];
export function importFixture() {
  const actor = randomUUID(), a = randomUUID(), b = randomUUID();
  return { actor, a, b, tag: `SIM-0312I-${actor}`,
    emailA: `sim-0312i-a-${actor}@example.test`, emailB: `sim-0312i-b-${actor}@example.test` };
}
const personSQL = (id, tag, email) => `
    insert into public.customers(id,full_name,first_seen_at,last_seen_at,sources)
      values(${q(id)},${q(tag)},timestamptz '1990-01-01 00:00+00',timestamptz '1990-01-01 00:00+00',array['toast_pos']);
    insert into public.customer_identifiers(customer_id,kind,value,value_sha256,source,first_seen_at,last_seen_at)
      values(${q(id)},'email',${q(email)},encode(sha256(convert_to(${q(email)},'UTF8')),'hex'),'toast_pos',
        timestamptz '1990-01-01 00:00+00',timestamptz '1990-01-01 00:00+00');`;
// The owner user and person A only. Person B comes later (importPersonBSQL), after pairing I.
export function importFixtureSQL(f) {
  return `begin;
    insert into public.users(id,name,role,pin_hash,active) values(${q(f.actor)},${q(f.tag)},'owner','SIM-NO-VALID-CREDENTIAL',true);
    ${personSQL(f.a, f.tag, f.emailA)}
    commit;`;
}
export const importPersonBSQL = (f) => `begin;${personSQL(f.b, f.tag, f.emailB)}
    commit;`;
export const beginSQL = (f, email) => `select (public.customer_consent_import_begin(${q(f.actor)},${q(IMPORT_SOURCE)},
    encode(sha256(convert_to(${q(`${f.tag}:${email}`)},'UTF8')),'hex'),date ${q(EXPORT_DATE)},false,1))->>'import_id' as import_id`;
export const chunkSQL = (f, importId, email) => `select public.customer_consent_import_chunk(${q(f.actor)},${q(importId)},0,
    ${q(JSON.stringify([{ email }]))}::jsonb) as result`;
export const finishSQL = (f, importId) => `select public.customer_consent_import_finish(${q(f.actor)},${q(importId)},false) as result`;
export const stateSQL = (id) => `select
      (select erased_at is null from public.customers where id=${q(id)}) as live,
      (select count(*)::int from public.customer_identifiers where customer_id=${q(id)}) as identifiers,
      (select status from public.customer_consent_current where customer_id=${q(id)} and channel='email') as consent,
      exists(select 1 from public.customer_marketing_export('email') x where x.customer_id=${q(id)}) as exported`;
export function importRetireSQL(f) {
  // Erase (by delete request) only the fixture people that exist (a run that stopped early never created B,
  // or nothing at all); retire only the fixture user. Nothing is deleted.
  return `begin;
    select public.customer_erase(${q(f.actor)},c.id,'delete_request') from public.customers c where c.id in (${q(f.a)},${q(f.b)});
    update public.users set active=false where id=${q(f.actor)} and name=${q(f.tag)};
    commit;`;
}
// Every fixture person that exists is erased and the fixture user (if created) is inactive.
export const importRetiredSQL = (f) => `select not exists(select 1 from public.users where id=${q(f.actor)} and active)
      and not exists(select 1 from public.customers where id in (${q(f.a)},${q(f.b)}) and erased_at is null) as retired`;

export async function importPreflight(query) {
  const grants = await query(`begin read only; set local statement_timeout='10s';
    select signature, to_regprocedure(signature) is not null as present,
      coalesce(has_function_privilege('service_role',to_regprocedure(signature),'EXECUTE'),false) as executable
    from unnest(array[${importSignatures.map(q).join(',')}]::text[]) as required(signature); commit;`);
  assert.ok(importSignatures.every(s => grants.some(r => r.signature===s && r.present===true && r.executable===true)),
    'import + sweep functions and service_role EXECUTE must be present (apply 0312 to SIM first)');
  const order = await query(`select strpos(d,'customer-consent-import') > 0
      and strpos(d,'customer_identity_lock()') > strpos(d,'customer-consent-import') as locked
    from (select pg_get_functiondef('public.customer_consent_import_finish(uuid,uuid,boolean)'::regprocedure) d) x`);
  assert.equal(order[0]?.locked, true, 'the finish must take the import lock, then the identity lock (apply the r1 0312 to SIM)');
  const blast = await query(`select
      (select count(*)::int from public.customers where merged_into is null and erased_at is null and last_seen_at < timestamptz ${q(CUTOFF)}) as candidates,
      (select count(*)::int from public.customer_consent_imports i where i.source=${q(IMPORT_SOURCE)}
        and not exists(select 1 from public.users u where u.id=i.actor_id and u.name like 'SIM-0312I-%')) as imports,
      (select count(*)::int from public.customer_consent_imports where source=${q(IMPORT_SOURCE)} and status='running') as running`);
  assert.equal(blast[0]?.candidates, 0, 'another person is a candidate at the proof cutoff: refuse rather than erase them');
  // Only this proof's own earlier fixture imports may exist for the source (a re-run diffs against them).
  assert.equal(blast[0]?.imports, 0, 'sim has a non-fixture import of the fixture source: refuse rather than move a real diff baseline');
  assert.equal(blast[0]?.running, 0, 'a fixture-source import is still running (an interrupted run): cancel it by hand first');
}

async function stageImport(query, f, email) {
  const begun = await query(beginSQL(f, email));
  const importId = begun[0]?.import_id;
  assert.match(String(importId), /^[0-9a-f-]{36}$/, 'fixture import must begin');
  await query(chunkSQL(f, importId, email));
  return importId;
}

// `race` is proveRace on sim; the offline harness passes a serial stand-in to replay the same sequence.
export async function runImportPairings(query, log=console.log, raceOptions={}, race=proveRace) {
  await importPreflight(query);
  const f = importFixture();
  log(`FIXTURE allocated ${JSON.stringify({ actor: f.actor, a: f.a, b: f.b, tag: f.tag })}`);
  try {
    await query(importFixtureSQL(f));
    // I. The finish holds the identity lock; the sweep races.
    const importA = await stageImport(query, f, f.emailA);
    log(`FIXTURE import A ${importA}`);
    const first = await race(query, finishSQL(f, importA), racerSQL(f), `${f.tag}-1`, raceOptions);
    assert.equal(first.ok, true, 'the sweep must commit');
    assert.equal(first.rows?.[0]?.result?.erased, 0, 'the sweep must erase nobody: the import opted the person in under the lock');
    const a = await query(stateSQL(f.a));
    assert.deepEqual(a[0], { live: true, identifiers: 1, consent: 'opted_in', exported: true },
      'the person the import opted in keeps identity, consent and the marketing file');
    log('PASS I: the sweep blocked behind the finishing import, then erased nobody');
    // II. Only now does B exist (r2): unconsented and last seen 1990-01-01, B is the sweep's one candidate.
    // The sweep holds the identity lock (it has checked and erased B); the finish races.
    await query(importPersonBSQL(f));
    const importB = await stageImport(query, f, f.emailB);
    log(`FIXTURE import B ${importB}`);
    const second = await race(query, racerSQL(f), finishSQL(f, importB), `${f.tag}-2`, raceOptions);
    assert.equal(second.ok, true, 'the finish must commit after the sweep');
    assert.equal(second.rows?.[0]?.result?.replay, false, 'the finish must complete the import');
    const b = await query(stateSQL(f.b));
    assert.deepEqual(b[0], { live: false, identifiers: 0, consent: 'opted_out', exported: false },
      'the person the sweep erased first stays erased, opted out and unmarketed');
    const kept = await query(stateSQL(f.a));
    assert.ok(kept[0]?.live === true && kept[0]?.identifiers === 1, 'the second sweep erased only B: A (opted in at the time) stays');
    log('PASS II: the finish blocked behind the sweep, then completed; nobody was opted in mid-erase');
  } finally {
    await query(importRetireSQL(f));
    const rows = await query(importRetiredSQL(f));
    assert.equal(rows[0]?.retired, true, 'owned fixture must be retired');
    log('PASS import fixture user retired and every fixture person created erased by delete request');
  }
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(() => {
    const ref=projectRef(process.argv.slice(2),true);
    const query=managementQuery(ref,process.env.SUPABASE_ACCESS_TOKEN);
    return runProof(query).then(() => runImportPairings(query));
  }).catch(() => {
    console.error('FAIL 0312 Management API proof: check SIM target, preflight, connectivity and invariants; interrupted requests may need fixture retirement');
    process.exitCode=1;
  });
}
