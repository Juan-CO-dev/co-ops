/** FILE ONLY: CC runs after 0330 on SIM. Never loads .env or a direct DB URL.
 * SUPABASE_ACCESS_TOKEN=<operator environment>; node scripts/sim/ezcater-0330-reconcile-lock-check-management.mjs --ref=jepgzucrvklhqpthowsc
 * The at-scale proof of W23/B209 that one PGlite session cannot give: with 8,000 ezCater orders
 * stored (each its own provider_uuid, no snapshot, so the planner touches none of them),
 *   red    the 0229 body (re-created as a pg_temp function inside the request) takes one advisory
 *          lock per stored order and fails ("out of shared memory" on a 64-locks-per-transaction
 *          server), so the request errors;
 *   green  the live 0330 reconcile_ezcater_toast succeeds and holds only the global reconcile lock
 *          plus the providers it writes (at most a handful on the sim).
 * NOTHING PERSISTS: every request opens a transaction it never commits (the fixture rows, the temp
 * function and the reconcile's writes end with the request), and a final query proves no fixture
 * row remains. A fixture row found afterwards fails the run and prints the cleanup to do by hand.
 * Refuses to run unless 0330 is applied (a sim left with 8,000 extra orders under the 0229 body would
 * fail every capture tick).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { literal as q, managementQuery, projectRef } from '../supabase-management-query.mjs';

export const ORDERS = 8000;
export function fixture() {
  const run = randomUUID();
  return { run, tag: `SIM-0330-${run}` };
}
const body0229 = () => readFileSync('supabase/migrations/0229_ezcater_toast_reconcile.sql', 'utf8').replace(/\r\n/g, '\n')
  .match(/create function public\.reconcile_ezcater_toast[\s\S]*?\nend \$\$;/)[0]
  .replace('create function public.reconcile_ezcater_toast', 'create function pg_temp.reconcile_0229');

/** The fixture: 8,000 orders at an existing location, never committed. */
export const fixtureSQL = (f) => `insert into public.ezcater_orders(provider_uuid, caterer_uuid, location_id)
  select ${q(f.tag)} || '-' || g, ${q(f.tag)}, (select id from public.locations order by id limit 1)
  from generate_series(1, ${ORDERS}) g;`;

export async function preflight(query) {
  const rows = await query(`select strpos(pg_get_functiondef('public.reconcile_ezcater_toast(date,date)'::regprocedure), 'v_locked') > 0 as is_0330,
    to_regprocedure('public.plan_ezcater_toast()') is not null as planner,
    (select setting::int from pg_settings where name = 'max_locks_per_transaction') as max_locks,
    (select count(*)::int from public.ezcater_orders) as orders`);
  assert.equal(rows[0]?.is_0330, true, '0330 must be applied on the sim before this proof runs');
  assert.equal(rows[0]?.planner, true, 'plan_ezcater_toast must be present');
  return rows[0];
}

export async function runProof(query, log = console.log) {
  const before = await preflight(query);
  const f = fixture();
  log(`FIXTURE ${JSON.stringify({ ...f, orders: ORDERS, max_locks_per_transaction: before.max_locks })}`);
  try {
    // red: the 0229 body over 8,000 extra orders fails inside its own (never committed) transaction.
    let redFailed = false;
    try {
      await query(`begin; ${fixtureSQL(f)} ${body0229()} select pg_temp.reconcile_0229(current_date - 8, current_date + 1) as r;`);
    } catch { redFailed = true; }
    assert.equal(redFailed, true, 'the 0229 body must fail with 8,000 extra stored orders (one advisory lock each)');
    log('PASS red: the 0229 body failed with 8,000 extra stored orders');
    // green: the live 0330 body succeeds and holds a handful of advisory locks.
    const green = await query(`begin; ${fixtureSQL(f)}
      select x.r, (select count(*)::int from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()) as locks
      from (select public.reconcile_ezcater_toast(current_date - 8, current_date + 1) as r) x;`);
    assert.ok(green[0]?.r, '0330 reconcile returned a result');
    assert.ok(green[0].locks < 50, `0330 reconcile held ${green[0].locks} advisory locks; expected the global lock plus the providers it writes`);
    log(`PASS green: 0330 reconcile succeeded holding ${green[0].locks} advisory locks over ${before.orders + ORDERS} orders`);
  } finally {
    const left = await query(`select count(*)::int as n from public.ezcater_orders where caterer_uuid = ${q(f.tag)}`);
    assert.equal(left[0]?.n, 0, `fixture rows persisted; retire them by hand (caterer_uuid = ${f.tag})`);
    log('PASS no fixture row persisted');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(() => {
    const ref = projectRef(process.argv.slice(2), true);
    return runProof(managementQuery(ref, process.env.SUPABASE_ACCESS_TOKEN));
  }).catch(() => {
    console.error('FAIL 0330 Management API proof: check SIM target, 0330 applied, connectivity and invariants; a persisted fixture is printed above');
    process.exitCode = 1;
  });
}
