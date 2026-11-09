/** Migration 0295 proof: in-memory PGlite only, synthetic rows, no credentials/network. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const migration = read("0295_toast_legacy_retire.sql");
const salesDDL = read("0147_toast_sales_ingest.sql");
const depletionDDL = read("0166_toast_daily_depletion.sql");
// Execute the REAL definitions, including numeric, UUID, date, text, constraints
// and RLS. Only unrelated prerequisite tables are reduced to their UUID keys.
const signalsDDL = read("0182_par_rhythm_and_ledger.sql").match(
  /CREATE TABLE IF NOT EXISTS public\.toast_daily_sales_signals \([\s\S]*?\n\);/,
)?.[0];
assert.ok(signalsDDL, "0182 signals table definition found");
const shopA = "54ce1029-400e-4a92-9c2b-0ccb3b031f0a";
const shopB = "d2cced11-b167-49fa-bab6-86ec9bf4ff09";
const otherShop = "00000000-0000-4000-8000-000000000001";
const tables = ["toast_sales_events", "toast_daily_depletion", "toast_daily_sales_signals"];
let checks = 0;
function check(ok, label) { assert.ok(ok, label); checks++; console.log(`ok ${label}`); }

async function seed(db, fixtureCount) {
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.locations (id uuid primary key);
    create table public.vendor_items (id uuid primary key);
    insert into public.locations values ('${shopA}'), ('${shopB}'), ('${otherShop}');
    ${salesDDL}
    ${depletionDDL}
    ${signalsDDL}
    grant select, insert, update, delete on public.toast_sales_events,
      public.toast_daily_depletion, public.toast_daily_sales_signals
      to anon, authenticated, service_role, public;
    insert into public.toast_sales_events
      (location_id, business_date, check_guid, selection_guid, toast_item_guid, item_name, quantity, snapshot_version)
    select case when i <= 7 then '${shopA}'::uuid else '${shopB}'::uuid end,
      case when i <= 7 then date '2026-08-01' else date '2026-08-06' end,
      'check-' || (1 + (i % 4)), 'sel-' || i, 'fixture-item', 'fixture', 1, 1
    from generate_series(1, ${fixtureCount}) i;
    -- Same day with a real check, same tag at another shop, same tag on another day,
    -- and the two authorized shops paired with the WRONG date must all survive.
    insert into public.toast_sales_events
      (location_id, business_date, check_guid, selection_guid, toast_item_guid, item_name, quantity, snapshot_version)
    values
      ('${shopA}', '2026-08-01', 'real-check', 'keep1', 'item', 'real', 1, 1),
      ('${otherShop}', '2026-08-01', 'check-1', 'keep2', 'item', 'real', 1, 1),
      ('${shopA}', '2026-08-02', 'check-1', 'keep3', 'item', 'real', 1, 1),
      ('${shopA}', '2026-08-06', 'check-1', 'keep4', 'item', 'real', 1, 1),
      ('${shopB}', '2026-08-01', 'check-1', 'keep5', 'item', 'real', 1, 1);
    insert into public.vendor_items select gen_random_uuid() from generate_series(1, 67);
    insert into public.toast_daily_depletion (location_id, business_date, sku_id, direct_oz, flattened_oz)
      select s.id, s.day, v.id, 1.25, 2.75 from public.vendor_items v cross join
      (values ('${shopA}'::uuid, date '2026-08-01'), ('${shopB}'::uuid, date '2026-08-06')) s(id,day);
    insert into public.toast_daily_sales_signals (location_id, business_date, counted_qty)
      values ('${shopA}', '2026-08-01', 1.5);
  `);
}
async function snapshot(db, table) {
  return (await db.query(`select * from public.${table} order by id`)).rows;
}

const db = new PGlite();
try {
  await seed(db, 14);
  const beforeSales = await snapshot(db, tables[0]);
  const beforeDepletion = await snapshot(db, tables[1]);
  const beforeSignals = await snapshot(db, tables[2]);
  await db.exec(migration);
  assert.deepEqual(await snapshot(db, tables[0]), beforeSales.filter(r => r.selection_guid.startsWith("keep")));
  check(true, "exactly 14 fixture selections deleted; all 5 non-fixture controls unchanged");
  assert.equal(beforeDepletion.length, 134);
  assert.deepEqual(await snapshot(db, tables[1]), beforeDepletion);
  assert.deepEqual(await snapshot(db, tables[2]), beforeSignals);
  check(true, "all 134 unproven depletion rows and signals remain byte-for-byte unchanged");
  for (const table of tables) {
    for (const role of ["anon", "authenticated"]) {
      const privileges = (await db.query(`select
        has_table_privilege($1, $2, 'INSERT') as i,
        has_table_privilege($1, $2, 'UPDATE') as u,
        has_table_privilege($1, $2, 'DELETE') as d,
        has_table_privilege($1, $2, 'SELECT') as s`, [role, `public.${table}`])).rows[0];
      check(!privileges.i && !privileges.u && !privileges.d && privileges.s, `${role}/${table}: writes revoked, SELECT kept (including inherited PUBLIC grants)`);
      await db.exec(`set role ${role}`);
      try {
        for (const sql of [
          `insert into public.${table} default values`,
          `update public.${table} set business_date = business_date`,
          `delete from public.${table}`,
        ]) {
          await assert.rejects(db.exec(sql), e => e.code === "42501", `${role} write denied`);
          checks++;
        }
      } finally { await db.exec("reset role"); }
    }
    const service = (await db.query(`select bool_and(has_table_privilege('service_role', $1, privilege)) as ok
      from unnest(array['SELECT','INSERT','UPDATE','DELETE']) privilege`, [`public.${table}`])).rows[0];
    check(service.ok, `${table}: service_role unchanged`);
  }
} finally { await db.close(); }

for (const count of [13, 15]) {
  const mismatch = new PGlite();
  try {
    await seed(mismatch, count);
    const before = await snapshot(mismatch, tables[0]);
    await assert.rejects(mismatch.exec(migration), /0295 fixture manifest mismatch/);
    await mismatch.exec("rollback");
    assert.deepEqual(await snapshot(mismatch, tables[0]), before);
    check(true, `${count} fixtures: count guard aborts and rolls back every deletion`);
    check((await mismatch.query("select has_table_privilege('anon', 'public.toast_sales_events', 'INSERT') as ok")).rows[0].ok,
      `${count} fixtures: failed migration leaves grants unchanged`);
  } finally { await mismatch.close(); }
}
console.log(`PASS: ${checks} checks; no external database accessed.`);
