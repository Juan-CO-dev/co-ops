/** Migration 0295 proof: in-memory PGlite only, synthetic rows, no credentials/network. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const migration = read("0295_toast_legacy_retire.sql");
const tables = ["toast_sales_events", "toast_daily_depletion", "toast_daily_sales_signals"];
// Execute real table definitions, indexes, policies, RLS and ACL statements.
// Unrelated prerequisite tables are reduced to their UUID keys. Strip comments
// before splitting these three migrations' plain table statements (no functions).
const tableDDL = (file, table) => {
  const statements = read(file).replace(/--[^\n]*/g, "").split(";");
  const selected = statements.filter(sql => new RegExp(`\\bpublic\\.${table}\\b`, "i").test(sql)
    && /^\s*(create\s+(table|index|policy)|alter\s+table|revoke|grant)\b/i.test(sql));
  assert.ok(selected.some(sql => /create\s+table/i.test(sql)), `${table}: CREATE TABLE found`);
  assert.ok(selected.some(sql => /enable row level security/i.test(sql)), `${table}: RLS found`);
  return selected.join(";\n") + ";";
};
const ddl = [
  tableDDL("0147_toast_sales_ingest.sql", tables[0]),
  tableDDL("0166_toast_daily_depletion.sql", tables[1]),
  tableDDL("0182_par_rhythm_and_ledger.sql", tables[2]),
].join("\n");
const shopA = "54ce1029-400e-4a92-9c2b-0ccb3b031f0a";
const shopB = "d2cced11-b167-49fa-bab6-86ec9bf4ff09";
const otherShop = "00000000-0000-4000-8000-000000000001";
const prod = [[shopA, "2026-08-01"], [shopB, "2026-08-06"]];
const sim = [[shopA, "2026-10-08"], [shopB, "2026-10-13"]];
let checks = 0;
function check(ok, label) { assert.ok(ok, label); checks++; console.log(`ok ${label}`); }
async function seed(db, groups, malformed = false) {
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    -- Supabase default table ACL bootstrap, not grants invented after migration.
    -- 0147/0166 leave defaults intact; 0182 explicitly revokes all signals access.
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    create table public.locations (id uuid primary key);
    create table public.vendor_items (id uuid primary key);
    insert into public.locations values ('${shopA}'), ('${shopB}'), ('${otherShop}');
    ${ddl}
    insert into public.vendor_items select gen_random_uuid() from generate_series(1, 67);
    insert into public.toast_daily_depletion (location_id, business_date, sku_id, direct_oz, flattened_oz)
      select s.id, s.day, v.id, 1.25, 2.75 from public.vendor_items v cross join
      (values ('${shopA}'::uuid, date '2026-08-01'), ('${shopB}'::uuid, date '2026-08-06')) s(id,day);
    insert into public.toast_daily_sales_signals (location_id, business_date, counted_qty)
      values ('${shopA}', '2026-08-01', 1.5);
  `);
  for (const [index, [shop, day]] of groups.entries()) {
    const pattern = malformed && index === 0 ? [3, 1, 2, 2] : [3, 1, 2, 1];
    for (const [checkIndex, count] of pattern.entries()) {
      for (let row = 0; row < count; row++) {
        await db.query(`insert into public.toast_sales_events
          (location_id, business_date, check_guid, selection_guid, toast_item_guid, item_name, quantity, snapshot_version)
          values ($1, $2, $3, $4, 'fixture-item', 'fixture', 1, 1)`,
        [shop, day, `check-${checkIndex + 1}`, `fixture-${index}-${checkIndex}-${row}`]);
      }
    }
  }
  // Real UUID check GUIDs on fixture days, other days and another shop survive.
  for (const [index, [shop, day]] of [...prod, ...sim, [otherShop, "2026-08-01"]].entries()) {
    await db.query(`insert into public.toast_sales_events
      (location_id, business_date, check_guid, selection_guid, toast_item_guid, item_name, quantity, snapshot_version)
      values ($1, $2, $3, $4, 'item', 'real', 1, 1)`,
    [shop, day, "a0000000-0000-4000-8000-000000000001", `keep-${index}`]);
  }
}
async function snapshot(db, table) {
  return (await db.query(`select * from public.${table} order by id`)).rows;
}
async function signalsDenied(db, phase) {
  for (const role of ["anon", "authenticated"]) {
    const row = (await db.query(`select bool_or(has_table_privilege($1, 'public.toast_daily_sales_signals', privilege)) as any
      from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege`, [role])).rows[0];
    check(!row.any, `${phase}: ${role} has zero signals privileges`);
  }
}
async function acl(db) {
  return (await db.query(`select relname, relacl::text from pg_class
    where relname = any($1) order by relname`, [tables])).rows;
}
for (const [label, groups, malformed, fails] of [
  ["prod", prod, false, false], ["sim", sim, false, false],
  ["empty", [], false, false], ["3/1/2/2", prod, true, true],
  ["third group", [...prod, [otherShop, "2026-08-01"]], false, true],
]) {
  const db = new PGlite();
  try {
    await seed(db, groups, malformed);
    await signalsDenied(db, `${label} before`);
    const before = await Promise.all(tables.map(table => snapshot(db, table)));
    const beforeACL = await acl(db);
    if (fails) {
      await assert.rejects(db.exec(migration), /0295 fixture pattern mismatch/);
      await db.exec("rollback");
      assert.deepEqual(await Promise.all(tables.map(table => snapshot(db, table))), before);
      assert.deepEqual(await acl(db), beforeACL);
      check(true, `${label}: abort preserves every row and every ACL`);
      await signalsDenied(db, `${label} after abort`);
      continue;
    }
    const notices = [];
    await db.exec(migration, { onNotice: notice => notices.push(notice.message) });
    assert.deepEqual(await snapshot(db, tables[0]), before[0].filter(r => r.selection_guid.startsWith("keep-")));
    check(true, `${label}: exactly ${7 * groups.length} fixtures deleted; five non-fixture controls unchanged`);
    assert.equal(before[1].length, 134);
    assert.deepEqual(await snapshot(db, tables[1]), before[1]);
    assert.deepEqual(await snapshot(db, tables[2]), before[2]);
    check(true, `${label}: all depletion and signals rows unchanged`);
    if (groups.length === 0) check(notices.some(message => /no fixture groups/.test(message)), "empty: no-op NOTICE emitted");
    await signalsDenied(db, `${label} after`);
    for (const table of tables) {
      for (const role of ["anon", "authenticated"]) {
        const privileges = (await db.query(`select
          has_table_privilege($1, $2, 'INSERT') as i,
          has_table_privilege($1, $2, 'UPDATE') as u,
          has_table_privilege($1, $2, 'DELETE') as d,
          has_table_privilege($1, $2, 'TRUNCATE') as t,
          has_table_privilege($1, $2, 'REFERENCES') as r,
          has_table_privilege($1, $2, 'TRIGGER') as g,
          has_table_privilege($1, $2, 'SELECT') as s`, [role, `public.${table}`])).rows[0];
        check(!privileges.i && !privileges.u && !privileges.d && !privileges.t && !privileges.r && !privileges.g && privileges.s === (table !== tables[2]), `${label} ${role}/${table}: writes revoked, SELECT unchanged`);
        await db.exec(`set role ${role}`);
        try {
          for (const sql of [
            `insert into public.${table} default values`,
            `update public.${table} set business_date = business_date`,
            `delete from public.${table}`,
            `truncate public.${table}`,
          ]) {
            await assert.rejects(db.exec(sql), e => e.code === "42501", `${role} write denied`);
            checks++;
          }
        } finally { await db.exec("reset role"); }
      }
      const service = (await db.query(`select bool_and(has_table_privilege('service_role', $1, privilege)) as ok
        from unnest(array['SELECT','INSERT','UPDATE','DELETE']) privilege`, [`public.${table}`])).rows[0];
      check(service.ok, `${label} ${table}: service_role unchanged`);
    }
  } finally { await db.close(); }
}
console.log(`PASS: ${checks} checks; no external database accessed.`);
