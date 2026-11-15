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
  const blast = await query(`select count(*)::int as n from public.customers where last_seen_at < timestamptz ${q(CUTOFF)}`);
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
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(() => {
    const ref=projectRef(process.argv.slice(2),true);
    return runProof(managementQuery(ref,process.env.SUPABASE_ACCESS_TOKEN));
  }).catch(() => {
    console.error('FAIL 0312 Management API proof: check SIM target, preflight, connectivity and invariants; interrupted requests may need fixture retirement');
    process.exitCode=1;
  });
}
