/**
 * Local Postgres proof of migration 0259 (catalog Phase 2a), SYNTHETIC ROWS ONLY — PGlite, in memory.
 * CC still owns the Supabase sim/prod gate (plan Task 14); this never touches a real database.
 *
 *   node scripts/sql-harness-0259.mjs
 *
 * Proves, by executing the migration's own SQL:
 *   P1  the backfill groups a SET BY CHAIN, not by timestamp — a live chain written in two statements
 *       is ONE version; two disconnected retired sets are TWO versions; history is ordered by
 *       valid_from with the LIVE set last on a tie; no level points into another version.
 *   P3b save_sku_pack_version refuses a bad chain shape by NAME (shared_child, not_one_root, cycle,
 *       duplicate_label, non_positive_qty) and refuses an inactive SKU; a good save mirrors the flat
 *       fields and bumps the epoch of EVERY shop riding the global pack, inactive shops too (P3f).
 *   P3c record_receiving_prices refuses a null / 'NaN' price, a missing SKU, a null date and an
 *       inactive shop by NAME; a good invoice opens the shop's lane.
 *   P3e the migration's own privilege guard runs (it raises if a helper is reachable or a writer is not).
 *   0260 the deploy-window heal (plan Task 4 Step 2's A → B → C): A ends when the old writer's set B
 *       began, B ends when the new writer's C began, C stays live, version_id becomes NOT NULL.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const u = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SHOP = u(1), SHOP_OFF = u(2);
const A = u(101), B = u(102), C = u(103), E = u(105);

const db = new PGlite();
let failures = 0;
const check = (ok, what) => { if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
async function refuses(sql, params, code, what) {
  try { await db.query(sql, params); check(false, `${what} (no error; expected ${code})`); }
  catch (e) { check(String(e.message).includes(code), `${what} → ${code}${String(e.message).includes(code) ? "" : ` (got: ${e.message})`}`); }
}

try {
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.users(id uuid primary key);
    create table public.locations(id uuid primary key, active boolean not null default true);
    create table public.vendors(id uuid primary key, source_kind text, active boolean not null default true);
    create table public.vendor_items(id uuid primary key, active boolean not null default true,
      location_id uuid null references public.locations(id), pack_format text, each_container_label text,
      units_per_pack int, each_size numeric, each_measure text);
    create table public.measure_units(label text primary key, active boolean not null default true);
    -- 0159's shape, verbatim in the parts 0259 touches
    create table public.sku_pack_levels (
      id uuid primary key default gen_random_uuid(),
      sku_id uuid not null references public.vendor_items(id),
      label text not null,
      contains_qty numeric not null check (contains_qty > 0),
      contains_level_id uuid null references public.sku_pack_levels(id),
      contains_measure_unit text null,
      display_ordinal integer not null default 0,
      effective_from timestamptz not null default now(),
      active boolean not null default true,
      created_at timestamptz not null default now(),
      created_by uuid null references public.users(id),
      constraint sku_pack_levels_one_link check (num_nonnulls(contains_level_id, contains_measure_unit) = 1)
    );
    create unique index sku_pack_levels_sku_label_active on public.sku_pack_levels (sku_id, label) where active;
    create table public.vendor_price_history(id uuid primary key default gen_random_uuid(),
      vendor_item_id uuid not null references public.vendor_items(id), unit_price numeric(10,2) not null,
      effective_date date not null, recorded_at timestamptz default now(), recorded_by uuid, source text, source_note text);
    create table public.location_sku_settings(sku_id uuid, location_id uuid, auto_weekday_par numeric, auto_weekend_par numeric);
    create table public.vendor_import_batches(id uuid primary key);
    create table public.vendor_import_observations(id uuid primary key);
    -- Supabase's default privileges hand service_role the pre-existing tables; mirror that for the stubs.
    grant select, insert, update on all tables in schema public to service_role;

    insert into public.locations values ('${SHOP}', true), ('${SHOP_OFF}', false);
    insert into public.measure_units values ('oz', true), ('lb', true), ('each', true);
    insert into public.vendor_items (id, active) values ('${A}', true), ('${B}', true), ('${C}', true), ('${E}', false);

    -- A: the LIVE chain written in TWO statements (two effective_from) → must be ONE version.
    insert into public.sku_pack_levels (id, sku_id, label, contains_qty, contains_measure_unit, effective_from, active)
      values ('${u(201)}', '${A}', 'bag', 80, 'oz', '2026-07-01T10:00:00Z', true);
    insert into public.sku_pack_levels (id, sku_id, label, contains_qty, contains_level_id, effective_from, active)
      values ('${u(202)}', '${A}', 'case', 4, '${u(201)}', '2026-07-01T10:00:05Z', true);

    -- B: two DISCONNECTED retired sets (the first itself written in two statements) + the live one.
    insert into public.sku_pack_levels (id, sku_id, label, contains_qty, contains_measure_unit, effective_from, active)
      values ('${u(211)}', '${B}', 'sleeve', 100, 'each', '2026-05-01T00:00:00Z', false);
    insert into public.sku_pack_levels (id, sku_id, label, contains_qty, contains_level_id, effective_from, active)
      values ('${u(212)}', '${B}', 'box', 5, '${u(211)}', '2026-05-01T00:00:03Z', false);
    insert into public.sku_pack_levels (id, sku_id, label, contains_qty, contains_measure_unit, effective_from, active)
      values ('${u(213)}', '${B}', 'pack', 2, 'lb', '2026-06-01T00:00:00Z', false),
             ('${u(214)}', '${B}', 'case', 12, 'lb', '2026-07-01T00:00:00Z', true);

    -- C: a retired set and the live set with the SAME valid_from → the LIVE set sorts last.
    insert into public.sku_pack_levels (id, sku_id, label, contains_qty, contains_measure_unit, effective_from, active)
      values ('${u(221)}', '${C}', 'old', 5, 'lb', '2026-08-01T00:00:00Z', false),
             ('${u(222)}', '${C}', 'new', 6, 'lb', '2026-08-01T00:00:00Z', true);
  `);

  await db.exec(readFileSync("supabase/migrations/0259_sku_shop_versions.sql", "utf8"));
  console.log("ok   0259 applied (its backfill asserts and privilege guard passed)");

  const versions = async (sku) => (await db.query(
    "select id, active, valid_from, valid_to, based_on_version_id from public.sku_pack_versions where sku_id = $1 and flat_snapshot is null order by valid_from, active, created_at, id", [sku])).rows;
  const levelsOf = async (vid) => (await db.query("select id from public.sku_pack_levels where version_id = $1 order by id", [vid])).rows.map((r) => r.id);
  const iso = (d) => (d == null ? null : new Date(d).toISOString());

  // P1 — A: one live version, both statements' levels in it, valid_from = the earliest.
  const va = await versions(A);
  check(va.length === 1 && va[0].active, "A: a live chain written in two statements is ONE version");
  check(iso(va[0].valid_from) === "2026-07-01T10:00:00.000Z", "A: valid_from = the earliest effective_from");
  check(JSON.stringify(await levelsOf(va[0].id)) === JSON.stringify([u(201), u(202)]), "A: both levels linked to that version");

  // P1 — B: two retired versions + the live one, dated end to end, based_on chained.
  const vb = await versions(B);
  check(vb.length === 3, "B: two disconnected retired sets are TWO versions (+ the live one)");
  check(JSON.stringify(await levelsOf(vb[0].id)) === JSON.stringify([u(211), u(212)]), "B: the two-statement retired set is one version");
  check(iso(vb[0].valid_to) === "2026-06-01T00:00:00.000Z" && iso(vb[1].valid_to) === "2026-07-01T00:00:00.000Z" && vb[2].valid_to === null,
    "B: each retired version ends when the next began; the live one is open");
  check(vb[1].based_on_version_id === vb[0].id && vb[2].based_on_version_id === vb[1].id, "B: based_on follows the history order");

  // P1 — C: on a tie the LIVE set is last, so the retired set never takes the live interval.
  const vc = await versions(C);
  check(vc.length === 2 && !vc[0].active && vc[1].active, "C: on a valid_from tie the LIVE set sorts last");
  check(vc[1].valid_to === null && vc[1].based_on_version_id === vc[0].id, "C: the live set keeps the open interval");

  const cross = (await db.query("select count(*)::int as n from public.sku_pack_levels l join public.sku_pack_levels c on c.id = l.contains_level_id where l.version_id is distinct from c.version_id")).rows[0].n;
  check(cross === 0, "no level points into a different version");

  // P3b — named refusals, as the service role.
  await db.exec("set role service_role;");
  const save = "select public.save_sku_pack_version($1, null, $2::jsonb, $3, null, null, null, false) as r";
  const liveA = va[0].id;
  await refuses(save, [A, JSON.stringify([{ label: "case", containsQty: 2, containsIndex: 2 }, { label: "box", containsQty: 2, containsIndex: 2 }, { label: "bag", containsQty: 5, containsMeasureUnit: "lb" }]), liveA], "sku_pack_version:shared_child", "two levels containing one child");
  await refuses(save, [A, JSON.stringify([{ label: "a", containsQty: 1, containsMeasureUnit: "lb" }, { label: "b", containsQty: 1, containsMeasureUnit: "lb" }]), liveA], "sku_pack_version:not_one_root", "two roots");
  await refuses(save, [A, JSON.stringify([{ label: "root", containsQty: 1, containsIndex: 1 }, { label: "x", containsQty: 1, containsMeasureUnit: "lb" }, { label: "y", containsQty: 2, containsIndex: 3 }, { label: "z", containsQty: 2, containsIndex: 2 }]), liveA], "sku_pack_version:cycle", "a detached cycle");
  await refuses(save, [A, JSON.stringify([{ label: "case", containsQty: 2, containsIndex: 1 }, { label: "case", containsQty: 5, containsMeasureUnit: "lb" }]), liveA], "sku_pack_version:duplicate_label", "a repeated label");
  await refuses(save, [A, JSON.stringify([{ label: "case", containsQty: 0, containsMeasureUnit: "lb" }]), liveA], "sku_pack_version:non_positive_qty", "a zero quantity");
  await refuses(save, [E, JSON.stringify([{ label: "case", containsQty: 1, containsMeasureUnit: "lb" }]), null], "sku_pack_version:sku_not_found", "an inactive SKU");

  // A good global save: the mirror is derived in the transaction; the epoch moves for EVERY shop (P3f).
  const ok = (await db.query(save, [A, JSON.stringify([{ label: "case", containsQty: 6, containsIndex: 1 }, { label: "bag", containsQty: 5, containsMeasureUnit: "lb" }]), liveA])).rows[0].r;
  check(ok.mirror_synced === true && ok.retired_version_id === liveA, "a good global save retires the live version and syncs the mirror");
  const mirror = (await db.query("select pack_format, units_per_pack, each_size::text as each_size, each_measure from public.vendor_items where id = $1", [A])).rows[0];
  check(mirror.pack_format === "case" && mirror.units_per_pack === 6 && Number(mirror.each_size) === 5 && mirror.each_measure === "lb", "the flat mirror describes the saved chain (case of 6 × 5 lb)");
  const epochs = (await db.query("select location_id from public.sku_pack_epochs where sku_id = $1 order by 1", [A])).rows.map((r) => r.location_id);
  check(JSON.stringify(epochs) === JSON.stringify([SHOP, SHOP_OFF]), "the epoch moved for every shop riding the global pack, the inactive one too");

  // P3c — the invoice writer.
  const rec = "select public.record_receiving_prices($1, $2::jsonb) as r";
  const row = (extra) => JSON.stringify([{ vendor_item_id: B, unit_price: 12.5, effective_date: "2026-10-07", recorded_by: null, ...extra }]);
  await refuses(rec, [SHOP, row({ unit_price: null })], "sku_price:invalid_price", "a null price");
  await refuses(rec, [SHOP, row({ unit_price: "NaN" })], "sku_price:invalid_price", "the string 'NaN'");
  await refuses(rec, [SHOP, row({ vendor_item_id: u(999) })], "sku_price:sku_not_found", "a SKU that is not there");
  await refuses(rec, [SHOP, row({ effective_date: null })], "sku_price:invalid_date", "a null effective date");
  await refuses(rec, [SHOP_OFF, row({})], "sku_price:location_not_found", "an inactive shop");
  const inv = (await db.query(rec, [SHOP, row({})])).rows[0].r;
  check(inv.lanes_opened === 1 && inv.shop_rows === 1 && inv.global_rows === 0, "a good first invoice opens the shop's lane and lands in it");
  await db.exec("reset role;");

  // 0260 — the deploy-window heal (plan Task 4 Step 2's A → B → C, executed here on synthetic rows):
  // A = C's backfilled live version; B = the OLD writer (every live level deactivated, an unversioned
  // set inserted); C = the NEW writer. After 0260: A ends when B began, B ends when C began, C is live.
  const aId = vc[1].id;
  const bFrom = (await db.query(`
    with b as (select clock_timestamp() - interval '1 second' as at)
    , off as (update public.sku_pack_levels set active = false where sku_id = $1 and active returning 1)
    insert into public.sku_pack_levels (id, sku_id, label, contains_qty, contains_measure_unit, display_ordinal, effective_from, active)
    select gen_random_uuid(), $1, 'zz-old-writer', 7, 'lb', 0, (select at from b), true from (select count(*) from off) x
    returning effective_from`, [C])).rows[0].effective_from;
  const cRes = (await db.query(save, [C, JSON.stringify([{ label: "zz-new-writer", containsQty: 9, containsMeasureUnit: "lb" }]), aId])).rows[0].r;
  await db.exec(readFileSync("supabase/migrations/0260_sku_pack_versions_finalize.sql", "utf8"));
  const healed = Object.fromEntries((await db.query("select id, active, valid_from, valid_to, note from public.sku_pack_versions where sku_id = $1", [C])).rows.map((r) => [r.id, r]));
  const bRow = Object.values(healed).find((r) => r.note === "0260 backfill");
  check(iso(healed[aId].valid_to) === iso(bFrom), "0260: A ends exactly when the old writer's set B began");
  check(bRow && iso(bRow.valid_to) === iso(cRes.valid_from), "0260: B is versioned and ends exactly when C began");
  check(healed[cRes.version_id].active && healed[cRes.version_id].valid_to === null, "0260: C stays live");
  const nullable = (await db.query("select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'sku_pack_levels' and column_name = 'version_id'")).rows[0].is_nullable;
  check(nullable === "NO", "0260: version_id is NOT NULL");

  if (failures > 0) { console.error(`\n${failures} check(s) FAILED`); process.exitCode = 1; }
  else console.log("\nPASS 0259 backfill grouping (P1), chain-shape refusals (P3b), invoice guards (P3c), all-shop epochs (P3f), privilege guard (P3e); 0260 A → B → C heal");
} finally { await db.close(); }
