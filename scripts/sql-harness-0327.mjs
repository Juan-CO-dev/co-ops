/**
 * Offline proof of migration 0327 (audit W20: B197, B114, the manager unlink). PGlite, no network.
 *
 * Schema: the Foundation Spec's `vendor_deliveries` (it predates the migrations folder), then the
 * REAL migrations 0100 / 0168 / 0169 / 0178 whole and the real statements of 0160 / 0170 / 0171 /
 * 0174 / 0175 that touch these tables, so every CHECK, unique index and foreign key the functions
 * meet here is production's. Synthetic rows only.
 *
 *   R. record_delivery_atomic: the header, lines, lined credits (by line_index) and line-less
 *      credits land together or not at all; each named failure leaves ZERO rows behind.
 *   V. delivery_match_verdict: attest / override under the row lock, the named refusals, notes
 *      appended in order, an override is terminal.
 *   U. delivery_receipt_unlink: both sides cleared, match reset, the append-only record, refusals.
 *   C. privilege ceilings and RLS. G. the pre-flight guards and idempotent re-apply.
 *
 * One PGlite backend is ONE session: "the racer waits, then is refused" needs two, and is
 * scripts/sim/receiving-0326-0327-lock-check-management.mjs (sim only, run by CC).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID as uuid } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const FILE = '0327_receiving_atomic_writers.sql';
const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const extract = (file, pattern) => { const found = read(file).match(pattern); assert.ok(found, `real prerequisite in ${file}: ${pattern}`); return found[0]; };
const migration = read(FILE);
let checks = 0;
const check = (ok, label) => { assert.ok(ok, label); checks++; console.log(`ok ${label}`); };

const BOOTSTRAP = `
  create role anon; create role authenticated; create role service_role bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to public, anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to public, anon, authenticated, service_role;
  create table public.locations(id uuid primary key, active boolean not null default true);
  create table public.vendors(id uuid primary key, active boolean not null default true);
  create table public.users(id uuid primary key, active boolean not null default true);
  create table public.vendor_items(id uuid primary key, vendor_id uuid references public.vendors(id));
  create table public.purchase_orders(id uuid primary key);
  -- docs/CO-OPS_Foundation_Spec_v1.3.md, "vendor_deliveries" (the base table; never in a migration file).
  create table public.vendor_deliveries (
    id uuid primary key default gen_random_uuid(),
    vendor_id uuid references public.vendors(id) not null,
    location_id uuid references public.locations(id) not null,
    delivery_date date not null,
    invoice_number text,
    invoice_total decimal(10,2),
    notes text,
    received_by uuid references public.users(id),
    created_at timestamptz default now()
  );
`;
const realSchema = () => [
  read('0100_vendor_delivery_items.sql'),
  extract('0160_receiving_counts.sql', /ALTER TABLE public\.vendor_delivery_items\s+ADD COLUMN received_level_label[\s\S]*?;/),
  extract('0160_receiving_counts.sql', /ALTER TABLE public\.vendor_deliveries\s+ADD COLUMN receipt_url[\s\S]*?;/),
  read('0168_delivery_intake_p1.sql'),
  read('0169_delivery_dedupe_index.sql'),
  extract('0170_email_receipts.sql', /create table if not exists public\.email_receipts \([\s\S]*?\n\);/i),
  extract('0170_email_receipts.sql', /alter table public\.vendor_deliveries\s+add column if not exists email_receipt_id[^;]*;/i),
  extract('0171_receipt_link_integrity.sql', /create unique index if not exists vendor_deliveries_email_receipt_uq[\s\S]*?;/i),
  extract('0174_vendor_ordering.sql', /ALTER TABLE public\.vendor_deliveries\s+ADD COLUMN IF NOT EXISTS purchase_order_id[^;]*;/),
  extract('0175_vendor_ordering_v2.sql', /ALTER TABLE public\.vendor_credits\s+ADD COLUMN IF NOT EXISTS resolved_by_delivery_id[^;]*;/),
  read('0178_delivery_line_vendor_binding.sql'),
].join('\n');

async function fresh() {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(realSchema());
  return db;
}

const db = await fresh();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const one = async (sql, args = []) => (await q(sql, args))[0];
const n = async table => (await one(`select count(*)::int n from public.${table}`)).n;
async function service(fn) { await db.exec('set role service_role'); try { return await fn(); } finally { await db.exec('reset role'); } }
const rpc = (name, args, casts) => service(async () =>
  (await one(`select public.${name}(${args.map((_, i) => `$${i + 1}${casts?.[i] ? `::${casts[i]}` : ''}`).join(',')}) result`, args)).result);
const refuses = async (fn, pattern, label) => { await assert.rejects(fn, pattern); check(true, label); };

const shop = uuid(), otherShop = uuid(), vendor = uuid(), otherVendor = uuid(), actor = uuid(), inactive = uuid();
const skuA = uuid(), skuB = uuid(), skuC = uuid(), skuOther = uuid(), skuFree = uuid(), po = uuid();

try {
  // ── G. guards (before the real apply) ──────────────────────────────────────────────────────────
  {
    const bare = new PGlite();
    try {
      await bare.exec(BOOTSTRAP);
      await assert.rejects(() => bare.exec(migration), /0327: the receiving tables \(0100, 0168, 0170\) must exist first/);
      await bare.exec('rollback');
      check((await bare.query("select to_regprocedure('public.record_delivery_atomic(jsonb,jsonb,jsonb,jsonb)') f")).rows[0].f === null,
        'refuses before the receiving tables exist and creates nothing');
    } finally { await bare.close(); }

    const drifted = await fresh();
    try {
      await drifted.exec('alter table public.vendor_delivery_items drop column photo_url; alter table public.vendor_deliveries drop column note;');
      await assert.rejects(() => drifted.exec(migration), /0327: missing column\(s\): vendor_deliveries\.note, vendor_delivery_items\.photo_url/);
      await drifted.exec('rollback');
      check((await drifted.query("select to_regclass('public.delivery_receipt_unlinks') t")).rows[0].t === null,
        'a schema missing a column the writer names is refused by name, nothing created');
    } finally { await drifted.close(); }

    const noIndex = await fresh();
    try {
      await noIndex.exec('drop index public.vendor_deliveries_dedupe_uq');
      await assert.rejects(() => noIndex.exec(migration), /0327: the 0168 \/ 0169 \/ 0171 unique indexes must exist first/);
      await noIndex.exec('rollback');
      check(true, 'refuses without the duplicate-delivery index (the arbiter the writer relies on)');
    } finally { await noIndex.close(); }

    const before0326 = await fresh();
    try {
      await before0326.exec(`create function public.vendor_mail_mutate(uuid,integer,uuid,uuid,uuid,text,jsonb) returns jsonb
        language plpgsql as $f$ begin perform 1 from public.locations for update; return null; end $f$;`);
      await assert.rejects(() => before0326.exec(migration), /0327: 0326 \(vendor mail lock order\) must be applied first/);
      await before0326.exec('rollback');
      await before0326.exec(`create or replace function public.vendor_mail_mutate(uuid,integer,uuid,uuid,uuid,text,jsonb) returns jsonb
        language plpgsql as $f$ begin perform 1 from public.locations for no key update; return null; end $f$;`);
      await before0326.exec(migration);
      check(true, 'where vendor mail is installed, 0327 waits for 0326; with 0326 it applies');
    } finally { await before0326.close(); }
  }

  await db.exec(migration);
  await db.exec(migration);
  check((await one("select count(*)::int n from pg_policies where tablename='delivery_receipt_unlinks'")).n === 4, 'applies, and re-applying is a no-op (idempotent)');

  await db.query('insert into public.locations(id) values ($1),($2)', [shop, otherShop]);
  await db.query('insert into public.vendors(id) values ($1),($2)', [vendor, otherVendor]);
  await db.query('insert into public.users(id, active) values ($1, true), ($2, false)', [actor, inactive]);
  await db.query('insert into public.vendor_items(id, vendor_id) values ($1,$5),($2,$5),($3,$5),($4,$6),($7,null)', [skuA, skuB, skuC, skuOther, vendor, otherVendor, skuFree]);
  await db.query('insert into public.purchase_orders(id) values ($1)', [po]);

  const header = (extra = {}) => ({ vendor_id: vendor, location_id: shop, delivery_date: '2026-11-14', invoice_number: 'INV-1001',
    invoice_total: 412.5, notes: 'dock 2', note: 'dock 2', receipt_url: null, received_by: actor, delivery_status: 'in_progress', purchase_order_id: po, ...extra });
  const line = (sku, extra = {}) => ({ vendor_item_id: sku, qty_received: 4, vendor_id: vendor, unit_price: 12.5, observed_oz_per_each: null,
    notes: null, created_by: actor, received_level_label: 'case', received_qty_at_level: 4, resolved_oz: 640, note: null, photo_url: null,
    expected_qty: 5, discrepancy_type: null, ...extra });
  const record = (h, lines, lineCredits = [], missingCredits = []) =>
    rpc('record_delivery_atomic', [JSON.stringify(h), JSON.stringify(lines), JSON.stringify(lineCredits), JSON.stringify(missingCredits)], ['jsonb', 'jsonb', 'jsonb', 'jsonb']);
  const empty = async label => check(await n('vendor_deliveries') === base.deliveries && await n('vendor_delivery_items') === base.items && await n('vendor_credits') === base.credits, label);
  const base = { deliveries: 0, items: 0, credits: 0 };
  const rebase = async () => { base.deliveries = await n('vendor_deliveries'); base.items = await n('vendor_delivery_items'); base.credits = await n('vendor_credits'); };

  // ── R. record_delivery_atomic ──────────────────────────────────────────────────────────────────
  const lines = [line(skuA, { discrepancy_type: 'short', notes: 'one crushed', note: 'one crushed' }), line(skuB, { qty_received: 2.5, received_qty_at_level: 2.5, unit_price: null }),
    line(skuC, { discrepancy_type: 'damaged', expected_qty: null, photo_url: '/api/photos/11111111-1111-4111-8111-111111111111' })];
  const saved = await record(header(), lines,
    [{ line_index: 3, reason: 'damaged', sku_id: skuC, qty: null, amount_cents: null }, { line_index: 1, reason: 'short', sku_id: skuA, qty: 1, amount_cents: 1250 }],
    [{ reason: 'short', sku_id: skuFree, qty: 3, amount_cents: 600 }]);
  check(typeof saved.delivery_id === 'string' && saved.item_ids.length === 3, 'a valid delivery returns its id and one line id per line');
  const d1 = await one('select * from public.vendor_deliveries where id=$1', [saved.delivery_id]);
  check(d1.vendor_id === vendor && d1.location_id === shop && d1.invoice_number === 'INV-1001' && Number(d1.invoice_total) === 412.5
    && d1.notes === 'dock 2' && d1.note === 'dock 2' && d1.received_by === actor && d1.delivery_status === 'in_progress'
    && d1.purchase_order_id === po && d1.match_state === 'counted_only' && d1.email_receipt_id === null, 'the header is written as sent');
  const items = await q('select * from public.vendor_delivery_items where delivery_id=$1', [saved.delivery_id]);
  const byId = new Map(items.map(i => [i.id, i]));
  check(saved.item_ids.map(id => byId.get(id).vendor_item_id).join() === [skuA, skuB, skuC].join(), 'item_ids are in the order the lines were sent');
  const second = byId.get(saved.item_ids[1]);
  check(Number(second.qty_received) === 2.5 && second.unit_price === null && Number(second.resolved_oz) === 640 && second.received_level_label === 'case'
    && second.vendor_id === vendor && second.created_by === actor && Number(second.expected_qty) === 5, 'a line keeps every column, nulls included');
  check(byId.get(saved.item_ids[2]).photo_url === '/api/photos/11111111-1111-4111-8111-111111111111' && byId.get(saved.item_ids[0]).discrepancy_type === 'short', 'photo and flag land on their own line');
  check(new Set(items.map(i => i.created_at.toISOString())).size === 1, 'every line of one save shares one created_at (the batch instant B199 groups by)');
  const credits = await q('select * from public.vendor_credits where delivery_id=$1 order by reason, sku_id', [saved.delivery_id]);
  const credit = (reason, sku) => credits.find(c => c.reason === reason && c.sku_id === sku);
  check(credits.length === 3 && credit('damaged', skuC).delivery_item_id === saved.item_ids[2] && credit('short', skuA).delivery_item_id === saved.item_ids[0],
    'each lined credit points at the line its line_index named');
  check(credit('short', skuA).amount_cents === 1250 && Number(credit('short', skuA).qty) === 1 && credit('damaged', skuC).qty === null && credit('damaged', skuC).amount_cents === null,
    'credit qty and amount are stored as sent (a null amount stays null)');
  const lineless = credit('short', skuFree);
  check(lineless.delivery_item_id === null && lineless.amount_cents === 600 && Number(lineless.qty) === 3 && lineless.location_id === shop
    && lineless.vendor_id === vendor && lineless.created_by === actor && lineless.status === 'open', 'a missing-item credit is line-less and belongs to this delivery');
  const bare = await record(header({ invoice_number: null, invoice_total: null, notes: null, note: null, delivery_status: null, purchase_order_id: null }), [line(skuA)]);
  check((await one('select delivery_status, invoice_number from public.vendor_deliveries where id=$1', [bare.delivery_id])).delivery_status === 'complete', 'no status sent means complete (the column default the old insert used)');
  await record(header({ invoice_number: null }), [line(skuA)]);
  check(true, 'two no-invoice deliveries on one day are both allowed (the 0169 index exempts them)');
  await rebase();

  // The B197 repro: a bad flag on line 2 used to leave the header behind and block the retry.
  await refuses(() => record(header({ invoice_number: 'INV-2' }), [line(skuA), line(skuB, { discrepancy_type: 'bogus' })]), /vendor_delivery_items_discrepancy_type_check|violates check constraint/, 'a bad discrepancy flag on line 2 is refused');
  await empty('...and leaves no delivery, no line and no credit behind');
  const retry = await record(header({ invoice_number: 'INV-2' }), [line(skuA), line(skuB)]);
  check(typeof retry.delivery_id === 'string', '...so the corrected retry of the SAME invoice saves (it used to be "already received")');
  await rebase();

  await refuses(() => record(header({ invoice_number: 'inv-1001' }), [line(skuA)]), /vendor_deliveries_dedupe_uq/, 'the same invoice in another case is refused by the 0169 index');
  await empty('...and nothing is written');
  await refuses(() => record(header({ invoice_number: 'INV-3' }), [line(skuA, { qty_received: 0 })]), /violates check constraint/, 'a zero quantity is refused by the 0100 check');
  await empty('...and nothing is written');
  await refuses(() => record(header({ invoice_number: 'INV-3' }), [line(skuA), line(skuOther)]), /vendor_delivery_items_sku_vendor_fk|violates foreign key/, "another vendor's SKU is refused by the 0178 binding");
  await empty('...and nothing is written');
  await refuses(() => record(header({ invoice_number: 'INV-3' }), [line(skuA, { discrepancy_type: 'short' })],
    [{ line_index: 1, reason: 'short', sku_id: skuA, qty: 1, amount_cents: 100 }, { line_index: 1, reason: 'short', sku_id: skuA, qty: 1, amount_cents: 100 }]),
    /vendor_credits_line_reason_uq/, 'two credits for one (line, reason) are refused by the 0168 index');
  await empty('...and the delivery and its lines are rolled back with them');
  await refuses(() => record(header({ invoice_number: 'INV-3' }), [line(skuA)], [], [{ reason: 'not_a_reason', sku_id: skuA, qty: 1, amount_cents: 1 }]), /violates check constraint/, 'a bad credit reason is refused');
  await empty('...and nothing is written');
  for (const [label, credits] of [['0', [{ line_index: 0 }]], ['past the last line', [{ line_index: 2 }]], ['text', [{ line_index: 'x' }]], ['a fraction', [{ line_index: 1.5 }]], ['missing', [{ reason: 'short' }]]]) {
    await assert.rejects(() => record(header({ invoice_number: 'INV-3' }), [line(skuA)], credits.map(c => ({ reason: 'short', sku_id: skuA, qty: 1, amount_cents: 1, ...c }))), /invalid_input/, label);
  }
  check(true, 'a line_index that names no line (0, past the end, text, a fraction, missing) is invalid_input');
  await empty('...before anything is written');
  for (const args of [[null, '[]'], ['[]', '[{}]'], ['{}', '{}'], ['{}', '[]'], ['{}', '[1]']]) {
    await assert.rejects(() => rpc('record_delivery_atomic', [args[0], args[1], '[]', '[]'], ['jsonb', 'jsonb', 'jsonb', 'jsonb']), /invalid_input/);
  }
  await assert.rejects(() => record(header({ vendor_id: null }), [line(skuA)]), /invalid_input/);
  await assert.rejects(() => record(header({ received_by: null }), [line(skuA)]), /invalid_input/);
  await assert.rejects(() => rpc('record_delivery_atomic', [JSON.stringify(header({ invoice_number: 'INV-3' })), JSON.stringify([line(skuA)]), '{}', '[]'], ['jsonb', 'jsonb', 'jsonb', 'jsonb']), /invalid_input/);
  check(true, 'a missing header, no lines, a non-array or a header without vendor / shop / receiver is invalid_input');
  await empty('...and writes nothing');
  const nullCredits = await rpc('record_delivery_atomic', [JSON.stringify(header({ invoice_number: 'INV-4' })), JSON.stringify([line(skuA)]), null, null], ['jsonb', 'jsonb', 'jsonb', 'jsonb']);
  check(nullCredits.item_ids.length === 1, 'null credit lists mean no credits');

  // ── V. delivery_match_verdict ──────────────────────────────────────────────────────────────────
  const verdict = (delivery, kind, v, note) => rpc('delivery_match_verdict', [delivery, kind, v ?? null, note ?? null], ['uuid', 'text', 'text', 'text']);
  const state = async id => one('select match_state, note, email_receipt_id from public.vendor_deliveries where id=$1', [id]);
  const D = saved.delivery_id;
  const receipt = uuid(), receipt2 = uuid();
  await db.query("insert into public.email_receipts(id, source, location_id) values ($1,'inbound',$3),($2,'upload',$3)", [receipt, receipt2, shop]);
  const link = async (delivery, r) => { await db.query('update public.email_receipts set linked_delivery_id=$1 where id=$2', [delivery, r]); await db.query('update public.vendor_deliveries set email_receipt_id=$2 where id=$1', [delivery, r]); };

  await refuses(() => verdict(D, 'attest', 'matched'), /no_receipt/, 'attest without a linked receipt is no_receipt');
  await refuses(() => verdict(uuid(), 'attest', 'matched'), /not_found/, 'an unknown delivery is not_found');
  await refuses(() => verdict(D, 'approve', 'matched'), /invalid_input/, 'an unknown kind is invalid_input');
  await refuses(() => verdict(null, 'attest', 'matched'), /invalid_input/, 'a null delivery is invalid_input');
  await link(D, receipt);
  await refuses(() => verdict(D, 'attest', 'maybe'), /invalid_verdict/, 'a verdict that is not matched / discrepant is invalid_verdict');
  await refuses(() => verdict(D, 'attest', null), /invalid_verdict/, 'a missing verdict is invalid_verdict');
  const first = await verdict(D, 'attest', 'matched', 'ignored on a match');
  check(first.prior_state === 'counted_only' && first.match_state === 'matched' && first.location_id === shop && first.receipt_id === receipt, 'attest returns the state it replaced, read under the lock');
  check((await state(D)).match_state === 'matched' && (await state(D)).note === 'dock 2', 'matched sets the state and leaves the note alone');
  await verdict(D, 'attest', 'discrepant', '  short 2 cases  ');
  await verdict(D, 'attest', 'discrepant', 'and one damaged');
  check((await state(D)).note === 'dock 2\nshort 2 cases\nand one damaged', 'two discrepancy notes are both kept, trimmed, in order');
  await verdict(D, 'attest', 'discrepant');
  await verdict(D, 'attest', 'discrepant', '   ');
  check((await state(D)).note === 'dock 2\nshort 2 cases\nand one damaged', 'a discrepancy with no note appends nothing');
  await refuses(() => verdict(D, 'override', null, '   '), /note_required/, 'an override needs a note');
  const over = await verdict(D, 'override', null, 'accepted per vendor call');
  check(over.prior_state === 'discrepant' && (await state(D)).match_state === 'override' && (await state(D)).note.endsWith('\naccepted per vendor call'), 'override sets the terminal state and appends its note');
  // The B114 repro, in commit order: the attestation that read counted_only BEFORE the override now waits for the
  // row lock and re-reads the state after it.
  const beforeRace = (await state(D)).note;
  await refuses(() => verdict(D, 'attest', 'discrepant', 'short 2 cases'), /already_overridden/, 'an attestation after an override is refused already_overridden');
  await refuses(() => verdict(D, 'attest', 'matched'), /already_overridden/, '...for either verdict');
  check((await state(D)).match_state === 'override' && (await state(D)).note === beforeRace, "...and the manager's decision and note are untouched");
  await verdict(D, 'override', null, 'second look: still accepted');
  check((await state(D)).note === `${beforeRace}\nsecond look: still accepted`, 'a second override appends (never clobbers)');
  const blank = await record(header({ invoice_number: 'INV-5', notes: null, note: null }), [line(skuA)]);
  await verdict(blank.delivery_id, 'override', null, 'no paperwork came');
  check((await state(blank.delivery_id)).note === 'no paperwork came' && (await state(blank.delivery_id)).match_state === 'override', 'an override needs no receipt, and a first note has no leading newline');

  // ── U. delivery_receipt_unlink ─────────────────────────────────────────────────────────────────
  const unlink = (delivery, r, note, who = actor) => rpc('delivery_receipt_unlink', [delivery, r, note, who], ['uuid', 'uuid', 'text', 'uuid']);
  await refuses(() => unlink(D, receipt, '  '), /note_required/, 'unlink needs a reason');
  await refuses(() => unlink(D, receipt, 'x'.repeat(2001)), /invalid_input/, 'a reason over 2000 characters is invalid_input');
  await refuses(() => unlink(D, receipt, 'wrong doc', null), /invalid_input/, 'no actor is invalid_input');
  await refuses(() => unlink(D, receipt, 'wrong doc', inactive), /forbidden/, 'an inactive actor is forbidden');
  await refuses(() => unlink(D, receipt, 'wrong doc', uuid()), /forbidden/, 'an unknown actor is forbidden');
  await refuses(() => unlink(uuid(), receipt, 'wrong doc'), /not_found/, 'an unknown delivery is not_found');
  await refuses(() => unlink(blank.delivery_id, null, 'wrong doc'), /no_receipt/, 'a delivery with no receipt is no_receipt');
  await refuses(() => unlink(D, receipt2, 'wrong doc'), /receipt_changed/, 'a different receipt than the one the person saw is receipt_changed');
  check((await state(D)).email_receipt_id === receipt && await n('delivery_receipt_unlinks') === 0, '...and every refusal changes nothing');
  const noteBefore = (await state(D)).note;
  const undone = await unlink(D, receipt, '  this is the order confirmation, not the invoice ');
  check(undone.receipt_id === receipt && undone.prior_state === 'override' && undone.location_id === shop && undone.receipt_released === true, 'unlink returns what it undid');
  const after = await state(D);
  check(after.email_receipt_id === null && after.match_state === 'counted_only', 'the delivery has no receipt and its match is back to counted_only (an override is cleared too)');
  check(after.note === `${noteBefore}\nthis is the order confirmation, not the invoice`, 'the reason is appended to the delivery note');
  check((await one('select linked_delivery_id from public.email_receipts where id=$1', [receipt])).linked_delivery_id === null, 'the receipt is free again (back in triage)');
  const row = await one('select * from public.delivery_receipt_unlinks where id=$1', [undone.unlink_id]);
  check(row.delivery_id === D && row.receipt_id === receipt && row.location_id === shop && row.prior_match_state === 'override'
    && row.note === 'this is the order confirmation, not the invoice' && row.unlinked_by === actor, 'the unlink is recorded: pair, shop, prior state, reason, who');
  await refuses(() => verdict(D, 'attest', 'matched'), /no_receipt/, 'after an unlink there is nothing to attest');
  await refuses(() => unlink(D, receipt, 'again'), /no_receipt/, 'a second unlink of the same delivery is no_receipt (no double record)');
  await link(D, receipt2);
  check((await state(D)).email_receipt_id === receipt2, 'the freed slot takes another receipt (the 0171 one-receipt index is clear)');
  const any = await unlink(D, null, 'no receipt named: unlink whatever is linked');
  check(any.receipt_id === receipt2 && await n('delivery_receipt_unlinks') === 2, 'without a named receipt the linked one is unlinked');
  // A receipt whose own side already points elsewhere is left alone; the delivery is still cleared.
  await db.query('update public.vendor_deliveries set email_receipt_id=$2 where id=$1', [D, receipt]);
  await db.query('update public.email_receipts set linked_delivery_id=$1 where id=$2', [blank.delivery_id, receipt]);
  const stale = await unlink(D, receipt, 'stale pair');
  check(stale.receipt_released === false && (await state(D)).email_receipt_id === null
    && (await one('select linked_delivery_id from public.email_receipts where id=$1', [receipt])).linked_delivery_id === blank.delivery_id,
    "a receipt already pointing at another delivery keeps that link; this delivery's side is cleared");

  // ── C. ceilings ────────────────────────────────────────────────────────────────────────────────
  for (const f of ['record_delivery_atomic(jsonb,jsonb,jsonb,jsonb)', 'delivery_match_verdict(uuid,text,text,text)', 'delivery_receipt_unlink(uuid,uuid,text,uuid)']) {
    const meta = await one(`select prosecdef, proconfig from pg_proc where oid='public.${f}'::regprocedure`);
    assert.equal(meta.prosecdef, true); assert.ok(meta.proconfig.includes('search_path=pg_catalog, public'));
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal((await one(`select has_function_privilege($1,'public.${f}','EXECUTE') ok`, [role])).ok, role === 'service_role');
    }
    assert.equal((await one(`select count(*)::int n from pg_proc p, lateral aclexplode(p.proacl) a where p.oid='public.${f}'::regprocedure and a.grantee=0`)).n, 0);
  }
  check(true, 'the three functions: SECURITY DEFINER, pinned search_path, service_role execute only, no PUBLIC');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
      assert.equal((await one("select has_table_privilege($1,'public.delivery_receipt_unlinks',$2) ok", [role, p])).ok, role === 'service_role' && p === 'SELECT');
    }
  }
  check(true, 'delivery_receipt_unlinks: service_role SELECT only (append-only by grant)');
  await refuses(() => service(() => db.query('insert into public.delivery_receipt_unlinks(delivery_id,receipt_id,location_id,prior_match_state,note,unlinked_by) values ($1,$2,$3,$4,$5,$6)', [D, receipt, shop, 'matched', 'forged', actor])),
    /permission denied/, 'service_role cannot forge an unlink row');
  await refuses(() => service(() => db.query('delete from public.delivery_receipt_unlinks')), /permission denied/, 'service_role cannot delete unlink history');
  await refuses(() => service(() => db.query("update public.delivery_receipt_unlinks set note='edited'")), /permission denied/, 'service_role cannot rewrite unlink history');
  check((await service(() => q('select id from public.delivery_receipt_unlinks'))).length === 3, 'service_role can read the history');
  const policies = (await q("select policyname, cmd, qual, with_check from pg_policies where tablename='delivery_receipt_unlinks' order by policyname")).map(p => `${p.policyname}:${p.cmd}:${p.qual ?? p.with_check}`);
  check((await one("select relrowsecurity from pg_class where oid='public.delivery_receipt_unlinks'::regclass")).relrowsecurity === true
    && policies.join('|') === 'delivery_receipt_unlinks_no_user_delete:DELETE:false|delivery_receipt_unlinks_no_user_insert:INSERT:false|delivery_receipt_unlinks_no_user_select:SELECT:false|delivery_receipt_unlinks_no_user_update:UPDATE:false',
    'RLS is on with the four deny policies, split per operation (never FOR ALL)');
  await db.exec('grant execute on function public.delivery_match_verdict(uuid,text,text,text) to authenticated; grant insert on public.delivery_receipt_unlinks to service_role;');
  await db.exec(migration);
  check((await one("select has_function_privilege('authenticated','public.delivery_match_verdict(uuid,text,text,text)','EXECUTE') ok")).ok === false
    && (await one("select has_table_privilege('service_role','public.delivery_receipt_unlinks','INSERT') ok")).ok === false, 're-applying closes drifted grants');
  await assert.rejects(() => db.exec(migration.replace('grant select on public.delivery_receipt_unlinks to service_role;', 'grant select, insert on public.delivery_receipt_unlinks to service_role;')), /0327: delivery_receipt_unlinks privilege escape/);
  await db.exec('rollback');
  await assert.rejects(() => db.exec(migration.replace('grant execute on function public.record_delivery_atomic(jsonb,jsonb,jsonb,jsonb) to service_role;', 'grant execute on function public.record_delivery_atomic(jsonb,jsonb,jsonb,jsonb) to authenticated, service_role;')), /0327: receiving RPC escape/);
  await db.exec('rollback');
  check(await n('delivery_receipt_unlinks') === 3, 'a variant that widens a grant fails its own assertion, rolls back, and keeps the history');

  console.log(`PASS 0327: ${checks} checks (single-session PGlite; the two-session proofs are the sim script)`);
} finally { await db.close(); }
