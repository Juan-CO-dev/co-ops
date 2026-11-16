/**
 * Local Postgres proof of migration 0324 (audit W18/B107), SYNTHETIC ROWS ONLY — PGlite, in memory.
 * CC still owns the Supabase sim/prod gate; this never touches a real database.
 *
 *   node scripts/sql-harness-0324.mjs
 *
 * Executes the REAL 0259 + 0260 + 0261 + 0324, then proves:
 *   B1  the ATOMIC Back to default: one call retires the shop's own version (the shop rides the default
 *       again, its pack epoch bumped) and converts the shop's own par to the value the person accepted.
 *   B2  a PAR MISMATCH refuses EVERYTHING: the shop's version still live, the par, the epoch untouched.
 *   B3  the DEPENDENCY SNAPSHOT is re-taken under the SKU lock: a par lane that moved after the preview
 *       refuses dependencies_changed, writing nothing.
 *   B4  the version is bound: another shop's version is not_found, another SKU's is version_sku_mismatch,
 *       an already-retired one is not_live; a global-par conversion is par_lane_mismatch; no shop is
 *       location_required.
 *   B5  "give this shop its own par" from the inherited global par works exactly as on 0261's shop save.
 *   B6  privileges: authenticated cannot execute the apply; service_role cannot call the internal loop.
 *   B7  (W18/B106 fix round 1) the walker's Accept is bound to the pack epoch it was computed in, checked
 *       under the SKU lock every pack writer takes: at that epoch it writes the slot (insert or update) and
 *       clears the machine lane + pin; after a pack change (here a real Back to default) it refuses
 *       par_suggestion:pack_changed and writes nothing; the patch is allowlisted to the slot and bound to
 *       the value; only service_role may execute it.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const u = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const S1 = u(1), S2 = u(2);
const USER = u(50);

const db = new PGlite();
let failures = 0;
const check = (ok, what) => { if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
async function refuses(fn, code, what) {
  try { await fn(); check(false, `${what} (no error; expected ${code})`); }
  catch (e) { check(String(e.message).includes(code), `${what} → ${code}${String(e.message).includes(code) ? "" : ` (got: ${e.message})`}`); }
}
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];

const DEFAULT_CASE = [{ label: "case", containsQty: 4, containsIndex: 1 }, { label: "bag", containsQty: 24, containsMeasureUnit: "oz" }];
const SHOP_CASE = [{ label: "case", containsQty: 8, containsIndex: 1 }, { label: "bag", containsQty: 24, containsMeasureUnit: "oz" }];
const humanPatch = (slot, value) => ({ [`${slot}_par`]: value, [`auto_${slot}_par`]: null, [`auto_${slot}_baseline_par`]: null, [`auto_${slot}_applied_at`]: null, [`pinned_${slot}_at`]: null });

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
      units_per_pack int, each_size numeric, each_measure text, weekday_par numeric, weekend_par numeric,
      unique (id));
    create table public.measure_units(label text primary key, active boolean not null default true);
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
    create table public.location_sku_settings (
      id uuid primary key default gen_random_uuid(),
      location_id uuid not null references public.locations(id),
      sku_id uuid not null references public.vendor_items(id),
      active_override boolean null, weekday_par numeric null, weekend_par numeric null,
      updated_by uuid null references public.users(id), updated_at timestamptz not null default now(),
      created_at timestamptz not null default now(),
      auto_weekday_par numeric null, auto_weekend_par numeric null,
      auto_weekday_applied_at timestamptz null, auto_weekend_applied_at timestamptz null,
      auto_weekday_baseline_par numeric null, auto_weekend_baseline_par numeric null,
      pinned_weekday_at timestamptz null, pinned_weekend_at timestamptz null,
      constraint location_sku_settings_location_sku_uq unique (location_id, sku_id)
    );
    create table public.vendor_import_batches(id uuid primary key);
    create table public.vendor_import_observations(id uuid primary key);
    create table public.vendor_deliveries(id uuid primary key, location_id uuid not null references public.locations(id));
    create table public.photos(id uuid primary key, location_id uuid not null references public.locations(id));
    grant select, insert, update on all tables in schema public to service_role;

    insert into public.users values ('${USER}');
    insert into public.locations values ('${S1}', true), ('${S2}', true);
    insert into public.measure_units values ('oz', true), ('lb', true), ('each', true);
  `);
  await db.exec(readFileSync("supabase/migrations/0259_sku_shop_versions.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/0260_sku_pack_versions_finalize.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/0261_sku_pack_change_requests.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/0324_sku_pack_back_to_default.sql", "utf8"));
  console.log("ok   0259 + 0260 + 0261 + 0324 applied (0324's pre-flight and ACL guard passed)");
  await db.exec(readFileSync("supabase/migrations/0324_sku_pack_back_to_default.sql", "utf8"));
  console.log("ok   0324 re-applied: idempotent");

  // A SKU with a live GLOBAL chain (case 4 × bag 24 oz) and S1's OWN chain (case 8 × bag 24 oz).
  let skuN = 300;
  async function freshSku({ shopPar = 4 } = {}) {
    const sku = u(++skuN);
    await db.exec("reset role;");
    await db.query("insert into public.vendor_items (id, active, weekday_par) values ($1, true, 3)", [sku]);
    if (shopPar != null) await db.query("insert into public.location_sku_settings (location_id, sku_id, weekday_par) values ($1, $2, $3)", [S1, sku, shopPar]);
    await db.exec("set role service_role;");
    const g = (await one("select public.save_sku_pack_version($1, null, $2::jsonb, null, null, null, null, false) as r", [sku, JSON.stringify(DEFAULT_CASE)])).r;
    const s = (await one("select public.save_sku_pack_version($1, $2, $3::jsonb, null, $4, null, null, false) as r", [sku, S1, JSON.stringify(SHOP_CASE), g.version_id])).r;
    return { sku, global: g.version_id, shop: s.version_id };
  }
  const snapshot = async (sku, shops = [S1]) => (await one("select public.sku_pack_change_snapshot($1, $2::uuid[]) as s", [sku, shops])).s;
  const back = (a) => db.query(
    "select public.apply_sku_pack_back_to_default($1, $2, $3, $4, $5::jsonb, $6::jsonb) as r",
    [a.sku, a.location === undefined ? S1 : a.location, a.version, USER, JSON.stringify(a.pars ?? []), JSON.stringify(a.snapshot)],
  ).then((res) => res.rows[0].r);
  const state = async (sku) => JSON.stringify({
    versions: (await db.query("select id, location_id, active, valid_to from public.sku_pack_versions where sku_id = $1 and flat_snapshot is null order by created_at, id", [sku])).rows,
    overlay: (await db.query("select location_id, weekday_par::text as wd from public.location_sku_settings where sku_id = $1 order by location_id", [sku])).rows,
    epochs: (await db.query("select location_id, epoch::int as e from public.sku_pack_epochs where sku_id = $1 order by location_id", [sku])).rows,
    global: await one("select weekday_par::text as wd from public.vendor_items where id = $1", [sku]),
  });
  const epochOf = async (sku, shop) => (await one("select coalesce((select epoch::int from public.sku_pack_epochs where sku_id = $1 and location_id = $2), 0) as e", [sku, shop])).e;

  await db.exec("set role service_role;");

  // ── B1 the atomic Back to default ─────────────────────────────────────────
  {
    const { sku, shop } = await freshSku();
    const epochBefore = await epochOf(sku, S1);
    const r = await back({ sku, version: shop, snapshot: await snapshot(sku), pars: [
      { location_id: S1, slot: "weekday", expected: 4, to: 8, patch: humanPatch("weekday", 8) },
    ] });
    check(r.version_id === shop && r.pars_converted === 1, "B1: one call → the shop's version retired, one par converted");
    const v = await one("select active, valid_to is not null as closed from public.sku_pack_versions where id = $1", [shop]);
    check(v.active === false && v.closed === true, "B1: the shop version is retired (closed, never deleted)");
    const live = await one("select count(*)::int as n from public.sku_pack_versions where sku_id = $1 and location_id = $2 and active", [sku, S1]);
    check(live.n === 0, "B1: S1 has NO live own version — it rides the default again (no copy saved)");
    const s1 = await one("select weekday_par::text as wd from public.location_sku_settings where sku_id = $1 and location_id = $2", [sku, S1]);
    check(Number(s1.wd) === 8, "B1: S1's own par converted 4 → 8 (8-bag case → 4-bag case)");
    check(await epochOf(sku, S1) > epochBefore, "B1: S1's pack epoch moved (a stale auto par retires at read time)");
    const g = await one("select weekday_par::text as wd from public.vendor_items where id = $1", [sku]);
    check(Number(g.wd) === 3, "B1: the global par is untouched");
  }

  // ── B2 a par mismatch refuses EVERYTHING ─────────────────────────────────
  {
    const { sku, shop } = await freshSku();
    const snap = await snapshot(sku);
    const before = await state(sku);
    await refuses(() => back({ sku, version: shop, snapshot: snap, pars: [
      { location_id: S1, slot: "weekday", expected: 5, to: 8, patch: humanPatch("weekday", 8) },
    ] }), "sku_pack_change:par_changed", "B2: a conversion bound to a value the shop no longer has");
    check(await state(sku) === before, "B2: …and NOTHING changed — the shop version still live, the par and the epoch as they were");
  }

  // ── B3 the dependency snapshot, re-taken under the lock ─────────────────
  {
    const { sku, shop } = await freshSku();
    const snap = await snapshot(sku);
    await db.exec("reset role;");
    await db.query("update public.location_sku_settings set weekday_par = 6 where sku_id = $1 and location_id = $2", [sku, S1]);
    await db.exec("set role service_role;");
    const moved = await state(sku);
    await refuses(() => back({ sku, version: shop, snapshot: snap }), "sku_pack_change:dependencies_changed", "B3: the shop's par moved after the preview");
    check(await state(sku) === moved, "B3: …nothing written (the version still live)");
    await refuses(async () => back({ sku, version: shop, snapshot: await snapshot(sku, [S2]) }), "sku_pack_change:invalid_payload", "B3: a snapshot that does not cover the shop");
  }

  // ── B4 the version, the lane, the shop ───────────────────────────────────
  {
    const { sku, shop, global } = await freshSku();
    const other = await freshSku();
    const s2 = (await one("select public.save_sku_pack_version($1, $2, $3::jsonb, null, $4, null, null, false) as r", [sku, S2, JSON.stringify(SHOP_CASE), global])).r.version_id;
    const before = await state(sku);
    await refuses(async () => back({ sku, version: s2, snapshot: await snapshot(sku) }), "sku_pack_change:not_found", "B4: another shop's version");
    await refuses(async () => back({ sku, version: other.shop, snapshot: await snapshot(sku) }), "sku_pack_change:version_sku_mismatch", "B4: another SKU's version");
    await refuses(async () => back({ sku, version: global, snapshot: await snapshot(sku) }), "sku_pack_change:not_found", "B4: the GLOBAL version is never retired here");
    await refuses(async () => back({ sku, version: shop, snapshot: await snapshot(sku), pars: [
      { location_id: null, slot: "weekday", expected: 3, to: 2, patch: null },
    ] }), "sku_pack_change:par_lane_mismatch", "B4: a GLOBAL par conversion on a shop's Back to default");
    await refuses(async () => back({ sku, location: null, version: shop, snapshot: await snapshot(sku) }), "sku_pack_change:location_required", "B4: no shop");
    check(await state(sku) === before, "B4: …every refusal wrote nothing");
    await back({ sku, version: shop, snapshot: await snapshot(sku) });
    await refuses(async () => back({ sku, version: shop, snapshot: await snapshot(sku) }), "sku_pack_change:not_live", "B4: a version already retired");
  }

  // ── B5 "give this shop its own par" from the inherited global par ────────
  {
    const { sku, shop } = await freshSku({ shopPar: null });
    const r = await back({ sku, version: shop, snapshot: await snapshot(sku), pars: [
      { location_id: S1, slot: "weekday", expected: 3, to: 6, inherited: true, from: "global", patch: humanPatch("weekday", 6) },
    ] });
    const s1 = await one("select weekday_par::text as wd from public.location_sku_settings where sku_id = $1 and location_id = $2", [sku, S1]);
    const g = await one("select weekday_par::text as wd from public.vendor_items where id = $1", [sku]);
    check(r.pars_converted === 1 && Number(s1.wd) === 6 && Number(g.wd) === 3, "B5: the inherited global par (3) becomes S1's OWN slot (6); the global par stays 3");
  }

  // ── B7 the epoch-bound Accept (W18/B106 fix round 1) ─────────────────────
  {
    const acceptRpc = (a) => db.query(
      "select public.apply_par_suggestion_accept($1::uuid, $2::uuid, $3::text, $4::numeric, $5::bigint, $6::jsonb, $7::uuid) as r",
      [a.sku, a.location ?? S1, a.slot ?? "weekday", a.value, a.epoch, JSON.stringify(a.patch ?? humanPatch(a.slot ?? "weekday", a.value)), USER],
    ).then((res) => res.rows[0].r);
    const overlayOf = async (sku, shop) => one(
      "select id, weekday_par::text as wd, weekend_par::text as we, auto_weekday_par::text as awd, pinned_weekday_at as pin, updated_by from public.location_sku_settings where sku_id = $1 and location_id = $2",
      [sku, shop]);
    const { sku, shop } = await freshSku();
    await db.exec("reset role;");
    await db.query("update public.location_sku_settings set auto_weekday_par = 7, pinned_weekday_at = now() where sku_id = $1 and location_id = $2", [sku, S1]);
    await db.exec("set role service_role;");
    const e1 = await epochOf(sku, S1);
    const id = await acceptRpc({ sku, value: 9, epoch: e1 });
    const o = await overlayOf(sku, S1);
    check(id === o.id && Number(o.wd) === 9 && o.awd === null && o.pin === null && o.updated_by === USER,
      "B7: at the live epoch the accept writes the human slot, clears the machine par and the pin, names the actor");
    check(o.we === null, "B7: …and only that slot");

    // A pack change commits between the walk's validation (epoch e1) and the write: a real Back to default.
    await back({ sku, version: shop, snapshot: await snapshot(sku) });
    check(await epochOf(sku, S1) > e1, "B7: the Back to default moved S1's pack epoch");
    const before = await state(sku);
    await refuses(() => acceptRpc({ sku, value: 12, epoch: e1 }), "par_suggestion:pack_changed", "B7: an accept computed in the old pack epoch");
    check(await state(sku) === before, "B7: …and wrote nothing");

    // No overlay row yet (S2 rides the default): the insert path, at S2's own epoch.
    const e2 = await epochOf(sku, S2);
    await acceptRpc({ sku, location: S2, slot: "weekend", value: 5, epoch: e2 });
    const o2 = await overlayOf(sku, S2);
    check(o2 != null && Number(o2.we) === 5 && o2.wd === null, "B7: no overlay row → one is created with only the accepted slot");
    await refuses(() => acceptRpc({ sku, location: S2, slot: "weekend", value: 5, epoch: e2 + 1 }), "par_suggestion:pack_changed", "B7: a FUTURE epoch is not a proof either");

    // The patch: allowlisted to the slot, bound to the value.
    const e1now = await epochOf(sku, S1);
    await refuses(() => acceptRpc({ sku, value: 4, epoch: e1now, patch: { ...humanPatch("weekday", 4), weekend_par: 1 } }), "par_suggestion:invalid_patch", "B7: a patch that reaches the other slot");
    await refuses(() => acceptRpc({ sku, value: 4, epoch: e1now, patch: { ...humanPatch("weekday", 4), auto_weekday_pack_epoch: 9 } }), "par_suggestion:invalid_patch", "B7: a patch that stamps a machine epoch");
    await refuses(() => acceptRpc({ sku, value: 4, epoch: e1now, patch: humanPatch("weekday", 5) }), "par_suggestion:invalid_patch", "B7: a patch whose par is not the accepted value");
    await refuses(() => acceptRpc({ sku, slot: "monday", value: 4, epoch: e1now }), "par_suggestion:invalid_payload", "B7: an unknown slot");
    await refuses(() => acceptRpc({ sku: u(999), value: 4, epoch: 0 }), "par_suggestion:not_found", "B7: an unknown SKU");
    check(Number((await overlayOf(sku, S1)).wd) === 9, "B7: …every refusal left S1's par as it was");
  }

  // ── B6 privileges ────────────────────────────────────────────────────────
  await refuses(() => db.query("select public.sku_pack_apply_par_changes(null, null, null, null)"), "permission denied", "B6: service_role cannot call the internal par loop directly");
  await db.exec("reset role; set role authenticated;");
  await refuses(() => db.query("select public.apply_sku_pack_back_to_default(null, null, null, null, null, null)"), "permission denied", "B6: authenticated cannot execute the Back-to-default apply");
  await refuses(() => db.query("select public.apply_par_suggestion_accept(null, null, null, null, null, null, null)"), "permission denied", "B7: authenticated cannot execute the epoch-bound accept");
  await db.exec("reset role; set role anon;");
  await refuses(() => db.query("select public.apply_sku_pack_back_to_default(null, null, null, null, null, null)"), "permission denied", "B6: anon cannot execute the Back-to-default apply");
  await refuses(() => db.query("select public.apply_par_suggestion_accept(null, null, null, null, null, null, null)"), "permission denied", "B7: anon cannot execute the epoch-bound accept");
  await db.exec("reset role;");

  if (failures > 0) { console.error(`\n${failures} check(s) FAILED`); process.exitCode = 1; }
  else console.log("\nPASS 0324: atomic Back to default with par conversion (B1), all-or-nothing refusals (B2), the snapshot re-check under the lock (B3), the version / lane / shop bound (B4), own-par from global (B5), privileges (B6), the epoch-bound accept (B7)");
} finally { await db.close(); }
