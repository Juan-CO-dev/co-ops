import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { migratedShopOwnedDb, SHOP_OWNED_ID as I } from './fixtures/shop-owned-pglite';
import { fixtureSql, readFixture, startSql, backSql, primarySql, saveSql, retireSql, skuCall, runCatalogApiEvidence } from '../scripts/catalog-jobs/concurrency.mjs';
let db: PGlite;
afterEach(async () => { await db?.close(); });
async function setup() { db = await migratedShopOwnedDb(); await db.exec("alter table users add column active boolean not null default true"); await db.exec(readFileSync('supabase/migrations/0265_sku_swaps.sql', 'utf8')); }
const query = async (sql: string) => { const results = await db.exec(sql); return { ok: true, rows: results.at(-1)?.rows ?? [] }; };
async function fixture() {
  const f = { prefix: `F4-test-${randomUUID()}`, actor: I.actor, shop: I.shopA, product: randomUUID() };
  await db.exec(fixtureSql(f)); return readFixture(query, f);
}
describe('future SIM SQL executes against actual migrations locally', () => {
  it('rollback-only scenario verifies exact marker and removes all identities', async () => {
    await setup();
    const before = await db.query('select id from vendor_items order by id');
    const results = await db.exec(readFileSync('scripts/catalog-jobs/sim-scenario.sql', 'utf8'));
    expect(results.flatMap(result => result.rows)).toContainEqual({ marker: 'catalog_rollback_marker', identity_counts_unchanged: true });
    expect((await db.query('select id from vendor_items order by id')).rows).toEqual(before.rows);
  });
  it.each(['primary-first', 'restore-first'])('proves persisted %s serial order using the SIM SQL', async order => {
    await setup(); const f = await fixture();
    const swap = (await db.query<{ result: { swap_id: string } }>(startSql(f))).rows[0]!.result.swap_id;
    if (order === 'primary-first') await db.exec(primarySql(f));
    const back = (await db.query<{ result: { primary: string } }>(backSql(f, swap))).rows[0]!.result;
    if (order === 'restore-first') await db.exec(primarySql(f));
    expect(back.primary).toBe(order === 'primary-first' ? 'changed_since' : 'restored');
    expect((await db.query<{ primary_sku_id: string }>('select primary_sku_id from product_primaries where product_id=$1 and location_id=$2', [f.product, f.shop])).rows[0]!.primary_sku_id).toBe(f.third);
    await db.exec(retireSql(f.prefix));
    expect((await db.query('select id from vendor_items where product_id=$1 and active', [f.product])).rows).toHaveLength(0);
    expect((await db.query('select id from sku_swap_ends where swap_id=$1', [swap])).rows).toHaveLength(1);
  });
  it('restores saved inherited quantity after a changed global default', async () => {
    await setup(); const f = await fixture();
    const swap = (await db.query<{ result: { swap_id: string } }>(startSql(f))).rows[0]!.result.swap_id;
    await db.exec(saveSql(f, 19)); await db.exec(backSql(f, swap));
    expect(Number((await db.query<{ quantity: string }>('select quantity from recipe_inputs where recipe_id=$1', [f.recipe])).rows[0]!.quantity)).toBe(19);
    expect(Number((await db.query<{ quantity: string }>('select l.quantity from recipe_versions v join recipe_version_lines l on l.version_id=v.id where v.recipe_id=$1 and v.location_id=$2 and v.active', [f.recipe, f.shop])).rows[0]!.quantity)).toBe(4);
  });
  it('uses cooperating job normalization and persists exactly one identity', async () => {
    await setup(); const name = `F4-test-${randomUUID()}`;
    await db.exec(skuCall(name, I.actor, I.shopA, name));
    await expect(db.exec(skuCall(name, I.actor, I.shopA, ` ${name.toUpperCase()} `))).rejects.toThrow('shop_owned:item_number_taken');
    expect((await db.query('select id from vendor_items where name=$1', [name])).rows).toHaveLength(1);
  });
  it('executes every runner SQL path sequentially without claiming lock evidence', async () => {
    await setup();
    const checks: { name: string; passed: boolean }[] = [];
    const q = async (sql: string) => {
      try { const rows = await db.exec(sql); return { ok: true, rows: rows.at(-1)?.rows ?? [], code: null, ms: 0 }; }
      catch (error) { await db.exec('rollback'); return { ok: false, rows: [], code: (error as Error).message.match(/(?:shop_owned|recipe_version|swap):[a-z_]+/)?.[0] ?? 'unknown', ms: 0 }; }
    };
    // PGlite has ONE connection. This adapter exercises the emitted statements
    // and all persisted assertions; timing/lock assertions must remain FALSE.
    const collision = async (query: typeof q, holder: string, racer: string) => ({ h: await query(holder), r: await query(racer), waits: [] as string[] });
    await runCatalogApiEvidence({ q, actor: I.actor, shop: I.shopA,
      check: (name: string, passed: boolean) => { checks.push({ name, passed }); }, collision,
      primaryRequest: async (product: string, sku: string) => {
        await db.query('update product_primaries set primary_sku_id=$1 where product_id=$2 and location_id=$3', [sku, product, I.shopA]);
        return { status: 200 };
      } });
    const noConcurrency = (name: string) => /lock-observed|racer-waited|primary-first.nowait|primary-first.refusal-no-end|dependencies-busy.named-immediate-refusal|dependencies-busy.no-version-on-refusal/.test(name);
    expect(checks.filter(row => noConcurrency(row.name)).every(row => !row.passed)).toBe(true);
    expect(checks.filter(row => !noConcurrency(row.name) && !row.passed)).toEqual([]);
    expect(checks.filter(row => row.passed).length).toBeGreaterThan(30);
  });
});
