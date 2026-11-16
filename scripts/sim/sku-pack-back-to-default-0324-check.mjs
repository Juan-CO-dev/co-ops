/** FILE ONLY: CC runs after 0324 on SIM. Never loads .env or a direct DB URL. The builder did NOT run it.
 * SUPABASE_ACCESS_TOKEN=<operator environment>; node scripts/sim/sku-pack-back-to-default-0324-check.mjs --ref=jepgzucrvklhqpthowsc
 * The proof of 0324 apply_sku_pack_back_to_default (audit W18/B107) on the REAL sim schema, which the PGlite
 * harness (scripts/sql-harness-0324.mjs) stands in for with a stub schema:
 *   B1  a shop with its own case (8 bags) and a human par of 4 goes back to the default case (4 bags) and the
 *       accepted conversion lands in the same call: the shop's version retired, no live own version, par 8,
 *       pack epoch moved, the global par untouched;
 *   B2  a conversion bound to a value the shop no longer has refuses par_changed and the version stays live;
 *   B3  a par lane that moved after the preview's snapshot refuses dependencies_changed;
 *   B6  anon / authenticated cannot execute the apply; nobody but the owner can call the internal loop.
 * EVERYTHING runs inside ONE transaction that ends in ROLLBACK: the fixture (two shops, one SKU, its versions and
 * overlay rows, all tagged SIM-0324-<uuid>) is never committed, so nothing needs retiring afterwards. A failed
 * check raises inside the transaction (the request fails, the transaction is gone). No retries.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { literal as q, managementQuery, projectRef } from '../supabase-management-query.mjs';

export const signatures = [
  'public.apply_sku_pack_back_to_default(uuid,uuid,uuid,uuid,jsonb,jsonb)',
  'public.sku_pack_apply_par_changes(uuid,uuid,jsonb,uuid)',
  'public.save_sku_pack_version(uuid,uuid,jsonb,uuid,uuid,text,uuid,boolean)',
  'public.sku_pack_change_snapshot(uuid,uuid[])',
];
export const inserted = {
  locations: ['id', 'name', 'code', 'type', 'active'],
  vendor_items: ['id', 'name', 'active', 'weekday_par'],
  location_sku_settings: ['location_id', 'sku_id', 'weekday_par'],
};

export async function preflight(query) {
  const rows = await query(`begin read only; set local statement_timeout='10s';
    select signature, to_regprocedure(signature) is not null as present from unnest(array[${signatures.map(q).join(',')}]::text[]) as s(signature); commit;`);
  assert.ok(signatures.every((sig) => rows.some((r) => r.signature === sig && r.present === true)), '0324 (and 0259/0261) functions must be present');
  const grants = await query(`select
    has_function_privilege('anon', 'public.apply_sku_pack_back_to_default(uuid,uuid,uuid,uuid,jsonb,jsonb)'::regprocedure, 'EXECUTE') as anon_apply,
    has_function_privilege('authenticated', 'public.apply_sku_pack_back_to_default(uuid,uuid,uuid,uuid,jsonb,jsonb)'::regprocedure, 'EXECUTE') as auth_apply,
    has_function_privilege('service_role', 'public.apply_sku_pack_back_to_default(uuid,uuid,uuid,uuid,jsonb,jsonb)'::regprocedure, 'EXECUTE') as svc_apply,
    has_function_privilege('service_role', 'public.sku_pack_apply_par_changes(uuid,uuid,jsonb,uuid)'::regprocedure, 'EXECUTE') as svc_loop,
    has_function_privilege('authenticated', 'public.sku_pack_apply_par_changes(uuid,uuid,jsonb,uuid)'::regprocedure, 'EXECUTE') as auth_loop`);
  const g = grants[0] ?? {};
  assert.equal(g.anon_apply, false, 'B6: anon must not execute the apply');
  assert.equal(g.auth_apply, false, 'B6: authenticated must not execute the apply');
  assert.equal(g.svc_apply, true, 'service_role must execute the apply');
  assert.equal(g.svc_loop, false, 'B6: service_role must not call the internal loop');
  assert.equal(g.auth_loop, false, 'B6: authenticated must not call the internal loop');
  // The fixture inserts only the columns above: every other NOT NULL column must have a default.
  const cols = await query(`select table_name, column_name, is_nullable, column_default, is_identity, is_generated from information_schema.columns
    where table_schema='public' and table_name in (${Object.keys(inserted).map(q).join(',')})`);
  for (const [table, names] of Object.entries(inserted)) for (const c of names) {
    assert.ok(cols.some((r) => r.table_name === table && r.column_name === c), `fixture column ${table}.${c} must exist`);
  }
  for (const c of cols) {
    assert.ok(c.is_nullable !== 'NO' || c.column_default != null || c.is_identity === 'YES' || c.is_generated === 'ALWAYS'
      || inserted[c.table_name]?.includes(c.column_name), `fixture schema requires ${c.table_name}.${c.column_name}: extend the fixture`);
  }
}

export function fixture() {
  const f = Object.fromEntries(['s1', 's2', 'sku'].map((k) => [k, randomUUID()]));
  f.tag = `SIM-0324-${f.sku}`;
  return f;
}

const DEFAULT_CASE = JSON.stringify([{ label: 'case', containsQty: 4, containsIndex: 1 }, { label: 'bag', containsQty: 24, containsMeasureUnit: 'oz' }]);
const SHOP_CASE = JSON.stringify([{ label: 'case', containsQty: 8, containsIndex: 1 }, { label: 'bag', containsQty: 24, containsMeasureUnit: 'oz' }]);
const patch = (to) => JSON.stringify({ weekday_par: to, auto_weekday_par: null, auto_weekday_baseline_par: null, auto_weekday_applied_at: null, pinned_weekday_at: null });

/** The whole proof as ONE statement list ending in ROLLBACK. */
export function proofSQL(f) {
  const conv = (expected, to) => `jsonb_build_array(jsonb_build_object('location_id', ${q(f.s1)}, 'slot', 'weekday', 'expected', ${expected}, 'to', ${to}, 'inherited', false, 'from', null, 'patch', ${q(patch(to))}::jsonb))`;
  return `begin;
    set local statement_timeout = '30s';
    insert into public.locations(id, name, code, type, active) values
      (${q(f.s1)}, ${q(f.tag + '-1')}, ${q(f.tag + '-1')}, 'permanent', true),
      (${q(f.s2)}, ${q(f.tag + '-2')}, ${q(f.tag + '-2')}, 'permanent', true);
    insert into public.vendor_items(id, name, active, weekday_par) values (${q(f.sku)}, ${q(f.tag)}, true, 3);
    insert into public.location_sku_settings(location_id, sku_id, weekday_par) values (${q(f.s1)}, ${q(f.sku)}, 4);
    do $$
    declare
      v_g jsonb; v_s jsonb; v_snap jsonb; v_r jsonb; v_e0 integer; v_e1 integer; v_ok boolean;
    begin
      v_g := public.save_sku_pack_version(${q(f.sku)}, null, ${q(DEFAULT_CASE)}::jsonb, null, null, null, null, false);
      v_s := public.save_sku_pack_version(${q(f.sku)}, ${q(f.s1)}, ${q(SHOP_CASE)}::jsonb, null, (v_g->>'version_id')::uuid, null, null, false);
      -- B2: a stale expected value refuses and leaves the version live.
      v_snap := public.sku_pack_change_snapshot(${q(f.sku)}, array[${q(f.s1)}]::uuid[]);
      v_ok := false;
      begin
        perform public.apply_sku_pack_back_to_default(${q(f.sku)}, ${q(f.s1)}, (v_s->>'version_id')::uuid, null, ${conv(5, 8)}, v_snap);
      exception when others then
        v_ok := sqlerrm like '%sku_pack_change:par_changed%';
      end;
      if not v_ok then raise exception 'B2 failed: expected par_changed'; end if;
      if not exists (select 1 from public.sku_pack_versions where id = (v_s->>'version_id')::uuid and active) then raise exception 'B2 failed: version retired'; end if;
      -- B3: a par lane that moved after the snapshot refuses dependencies_changed.
      update public.location_sku_settings set weekday_par = 6 where sku_id = ${q(f.sku)} and location_id = ${q(f.s1)};
      v_ok := false;
      begin
        perform public.apply_sku_pack_back_to_default(${q(f.sku)}, ${q(f.s1)}, (v_s->>'version_id')::uuid, null, '[]'::jsonb, v_snap);
      exception when others then
        v_ok := sqlerrm like '%sku_pack_change:dependencies_changed%';
      end;
      if not v_ok then raise exception 'B3 failed: expected dependencies_changed'; end if;
      update public.location_sku_settings set weekday_par = 4 where sku_id = ${q(f.sku)} and location_id = ${q(f.s1)};
      -- B1: the atomic Back to default with the accepted conversion.
      v_e0 := coalesce((select epoch::int from public.sku_pack_epochs where sku_id = ${q(f.sku)} and location_id = ${q(f.s1)}), 0);
      v_snap := public.sku_pack_change_snapshot(${q(f.sku)}, array[${q(f.s1)}]::uuid[]);
      v_r := public.apply_sku_pack_back_to_default(${q(f.sku)}, ${q(f.s1)}, (v_s->>'version_id')::uuid, null, ${conv(4, 8)}, v_snap);
      if (v_r->>'pars_converted')::int <> 1 then raise exception 'B1 failed: pars_converted %', v_r; end if;
      if exists (select 1 from public.sku_pack_versions where sku_id = ${q(f.sku)} and location_id = ${q(f.s1)} and active) then raise exception 'B1 failed: S1 still has a live own version'; end if;
      if (select weekday_par from public.location_sku_settings where sku_id = ${q(f.sku)} and location_id = ${q(f.s1)}) <> 8 then raise exception 'B1 failed: par not converted'; end if;
      v_e1 := coalesce((select epoch::int from public.sku_pack_epochs where sku_id = ${q(f.sku)} and location_id = ${q(f.s1)}), 0);
      if v_e1 <= v_e0 then raise exception 'B1 failed: pack epoch did not move'; end if;
      if (select weekday_par from public.vendor_items where id = ${q(f.sku)}) <> 3 then raise exception 'B1 failed: global par moved'; end if;
    end $$;
    rollback;`;
}

export async function runProof(query, log = console.log) {
  await preflight(query);
  log('PASS preflight: 0324 present, ACL as designed (B6), fixture columns covered');
  const f = fixture();
  log(`FIXTURE (rolled back, never committed) ${JSON.stringify(f)}`);
  await query(proofSQL(f));
  log('PASS B1 atomic Back to default + conversion, B2 par_changed refusal, B3 dependencies_changed refusal (all inside one rolled-back transaction)');
  const left = await query(`select exists(select 1 from public.vendor_items where id=${q(f.sku)}) as leaked`);
  assert.equal(left[0]?.leaked, false, 'the rolled-back fixture must not exist');
  log('PASS nothing committed');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(() => {
    const ref = projectRef(process.argv.slice(2), true);
    return runProof(managementQuery(ref, process.env.SUPABASE_ACCESS_TOKEN));
  }).catch(() => {
    console.error('FAIL 0324 Management API proof: check SIM target, preflight, connectivity and invariants');
    process.exitCode = 1;
  });
}
