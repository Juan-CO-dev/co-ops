/**
 * Local Postgres proof of migration 0335 (the Toast menu map confirm in one transaction, bug-audit wave W27, B230),
 * SYNTHETIC ROWS ONLY — PGlite, in memory. CC owns the Supabase sim/prod gate; this never touches a real database.
 *
 *   node scripts/sql-harness-0335.mjs
 *
 * Applies a small inline stub (Supabase roles + default privileges, locations, menu_items, items, catering_packages,
 * vendor_items), then the REAL 0146 + 0151 + 0152, the REAL toast_menu_map ALTER statements of 0155 / 0158 / 0226
 * (package_id, sku_id, parent_only, the final entity / disposition checks), 0264's REAL shop_owned_graph_lock()
 * body on a statement trigger (the graph lock every active-changing write takes), and 0335, and proves:
 *   C0  the preflight refuses without toast_menu_map; a second apply is a no-op (idempotent)
 *   C1  posture: one signature, SECURITY DEFINER, pinned search_path, EXECUTE for service_role only
 *   C2  confirming A deactivates its rival B and confirms A in one call (superseded = 1)
 *   C3  the race outcome, serialized: confirming B afterwards refuses toast_map:conflict, A stays confirmed, and the
 *       GUID keeps exactly one active row
 *   C4  an open_item rival refuses toast_map:open_item_guid and NO row is deactivated
 *   C5  a row of another shop / an unknown id refuses toast_map:not_found; a non-candidate toast_map:not_candidate
 *   C6  atomicity: a failure after the supersede (the confirm UPDATE refused by a trigger) rolls the supersede back
 *   C7  the graph advisory lock 7258025800 is held by the confirming transaction (taken before the row locks — the
 *       order is pinned in the body by tests/toast-map-confirm-migration.test.ts)
 * The two-session proof (two rival confirms at once) needs two connections and is sim-only:
 * scripts/sim/toast-map-0335-confirm-lock-check.mjs.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const M0146 = read("supabase/migrations/0146_toast_menu_crosswalk.sql");
const M0151 = read("supabase/migrations/0151_toast_map_multi_guid.sql");
const M0152 = read("supabase/migrations/0152_toast_map_modifier_lane.sql");
/** Every `alter table public.toast_menu_map …;` statement of a migration, in file order. */
const mapAlters = (file) => {
  const src = read(file);
  const out = [];
  let i = src.indexOf("alter table public.toast_menu_map");
  while (i >= 0) {
    const j = src.indexOf(";", i);
    out.push(src.slice(i, j + 1));
    i = src.indexOf("alter table public.toast_menu_map", j);
  }
  if (out.length === 0) throw new Error(`expected toast_menu_map alters in ${file}`);
  return out.join("\n");
};
const ALTERS = ["0155_platter_depletion", "0158_sku_modifier_targets", "0226_depletion_specs_abcd"]
  .map((m) => mapAlters(`supabase/migrations/${m}.sql`)).join("\n");
const GRAPH_LOCK = (() => {
  const src = read("supabase/migrations/0264_catalog_shop_owned.sql");
  const i = src.indexOf("create or replace function public.shop_owned_graph_lock()");
  const j = src.indexOf("end $$;", i);
  if (i < 0 || j < 0) throw new Error("expected 0264's shop_owned_graph_lock()");
  return `${src.slice(i, j + "end $$;".length)}
create trigger shop_owned_lock before insert or update of location_id, menu_item_id, item_id, sku_id, active
  on public.toast_menu_map for each statement execute function public.shop_owned_graph_lock();`;
})();
const M0335 = read("supabase/migrations/0335_toast_map_confirm_atomic.sql");

const STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create table public.locations (id uuid primary key default gen_random_uuid());
create table public.menu_items (id uuid primary key default gen_random_uuid());
create table public.items (id uuid primary key default gen_random_uuid());
create table public.catering_packages (id uuid primary key default gen_random_uuid());
create table public.vendor_items (id uuid primary key default gen_random_uuid());
`;

let failures = 0;
let checks = 0;
const check = (ok, what) => { checks++; if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
async function refuses(fn, code, what) {
  try { await fn(); check(false, `${what} (no error; expected ${code})`); }
  catch (e) { const s = `${e.code ?? ""} ${e.message}`; check(s.includes(code), `${what} → ${code}${s.includes(code) ? "" : ` (got: ${s})`}`); }
}

const SHOP = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const ACTOR = "00000000-0000-4000-8000-0000000000c3";

async function base() {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(M0146);
  await db.exec(M0151);
  await db.exec(M0152);
  await db.exec(ALTERS);
  await db.exec(GRAPH_LOCK);
  await db.exec(`insert into public.locations (id) values ('${SHOP}'), ('${OTHER}');`);
  return db;
}
async function menuItem(db) {
  return (await db.query("insert into public.menu_items default values returning id")).rows[0].id;
}
async function row(db, { loc = SHOP, guid = "g1", status = "candidate", disposition = "deplete", active = true, entity = true } = {}) {
  const m = entity ? await menuItem(db) : null;
  const r = await db.query(
    `insert into public.toast_menu_map (location_id, menu_item_id, toast_item_guid, toast_item_name, match_status, disposition, active)
     values ($1, $2, $3, 'Toast item', $4, $5, $6) returning id`, [loc, m, guid, status, disposition, active]);
  return r.rows[0].id;
}
const confirm = (db, id, loc = SHOP) => db.query("select public.confirm_toast_mapping($1, $2, $3) as r", [id, loc, ACTOR]);
const get = async (db, id) => (await db.query("select active, match_status, confirmed_by from public.toast_menu_map where id = $1", [id])).rows[0];
const activeOn = async (db, guid, loc = SHOP) =>
  Number((await db.query("select count(*)::int as n from public.toast_menu_map where location_id = $1 and toast_item_guid = $2 and active", [loc, guid])).rows[0].n);

// ── C0 preflight + idempotent ────────────────────────────────────────────────
{
  const bare = new PGlite();
  await bare.exec(STUB);
  await refuses(() => bare.exec(M0335), "0335: public.toast_menu_map missing", "C0 preflight refuses without 0146");
  const db = await base();
  await db.exec(M0335);
  await db.exec(M0335);
  check(true, "C0 a second apply is a no-op");

  // ── C1 posture ─────────────────────────────────────────────────────────────
  const privs = (await db.query(
    `select grantee from information_schema.routine_privileges where routine_schema = 'public' and routine_name = 'confirm_toast_mapping'`)).rows.map((r) => r.grantee);
  check(privs.includes("service_role") && !privs.includes("anon") && !privs.includes("authenticated") && !privs.includes("PUBLIC"),
    `C1 EXECUTE for service_role only (got ${privs.join(", ")})`);
  const p = (await db.query(`select prosecdef, proconfig from pg_proc where proname = 'confirm_toast_mapping'`)).rows;
  check(p.length === 1 && p[0].prosecdef === true && (p[0].proconfig ?? []).includes("search_path=pg_catalog, public"),
    "C1 one signature, SECURITY DEFINER, pinned search_path");

  // ── C2 confirm A supersedes rival B ────────────────────────────────────────
  const a = await row(db, { guid: "g2" });
  const b = await row(db, { guid: "g2" });
  const other = await row(db, { guid: "g2", loc: OTHER });
  const r = (await confirm(db, a)).rows[0].r;
  check(r.superseded === 1 && r.location_id === SHOP, `C2 superseded = 1 (got ${JSON.stringify(r)})`);
  const ra = await get(db, a), rb = await get(db, b);
  check(ra.active && ra.match_status === "confirmed" && ra.confirmed_by === ACTOR, "C2 A confirmed by the actor");
  check(rb.active === false && rb.match_status === "candidate", "C2 rival B deactivated (still a candidate, history kept)");
  check((await get(db, other)).active === true, "C2 the same GUID at another shop is untouched");

  // ── C3 the race, serialized ────────────────────────────────────────────────
  await refuses(() => confirm(db, b), "toast_map:conflict", "C3 confirming B after A refuses");
  check((await get(db, a)).match_status === "confirmed" && (await activeOn(db, "g2")) === 1, "C3 A stays confirmed; exactly one active row on the GUID");

  // ── C4 open_item rival ─────────────────────────────────────────────────────
  const c = await row(db, { guid: "g3" });
  const open = await row(db, { guid: "g3", disposition: "open_item", entity: false });
  await refuses(() => confirm(db, c), "toast_map:open_item_guid", "C4 an open_item rival refuses");
  check((await get(db, c)).match_status === "candidate" && (await get(db, open)).active === true && (await activeOn(db, "g3")) === 2,
    "C4 nothing deactivated, nothing confirmed");

  // ── C5 refusals by name ────────────────────────────────────────────────────
  const d = await row(db, { guid: "g4" });
  await refuses(() => confirm(db, d, OTHER), "toast_map:not_found", "C5 a row named with another shop");
  await refuses(() => confirm(db, "00000000-0000-4000-8000-00000000dead"), "toast_map:not_found", "C5 an unknown id");
  const rejected = await row(db, { guid: "g5", status: "rejected" });
  await refuses(() => confirm(db, rejected), "toast_map:not_candidate", "C5 a non-candidate");
  check((await get(db, d)).match_status === "candidate", "C5 refusals change nothing");

  // ── C6 atomicity ───────────────────────────────────────────────────────────
  const e = await row(db, { guid: "g6" });
  const f = await row(db, { guid: "g6" });
  await db.exec(`create function public.harness_refuse_confirm() returns trigger language plpgsql as $$
    begin if new.match_status = 'confirmed' and new.toast_item_guid = 'g6' then raise exception 'harness: confirm refused'; end if; return new; end $$;
    create trigger harness_refuse before update on public.toast_menu_map for each row execute function public.harness_refuse_confirm();`);
  await refuses(() => confirm(db, e), "harness: confirm refused", "C6 a failing confirm");
  check((await get(db, f)).active === true && (await activeOn(db, "g6")) === 2, "C6 the supersede rolled back with it (rival still active)");
  await db.exec("drop trigger harness_refuse on public.toast_menu_map;");

  // ── C7 the graph lock ──────────────────────────────────────────────────────
  const g = await row(db, { guid: "g7" });
  await db.exec("begin;");
  await confirm(db, g);
  const locks = (await db.query(
    `select count(*)::int as n from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()
       and ((classid::bigint << 32) | objid::bigint) = 7258025800`)).rows[0].n;
  await db.exec("rollback;");
  check(locks >= 1, `C7 the graph advisory lock 7258025800 is held by the confirming transaction (${locks})`);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
