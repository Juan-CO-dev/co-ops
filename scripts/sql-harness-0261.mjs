/**
 * Local Postgres proof of migration 0261 (catalog Phase 2b), SYNTHETIC ROWS ONLY — PGlite, in memory.
 * CC still owns the Supabase sim/prod gate (plan Task 14); this never touches a real database.
 *
 *   node scripts/sql-harness-0261.mjs
 *
 * Executes the REAL 0259 + 0260 + 0261, then proves:
 *   A1  the ATOMIC apply: one call saves the version (0259's writer, inside the transaction), converts
 *       a shop's own par and the global par, and closes the door report with the version that answered.
 *   A2  a PAR MISMATCH refuses EVERYTHING: no new version, the old one still live, the flat mirror,
 *       the pars, the epochs and the report exactly as they were.
 *   A3  the DEPENDENCY SNAPSHOT is re-taken under the SKU lock: a par lane that moved, a shop that
 *       gained its own case, or a new active shop after the preview refuses dependencies_changed —
 *       and nothing is written.
 *   A4  "give this shop its own par": from the inherited GLOBAL par or the shop's AUTO par, only on a
 *       shop save, only into an EMPTY slot; the global par is untouched. A4b: a concurrent insert of the
 *       shop's row is refused by name (par_changed), never a bare unique violation.
 *   A5  the report is bound: another SKU's report, another shop's report, a closed report refuse.
 *   A6  invalid patches and lane mismatches refuse by name; one open report per (sku, shop).
 *   A7  privileges: service_role cannot DELETE a report; anon/authenticated cannot execute the applies.
 *   A9  filing: a second report of the same case JOINS the open one and its note / numbers / photo are
 *       ADDED (append-only); another shop's photo or delivery is refused by name.
 *   A8  the atomic PRICE apply: a later-dated price (or a moved global head, or a shop's new lane)
 *       landing between the preview's snapshot and the save is refused price_changed, writing nothing.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const u = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const S1 = u(1), S2 = u(2), S3 = u(3), S_NEW = u(4);
const USER = u(50);

const db = new PGlite();
let failures = 0;
const check = (ok, what) => { if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
async function refuses(fn, code, what) {
  try { await fn(); check(false, `${what} (no error; expected ${code})`); }
  catch (e) { check(String(e.message).includes(code), `${what} → ${code}${String(e.message).includes(code) ? "" : ` (got: ${e.message})`}`); }
}
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];

const OZ_BAG = [{ label: "case", containsQty: 4, containsIndex: 1 }, { label: "bag", containsQty: 80, containsMeasureUnit: "oz" }];
const NEW_SACK = [{ label: "case", containsQty: 4, containsIndex: 1 }, { label: "sack", containsQty: 10, containsMeasureUnit: "lb" }];
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
    -- 0174 + 0183, the columns 0259/0261 touch
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
    insert into public.locations values ('${S1}', true), ('${S2}', true), ('${S3}', true);
    insert into public.measure_units values ('oz', true), ('lb', true), ('each', true);
  `);
  await db.exec(readFileSync("supabase/migrations/0259_sku_shop_versions.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/0260_sku_pack_versions_finalize.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/0261_sku_pack_change_requests.sql", "utf8"));
  console.log("ok   0259 + 0260 + 0261 applied (0261's privilege guard passed)");

  // A fresh SKU with a live GLOBAL chain (case 4 × bag 80 oz), global weekday par 3.
  let skuN = 300;
  async function freshSku() {
    const sku = u(++skuN);
    await db.exec("reset role;");
    await db.query("insert into public.vendor_items (id, active, weekday_par) values ($1, true, 3)", [sku]);
    await db.exec("set role service_role;");
    const g = (await one("select public.save_sku_pack_version($1, null, $2::jsonb, null, null, null, null, false) as r", [sku, JSON.stringify(OZ_BAG)])).r;
    return { sku, live: g.version_id };
  }
  const allShops = async () => (await db.query("select id from public.locations where active order by id")).rows.map((r) => r.id);
  const snapshot = async (sku, shops) => (await one("select public.sku_pack_change_snapshot($1, $2::uuid[]) as s", [sku, shops])).s;
  const apply = (a) => db.query(
    "select public.apply_sku_pack_change($1, $2, $3::jsonb, $4, $5, null, $6, false, $7::jsonb, $8, $9::jsonb) as r",
    [a.sku, a.location ?? null, JSON.stringify(a.levels ?? NEW_SACK), a.expected, a.basedOn ?? null, USER, JSON.stringify(a.pars ?? []), a.request ?? null, JSON.stringify(a.snapshot)],
  ).then((res) => res.rows[0].r);
  const fileRequest = async (sku, shop) => (await one(
    "insert into public.sku_pack_change_requests (sku_id, location_id, filed_by) values ($1, $2, $3) returning id", [sku, shop, USER])).id;
  // Everything a refused apply must leave untouched.
  const state = async (sku) => JSON.stringify({
    versions: (await db.query("select id, location_id, active, valid_to from public.sku_pack_versions where sku_id = $1 and flat_snapshot is null order by created_at, id", [sku])).rows,
    levels: (await db.query("select count(*)::int as n from public.sku_pack_levels where sku_id = $1 and active", [sku])).rows[0].n,
    mirror: await one("select pack_format, units_per_pack, each_size::text as each_size, each_measure, weekday_par::text as wd, weekend_par::text as we from public.vendor_items where id = $1", [sku]),
    overlay: (await db.query("select location_id, weekday_par::text as wd, auto_weekday_par::text as awd from public.location_sku_settings where sku_id = $1 order by location_id", [sku])).rows,
    epochs: (await db.query("select location_id, epoch::int as e from public.sku_pack_epochs where sku_id = $1 order by location_id", [sku])).rows,
    requests: (await db.query("select id, status, resolved_version_id from public.sku_pack_change_requests where sku_id = $1 order by id", [sku])).rows,
  });
  const setOverlay = async (sku, shop, cols) => {
    await db.exec("reset role;");
    const keys = Object.keys(cols);
    await db.query(`insert into public.location_sku_settings (location_id, sku_id, ${keys.join(", ")}) values ($1, $2, ${keys.map((_, i) => `$${i + 3}`).join(", ")})
                    on conflict (location_id, sku_id) do update set ${keys.map((k) => `${k} = excluded.${k}`).join(", ")}`, [shop, sku, ...keys.map((k) => cols[k])]);
    await db.exec("set role service_role;");
  };

  await db.exec("set role service_role;");

  // ── A1 the atomic global apply ───────────────────────────────────────────
  {
    const { sku, live } = await freshSku();
    await setOverlay(sku, S1, { weekday_par: 5 });
    const req = await fileRequest(sku, S1);
    const snap = await snapshot(sku, await allShops());
    const r = await apply({ sku, expected: live, request: req, snapshot: snap, pars: [
      { location_id: S1, slot: "weekday", expected: 5, to: 3, patch: humanPatch("weekday", 3) },
      { location_id: null, slot: "weekday", expected: 3, to: 2, patch: null },
    ] });
    check(r.version_id && r.retired_version_id === live && r.pars_converted === 2 && r.request_applied === true, "A1: one call → a new version, two pars converted, the report applied");
    const v = await one("select active, location_id from public.sku_pack_versions where id = $1", [r.version_id]);
    const old = await one("select active from public.sku_pack_versions where id = $1", [live]);
    check(v.active && v.location_id === null && old.active === false, "A1: the new global version is live and the old one closed");
    const mirror = await one("select pack_format, units_per_pack, each_size::text as each_size, each_measure, weekday_par::text as wd from public.vendor_items where id = $1", [sku]);
    check(mirror.pack_format === "case" && mirror.units_per_pack === 4 && Number(mirror.each_size) === 10 && mirror.each_measure === "lb", "A1: the flat mirror was derived inside the same transaction");
    check(Number(mirror.wd) === 2, "A1: the global par converted (3 → 2)");
    const s1 = await one("select weekday_par::text as wd from public.location_sku_settings where sku_id = $1 and location_id = $2", [sku, S1]);
    check(Number(s1.wd) === 3, "A1: S1's own par converted (5 → 3)");
    const rq = await one("select status, resolved_version_id, resolved_by from public.sku_pack_change_requests where id = $1", [req]);
    check(rq.status === "applied" && rq.resolved_version_id === r.version_id && rq.resolved_by === USER, "A1: the report is closed by the version that answered it");
  }

  // ── A2 a par mismatch refuses EVERYTHING ──────────────────────────────────
  {
    const { sku, live } = await freshSku();
    await setOverlay(sku, S1, { weekday_par: 5 });
    const req = await fileRequest(sku, S1);
    const snap = await snapshot(sku, await allShops());
    const before = await state(sku);
    await refuses(() => apply({ sku, expected: live, request: req, snapshot: snap, pars: [
      { location_id: null, slot: "weekday", expected: 3, to: 2, patch: null },
      { location_id: S1, slot: "weekday", expected: 4, to: 2, patch: humanPatch("weekday", 2) },
    ] }), "sku_pack_change:par_changed", "A2: a conversion bound to a value the shop no longer has");
    check(await state(sku) === before, "A2: …and NOTHING changed — no version, no mirror, no par (the global one converted first), no epoch, the report still open");
    await refuses(() => apply({ sku, expected: live, request: req, snapshot: snap, pars: [
      { location_id: null, slot: "weekday", expected: 9, to: 2, patch: null },
    ] }), "sku_pack_change:par_changed", "A2: the global par moved");
    check(await state(sku) === before, "A2: …nothing changed again");
    await refuses(() => apply({ sku, expected: u(999), request: req, snapshot: snap }), "sku_pack_version:version_changed", "A2: 0259's own refusal (stale live version) also rolls the apply back");
    check(await state(sku) === before, "A2: …nothing changed");
  }

  // ── A3 the dependency snapshot, re-taken under the lock ─────────────────
  {
    const { sku, live } = await freshSku();
    const snap = await snapshot(sku, await allShops());
    const before = await state(sku);
    await setOverlay(sku, S2, { weekday_par: 7 });
    const moved = await state(sku);
    await refuses(() => apply({ sku, expected: live, snapshot: snap }), "sku_pack_change:dependencies_changed", "A3: a par lane moved after the preview");
    check(await state(sku) === moved && moved !== before, "A3: …nothing written");
  }
  {
    const { sku, live } = await freshSku();
    const snap = await snapshot(sku, await allShops());
    await db.query("select public.save_sku_pack_version($1, $2, $3::jsonb, null, null, null, null, false)", [sku, S2, JSON.stringify([{ label: "crate", containsQty: 12, containsMeasureUnit: "lb" }])]);
    const after = await state(sku);
    await refuses(() => apply({ sku, expected: live, snapshot: snap, pars: [{ location_id: null, slot: "weekday", expected: 3, to: 2, patch: null }] }),
      "sku_pack_change:dependencies_changed", "A3: a shop gained its own case after the preview (its par must not convert)");
    check(await state(sku) === after, "A3: …nothing written");
  }
  {
    const { sku, live } = await freshSku();
    const snap = await snapshot(sku, await allShops());
    await db.exec("reset role;");
    await db.query("insert into public.locations values ($1, true)", [S_NEW]);
    await db.exec("set role service_role;");
    await refuses(() => apply({ sku, expected: live, snapshot: snap }), "sku_pack_change:dependencies_changed", "A3: a new active shop after the preview (a global save would reach it unseen)");
    await db.exec("reset role;");
    await db.query("update public.locations set active = false where id = $1", [S_NEW]);
    await db.exec("set role service_role;");
  }
  {
    const { sku, live } = await freshSku();
    const snap = await snapshot(sku, [S1]);
    await refuses(() => apply({ sku, expected: live, snapshot: snap }), "sku_pack_change:dependencies_changed", "A3: a global save whose snapshot does not cover every active shop");
    const shopSnap = await snapshot(sku, [S1]);
    await refuses(() => apply({ sku, location: S2, expected: null, basedOn: live, snapshot: shopSnap }), "sku_pack_change:invalid_payload", "A3: a shop save whose snapshot does not cover that shop");
  }

  // ── A4 "give this shop its own par" ──────────────────────────────────────
  {
    const { sku, live } = await freshSku();
    await setOverlay(sku, S3, { auto_weekday_par: 6, auto_weekday_baseline_par: 3, auto_weekday_pack_epoch: 0 });
    let snap = await snapshot(sku, [S2]);
    const r = await apply({ sku, location: S2, expected: null, basedOn: live, snapshot: snap, pars: [
      { location_id: S2, slot: "weekday", expected: 3, to: 2, inherited: true, from: "global", patch: humanPatch("weekday", 2) },
    ] });
    const s2 = await one("select weekday_par::text as wd from public.location_sku_settings where sku_id = $1 and location_id = $2", [sku, S2]);
    const g = await one("select weekday_par::text as wd from public.vendor_items where id = $1", [sku]);
    check(r.pars_converted === 1 && Number(s2.wd) === 2 && Number(g.wd) === 3, "A4: an inherited global par becomes S2's OWN slot (2); the global par stays 3");
    snap = await snapshot(sku, [S3]);
    const r3 = await apply({ sku, location: S3, expected: null, basedOn: live, snapshot: snap, pars: [
      { location_id: S3, slot: "weekday", expected: 6, to: 3, inherited: true, from: "auto", patch: humanPatch("weekday", 3) },
    ] });
    const s3 = await one("select weekday_par::text as wd, auto_weekday_par from public.location_sku_settings where sku_id = $1 and location_id = $2", [sku, S3]);
    check(r3.pars_converted === 1 && Number(s3.wd) === 3 && s3.auto_weekday_par === null, "A4: S3's AUTO par (6) becomes its own human par (3); the machine lane is cleared by the admin patch");
    // S2 now HAS its own slot: creating it again is refused (it is no longer empty).
    snap = await snapshot(sku, [S2]);
    const live2 = (await one("select id from public.sku_pack_versions where sku_id = $1 and location_id = $2 and active", [sku, S2])).id;
    const before = await state(sku);
    await refuses(() => apply({ sku, location: S2, expected: live2, snapshot: snap, levels: OZ_BAG, pars: [
      { location_id: S2, slot: "weekday", expected: 3, to: 2, inherited: true, from: "global", patch: humanPatch("weekday", 2) },
    ] }), "sku_pack_change:par_changed", "A4: an 'own par' into a slot that is no longer empty");
    check(await state(sku) === before, "A4: …nothing written");
    await refuses(async () => apply({ sku, expected: (await one("select id from public.sku_pack_versions where sku_id = $1 and location_id is null and active", [sku])).id,
      snapshot: await snapshot(sku, await allShops()), pars: [
        { location_id: S1, slot: "weekday", expected: 3, to: 2, inherited: true, from: "global", patch: humanPatch("weekday", 2) },
      ] }), "sku_pack_change:par_lane_mismatch", "A4: an 'own par' on a GLOBAL save");
    await refuses(async () => apply({ sku, location: S1, expected: null, basedOn: live, snapshot: await snapshot(sku, [S1]), pars: [
      { location_id: S1, slot: "weekday", expected: 3, to: 2, inherited: true, from: "human", patch: humanPatch("weekday", 2) },
    ] }), "sku_pack_change:invalid_payload", "A4: an unknown source");
  }

  // ── A4b the "own par" insert race (chunk-2 review P3c) ───────────────────────
  // No row existed to lock, and a concurrent writer creates the shop's row before our insert: the
  // unique (location_id, sku_id) is hit. Simulated with a BEFORE INSERT trigger that inserts the same
  // (shop, sku) first; the apply must refuse it by NAME and write nothing.
  {
    const { sku, live } = await freshSku();
    await db.exec("reset role;");
    await db.exec(`
      create function public.harness_race() returns trigger language plpgsql as $f$
      begin
        if pg_trigger_depth() = 1 then
          insert into public.location_sku_settings (location_id, sku_id, weekday_par) values (new.location_id, new.sku_id, 9);
        end if;
        return new;
      end $f$;
      create trigger harness_race before insert on public.location_sku_settings for each row execute function public.harness_race();`);
    await db.exec("set role service_role;");
    const snap = await snapshot(sku, [S1]);
    const before = await state(sku);
    await refuses(() => apply({ sku, location: S1, expected: null, basedOn: live, snapshot: snap, pars: [
      { location_id: S1, slot: "weekday", expected: 3, to: 2, inherited: true, from: "global", patch: humanPatch("weekday", 2) },
    ] }), "sku_pack_change:par_changed", "A4b: a concurrent writer created the shop's par row first → par_changed (never a bare 23505)");
    check(await state(sku) === before, "A4b: …and nothing was written (the racing row and the version roll back too)");
    await db.exec("reset role; drop trigger harness_race on public.location_sku_settings; drop function public.harness_race(); set role service_role;");
  }

  // ── A5 the report is bound ───────────────────────────────────────────────
  {
    const a = await freshSku();
    const b = await freshSku();
    const reqB = await fileRequest(b.sku, S1);
    const reqA2 = await fileRequest(a.sku, S2);
    const before = await state(a.sku);
    await refuses(() => apply({ sku: a.sku, expected: a.live, request: reqB, snapshot: undefined }), "sku_pack_change:invalid_payload", "A5: no snapshot at all");
    await refuses(async () => apply({ sku: a.sku, expected: a.live, request: reqB, snapshot: await snapshot(a.sku, await allShops()) }), "sku_pack_change:request_mismatch", "A5: another SKU's report");
    await refuses(async () => apply({ sku: a.sku, location: S1, expected: null, basedOn: a.live, request: reqA2, snapshot: await snapshot(a.sku, [S1]) }), "sku_pack_change:request_mismatch", "A5: another shop's report on a shop save");
    check(await state(a.sku) === before, "A5: …nothing written");
    await db.query("update public.sku_pack_change_requests set status = 'dismissed', resolved_at = now(), resolved_by = $2 where id = $1", [reqA2, USER]);
    await refuses(async () => apply({ sku: a.sku, location: S2, expected: null, basedOn: a.live, request: reqA2, snapshot: await snapshot(a.sku, [S2]) }), "sku_pack_change:request_not_open", "A5: a report already closed");
    // A global save cannot answer the report of a shop that keeps its own case.
    await db.query("select public.save_sku_pack_version($1, $2, $3::jsonb, null, null, null, null, false)", [b.sku, S1, JSON.stringify([{ label: "crate", containsQty: 12, containsMeasureUnit: "lb" }])]);
    await refuses(async () => apply({ sku: b.sku, expected: b.live, request: reqB, snapshot: await snapshot(b.sku, await allShops()) }), "sku_pack_change:request_mismatch", "A5: a global save answering a shop-with-its-own-case's report");
  }

  // ── A6 named refusals; one open report ───────────────────────────────────
  {
    const { sku, live } = await freshSku();
    await setOverlay(sku, S1, { weekday_par: 5 });
    const snap = await snapshot(sku, await allShops());
    await refuses(() => apply({ sku, expected: live, snapshot: snap, pars: [{ location_id: S1, slot: "weekday", expected: 5, to: 3, patch: { weekday_par: 3, weekend_par: 9 } }] }),
      "sku_pack_change:invalid_patch", "A6: a patch reaching the OTHER slot");
    await refuses(() => apply({ sku, expected: live, snapshot: snap, pars: [{ location_id: S1, slot: "weekday", expected: 5, to: 3, patch: { weekday_par: 4 } }] }),
      "sku_pack_change:invalid_patch", "A6: a patch whose value is not the conversion's");
    await refuses(() => apply({ sku, location: S1, expected: null, basedOn: live, snapshot: snap, pars: [{ location_id: null, slot: "weekday", expected: 3, to: 2 }] }),
      "sku_pack_change:par_lane_mismatch", "A6: a shop save (its snapshot a superset, still re-checked) converting the GLOBAL par");
    await refuses(async () => apply({ sku, location: S1, expected: null, basedOn: live, snapshot: await snapshot(sku, [S1]), pars: [{ location_id: null, slot: "weekday", expected: 3, to: 2 }] }),
      "sku_pack_change:par_lane_mismatch", "A6: a shop save converting the GLOBAL par");
    await refuses(async () => apply({ sku, location: S1, expected: null, basedOn: live, snapshot: await snapshot(sku, [S1]), pars: [{ location_id: S2, slot: "weekday", expected: 3, to: 2, patch: humanPatch("weekday", 2) }] }),
      "sku_pack_change:par_lane_mismatch", "A6: a shop save converting ANOTHER shop's par");
    await refuses(() => apply({ sku, expected: live, snapshot: snap, pars: [{ location_id: S1, slot: "monday", expected: 5, to: 3 }] }), "sku_pack_change:invalid_payload", "A6: an unknown slot");
    await fileRequest(sku, S3);
    await refuses(() => fileRequest(sku, S3), "sku_pack_change_requests_one_open", "A6: a second OPEN report for the same (sku, shop)");
  }

  // ── A8 the atomic PRICE apply (full-branch r1 P2-2) ──────────────────────
  {
    const { sku } = await freshSku();
    const priceSnap = async (shops) => (await one("select public.sku_price_snapshot($1, $2::uuid[]) as s", [sku, shops])).s;
    const applyPrice = (loc, price, date, snap) => db.query(
      "select public.apply_sku_price_change($1, $2, $3, $4::date, $5, false, $6::jsonb) as r", [sku, loc, price, date, USER, snap == null ? null : JSON.stringify(snap)],
    ).then((res) => res.rows[0].r);
    const rows = async () => (await db.query("select unit_price::text as p, effective_date::text as d, location_id from public.vendor_price_history where vendor_item_id = $1 order by recorded_at, id", [sku])).rows;
    // A global head of $100 dated Oct 15.
    await applyPrice(null, 100, "2026-10-15", null);
    // The preview for S1 promised: a $90 row dated Oct 15 becomes S1's current price.
    const snap = await priceSnap([S1]);
    // …and a concurrent writer lands a LATER-dated lane price for S1 in between (Oct 16).
    await db.query("select public.save_sku_shop_price($1, $2, 95, '2026-10-16', $3, null, null)", [sku, S1, USER]);
    const before = JSON.stringify(await rows());
    await refuses(() => applyPrice(S1, 90, "2026-10-15", snap), "sku_price:price_changed", "A8: a later-dated price landed between the preview and the save");
    check(JSON.stringify(await rows()) === before, "A8: …and nothing was written");
    // A fresh preview (snapshot) of the new state saves.
    const fresh = await priceSnap([S1]);
    const ok = await applyPrice(S1, 90, "2026-10-17", fresh);
    check(ok.price_id && ok.lane_id && ok.lane_created === false, "A8: with the snapshot it was shown, the shop price saves into the shop's lane");
    // A GLOBAL save: a new global head in between refuses it too; the global writer runs inside.
    const gsnap = await priceSnap(await allShops());
    await applyPrice(null, 101, "2026-10-18", null); // the concurrent writer
    await refuses(() => applyPrice(null, 102, "2026-10-17", gsnap), "sku_price:price_changed", "A8: a global head that moved after the preview");
    const g2 = await applyPrice(null, 102, "2026-10-19", await priceSnap(await allShops()));
    check(g2.price_id != null, "A8: the global save goes through 0259's global writer with a current snapshot");
    // A shop that opened its own lane after a global preview changes who the save reaches.
    const gsnap2 = await priceSnap(await allShops());
    await db.query("select public.save_sku_shop_price($1, $2, 80, '2026-10-19', $3, null, null)", [sku, S2, USER]);
    await refuses(() => applyPrice(null, 103, "2026-10-20", gsnap2), "sku_price:price_changed", "A8: a shop opened its own price lane after the global preview");
    await refuses(async () => applyPrice(S1, 90, "2026-10-20", await priceSnap([S2])), "sku_price:invalid_payload", "A8: a shop save whose snapshot does not cover that shop");
  }

  // ── A9 filing JOINS the open report and ADDS what it brought (chunk-3 review P3a) ──
  {
    const { sku, live } = await freshSku();
    await db.exec("reset role;");
    await db.query("insert into public.photos (id, location_id) values ($1, $2), ($3, $4)", [u(901), S1, u(902), S2]);
    await db.query("insert into public.vendor_deliveries (id, location_id) values ($1, $2)", [u(911), S2]);
    await db.exec("set role service_role;");
    const file = (note, photo, proposal = null, delivery = null) => db.query(
      "select public.file_sku_pack_change_request($1, $2, $3, $4, $5::jsonb, $6, $7) as r",
      [sku, S1, delivery, note, proposal == null ? null : JSON.stringify(proposal), photo, USER]).then((res) => res.rows[0].r);
    const first = await file("4 bags not 6", null);
    check(first.already === false && first.added === false, "A9: the first report opens one");
    const second = await file("  they're 10 lb now ", u(901), { innerCount: 4 });
    check(second.id === first.id && second.already === true && second.added === true, "A9: the second report JOINS the open one and its note, numbers and photo are ADDED");
    const adds = (await db.query("select note, photo_id, proposal from public.sku_pack_change_request_additions where request_id = $1", [first.id])).rows;
    check(adds.length === 1 && adds[0].note === "they're 10 lb now" && adds[0].photo_id === u(901) && adds[0].proposal.innerCount === 4, "A9: …kept as an addition, trimmed");
    const third = await file(null, null);
    check(third.already === true && third.added === false, "A9: a bare tap joins and adds nothing (nothing to add)");
    await refuses(() => file("x", u(902)), "sku_pack_change:photo_not_found", "A9: another shop's photo is refused by name");
    await refuses(() => file("x", null, null, u(911)), "sku_pack_change:delivery_not_found", "A9: another shop's delivery is refused by name");
    await refuses(() => db.query("update public.sku_pack_change_request_additions set note = 'edited'"), "permission denied", "A9: additions are append-only for service_role");
    // Once the GM's save closes the report, the next report opens a NEW one.
    await apply({ sku, location: S1, expected: null, basedOn: live, request: first.id, snapshot: await snapshot(sku, [S1]) });
    const after = await file("still different", null);
    check(after.already === false && after.id !== first.id, "A9: after the report is applied, the next one opens a new report");
  }

  // ── A7 privileges ────────────────────────────────────────────────────────
  await refuses(() => db.query("delete from public.sku_pack_change_requests"), "permission denied", "A7: service_role cannot DELETE a report");
  await db.exec("reset role; set role authenticated;");
  await refuses(() => db.query("select public.apply_sku_pack_change(null, null, null, null, null, null, null, false, null, null, null)"), "permission denied", "A7: authenticated cannot execute the apply");
  await refuses(() => db.query("select public.apply_sku_price_change(null, null, null, null, null, false, null)"), "permission denied", "A7: authenticated cannot execute the price apply");
  await refuses(() => db.query("select public.sku_price_snapshot(null, null)"), "permission denied", "A7: authenticated cannot read the price snapshot");
  await refuses(() => db.query("select * from public.sku_pack_change_requests"), "permission denied", "A7: authenticated cannot read the reports");
  await db.exec("reset role;");

  if (failures > 0) { console.error(`\n${failures} check(s) FAILED`); process.exitCode = 1; }
  else console.log("\nPASS 0261: atomic pack+par+report apply (A1), all-or-nothing refusals (A2), the snapshot re-check under the lock (A3), own-par from global/auto (A4), report binding (A5), named refusals (A6), privileges (A7), the atomic price apply (A8), filing joins and adds (A9)");
} finally { await db.close(); }
