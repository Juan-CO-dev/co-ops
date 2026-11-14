/** 0302 offline proof (audit W01: B032, B144, B002): the REAL parent DDL + 0302 in PGlite, synthetic rows only. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const read = (n) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8');
const grab = (file, re, label) => { const m = read(file).match(re); assert.ok(m, `extract ${label}`); return m[0]; };
const table = (file, name) => grab(file, new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`, 'i'), name);
const migration = read('0302_portal_draft_atomic.sql');

const db = new PGlite();
let checks = 0;
const check = (v, s) => { assert.ok(v, s); checks++; console.log(`ok ${s}`); };
const one = async (s, a = []) => (await db.query(s, a)).rows[0];
const all = async (s, a = []) => (await db.query(s, a)).rows;
const reject = async (f, re, s) => { await assert.rejects(f, re); check(true, s); };

const SNAP_KEYS = ['is_delivery', 'delivery_zone_id', 'subtotal_cents', 'delivery_fee_cents', 'service_charge_cents', 'gratuity_cents', 'tax_cents', 'total_cents', 'deposit_cents', 'tax_rate_bps', 'gratuity_bps', 'service_charge_bps', 'deposit_pct_bps', 'tax_on_delivery', 'tax_on_gratuity'];
const snap = (subtotal, extra = {}) => ({ is_delivery: false, delivery_zone_id: null, subtotal_cents: subtotal, delivery_fee_cents: 0, service_charge_cents: 0, gratuity_cents: 0, tax_cents: 0, total_cents: subtotal, deposit_cents: Math.round(subtotal / 4), tax_rate_bps: 0, gratuity_bps: 0, service_charge_bps: 0, deposit_pct_bps: 2500, tax_on_delivery: false, tax_on_gratuity: false, ...extra });
const setLines = (c, q, lines, s) => one('select public.portal_draft_set_lines($1,$2,$3,$4) r', [c, q, JSON.stringify(lines), JSON.stringify(s)]).then((x) => x.r);
const submit = (c, q, expected, s, napkins = null, setNotes = false, notes = null) =>
  one('select public.portal_draft_submit($1,$2,$3,$4,$5,$6,$7,$8) r', [c, q, JSON.stringify(expected), JSON.stringify(s), napkins === null ? null : JSON.stringify(napkins), '2027-01-16T00:00:00Z', setNotes, notes]).then((x) => x.r);
const linesOf = (q) => all('select id::text, item_id::text, package_id::text, quantity, unit_price_cents, line_total_cents, display_order, line_kind, components_listed from catering_quote_items where quote_id=$1 order by display_order', [q]);
const expectedOf = async (q) => (await linesOf(q)).map((l) => ({ id: l.id, quantity: Number(l.quantity), unit_price_cents: l.unit_price_cents }));

try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to public, anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to public, anon, authenticated, service_role;
    create function public.current_user_role_level() returns integer language sql as 'select 0';
    create function public.current_user_locations() returns uuid[] language sql as 'select array[]::uuid[]';
    create table public.locations(id uuid primary key);
    create table public.users(id uuid primary key);
    create table public.items(id uuid primary key);
    create table public.menu_items(id uuid primary key);
    create table public.catering_packages(id uuid primary key);
    create table public.catering_package_items(id uuid primary key);
    create table public.item_sizes(id uuid primary key);
    create table public.catering_delivery_zones(id uuid primary key);
    create table public.catering_portal_tokens(id uuid primary key);
    ${table('0108_catering_scaffold_capture.sql', 'catering_customers')}
    ${table('0108_catering_scaffold_capture.sql', 'catering_pipeline')}
    ${grab('0129_order_artifact_intake.sql', /ALTER TABLE public\.catering_pipeline\s+ADD COLUMN contact_phone[\s\S]*?ADD COLUMN dropoff_door\s+text;/i, '0129 pipeline columns')}
    ${table('0120_catering_quotes.sql', 'catering_quotes')}
    ${table('0120_catering_quotes.sql', 'catering_quote_items')}
    ${grab('0127_catering_portal_orders.sql', /ALTER TABLE catering_quotes DROP CONSTRAINT catering_quotes_status_check;[\s\S]*?CHECK \(origin IN \('self_serve','staff'\)\);/i, '0127 status + origin')}
    ${grab('0127_catering_portal_orders.sql', /CREATE TABLE catering_payments \([\s\S]*?\n\);/i, '0127 catering_payments')}
    ${grab('0128_catering_pricing_core.sql', /ALTER TABLE public\.catering_quote_items\s+ADD COLUMN portion[\s\S]*?;/i, '0128 portion')}
    ${grab('0130_catering_payments_one_due.sql', /CREATE UNIQUE INDEX catering_payments_one_due[\s\S]*?;/i, '0130 one due')}
    ${grab('0143_item_sizes.sql', /alter table public\.catering_quote_items\s+add column size_id[\s\S]*?;/i, '0143 size_id')}
    ${table('0144_catering_quote_item_options.sql', 'catering_quote_item_options')}
    ${grab('0251_catering_quote_line_kind.sql', /alter table public\.catering_quote_items\s+add column line_kind[\s\S]*?components_listed_header_only check \([\s\S]*?\);/i, '0251 line kind')}
    ${grab('0252_catering_quote_line_kind_enforce.sql', /alter table public\.catering_quote_items\s+add constraint catering_quote_items_package_line_has_kind[\s\S]*?;/i, '0252 package line has kind')}
  `);

  // ── Preflight refusals: each in a transaction, rolled back, leaving no partial DDL ─────────────
  const noFunctions = async () => (await one("select to_regprocedure('public.portal_draft_set_lines(uuid,uuid,jsonb,jsonb)') a, to_regprocedure('public.portal_draft_snapshot_ok(jsonb)') b")).a === null;
  const refusePreflight = async (sql, re, label) => {
    await db.exec('begin;' + sql);
    await reject(() => db.exec(migration), re, label);
    await db.exec('rollback');
    check(await noFunctions(), `${label}: no partial DDL`);
  };
  await refusePreflight('alter table public.catering_pipeline drop column dietary_notes', /missing columns .*catering_pipeline\.dietary_notes/, 'missing dietary_notes refused');
  await refusePreflight('alter table public.catering_quote_items drop column line_kind cascade', /missing columns .*catering_quote_items\.line_kind/, 'missing line_kind refused');
  await refusePreflight('alter table catering_payments drop column created_by', /missing columns .*catering_payments\.created_by/, 'missing payments.created_by refused');
  await refusePreflight('drop index catering_payments_one_due', /missing the 0130 partial unique index/, 'missing 0130 index refused');
  await refusePreflight("create function public.portal_draft_set_lines(uuid,uuid,jsonb,jsonb) returns jsonb language sql as 'select null::jsonb'", /already applied/, 'already applied refused');

  await db.exec(migration);
  check(!(await noFunctions()), '0302 applies');
  await reject(() => db.exec(migration), /already applied/, 're-apply refused');
  await db.exec('rollback');

  // ── Privileges ─────────────────────────────────────────────────────────────────────────────
  for (const f of ['public.portal_draft_set_lines(uuid,uuid,jsonb,jsonb)', 'public.portal_draft_submit(uuid,uuid,jsonb,jsonb,jsonb,timestamptz,boolean,text)']) {
    const p = await one(`select has_function_privilege('anon',$1,'EXECUTE') a, has_function_privilege('authenticated',$1,'EXECUTE') b, has_function_privilege('service_role',$1,'EXECUTE') s, (select prosecdef from pg_proc where oid=$1::regprocedure) d, (select proconfig from pg_proc where oid=$1::regprocedure) c`, [f]);
    check(!p.a && !p.b && p.s, `${f}: service_role only`);
    check(p.d === true && p.c.includes('search_path=pg_catalog, public'), `${f}: security definer, pinned search_path`);
  }
  const helper = await one("select has_function_privilege('service_role','public.portal_draft_snapshot_ok(jsonb)','EXECUTE') s, has_function_privilege('anon','public.portal_draft_snapshot_ok(jsonb)','EXECUTE') a");
  check(!helper.s && !helper.a, 'snapshot helper executable by no API role');
  const tablePriv = await one("select has_table_privilege('anon','public.catering_quote_items','INSERT') a");
  check(tablePriv.a === true, 'table grants untouched by 0302 (the synthetic default ACL still stands)');

  // ── Fixtures ───────────────────────────────────────────────────────────────────────────────
  const loc = randomUUID(), cust = randomUUID(), other = randomUUID(), pipe = randomUUID(), item = randomUUID(), item2 = randomUUID(), napkin = randomUUID(), pkg = randomUUID(), slot = randomUUID();
  await db.query('insert into locations values($1)', [loc]);
  await db.query('insert into items values($1),($2),($3)', [item, item2, napkin]);
  await db.query('insert into catering_packages values($1)', [pkg]);
  await db.query('insert into catering_package_items values($1)', [slot]);
  await db.query("insert into catering_customers(id,name,email) values($1,'Synthetic','s@example.test'),($2,'Other','o@example.test')", [cust, other]);
  await db.query("insert into catering_pipeline(id,customer_id,contact_name,stage,location_id) values($1,$2,'Synthetic','inquiry',$3)", [pipe, cust, loc]);
  const newDraft = async (status = 'draft') => {
    const id = randomUUID();
    await db.query("insert into catering_quotes(id,pipeline_id,customer_id,location_id,status,origin) values($1,$2,$3,$4,$5,'self_serve')", [id, pipe, cust, loc, status]);
    return id;
  };
  const chips = (qty, unit = 1000, order = 0) => ({ item_id: item, menu_item_id: null, package_id: null, size_id: null, portion: null, description: 'Chips', quantity: qty, unit_price_cents: unit, line_total_cents: qty * unit, display_order: order, line_kind: null, components_listed: null, options: [] });
  const pkgLine = (order) => ({ item_id: null, menu_item_id: null, package_id: pkg, size_id: null, portion: null, description: 'Box', quantity: 2, unit_price_cents: 5000, line_total_cents: 10000, display_order: order, line_kind: 'package_header', components_listed: false, options: [{ package_item_id: slot, item_id: item2, menu_item_id: null, quantity: 3 }] });

  // ── set_lines: replace in place, options written, snapshot written ─────────────────────────
  const q1 = await newDraft();
  let r = await setLines(cust, q1, [chips(10), pkgLine(1)], snap(20000));
  check(r.lines === 2, 'set_lines returns the line count');
  let ls = await linesOf(q1);
  check(ls.length === 2 && ls[1].line_kind === 'package_header' && ls[1].components_listed === false, 'lines + package header written');
  const opt = await all('select o.quantity from catering_quote_item_options o join catering_quote_items i on i.id=o.quote_item_id where i.quote_id=$1', [q1]);
  check(opt.length === 1 && Number(opt[0].quantity) === 3, 'package pick written against the new line id');
  let qr = await one('select subtotal_cents, deposit_cents, status from catering_quotes where id=$1', [q1]);
  check(qr.subtotal_cents === 20000 && qr.deposit_cents === 5000 && qr.status === 'draft', 'snapshot written, still draft');
  r = await setLines(cust, q1, [chips(3)], snap(3000));
  ls = await linesOf(q1);
  check(ls.length === 1 && Number(ls[0].quantity) === 3, 'second save REPLACES the line set');
  check((await one('select count(*)::int n from catering_quote_item_options')).n === 0, 'old package picks cascaded away');
  r = await setLines(cust, q1, [], snap(0));
  check((await linesOf(q1)).length === 0, 'an empty cart is a valid save');

  // ── set_lines refusals, nothing written ─────────────────────────────────────────────────────
  await setLines(cust, q1, [chips(2)], snap(2000));
  const before = JSON.stringify(await linesOf(q1));
  await reject(() => setLines(other, q1, [chips(9)], snap(9000)), /not_found/, 'set_lines: another customer → not_found');
  await reject(() => setLines(cust, randomUUID(), [chips(9)], snap(9000)), /not_found/, 'set_lines: unknown quote → not_found');
  await reject(() => setLines(cust, q1, [chips(9)], snap(1)), /subtotal_mismatch/, 'set_lines: snapshot subtotal ≠ lines → subtotal_mismatch');
  await reject(() => setLines(cust, q1, [chips(9)], { ...snap(9000), extra: 1 }), /invalid_snapshot/, 'set_lines: extra snapshot key → invalid_snapshot');
  const missing = snap(9000); delete missing.tax_cents;
  await reject(() => setLines(cust, q1, [chips(9)], missing), /invalid_snapshot/, 'set_lines: missing snapshot key → invalid_snapshot');
  await reject(() => setLines(cust, q1, [chips(9)], snap(9000, { is_delivery: 'yes' })), /invalid_snapshot/, 'set_lines: mistyped snapshot value → invalid_snapshot');
  await reject(() => setLines(cust, q1, { not: 'an array' }, snap(0)), /invalid_lines/, 'set_lines: non-array lines → invalid_lines');
  await reject(() => setLines(cust, q1, Array.from({ length: 201 }, (_, i) => chips(1, 1, i)), snap(201)), /invalid_lines/, 'set_lines: over 200 lines → invalid_lines');
  await reject(() => setLines(cust, q1, [{ ...chips(1), quantity: 0, line_total_cents: 0 }], snap(0)), /catering_quote_items_quantity_check|violates check/, 'set_lines: a DB constraint violation rolls the whole save back');
  check(JSON.stringify(await linesOf(q1)) === before, 'every refused save left the lines untouched');

  // ── submit: one transaction — flip + napkins + deposit + dietary notes ──────────────────────
  await setLines(cust, q1, [chips(10)], snap(10000));
  const napkins = { item_id: napkin, description: 'Napkins & utensils', unit_price_cents: 500 };
  r = await submit(cust, q1, await expectedOf(q1), snap(10500), napkins, true, '  Peanut allergy: table 3  ');
  qr = await one('select status, subtotal_cents, deposit_cents, expires_at from catering_quotes where id=$1', [q1]);
  check(qr.status === 'submitted' && qr.subtotal_cents === 10500 && qr.deposit_cents === 2625 && qr.expires_at !== null, 'submit flips with the napkins-inclusive snapshot + expiry');
  ls = await linesOf(q1);
  check(ls.length === 2 && ls[1].unit_price_cents === 500 && ls[1].display_order === 1, 'napkins line appended after the cart lines');
  const pay = await all('select id::text, kind, amount_cents, status, customer_id::text from catering_payments where quote_id=$1', [q1]);
  check(pay.length === 1 && pay[0].kind === 'deposit' && pay[0].amount_cents === 2625 && pay[0].status === 'due' && pay[0].customer_id === cust, 'one deposit-due intent');
  check(r.payment_id === pay[0].id && r.quote_id === q1, 'submit returns the payment id');
  check((await one('select dietary_notes from catering_pipeline where id=$1', [pipe])).dietary_notes === 'Peanut allergy: table 3', 'dietary notes saved (trimmed) on the lead');

  // B032: a cart save after the submit refuses; the frozen lines stand.
  await reject(() => setLines(cust, q1, [chips(99)], snap(99000)), /not_draft/, 'B032: set_lines after submit → not_draft');
  check((await linesOf(q1)).length === 2, 'B032: the submitted lines are untouched');
  await reject(async () => submit(cust, q1, await expectedOf(q1), snap(10500)), /not_draft/, 'double submit → not_draft');
  check((await one('select count(*)::int n from catering_payments where quote_id=$1', [q1])).n === 1, 'double submit wrote no second payment');

  // B032: a cart save that committed between the server's read and the submit's lock → cart_changed.
  const q2 = await newDraft();
  await setLines(cust, q2, [chips(1)], snap(1000));
  const stale = await expectedOf(q2);
  await setLines(cust, q2, [chips(50)], snap(50000));
  await reject(() => submit(cust, q2, stale, snap(1000)), /cart_changed/, 'B032: lines changed since priced → cart_changed');
  qr = await one('select status from catering_quotes where id=$1', [q2]);
  check(qr.status === 'draft' && (await one('select count(*)::int n from catering_payments where quote_id=$1', [q2])).n === 0, 'cart_changed wrote nothing');
  await reject(async () => submit(cust, q2, (await expectedOf(q2)).map((e) => ({ ...e, unit_price_cents: e.unit_price_cents + 1 })), snap(50000)), /cart_changed/, 'a different expected price → cart_changed');
  await reject(async () => submit(cust, q2, await expectedOf(q2), snap(49999)), /subtotal_mismatch/, 'snapshot ≠ lines (+napkins) → subtotal_mismatch');

  // B144: any failure after the flip rolls the flip back (here: the deposit insert violates its CHECK).
  // The napkins insert runs AFTER the status flip; an unknown napkins item violates its FK there.
  await reject(async () => submit(cust, q2, await expectedOf(q2), snap(50500), { item_id: randomUUID(), description: 'Napkins', unit_price_cents: 500 }), /foreign key/, 'B144: a write failing AFTER the flip (napkins line) raises');
  await reject(async () => submit(cust, q2, await expectedOf(q2), snap(50000, { deposit_cents: -1 })), /check constraint|violates/, 'B144: a failing deposit write raises');
  qr = await one('select status, subtotal_cents from catering_quotes where id=$1', [q2]);
  check(qr.status === 'draft', 'B144: the status flip was rolled back with it — the order can be submitted again');
  check((await linesOf(q2)).length === 1 && (await one('select count(*)::int n from catering_payments where quote_id=$1', [q2])).n === 0, 'B144: no napkins line, no orphan payment');
  r = await submit(cust, q2, await expectedOf(q2), snap(50000), null, false, null);
  check((await one('select status from catering_quotes where id=$1', [q2])).status === 'submitted', 'B144: the retry succeeds');
  check((await linesOf(q2)).length === 1, 'no napkins chosen → no napkins line');
  check((await one('select dietary_notes from catering_pipeline where id=$1', [pipe])).dietary_notes === 'Peanut allergy: table 3', 'p_set_dietary_notes=false leaves the lead notes alone');

  // A pre-existing live deposit intent is reused, never duplicated (0130).
  const q3 = await newDraft();
  await setLines(cust, q3, [chips(4)], snap(4000));
  await db.query("insert into catering_payments(quote_id,customer_id,kind,amount_cents,status) values($1,$2,'deposit',1,'due')", [q3, cust]);
  r = await submit(cust, q3, await expectedOf(q3), snap(4000), null, true, '   ');
  check((await one('select count(*)::int n from catering_payments where quote_id=$1', [q3])).n === 1, 'existing due intent reused');
  check(r.payment_id === (await one("select id::text from catering_payments where quote_id=$1", [q3])).id, 'the reused intent id is returned');
  check((await one('select dietary_notes from catering_pipeline where id=$1', [pipe])).dietary_notes === null, 'blank notes clear the lead notes (null, never "")');

  // Submit refusals.
  const q4 = await newDraft();
  await reject(() => submit(cust, q4, [], snap(0)), /empty_cart/, 'no lines → empty_cart');
  await setLines(cust, q4, [chips(1)], snap(1000));
  await reject(async () => submit(other, q4, await expectedOf(q4), snap(1000)), /not_found/, 'another customer → not_found');
  await reject(async () => submit(cust, q4, await expectedOf(q4), snap(1500), { item_id: napkin, unit_price_cents: 500 }), /invalid_napkins/, 'napkins without a description → invalid_napkins');
  await reject(async () => submit(cust, q4, await expectedOf(q4), snap(1000), null, true, 'x'.repeat(2001)), /invalid_notes/, 'notes over 2000 chars → invalid_notes');
  await reject(async () => submit(cust, q4, await expectedOf(q4), snap(1000), null, null, null), /invalid_notes/, 'a null notes switch → invalid_notes');
  await db.query("update catering_quotes set superseded_at=now() where id=$1", [q4]);
  await reject(async () => submit(cust, q4, await expectedOf(q4), snap(1000)), /not_draft/, 'superseded → not_draft');
  await reject(() => setLines(cust, q4, [chips(1)], snap(1000)), /not_draft/, 'superseded → set_lines not_draft');
  const q5 = await newDraft('sent');
  await reject(() => setLines(cust, q5, [chips(1)], snap(1000)), /not_draft/, 'a staff-sent quote → not_draft');
  check((await one('select status from catering_quotes where id=$1', [q4])).status === 'draft', 'refused submits changed no status');

  // Lock: both writers take the quote row FOR UPDATE (the serialization point).
  for (const fn of ['portal_draft_set_lines', 'portal_draft_submit']) {
    const src = (await one("select prosrc from pg_proc where proname=$1", [fn])).prosrc;
    check(/from public\.catering_quotes where id = p_quote_id for update/.test(src), `${fn} locks the quote row FOR UPDATE before any write`);
    const lockAt = src.indexOf('for update'), firstWrite = Math.min(...['delete from', 'insert into', 'update public'].map((w) => { const i = src.indexOf(w); return i < 0 ? Infinity : i; }));
    check(lockAt > 0 && lockAt < firstWrite, `${fn}: the lock precedes the first write`);
  }
  check(SNAP_KEYS.length === 15, 'snapshot key list is the 15 snapshot columns');

  console.log(`PASS 0302: ${checks} checks`);
} catch (e) {
  console.log(`FAIL 0302: ${e instanceof Error ? e.stack : e}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
