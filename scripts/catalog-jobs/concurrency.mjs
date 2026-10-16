import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { collide, lit, json, one, joined } from './management-api.mjs';

const line = (sku, quantity = 4) => [{ component_sku_id: sku, quantity, unit: 'oz', portioned: false }];
const pack = { levels: [{ label: 'case', containsQty: 16, containsMeasureUnit: 'oz' }] };
const price = { unitPrice: 8, effectiveDate: '2020-01-01' };
const tx = sql => `begin; set local statement_timeout='30s'; ${sql}; commit;`;

/** SQL builders are exported so local PGlite tests execute the EXACT future SIM statements. */
export const skuCall = (name, actor, shop, number = /** @type {string|null} */ (null), request = randomUUID()) =>
  `select create_catalog_sku(${json({ name, itemNumber: number, request_id: request })},${json(pack)},${json(price)},${lit(actor)},${lit(shop)}) result`;
export function fixtureSql(f) {
  return tx(`do $$ declare k uuid; n uuid; t uuid; r jsonb; begin
    k := (create_catalog_sku(${json({ name: `${f.prefix}-old` })},${json(pack)},${json(price)},${lit(f.actor)},null)->>'id')::uuid;
    n := (create_catalog_sku(${json({ name: `${f.prefix}-new` })},${json(pack)},${json(price)},${lit(f.actor)},null)->>'id')::uuid;
    t := (create_catalog_sku(${json({ name: `${f.prefix}-third` })},${json(pack)},${json(price)},${lit(f.actor)},null)->>'id')::uuid;
    insert into products(id,name) values(${lit(f.product)},${lit(f.prefix)});
    update vendor_items set product_id=${lit(f.product)} where id in(k,n,t);
    insert into product_primaries(product_id,primary_sku_id,location_id,updated_by,note)
      values(${lit(f.product)},k,${lit(f.shop)},${lit(f.actor)},'F4 original');
    insert into product_primaries(product_id,primary_sku_id,updated_by) values(${lit(f.product)},k,${lit(f.actor)});
    r := create_shop_sandwich(${json({ name: `${f.prefix}-menu`, menu_price: 12 })},
      ${json({ name: `${f.prefix}-recipe`, recipe_type: 'consumer', batch_yield: 1 })},
      jsonb_build_array(jsonb_build_object('component_sku_id',k,'quantity',4,'unit','oz','portioned',false)),${lit(f.actor)},null);
  end $$`);
}
export async function readFixture(q, f) {
  return { ...f, ...await one(q, `select
    (select id from vendor_items where name=${lit(`${f.prefix}-old`)}) old,
    (select id from vendor_items where name=${lit(`${f.prefix}-new`)}) replacement,
    (select id from vendor_items where name=${lit(`${f.prefix}-third`)}) third,
    (select id from recipes where name=${lit(`${f.prefix}-recipe`)}) recipe`) };
}
export function startSql(f) {
  return `with snapshots as (select sku_swap_product_snapshot(${lit(f.old)},${lit(f.replacement)},${lit(f.shop)}) p,
    sku_swap_recipe_snapshot(${lit(f.old)},${lit(f.replacement)},${lit(f.shop)}) r),
    transformed as (select p,(select jsonb_agg(x || jsonb_build_object('replacement_lines',
      (select jsonb_agg(l || jsonb_build_object('component_sku_id',case when l->>'component_sku_id'=${lit(f.old)} then ${lit(f.replacement)} else l->>'component_sku_id' end)) from jsonb_array_elements(x->'lines') l))) from jsonb_array_elements(r) x) r from snapshots)
    select start_sku_swap(${lit(f.old)},${lit(f.replacement)},${lit(f.shop)},${lit(f.actor)},p,r,true,'F4 concurrency') result from transformed`;
}
export const backSql = (f, swap) => `select end_sku_swap(${lit(swap)},${lit(f.actor)}) result`;
export const primarySql = f => `update product_primaries set primary_sku_id=${lit(f.third)},updated_by=${lit(f.actor)},note='F4 independent choice',updated_at=clock_timestamp() where product_id=${lit(f.product)} and location_id=${lit(f.shop)} returning id`;
export function saveSql(f, quantity, shop = null) {
  const lines = json(line(f.old, quantity));
  return `select save_recipe_version(${lit(f.recipe)},${lit(shop)},${lines},
    (select id from recipe_versions where recipe_id=${lit(f.recipe)} and location_id is not distinct from ${lit(shop)}::uuid and active),
    case when ${lit(shop)}::uuid is not null then (select id from recipe_versions where recipe_id=${lit(f.recipe)} and location_id is null and active) else null end,
    'F4 save',${lit(f.actor)},null,null,null,recipe_change_snapshot(${lit(f.recipe)},${lit(shop)},${lines})) result`;
}
export function retireSql(prefix) {
  // Only this run's random prefix. History/journals/packs/prices remain append-only.
  return tx(`update recipes set active=false where name like ${lit(`${prefix}%`)};
    update menu_items set active=false where name like ${lit(`${prefix}%`)};
    update items set active=false where name like ${lit(`${prefix}%`)};
    update vendor_items set active=false where name like ${lit(`${prefix}%`)};
    update products set active=false where name like ${lit(`${prefix}%`)}`);
}

export async function runCatalogApiEvidence({ q, actor, shop, check, primaryRequest, collision = collide }) {
  const prefix = `F4-catalog-${randomUUID()}`;
  check('fixture.run-prefix', true, prefix);
  const ensure = async sql => { const r = await q(sql); if (!r.ok) throw new Error(`Catalog evidence SQL: ${r.code}`); return r; };
  const fixture = async label => {
    const f = { prefix: `${prefix}-${label}`, actor, shop, product: randomUUID() };
    await ensure(fixtureSql(f)); return readFixture(q, f);
  };
  const start = async f => (await one(q, startSql(f))).result.swap_id;
  const state = (f, swap) => one(q, `select
    (select primary_sku_id from product_primaries where product_id=${lit(f.product)} and location_id=${lit(shop)}) primary,
    (select outcome->>'primary' from sku_swap_ends where swap_id=${lit(swap)}) outcome,
    (select count(*)::int from sku_swap_ends where swap_id=${lit(swap)}) ends`);
  const waiting = (result, label) => {
    check(`${label}.holder-success`, result.h.ok);
    check(`${label}.lock-observed`, result.waits.length > 0);
    check(`${label}.racer-waited`, result.r.ms >= 3000);
  };
  try {
    const rollback = await one(q, readFileSync(new URL('./sim-scenario.sql', import.meta.url), 'utf8'));
    check('rollback.marker-and-identity-counts', rollback.marker === 'catalog_rollback_marker' && rollback.identity_counts_unchanged === true);

    const duplicate = await collision(q, skuCall(`${prefix}-duplicate`, actor, shop, `${prefix}-number`), skuCall(`${prefix}-duplicate-racer`, actor, shop, ` ${prefix.toUpperCase()}-NUMBER `));
    waiting(duplicate, 'duplicate');
    check('duplicate.named-refusal', !duplicate.r.ok && duplicate.r.code === 'shop_owned:item_number_taken');
    const duplicates = await one(q, `select count(*)::int n from vendor_items where lower(btrim(item_number))=${lit(`${prefix}-number`.toLowerCase())}`);
    check('duplicate.one-persisted', duplicates.n === 1);

    // A fresh owned recipe per ordering; share and the owner-bound edit use the actual RPCs.
    for (const order of ['share-first', 'edit-first', 'stress']) {
      const f = await fixture(order);
      const owned = await one(q, `select create_shop_recipe(${json({ name: `${f.prefix}-owned`, recipe_type: 'production', batch_yield: 1 })},${json(line(f.old))},
        jsonb_build_array(jsonb_build_object('yield',1,'new_item',jsonb_build_object('name',${lit(`${f.prefix}-output`)},'section',(select slug from prep_sections where active order by slug limit 1)))),${lit(actor)},${lit(shop)}) result`);
      const recipe = owned.result.id, item = owned.result.output_item_ids[0];
      const share = `select share_shop_recipe(${lit(recipe)},${lit(shop)},${lit(actor)},array[${lit(item)}::uuid],'{}'::uuid[]) result`;
      const lines = json(line(f.old, 9));
      const edit = `select save_owned_recipe_version(${lit(recipe)},${lit(shop)},${lines},(select id from recipe_versions where recipe_id=${lit(recipe)} and location_id is null and active),${lit(actor)},recipe_change_snapshot(${lit(recipe)},null,${lines})) result`;
      if (order !== 'stress') {
        const result = await collision(q, order === 'share-first' ? share : edit, order === 'share-first' ? edit : share);
        waiting(result, order);
        check(`${order}.racer-outcome`, order === 'share-first' ? !result.r.ok && result.r.code === 'shop_owned:ownership_changed' : result.r.ok);
      } else {
        const results = await joined([q(share), q(edit)]);
        check('share-stress.success-and-only-authorized-refusal', results[0].ok && (results[1].ok || results[1].code === 'shop_owned:ownership_changed'));
      }
      const persisted = await one(q, `select location_id,(select quantity::float from recipe_inputs where recipe_id=${lit(recipe)} limit 1) qty from recipes where id=${lit(recipe)}`);
      check(`${order}.shared-persisted`, persisted.location_id === null);
      check(`${order}.quantity-persisted`, order === 'share-first' ? persisted.qty === 4 : order === 'edit-first' ? persisted.qty === 9 : [4,9].includes(persisted.qty));
    }

    for (const order of ['restore-first', 'primary-first']) {
      const f = await fixture(order), swap = await start(f);
      if (order === 'restore-first') {
        const result = await collision(q, backSql(f, swap), primarySql(f));
        waiting(result, order); check('restore-first.primary-success', result.r.ok);
      } else {
        // Row-first primary writes intentionally cause NOWAIT, not a deadlock or blind overwrite.
        const result = await collision(q, primarySql(f), backSql(f, swap));
        check('primary-first.holder-success', result.h.ok);
        check('primary-first.nowait', !result.r.ok && result.r.code === 'swap:dependencies_busy' && result.r.ms < 4000);
        const before = await state(f, swap); check('primary-first.refusal-no-end', before.ends === 0);
        if (!result.r.ok) await ensure(backSql(f, swap));
      }
      const persisted = await state(f, swap);
      check(`${order}.primary-preserved`, persisted.primary === f.third && persisted.ends === 1 && persisted.outcome === (order === 'restore-first' ? 'restored' : 'changed_since'));
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const f = await fixture(`primary-stress-${attempt}`), swap = await start(f);
      // Actual Session /primary route is exercised here, including its own graph-lock schedule.
      const [back, primary] = await joined([q(backSql(f, swap)), primaryRequest(f.product, f.third)]);
      check(`primary-stress-${attempt}.primary-http-success`, primary.status === 200);
      check(`primary-stress-${attempt}.back-success-or-busy`, back.ok || back.code === 'swap:dependencies_busy');
      if (!back.ok && back.code === 'swap:dependencies_busy') await ensure(backSql(f, swap));
      const persisted = await state(f, swap);
      check(`primary-stress-${attempt}.choice-and-end-persisted`, persisted.primary === f.third && persisted.ends === 1);
    }

    const changed = await fixture('default-change'), swap = await start(changed);
    await ensure(saveSql(changed, 19));
    await ensure(backSql(changed, swap));
    const restored = await one(q, `select
      (select quantity::float from recipe_inputs where recipe_id=${lit(changed.recipe)} limit 1) global_qty,
      (select l.quantity::float from recipe_versions v join recipe_version_lines l on l.version_id=v.id where v.recipe_id=${lit(changed.recipe)} and v.location_id=${lit(shop)} and v.active limit 1) shop_qty`);
    check('default-change.exact-inherited-restore', restored.global_qty === 19 && restored.shop_qty === 4);

    const busy = await fixture('dependency-busy');
    // Lock a SKU row WITHOUT the graph advisory lock. Updating updated_at is a real
    // write and does not fire the ownership trigger; holder commits after sleep.
    const result = await collision(q, `update vendor_items set updated_at=clock_timestamp() where id=${lit(busy.old)}`, saveSql(busy, 7, shop));
    check('dependencies-busy.holder-success', result.h.ok);
    check('dependencies-busy.named-immediate-refusal', !result.r.ok && result.r.code === 'recipe_version:dependencies_busy' && result.r.ms < 4000);
    const before = await one(q, `select count(*)::int n from recipe_versions where recipe_id=${lit(busy.recipe)} and location_id=${lit(shop)} and active`);
    check('dependencies-busy.no-version-on-refusal', before.n === 0);
    await ensure(saveSql(busy, 7, shop));
    const after = await one(q, `select l.quantity::float qty from recipe_versions v join recipe_version_lines l on l.version_id=v.id where v.recipe_id=${lit(busy.recipe)} and v.location_id=${lit(shop)} and v.active`);
    check('dependencies-busy.released-positive-control', after.qty === 7);
  } finally {
    // Every request above is awaited before retirement; never delete journal evidence.
    const live = await q(`select s.id from sku_swaps s join vendor_items v on v.id=s.old_sku_id where v.name like ${lit(`${prefix}%`)} and not exists(select 1 from sku_swap_ends e where e.swap_id=s.id)`);
    if (!live.ok) throw new Error('Catalog live swap cleanup read failed');
    for (const swap of live.rows) {
      const ended = await q(`select end_sku_swap(${lit(swap.id)},${lit(actor)}) result`);
      check('fixture.pending-swap-ended', ended.ok);
      if (!ended.ok) throw new Error('Catalog pending swap cleanup failed');
    }
    const cleanup = await q(retireSql(prefix));
    check('fixture.retired', cleanup.ok);
    if (!cleanup.ok) throw new Error('Catalog fixture retirement failed');
    const active = await one(q, `select (select count(*) from vendor_items where active and name like ${lit(`${prefix}%`)})+
      (select count(*) from recipes where active and name like ${lit(`${prefix}%`)})+
      (select count(*) from menu_items where active and name like ${lit(`${prefix}%`)})+
      (select count(*) from products where active and name like ${lit(`${prefix}%`)})+
      (select count(*) from items where active and name like ${lit(`${prefix}%`)}) as n`);
    check('fixture.no-active-identities', Number(active.n) === 0);
  }
}
