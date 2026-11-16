/**
 * Local Postgres proof of migration 0325 (W19: B108 column, B109/B110 po_lines draft-only trigger + confirm RPC,
 * B191 vendor child removal), SYNTHETIC ROWS ONLY — PGlite, in memory. No env, network or real database.
 *
 *   node scripts/sql-harness-0325.mjs
 *
 * The parent tables are extracted VERBATIM from their migrations (purchase_orders / po_lines from 0174,
 * vendor_contacts / vendor_ordering_details from 0092, the 0190 unique index, the 0205 column); only the
 * FK parents that predate the checked-in lineage (users, locations, vendors, vendor_items, par_pass_events) are
 * stubbed with the columns these tables reference. Then it proves:
 *   P0  the pre-flight refuses without 0190's index; 0325 applies and RE-APPLIES cleanly
 *   P1  the trigger: a DRAFT's lines change freely; past draft an INSERT and a qty / unit / note / sku change refuse
 *       po_not_draft; price_cents_at_order and guide_*_snapshot stay writable (confirmPO's advisory freeze); a line
 *       never moves to another PO (po_line_move_refused)
 *   P2  the RPC: flips status + snapshot + confirmer + time + cutoff in one statement when the lines match; refuses
 *       lines_changed (qty edited, unit edited, a line inserted, a wrong count), not_draft, po_not_found,
 *       invalid_confirm_payload; writes nothing when it refuses
 *   P3  remove_vendor_contact / remove_vendor_ordering_detail: deactivate at a count of 2, refuse last_contact /
 *       last_ordering_detail at 1, a second removal of the same row is not_found, a missing id is not_found
 *   P4  ceilings: the three RPCs are SECURITY DEFINER with a pinned search_path, service_role only, no PUBLIC; the
 *       trigger function is executable by nobody; the unconfirmed-email column exists, nullable, no default
 * The two-session proofs (an edit racing a confirm, two removals racing) need real sessions:
 *   scripts/sim-0325-po-lock-check-management.mjs, sim only, run by CC.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = (p) => readFileSync(p, "utf8");
const M0325 = read("supabase/migrations/0325_po_confirm_lines_and_vendor_child_removal.sql");
const extract = (sql, pattern, what) => { const m = sql.match(pattern); if (!m) throw new Error(`cannot extract ${what}`); return m[0]; };
const m0174 = read("supabase/migrations/0174_vendor_ordering.sql");
const m0092 = read("supabase/migrations/0092_vendor_multiprofile.sql");
const PO_DDL = extract(m0174, /CREATE TABLE IF NOT EXISTS public\.purchase_orders \([\s\S]*?\n\);/, "purchase_orders");
const LINES_DDL = extract(m0174, /CREATE TABLE IF NOT EXISTS public\.po_lines \([\s\S]*?\n\);/, "po_lines");
const CONTACTS_DDL = extract(m0092, /create table public\.vendor_contacts \([\s\S]*?\n\);/, "vendor_contacts");
const DETAILS_DDL = extract(m0092, /create table public\.vendor_ordering_details \([\s\S]*?\n\);/, "vendor_ordering_details");
const UQ_0190 = extract(read("supabase/migrations/0190_po_lines_po_sku_unique.sql"), /CREATE UNIQUE INDEX IF NOT EXISTS po_lines_po_sku_uq[\s\S]*?;/, "0190 index");
const COL_0205 = extract(read("supabase/migrations/0205_order_guides.sql"), /alter table public\.po_lines add column if not exists guide_section_snapshot text null;/, "0205 column");

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const I = { actor: id(1), shop: id(2), vendor: id(3), otherVendor: id(4), skuA: id(5), skuB: id(6), skuC: id(7), po: id(8), po2: id(9) };

let failures = 0;
let checks = 0;
const check = (ok, what) => { checks++; if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
async function refuses(fn, code, what) {
  try { await fn(); check(false, `${what} (no error; expected ${code})`); }
  catch (e) { const s = `${e.code ?? ""} ${e.message}`; check(s.includes(code), `${what} → ${code}${s.includes(code) ? "" : ` (got: ${s})`}`); }
}

async function base({ index = true, apply = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.users(id uuid primary key);
    create table public.locations(id uuid primary key);
    create table public.vendors(id uuid primary key, name text not null default 'v');
    create table public.vendor_items(id uuid primary key, vendor_id uuid references public.vendors(id));
    create table public.par_pass_events(id uuid primary key);
  `);
  await db.exec(PO_DDL);
  await db.exec(LINES_DDL);
  await db.exec(COL_0205);
  if (index) await db.exec(UQ_0190);
  await db.exec(CONTACTS_DDL);
  await db.exec(DETAILS_DDL);
  // 0174's posture on the PO tables (the ceilings block asserts the user roles hold nothing there).
  await db.exec(`revoke all on public.purchase_orders, public.po_lines from anon, authenticated, public;
    grant all on public.purchase_orders, public.po_lines, public.vendor_contacts, public.vendor_ordering_details to service_role;`);
  await db.query("insert into users(id) values ($1)", [I.actor]);
  await db.query("insert into locations(id) values ($1)", [I.shop]);
  await db.query("insert into vendors(id) values ($1), ($2)", [I.vendor, I.otherVendor]);
  await db.query("insert into vendor_items(id, vendor_id) values ($1,$4), ($2,$4), ($3,$4)", [I.skuA, I.skuB, I.skuC, I.vendor]);
  if (apply) await db.exec(M0325);
  return db;
}
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
async function draft(db, poId = I.po, code = "CH-1-V") {
  await db.query(`insert into purchase_orders(id, location_id, vendor_id, display_code, status, created_by) values ($1,$2,$3,$4,'draft',$5)`,
    [poId, I.shop, I.vendor, code, I.actor]);
  const l = (await db.query(`insert into po_lines(po_id, sku_id, order_qty, order_unit_label, note) values ($1,$2,2,'cs','n') returning id`, [poId, I.skuA])).rows[0].id;
  return l;
}
const expected = async (db, poId = I.po) => JSON.stringify((await db.query(
  "select id, sku_id, order_qty, order_unit_label from po_lines where po_id=$1 order by created_at", [poId])).rows
  .map((r) => ({ ...r, order_qty: Number(r.order_qty) })));
const SNAP = JSON.stringify({ displayCode: "CH-1-V", lines: [{ skuId: I.skuA, qty: 2 }] });
const confirm = (db, exp, snap = SNAP, poId = I.po) => db.query(
  "select confirm_purchase_order($1, $2::jsonb, $3::jsonb, $4, '2026-11-15T14:00:00Z', null)", [poId, exp, snap, I.actor]);

// ── P0 ──────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const db = await base({ index: false, apply: false });
  await refuses(() => db.exec(M0325), "0190 (po_lines_po_sku_uq) must be applied first", "P0 the pre-flight refuses without 0190's index");
  await db.close();
  const db2 = await base();
  await db2.exec(M0325);
  check(true, "P0 0325 applies and re-applies cleanly");
  check(Number((await one(db2, "select count(*) n from pg_trigger where tgname='po_lines_draft_only' and not tgisinternal")).n) === 1, "P0 exactly one trigger after the re-apply");
  await db2.close();
}

// ── P1 the trigger ──────────────────────────────────────────────────────────────────────────────────────────
{
  const db = await base();
  const line = await draft(db);
  await db.query("update po_lines set order_qty=3, note='x' where id=$1", [line]);
  await db.query("insert into po_lines(po_id, sku_id, order_qty) values ($1,$2,1)", [I.po, I.skuB]);
  check(true, "P1 a draft's lines change and grow freely");
  await db.query("update purchase_orders set status='confirmed' where id=$1", [I.po]);
  await refuses(() => db.query("update po_lines set order_qty=5 where id=$1", [line]), "po_not_draft", "P1 confirmed: a qty change refuses");
  await refuses(() => db.query("update po_lines set order_unit_label='ea' where id=$1", [line]), "po_not_draft", "P1 confirmed: a unit change refuses");
  await refuses(() => db.query("update po_lines set note='late' where id=$1", [line]), "po_not_draft", "P1 confirmed: a note change refuses");
  await refuses(() => db.query("update po_lines set sku_id=$2 where id=$1", [line, I.skuC]), "po_not_draft", "P1 confirmed: a SKU change refuses");
  await refuses(() => db.query("insert into po_lines(po_id, sku_id, order_qty) values ($1,$2,1)", [I.po, I.skuC]), "po_not_draft", "P1 confirmed: an insert refuses");
  await db.query("update po_lines set price_cents_at_order=450, guide_position_snapshot=7, guide_section_snapshot='Dairy' where id=$1", [line]);
  check(Number((await one(db, "select price_cents_at_order p from po_lines where id=$1", [line])).p) === 450, "P1 confirmed: the advisory price / guide freeze is allowed");
  await db.query("update po_lines set order_qty=order_qty where id=$1", [line]);
  check(true, "P1 confirmed: a no-op rewrite of the same qty is allowed");
  await db.query(`insert into purchase_orders(id, location_id, vendor_id, display_code, status, created_by) values ($1,$2,$3,'CH-1-V-2','draft',$4)`, [I.po2, I.shop, I.vendor, I.actor]);
  await refuses(() => db.query("update po_lines set po_id=$2 where id=$1", [line, I.po2]), "po_line_move_refused", "P1 a line never moves to another PO");
  for (const s of ["placed", "received"]) {
    await db.query("update purchase_orders set status=$2 where id=$1", [I.po, s]);
    await refuses(() => db.query("update po_lines set order_qty=9 where id=$1", [line]), "po_not_draft", `P1 ${s}: a qty change refuses`);
  }
  await db.query("update purchase_orders set status='draft' where id=$1", [I.po]);
  await db.query("update po_lines set order_qty=4 where id=$1", [line]);
  check(Number((await one(db, "select order_qty q from po_lines where id=$1", [line])).q) === 4, "P1 reopened to draft: editable again");
  await db.close();
}

// ── P2 the confirm RPC ──────────────────────────────────────────────────────────────────────────────────────
{
  const db = await base();
  await draft(db);
  const exp = await expected(db);
  await confirm(db, exp);
  const po = await one(db, "select status, confirmed_snapshot s, confirmed_by b, confirmed_at a from purchase_orders where id=$1", [I.po]);
  check(po.status === "confirmed" && po.s.displayCode === "CH-1-V" && po.b === I.actor && po.a !== null, "P2 lines match: status + snapshot + confirmer + time land together");
  await refuses(() => confirm(db, exp), "not_draft", "P2 a second confirm refuses not_draft");
  await db.close();

  for (const [what, mutate] of [
    ["a qty edited since the read", (d, ln) => d.query("update po_lines set order_qty=10 where id=$1", [ln])],
    ["a unit edited since the read", (d, ln) => d.query("update po_lines set order_unit_label='ea' where id=$1", [ln])],
    ["a line inserted since the read", (d) => d.query("insert into po_lines(po_id, sku_id, order_qty) values ($1,$2,1)", [I.po, I.skuB])],
  ]) {
    const d = await base();
    const ln = await draft(d);
    const before = await expected(d);
    await mutate(d, ln);
    await refuses(() => confirm(d, before), "lines_changed", `P2 ${what} → refused`);
    const after = await one(d, "select status, confirmed_snapshot s from purchase_orders where id=$1", [I.po]);
    check(after.status === "draft" && after.s === null, `P2 ${what}: nothing written (still a draft, no snapshot)`);
    await d.close();
  }
  const d = await base();
  await draft(d);
  await refuses(() => confirm(d, "[]"), "lines_changed", "P2 a wrong line count → refused");
  const good = await expected(d);
  await refuses(() => confirm(d, good, "[]"), "invalid_confirm_payload", "P2 a non-object snapshot → refused");
  await refuses(() => confirm(d, "[]", SNAP, id(99)), "po_not_found", "P2 a missing PO → po_not_found");
  await d.close();
}

// ── P3 vendor child removal ─────────────────────────────────────────────────────────────────────────────────
for (const [table, fn, last, cols] of [
  ["vendor_contacts", "remove_vendor_contact", "last_contact", "(vendor_id, name) values ($1, 'c')"],
  ["vendor_ordering_details", "remove_vendor_ordering_detail", "last_ordering_detail", "(vendor_id, method, value) values ($1, 'email', 'o@x.test')"],
]) {
  const db = await base();
  const a = (await one(db, `insert into ${table} ${cols} returning id`, [I.vendor])).id;
  const b = (await one(db, `insert into ${table} ${cols} returning id`, [I.vendor])).id;
  await one(db, `select ${fn}($1, $2)`, [a, I.actor]);
  const row = await one(db, `select active, updated_by from ${table} where id=$1`, [a]);
  check(row.active === false && row.updated_by === I.actor, `P3 ${fn}: deactivates at a count of 2, stamping the actor`);
  await refuses(() => one(db, `select ${fn}($1, $2)`, [b, I.actor]), last, `P3 ${fn}: refuses the last one`);
  check((await one(db, `select active from ${table} where id=$1`, [b])).active === true, `P3 ${fn}: the last one stays active`);
  await db.query(`insert into ${table} ${cols}`, [I.vendor]);
  await refuses(() => one(db, `select ${fn}($1, $2)`, [a, I.actor]), "not_found", `P3 ${fn}: removing an already-removed row → not_found`);
  await refuses(() => one(db, `select ${fn}($1, $2)`, [id(98), I.actor]), "not_found", `P3 ${fn}: a missing id → not_found`);
  await db.close();
}

// ── P4 ceilings ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const db = await base();
  for (const sig of ["confirm_purchase_order(uuid,jsonb,jsonb,uuid,timestamptz,timestamptz)", "remove_vendor_contact(uuid,uuid)", "remove_vendor_ordering_detail(uuid,uuid)"]) {
    const row = await one(db, `select has_function_privilege('anon',$1,'execute') a, has_function_privilege('authenticated',$1,'execute') b,
      has_function_privilege('service_role',$1,'execute') c, p.prosecdef d, p.proconfig::text e,
      exists(select 1 from aclexplode(p.proacl) x where x.grantee = 0) pub
      from pg_proc p where p.oid = $1::regprocedure`, [sig]);
    check(!row.a && !row.b && row.c && !row.pub, `P4 ${sig}: service_role only, no PUBLIC`);
    check(row.d && /search_path=pg_catalog, ?public/.test(row.e), `P4 ${sig}: definer with a pinned search_path`);
  }
  const t = await one(db, `select has_function_privilege('anon','po_lines_draft_only()','execute') a,
    has_function_privilege('authenticated','po_lines_draft_only()','execute') b, has_function_privilege('service_role','po_lines_draft_only()','execute') c`);
  check(!t.a && !t.b && !t.c, "P4 the trigger function is executable by nobody");
  const col = await one(db, `select is_nullable n, column_default d, data_type t from information_schema.columns
    where table_name='purchase_orders' and column_name='email_send_uncertain_at'`);
  check(col?.n === "YES" && col.d === null && col.t === "timestamp with time zone", "P4 email_send_uncertain_at: nullable timestamptz, no default");
  // The trigger fires for service_role writes too (a trigger needs no EXECUTE grant).
  await draft(db);
  await db.query("update purchase_orders set status='confirmed' where id=$1", [I.po]);
  await db.exec("set role service_role");
  await refuses(() => db.query("insert into po_lines(po_id, sku_id, order_qty) values ($1,$2,1)", [I.po, I.skuB]), "po_not_draft", "P4 the trigger binds service_role writes");
  await db.exec("reset role");
  await db.close();
}

if (failures > 0) {
  console.error(`FAIL 0325: ${failures} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`PASS 0325: ${checks} checks`);
