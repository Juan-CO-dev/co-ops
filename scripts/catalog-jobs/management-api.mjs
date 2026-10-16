/** CC runs this only through F4's catalog suite. No standalone CLI or environment autoload. */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const SIM_REF = 'jepgzucrvklhqpthowsc';
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const lit = value => value === null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
export const json = value => `${lit(JSON.stringify(value))}::jsonb`;
export async function joined(promises) {
  const results = await Promise.allSettled(promises);
  const failed = results.find(result => result.status === 'rejected');
  if (failed) throw new Error('Concurrent request failed');
  return results.map(result => result.value);
}
const pre = "begin; set local statement_timeout='30s'; set local lock_timeout='20s';";

/** Reject the target and authority BEFORE token I/O. Every q is a fresh API transaction. */
export function createManagementClient({ ref, assertLease, verifiedServer, token = () => readFileSync(join(homedir(), '.supabase-token'), 'utf8').trim(), fetch: transport = globalThis.fetch }) {
  if (ref !== SIM_REF) throw new Error('SIM only: project refused');
  if (typeof assertLease !== 'function' || verifiedServer !== true) throw new Error('F4 lease and verified server required');
  assertLease();
  const bearer = token();
  if (!bearer) throw new Error('Management credential unavailable');
  return async query => {
    assertLease();
    const t0 = Date.now();
    let response;
    try {
      response = await transport(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000),
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
      });
    } catch { throw new Error('Management transport failed'); }
    const text = await response.text();
    let rows = null;
    try { rows = JSON.parse(text); } catch { /* Never return raw SQL / server error text. */ }
    const ok = response.ok && Array.isArray(rows);
    const code = ok ? null : text.match(/(?:shop_owned|recipe_version|swap):[a-z_]+/)?.[0] ?? 'management_query_failed';
    return { ok, status: response.status, rows: ok ? rows : [], code, ms: Date.now() - t0 };
  };
}

export async function collide(q, holderSql, racerSql, { sleep: pause = sleep, nonce = String(randomUUID()) } = {}) {
  if (!/^[a-zA-Z0-9-]+$/.test(nonce)) throw new Error('Invalid race marker');
  const needle = `catalog-racer-${nonce}`;
  // Attach rejection handlers immediately, and ALWAYS settle both writes before
  // returning/throwing. Otherwise caller's finally could retire an in-flight fixture.
  const settled = promise => promise.then(value => ({ value }), error => ({ error }));
  const pending = [settled(q(`${pre} ${holderSql}; select pg_sleep(7); commit;`))];
  try {
    await pause(2000);
    pending.push(settled(q(`/* ${needle} */ ${pre} ${racerSql}; commit;`)));
    let waits = [];
    for (let attempt = 0; attempt < 12; attempt++) {
      const probe = await q(`select l.locktype from pg_locks l join pg_stat_activity a on a.pid=l.pid
        where not l.granted and a.query like ${lit(`%${needle}%`)} and a.query not like '%pg_locks%'`);
      if (!probe.ok) throw new Error('Lock observation unavailable');
      if (probe.rows.length) { waits = probe.rows.map(row => row.locktype); break; }
      await pause(300);
    }
    const results = await Promise.all(pending);
    if (results.some(result => result.error)) throw new Error('Race request failed');
    return { h: results[0].value, r: results[1].value, waits };
  } finally { await Promise.all(pending); }
}

export async function one(q, sql) {
  const result = await q(sql);
  if (!result.ok || result.rows.length !== 1) throw new Error(`Catalog query refused: ${result.code ?? 'unexpected_shape'}`);
  return result.rows[0];
}
