/**
 * Local Postgres proof of migration 0263 (catalog Phase 3a), SYNTHETIC ROWS ONLY — PGlite, in memory.
 * CC still owns the Supabase sim/prod gate (plan Task 12); this never touches a real database.
 *
 *   node scripts/sql-harness-0263.mjs
 *
 * Executes the REAL 0258 → 0262 + 0263 over tests/fixtures/recipe-versions-pglite-stub.sql, then proves:
 *   M1  save: a shop overlay opens, a re-save closes the live row and opens the next (append-only, optimistic).
 *   M2  every save refusal by name, and a refused save writes nothing.
 *   M3  the SCOPED snapshot: an unrelated SKU never stales it; an ingredient of a recipe that MAKES the item does.
 *   M4  restore (own history only) and back to default (by name: not_found, not_live).
 *   M5  promote: compare-and-set on the global values; the source shop returns to the default for the promoted
 *       fields in the same transaction (a remaining row carries what it still says); changed shops FIELD BY FIELD.
 *   M6  the privilege ceiling and the writers' grants; M7 every writer holds the graph lock 7258025800.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const u = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ACTOR = u(1);
const S1 = u(11), S2 = u(12), S3 = u(13), S_OFF = u(14);
const K1 = u(41), K_UNREL = u(45);
const M1 = u(61), M2 = u(62), M_OFF = u(63);
const R1 = u(71);
const NIL = "00000000-0000-0000-0000-000000000000";
const LOCK_KEY = 7258025800n;

const db = new PGlite();
let failures = 0;
const check = (ok, what) => { if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
async function refuses(fn, code, what) {
  try { await fn(); check(false, `${what} (no error; expected ${code})`); }
  catch (e) { const msg = String(e.message); check(msg.includes(code), `${what} → ${code}${msg.includes(code) ? "" : ` (got: ${msg})`}`); }
}
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const asOwner = async (fn) => { await db.exec("reset role;"); try { return await fn(); } finally { await db.exec("set role service_role;"); } };
const J = (v) => (v === null || v === undefined ? null : JSON.stringify(v));

const snapshot = async (item, scope) => (await one("select public.menu_item_change_snapshot($1::uuid, $2::uuid) as s", [item, scope])).s;
async function save(a) {
  const snap = a.snap !== undefined ? a.snap : await snapshot(a.item ?? M1, a.shop);
  return (await one(
    "select public.save_menu_item_shop_setting($1::uuid, $2::uuid, $3::numeric, $4, $5, $6, $7::uuid, $8, $9::uuid, $10::uuid, $11::jsonb) as r",
    [a.item ?? M1, a.shop, a.price ?? null, a.soldHere ?? null, a.name ?? null, a.nameEs ?? null, a.expected ?? null, a.note ?? null, ACTOR,
     a.restoredFrom ?? null, J(snap)])).r;
}
async function retire(a) {
  const snap = a.snap !== undefined ? a.snap : await snapshot(a.item ?? M1, a.shop);
  return (await one("select public.retire_menu_item_shop_setting($1::uuid, $2::uuid, $3::uuid, $4::jsonb) as r", [a.setting, a.shop, ACTOR, J(snap)])).r;
}
async function promote(a) {
  const item = await one("select menu_price::text as p, name, name_es from public.menu_items where id = $1", [a.item ?? M1]);
  const snap = a.snap !== undefined ? a.snap : await snapshot(a.item ?? M1, NIL);
  return (await one("select public.promote_menu_item_shop_setting($1::uuid, $2::text[], $3::numeric, $4, $5, $6::uuid, $7::jsonb) as r",
    [a.setting, a.fields, a.expectedPrice !== undefined ? a.expectedPrice : item.p, a.expectedName !== undefined ? a.expectedName : item.name,
     item.name_es, ACTOR, J(snap)])).r;
}
const live = async (item, shop) => one("select * from public.menu_item_shop_settings where menu_item_id = $1 and location_id = $2 and active", [item, shop]);
const state = async () => JSON.stringify({
  s: await all("select id, location_id, active, price::text, sold_here, name_override from public.menu_item_shop_settings order by id"),
  m: await all("select id, menu_price::text, name, name_es from public.menu_items order by id"),
});
const lockHeld = async () => Boolean((await one(
  `select exists (select 1 from pg_locks where locktype = 'advisory' and granted and pid = pg_backend_pid()
                    and ((classid::bigint << 32) | objid::bigint) = $1) as held`, [String(LOCK_KEY)])).held);
async function lockedInTxn(fn) { await db.exec("begin;"); try { await fn(); return await lockHeld(); } finally { await db.exec("rollback;"); } }

try {
  await db.exec("set timezone = 'UTC';");
  await db.exec(readFileSync("tests/fixtures/recipe-versions-pglite-stub.sql", "utf8"));
  for (const m of ["0258_recipe_input_write_atomic", "0259_sku_shop_versions", "0260_sku_pack_versions_finalize",
    "0261_sku_pack_change_requests", "0262_recipe_shop_versions"]) {
    await db.exec(readFileSync(`supabase/migrations/${m}.sql`, "utf8"));
  }
  await db.exec(`
    insert into public.users values ('${ACTOR}');
    insert into public.locations(id, name, active) values ('${S1}', 'One', true), ('${S2}', 'Two', true), ('${S3}', 'Three', true), ('${S_OFF}', 'Closed', false);
    insert into public.measure_units(label, active) values ('oz', true);
    insert into public.vendor_items(id, name, each_measure) values ('${K1}', 'Turkey', 'oz'), ('${K_UNREL}', 'Unrelated', 'oz');
    insert into public.menu_items(id, name, name_es, menu_price, active) values ('${M1}', 'Italian', 'Italiano', 12.50, true),
      ('${M2}', 'Pickle side', null, 2.25, true), ('${M_OFF}', 'Old sub', null, 9, false);
    begin;
    insert into public.recipes(id, name) values ('${R1}', 'Italian');
    insert into public.recipe_outputs(recipe_id, output_menu_item_id) values ('${R1}', '${M1}');
    insert into public.recipe_inputs(recipe_id, component_sku_id, quantity, unit) values ('${R1}', '${K1}', 4, 'oz');
    commit;
  `);
  await db.exec(readFileSync("supabase/migrations/0263_menu_item_shop_settings.sql", "utf8"));
  console.log("ok   0258 → 0263 applied (0263's privilege guard passed)");
  await db.exec("set role service_role;");

  // ── M1 save ──────────────────────────────────────────────────────────────
  const a = await save({ shop: S1, price: 13.25 });
  let row = await one("select * from public.menu_item_shop_settings where id = $1", [a.setting_id]);
  check(row.active && Number(row.price) === 13.25 && row.sold_here === true && row.name_override === null && row.created_by === ACTOR,
    "M1: S1's price here opens a live overlay row (sold here, the global name)");
  const b = await save({ shop: S1, price: 13.75, name: "Italiano Grande", expected: a.setting_id });
  const old = await one("select active, valid_to::text as vt from public.menu_item_shop_settings where id = $1", [a.setting_id]);
  row = await one("select based_on_setting_id, valid_from::text as vf from public.menu_item_shop_settings where id = $1", [b.setting_id]);
  check(!old.active && old.vt === row.vf && row.based_on_setting_id === a.setting_id && b.retired_setting_id === a.setting_id,
    "M1: a re-save closes the live row exactly when the next opens, based on it");
  const off = await save({ shop: S2, soldHere: false });
  check(Boolean(off.setting_id), "M1: 'not sold here' alone is a valid overlay");

  // ── M2 refusals ──────────────────────────────────────────────────────────
  {
    const before = await state();
    await refuses(async () => save({ shop: S1, price: 14, expected: a.setting_id }), "menu_item_shop:version_changed", "M2: a stale expected row");
    await refuses(async () => save({ shop: S3, price: 14, expected: b.setting_id }), "menu_item_shop:version_changed", "M2: expecting a row the shop does not have");
    await refuses(async () => save({ shop: S3 }), "menu_item_shop:empty_setting", "M2: a row that says nothing");
    for (const [p, what] of [[0, "zero"], [1000.01, "over 1000"], [1.234, "fractions of a cent"]]) {
      await refuses(async () => save({ shop: S3, price: p }), "menu_item_shop:invalid_price", `M2: a price ${what}`);
    }
    await refuses(async () => save({ shop: S3, name: "x".repeat(121) }), "menu_item_shop:invalid_name", "M2: a 121-character name");
    await refuses(async () => save({ shop: S_OFF, price: 10 }), "menu_item_shop:location_not_found", "M2: a closed shop");
    await refuses(async () => save({ item: M_OFF, shop: S3, price: 10 }), "menu_item_shop:menu_item_not_found", "M2: a menu item taken off everywhere");
    await refuses(async () => save({ item: u(999), shop: S3, price: 10, snap: {} }), "menu_item_shop:menu_item_not_found", "M2: an unknown menu item");
    await refuses(async () => save({ shop: S3, price: 10, snap: null }), "menu_item_shop:dependencies_changed", "M2: no snapshot");
    await refuses(async () => save({ shop: S3, price: 10, snap: { stale: true } }), "menu_item_shop:dependencies_changed", "M2: a snapshot that is not the current one");
    check(await state() === before, "M2: …and none of those wrote anything");
  }

  // ── M3 the scoped snapshot ───────────────────────────────────────────────
  {
    const s0 = await snapshot(M1, S3);
    await asOwner(() => db.query("update public.vendor_items set updated_at = now() + interval '1 second' where id = $1", [K_UNREL]));
    check(JSON.stringify(await snapshot(M1, S3)) === JSON.stringify(s0), "M3: an unrelated SKU leaves the menu snapshot alone");
    await asOwner(() => db.query("update public.vendor_items set updated_at = now() + interval '2 seconds' where id = $1", [K1]));
    check(JSON.stringify(await snapshot(M1, S3)) !== JSON.stringify(s0), "M3: an ingredient of the recipe that MAKES the item moves it (its cost moved)");
    await refuses(async () => save({ shop: S3, price: 10, snap: s0 }), "menu_item_shop:dependencies_changed", "M3: …and a save bound to the old one is refused");
    const m2a = await snapshot(M2, S3);
    await asOwner(() => db.query("update public.vendor_items set updated_at = now() + interval '3 seconds' where id = $1", [K1]));
    check(JSON.stringify(await snapshot(M2, S3)) === JSON.stringify(m2a), "M3: …while an item no recipe of K1 makes is untouched by it");
  }

  // ── M4 restore and back to default ───────────────────────────────────────
  {
    const r = await save({ shop: S1, restoredFrom: a.setting_id, expected: b.setting_id });
    row = await one("select price::text as p, name_override, based_on_setting_id from public.menu_item_shop_settings where id = $1", [r.setting_id]);
    check(Number(row.p) === 13.25 && row.name_override === null && row.based_on_setting_id === a.setting_id, "M4: restore saves an old row's values as a NEW row, based on it");
    await refuses(async () => save({ shop: S3, restoredFrom: a.setting_id }), "menu_item_shop:invalid_source", "M4: restoring ANOTHER shop's row");
    await refuses(async () => retire({ setting: r.setting_id, shop: S2 }), "menu_item_shop:not_found", "M4: back to default under the wrong shop");
    await refuses(async () => retire({ setting: u(998), shop: S1, snap: {} }), "menu_item_shop:not_found", "M4: an unknown row");
    await refuses(async () => retire({ setting: a.setting_id, shop: S1 }), "menu_item_shop:not_live", "M4: a row that is already closed");
    await refuses(async () => retire({ setting: r.setting_id, shop: S1, snap: { stale: true } }), "menu_item_shop:dependencies_changed", "M4: a stale snapshot");
    await retire({ setting: r.setting_id, shop: S1 });
    check(await live(M1, S1) === undefined, "M4: back to default retires the shop's row (kept in history)");
  }

  // ── M5 promote ───────────────────────────────────────────────────────────
  {
    // S1: price 14.50 + name; S2: not sold here (from M1); S3: its own price only.
    const s1 = await save({ shop: S1, price: 14.5, name: "Italiano Grande", nameEs: "Italiano Grande ES" });
    const s3 = await save({ shop: S3, price: 11 });
    const before = await state();
    await refuses(async () => promote({ setting: s1.setting_id, fields: [] }), "menu_item_shop:invalid_payload", "M5: no fields");
    await refuses(async () => promote({ setting: s1.setting_id, fields: ["sold_here"] }), "menu_item_shop:invalid_payload", "M5: sold_here is never promoted");
    await refuses(async () => promote({ setting: u(997), fields: ["price"], snap: {} }), "menu_item_shop:not_found", "M5: an unknown row");
    const s2 = await live(M1, S2);
    await refuses(async () => promote({ setting: s2.id, fields: ["price"] }), "menu_item_shop:nothing_to_promote", "M5: a row with no price cannot promote its price");
    await refuses(async () => promote({ setting: s1.setting_id, fields: ["price"], expectedPrice: "12.40" }), "menu_item_shop:global_changed", "M5: the global price moved since the preview");
    await refuses(async () => promote({ setting: s1.setting_id, fields: ["price"], snap: { stale: true } }), "menu_item_shop:dependencies_changed", "M5: a stale snapshot");
    check(await state() === before, "M5: …none of those wrote anything");
    // Price only: S2 (no own price) changes; S3 (own price) does not; S1 is the returned shop.
    let res = await promote({ setting: s1.setting_id, fields: ["price"] });
    const item = await one("select menu_price::text as p, name from public.menu_items where id = $1", [M1]);
    check(Number(item.p) === 14.5 && item.name === "Italian", "M5: the price is promoted; the name is untouched");
    check(JSON.stringify(res.changed_shops) === JSON.stringify([S2]), `M5: price promoted → only S2 inherits it (S3 keeps its own) (${JSON.stringify(res.changed_shops)})`);
    const src = await one("select active, valid_to::text as vt from public.menu_item_shop_settings where id = $1", [s1.setting_id]);
    const rest = await live(M1, S1);
    check(!src.active && res.returned_shop === S1 && res.remaining_setting_id === rest.id && rest.price === null && rest.name_override === "Italiano Grande"
      && (await one("select valid_from::text as vf from public.menu_item_shop_settings where id = $1", [rest.id])).vf === src.vt,
      "M5: the source returns to the default for the PRICE, its name carries on in a new row opened as the old one closed");
    // Name: S3 has its own price but the default name → it changes; S2 too.
    res = await promote({ setting: rest.id, fields: ["name"] });
    const named = await one("select name, name_es from public.menu_items where id = $1", [M1]);
    check(named.name === "Italiano Grande" && named.name_es === "Italiano Grande ES", "M5: the name (en + es) is promoted");
    check(JSON.stringify(res.changed_shops) === JSON.stringify([S2, S3].sort()), "M5: name promoted → S3 changes too (own price, default name) — field by field");
    check(res.remaining_setting_id === null && await live(M1, S1) === undefined, "M5: nothing left to say → no remaining row; S1 rides the default");
    check((await live(M1, S3)).id === s3.setting_id, "M5: S3's own row is untouched");
  }

  // ── M6 ceiling and grants; M7 the graph lock ─────────────────────────────
  {
    const has = [];
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
      if ((await asOwner(() => one("select has_table_privilege('service_role', 'public.menu_item_shop_settings', $1) as ok", [p]))).ok) has.push(p);
    }
    check(JSON.stringify(has) === JSON.stringify(["SELECT", "INSERT", "UPDATE"]), `M6: service_role on menu_item_shop_settings = exactly SELECT/INSERT/UPDATE (got ${has.join("/")})`);
    await refuses(async () => db.query("delete from public.menu_item_shop_settings"), "permission denied", "M6: service_role cannot DELETE an overlay row");
    await refuses(async () => db.query("select public.menu_item_change_lock($1, null)", [M1]), "permission denied", "M6: the closure-lock helper is not callable directly");
    await db.exec("reset role; set role authenticated;");
    await refuses(async () => db.query("select * from public.menu_item_shop_settings"), "permission denied", "M6: authenticated cannot read overlays");
    for (const f of ["save_menu_item_shop_setting(null, null, null, null, null, null, null, null, null, null, null)",
      "retire_menu_item_shop_setting(null, null, null, null)", "promote_menu_item_shop_setting(null, null, null, null, null, null, null)",
      "menu_item_change_snapshot(null, null)"]) {
      await refuses(async () => db.query(`select public.${f}`), "permission denied", `M6: authenticated cannot execute ${f.split("(")[0]}`);
    }
    await db.exec("reset role; set role service_role;");
    check(await lockedInTxn(async () => save({ shop: S3, price: 12, expected: (await live(M1, S3)).id })), "M7: save holds the graph lock");
    check(await lockedInTxn(async () => retire({ setting: (await live(M1, S3)).id, shop: S3 })), "M7: back to default holds it");
    check(!(await lockedInTxn(async () => db.query("select 1"))), "M7: (control) an idle transaction does not");
  }

  if (failures > 0) { console.error(`\n${failures} check(s) FAILED`); process.exitCode = 1; }
  else console.log("\nPASS 0263: save (M1), every refusal by name (M2), the scoped snapshot (M3), restore + back to default (M4), promote field by field returning the source (M5), the ceiling (M6), the graph lock (M7)");
} finally { await db.close(); }
