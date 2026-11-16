/** FILE ONLY: CC runs it on the SIM after applying 0326 and 0327. Never loads .env, a direct DB URL or `pg`.
 * SUPABASE_ACCESS_TOKEN=<operator environment>; node scripts/sim/receiving-0326-0327-lock-check-management.mjs --ref=jepgzucrvklhqpthowsc
 *
 * The two-session proofs of audit wave W20 that one PGlite backend cannot give (scripts/sql-harness-0326.mjs and
 * -0327.mjs are the single-session proofs). Every Management API request is ONE transaction; a "holder" runs its
 * statement and then sleeps with its locks held, a "racer" starts while it sleeps.
 *
 *   0326 (B196)  mail-vs-parse     The audit's deadlock, statement for statement: the holder locks the inbound message
 *                                  with the SAME lock clause the installed vendor_mail_mutate uses (read from its source),
 *                                  sleeps, then locks the receipt. The racer is the parser's write: an UPDATE of that
 *                                  receipt, which fires the real receipt-event trigger and its foreign-key check on the
 *                                  message. PASS = the racer is NOT blocked, finishes first, and nobody gets 40P01.
 *                                  (Before 0326 this pairing deadlocks: run it then to see the bug.)
 *   0327 (B114)  override>attest   The attestation that queued behind an override is refused already_overridden; the
 *                                  override and its note stand.
 *   0327 (B114)  attest>attest     Two discrepancy notes written at once are both kept, in commit order.
 *   0327 (W20-2) unlink>attest     An attestation that queued behind an unlink is refused no_receipt.
 *   0327 (B197)  atomic write      On the sim's REAL schema: a valid delivery saves (header, lines, credits); a bad flag
 *                                  on line 2 and a duplicate invoice leave no row behind.
 *
 * Fixtures: newly allocated ids only, every row tagged SIM-W20-<tag>, dated 2099. The fixture shop, user, vendor and
 * SKU are deactivated at the end; deliveries, receipts and the inbound message stay (append-only) and their ids are
 * printed. No retries: an interrupted request may have committed; retire leftovers by hand from the printed ids.
 * Exit 0 = every proof passed, 1 = a proof failed, 2 = refused / not runnable (wrong project, migration missing).
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { literal as q, managementQuery, projectRef } from '../supabase-management-query.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export const HOLD_MS = 6000;
export const MUTATE = 'public.vendor_mail_mutate(uuid,integer,uuid,uuid,uuid,text,jsonb)';
export const functions = {
  record: 'public.record_delivery_atomic(jsonb,jsonb,jsonb,jsonb)',
  verdict: 'public.delivery_match_verdict(uuid,text,text,text,uuid)',
  unlink: 'public.delivery_receipt_unlink(uuid,uuid,text,uuid)',
};
/** The proofs, in run order: [name, migration it proves]. */
export const proofs = [
  ['mail-vs-parse', '0326'], ['override>attest', '0327'], ['attest>attest', '0327'], ['unlink>attest', '0327'], ['atomic write', '0327'],
];
/** Every column the fixture writes, per table: checked against the sim's catalog before anything is inserted. */
export const fixtureColumns = {
  users: ['id', 'name', 'role', 'pin_hash', 'active'],
  locations: ['id', 'name', 'code', 'type', 'active'],
  vendors: ['id', 'name', 'active', 'created_by'],
  vendor_items: ['id', 'name', 'vendor_id', 'location_id', 'active', 'created_by', 'notes'],
  vendor_deliveries: ['id', 'vendor_id', 'location_id', 'delivery_date', 'invoice_number', 'notes', 'note', 'received_by', 'delivery_status', 'email_receipt_id'],
  email_receipts: ['id', 'source', 'subject', 'location_id', 'linked_delivery_id', 'inbound_message_id', 'received_at'],
  inbound_messages: ['id', 'provider_email_id', 'lane', 'content_state', 'subject', 'email_receipt_id'],
};

export function fixture() {
  const f = Object.fromEntries(['actor', 'shop', 'vendor', 'sku', 'message', 'mailReceipt',
    'dOverride', 'rOverride', 'dNotes', 'rNotes', 'dUnlink', 'rUnlink'].map(key => [key, randomUUID()]));
  f.tag = `SIM-W20-${f.shop.slice(0, 8)}`;
  return f;
}
const U = id => `${q(id)}::uuid`;

/** INSERT-only. Three linked delivery/receipt pairs for the 0327 races, one mail + receipt for 0326. */
export function fixtureSQL(f) {
  const delivery = (d, r, n) => `(${U(d)},${U(f.vendor)},${U(f.shop)},date '2099-01-0${n}',${q(`${f.tag}-${n}`)},'N0','N0',${U(f.actor)},'complete',${U(r)})`;
  return `begin;
    insert into public.users(id,name,role,pin_hash,active) values(${U(f.actor)},${q(f.tag)},'agm','SIM-NO-VALID-CREDENTIAL',true);
    insert into public.locations(id,name,code,type,active) values(${U(f.shop)},${q(f.tag)},${q(f.tag)},'permanent',true);
    insert into public.vendors(id,name,active,created_by) values(${U(f.vendor)},${q(f.tag)},true,${U(f.actor)});
    insert into public.vendor_items(id,name,vendor_id,location_id,active,created_by,notes) values(${U(f.sku)},${q(f.tag)},${U(f.vendor)},${U(f.shop)},true,${U(f.actor)},${q(f.tag)});
    insert into public.email_receipts(id,source,subject,location_id,received_at) values
      (${U(f.rOverride)},'upload',${q(f.tag)},${U(f.shop)},timestamptz '2099-01-01 12:00+00'),
      (${U(f.rNotes)},'upload',${q(f.tag)},${U(f.shop)},timestamptz '2099-01-02 12:00+00'),
      (${U(f.rUnlink)},'upload',${q(f.tag)},${U(f.shop)},timestamptz '2099-01-03 12:00+00');
    insert into public.vendor_deliveries(id,vendor_id,location_id,delivery_date,invoice_number,notes,note,received_by,delivery_status,email_receipt_id) values
      ${delivery(f.dOverride, f.rOverride, 1)}, ${delivery(f.dNotes, f.rNotes, 2)}, ${delivery(f.dUnlink, f.rUnlink, 3)};
    insert into public.inbound_messages(id,provider_email_id,lane,content_state,subject) values(${U(f.message)},${q(`${f.tag}-mail`)},'vendor_receipt','skipped',${q(f.tag)});
    insert into public.email_receipts(id,source,subject,location_id,inbound_message_id,received_at)
      values(${U(f.mailReceipt)},'inbound',${q(f.tag)},${U(f.shop)},${U(f.message)},timestamptz '2099-01-04 12:00+00');
    select 1 as done; commit;`;
}
/** UPDATE-only, each statement on the fixture's own ids: links both sides, exactly as the app's two writes do. */
export function linkSQL(f) {
  const pair = (d, r) => `update public.email_receipts set linked_delivery_id=${U(d)} where id=${U(r)} and subject=${q(f.tag)};`;
  return `begin; ${pair(f.dOverride, f.rOverride)} ${pair(f.dNotes, f.rNotes)} ${pair(f.dUnlink, f.rUnlink)}
    update public.inbound_messages set email_receipt_id=${U(f.mailReceipt)} where id=${U(f.message)} and subject=${q(f.tag)};
    select 1 as done; commit;`;
}
/** Deactivate the fixture's own configuration. History (deliveries, receipts, the mail) is kept. */
export function retireSQL(f) {
  return `begin;
    update public.vendor_items set active=false where id=${U(f.sku)} and name=${q(f.tag)};
    update public.vendors set active=false where id=${U(f.vendor)} and name=${q(f.tag)};
    update public.users set active=false where id=${U(f.actor)} and name=${q(f.tag)};
    update public.locations set active=false where id=${U(f.shop)} and code=${q(f.tag)};
    select 1 as done; commit;`;
}

/** ONE transaction. The body's outcome (ok:<json> | err:<sqlstate>:<message>) is returned as a row, so a SQL
 *  refusal is data here, never a failed request. `hold` sleeps AFTER the body with its locks still held. */
export function wrap(name, body, { hold = 0, serviceRole = true } = {}) {
  return `begin isolation level read committed;
    set local statement_timeout='40s'; set local lock_timeout='25s'; set local application_name=${q(name)};
    ${serviceRole ? 'set local role service_role;' : ''}
    do $zz$ declare v_out text; begin
      begin
        ${body}
        perform set_config('zzw20.out', 'ok:' || coalesce(v_out, 'null'), true);
      exception when others then
        perform set_config('zzw20.out', 'err:' || sqlstate || ':' || sqlerrm, true);
      end;
    end $zz$;
    ${hold ? `select pg_sleep(${hold / 1000});` : ''}
    select current_setting('zzw20.out', true) as out;
    commit;`;
}
export function parse(out) {
  if (typeof out !== 'string') return { ok: false, code: 'no_output', msg: String(out) };
  if (out.startsWith('ok:')) { let value = out.slice(3); try { value = JSON.parse(value); } catch { /* plain text */ } return { ok: true, value }; }
  const [, code, ...rest] = out.split(':');
  return { ok: false, code, msg: rest.join(':') };
}

export function calls(f) {
  // The last argument is the receipt the verdict is about (the one the person compared).
  const verdict = (d, kind, v, note, r) => `v_out := public.delivery_match_verdict(${U(d)},${q(kind)},${v ? q(v) : 'null'},${note ? q(note) : 'null'},${U(r)})::text;`;
  const header = n => JSON.stringify({ vendor_id: f.vendor, location_id: f.shop, delivery_date: '2099-02-01', invoice_number: `${f.tag}-INV-${n}`,
    invoice_total: 10, notes: f.tag, note: f.tag, receipt_url: null, received_by: f.actor, delivery_status: 'complete', purchase_order_id: null });
  const line = (extra = {}) => ({ vendor_item_id: f.sku, qty_received: 4, vendor_id: f.vendor, unit_price: 2.5, observed_oz_per_each: null, notes: null,
    created_by: f.actor, received_level_label: null, received_qty_at_level: null, resolved_oz: null, note: null, photo_url: null, expected_qty: 5,
    discrepancy_type: 'short', ...extra });
  const record = (n, lines, credits = []) => `v_out := public.record_delivery_atomic(${q(header(n))}::jsonb,${q(JSON.stringify(lines))}::jsonb,${q(JSON.stringify(credits))}::jsonb,'[]'::jsonb)::text;`;
  return {
    // The holder half of the audit's repro: the message, a pause, then the receipt. `lockClause` is the installed function's own.
    mailHolder: lockClause => `execute 'select 1 from public.inbound_messages where id = $1 ${lockClause}' using ${U(f.message)};
      perform pg_sleep(${HOLD_MS / 1000});
      perform 1 from public.email_receipts where id = ${U(f.mailReceipt)} for update; v_out := '"locked both"';`,
    // The parser's guarded failed-write (lib/receipt-parse.ts writeFailed): fires vendor_mail_receipt_event.
    parserWrite: `update public.email_receipts set parse_state='failed', parsed_json='{"reason":"sim_w20"}'::jsonb where id=${U(f.mailReceipt)} and parse_state='unparsed';
      v_out := '"parser write committed"';`,
    override: verdict(f.dOverride, 'override', null, 'accepted per vendor call', f.rOverride),
    attestAfterOverride: verdict(f.dOverride, 'attest', 'discrepant', 'short 2 cases', f.rOverride),
    attestA: verdict(f.dNotes, 'attest', 'discrepant', 'first note', f.rNotes),
    attestB: verdict(f.dNotes, 'attest', 'discrepant', 'second note', f.rNotes),
    unlink: `v_out := public.delivery_receipt_unlink(${U(f.dUnlink)},${U(f.rUnlink)},'wrong document',${U(f.actor)})::text;`,
    attestAfterUnlink: verdict(f.dUnlink, 'attest', 'matched', null, f.rUnlink),
    recordValid: record(1, [line(), line({ discrepancy_type: null })], [{ line_index: 1, reason: 'short', sku_id: f.sku, qty: 1, amount_cents: 250 }]),
    recordBadFlag: record(2, [line({ discrepancy_type: null }), line({ discrepancy_type: 'bogus' })]),
    recordDuplicate: record(1, [line({ discrepancy_type: null })]),
  };
}
export function evidenceSQL(f) {
  return `select
    (select json_build_object('state', match_state, 'note', note, 'receipt', email_receipt_id) from public.vendor_deliveries where id=${U(f.dOverride)}) as override_pair,
    (select json_build_object('state', match_state, 'note', note) from public.vendor_deliveries where id=${U(f.dNotes)}) as notes_pair,
    (select json_build_object('state', match_state, 'receipt', email_receipt_id,
       'receipt_side', (select linked_delivery_id from public.email_receipts where id=${U(f.rUnlink)}),
       'unlinks', (select count(*) from public.delivery_receipt_unlinks where delivery_id=${U(f.dUnlink)})) from public.vendor_deliveries where id=${U(f.dUnlink)}) as unlink_pair,
    (select json_build_object('deliveries', count(*), 'lines', (select count(*) from public.vendor_delivery_items i join public.vendor_deliveries d on d.id=i.delivery_id where d.notes=${q(f.tag)} and d.delivery_date=date '2099-02-01'),
       'credits', (select count(*) from public.vendor_credits c join public.vendor_deliveries d on d.id=c.delivery_id where d.notes=${q(f.tag)} and d.delivery_date=date '2099-02-01'))
       from public.vendor_deliveries where notes=${q(f.tag)} and delivery_date=date '2099-02-01') as atomic,
    (select parse_state from public.email_receipts where id=${U(f.mailReceipt)}) as mail_receipt_state`;
}

/** What is installed, and whether the fixture's columns exist with nothing else required. Read-only. */
export function preflightSQL() {
  const tables = Object.keys(fixtureColumns);
  const listed = Object.entries(fixtureColumns).flatMap(([t, cols]) => cols.map(c => `(${q(t)},${q(c)})`)).join(',');
  return `select
    to_regprocedure(${q(MUTATE)}) is not null as has_mutate,
    coalesce((select position('for no key update' in prosrc) > 0 from pg_proc where oid = to_regprocedure(${q(MUTATE)})), false) as has_0326,
    to_regprocedure(${q(functions.record)}) is not null and to_regprocedure(${q(functions.verdict)}) is not null
      and to_regprocedure(${q(functions.unlink)}) is not null and to_regclass('public.delivery_receipt_unlinks') is not null as has_0327,
    coalesce((select json_agg(t || '.' || c order by t, c) from (values ${listed}) need(t, c)
       where not exists (select 1 from information_schema.columns k where k.table_schema='public' and k.table_name=need.t and k.column_name=need.c)), '[]'::json) as missing_columns,
    coalesce((select json_agg(k.table_name || '.' || k.column_name order by 1) from information_schema.columns k
       where k.table_schema='public' and k.table_name in (${tables.map(q).join(',')}) and k.is_nullable='NO' and k.column_default is null
         and k.is_generated='NEVER' and k.is_identity='NO'
         and not exists (select 1 from (values ${listed}) have(t, c) where have.t=k.table_name and have.c=k.column_name)), '[]'::json) as unfilled_required`;
}

/** Holder first; the racer starts once the holder is asleep with its locks. Reports whether the racer was observed
 *  BLOCKED BY the holder (an ungranted lock + pg_blocking_pids), and which of the two finished first. */
export async function race(query, tag, holderSQL, racerSQL, { sleep = pause, now = Date.now } = {}) {
  const hName = `zzw20-${tag}-h-${randomUUID().slice(0, 8)}`, rName = `zzw20-${tag}-r-${randomUUID().slice(0, 8)}`;
  const send = async sql => { try { return { ...parse((await query(sql)).at(-1)?.out), at: now() }; } catch (e) { return { ok: false, code: 'transport', msg: e.message, at: now() }; } };
  const holder = send(holderSQL(hName));
  let racer;
  try {
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      const rows = await query(`select exists(select 1 from pg_stat_activity where application_name=${q(hName)} and wait_event='PgSleep') as ready`);
      if (rows[0]?.ready === true) ready = true; else await sleep(200);
    }
    if (!ready) return { error: 'the holder never reached its pause', holder: await holder };
    await sleep(500);
    const start = now();
    let racerDone = false;
    racer = send(racerSQL(rName)).then(result => { racerDone = true; return result; });
    let blocked = false;
    for (let i = 0; i < 20 && !blocked && !racerDone; i++) {
      const rows = await query(`select exists(select 1 from pg_stat_activity r join pg_locks l on l.pid=r.pid and not l.granted
        join pg_stat_activity h on h.pid = any(pg_blocking_pids(r.pid))
        where r.application_name=${q(rName)} and h.application_name=${q(hName)} and h.pid<>r.pid) as blocked`);
      if (rows[0]?.blocked === true) blocked = true; else await sleep(200);
    }
    const [h, r] = await Promise.all([holder, racer]);
    return { holder: h, racer: r, blocked, racerMs: r.at - start, racerFirst: r.at < h.at };
  } finally { await Promise.all([holder, racer].filter(Boolean)); }
}

/** The Management API may hand a json column back parsed or as text. */
const json = value => (typeof value === 'string' ? JSON.parse(value) : value);
const evidence = async (query, f) => Object.fromEntries(Object.entries((await query(evidenceSQL(f)))[0]).map(([k, v]) => [k, k === 'mail_receipt_state' ? v : json(v)]));
const refused = (result, name) => !result.ok && result.code === 'P0001' && result.msg === name;
const show = result => (result.ok ? JSON.stringify(result.value) : `${result.code} ${result.msg}`);

export async function runProof(query, log = console.log, raceOptions = {}) {
  const [raw] = await query(preflightSQL());
  const pre = { ...raw, missing_columns: json(raw.missing_columns), unfilled_required: json(raw.unfilled_required) };
  if (pre.missing_columns.length > 0 || pre.unfilled_required.length > 0) {
    log(`REFUSED: the fixture does not fit this schema. Missing: ${JSON.stringify(pre.missing_columns)}. Required but not written: ${JSON.stringify(pre.unfilled_required)}.`);
    return { refused: true, results: [] };
  }
  if (!pre.has_mutate && !pre.has_0327) { log('REFUSED: neither vendor mail (0297) nor 0327 is installed here.'); return { refused: true, results: [] }; }
  const f = fixture();
  const c = calls(f);
  const results = [];
  const record = (name, pass, detail) => { results.push({ name, pass, detail }); log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`); };
  const skip = (name, why) => { results.push({ name, pass: null, detail: why }); log(`SKIP ${name}: ${why}`); };
  log(`fixture ${f.tag}: ${JSON.stringify(f)}`);
  await query(fixtureSQL(f));
  try {
    await query(linkSQL(f));

    // ── 0326: the audit's deadlock, with the installed function's own lock clause ──
    if (!pre.has_mutate) skip('mail-vs-parse', 'vendor mail (0297) is not installed');
    else {
      const lockClause = pre.has_0326 ? 'for no key update' : 'for update';
      const x = await race(query, 'mail', n => wrap(n, c.mailHolder(lockClause), { serviceRole: false }), n => wrap(n, c.parserWrite), raceOptions);
      const e = await evidence(query, f);
      const pass = !x.error && x.holder.ok && x.racer.ok && !x.blocked && x.racerFirst && e.mail_receipt_state === 'failed';
      record('mail-vs-parse', pass, x.error ?? `message locked ${lockClause}; parser write ${x.blocked ? 'BLOCKED by the action' : 'not blocked'}, ${x.racerMs} ms, `
        + `${x.racerFirst ? 'finished first' : 'finished after the action'}; action: ${show(x.holder)}; parser: ${show(x.racer)}`
        + (pre.has_0326 ? '' : ' (0326 is NOT applied: this is the bug it fixes)'));
    }

    if (!pre.has_0327) for (const [name] of proofs.filter(p => p[1] === '0327')) skip(name, '0327 is not installed');
    else {
      // ── 0327: an attestation queued behind an override ──
      let x = await race(query, 'over', n => wrap(n, c.override, { hold: HOLD_MS }), n => wrap(n, c.attestAfterOverride), raceOptions);
      let e = await evidence(query, f);
      record('override>attest', !x.error && x.holder.ok && x.blocked && !x.racerFirst && refused(x.racer, 'already_overridden')
        && e.override_pair.state === 'override' && e.override_pair.note === 'N0\naccepted per vendor call',
        x.error ?? `attest ${x.blocked ? 'waited for' : 'did NOT wait for'} the override, then: ${show(x.racer)}; delivery ${JSON.stringify(e.override_pair)}`);

      // ── 0327: two notes at once ──
      x = await race(query, 'note', n => wrap(n, c.attestA, { hold: HOLD_MS }), n => wrap(n, c.attestB), raceOptions);
      e = await evidence(query, f);
      record('attest>attest', !x.error && x.holder.ok && x.racer.ok && x.blocked && !x.racerFirst && e.notes_pair.note === 'N0\nfirst note\nsecond note',
        x.error ?? `second attest ${x.blocked ? 'waited' : 'did NOT wait'}; note ${JSON.stringify(e.notes_pair.note)}`);

      // ── 0327: an attestation queued behind an unlink ──
      x = await race(query, 'unlk', n => wrap(n, c.unlink, { hold: HOLD_MS }), n => wrap(n, c.attestAfterUnlink), raceOptions);
      e = await evidence(query, f);
      record('unlink>attest', !x.error && x.holder.ok && x.blocked && !x.racerFirst && refused(x.racer, 'no_receipt')
        && e.unlink_pair.state === 'counted_only' && e.unlink_pair.receipt === null && e.unlink_pair.receipt_side === null && Number(e.unlink_pair.unlinks) === 1,
        x.error ?? `attest ${x.blocked ? 'waited for' : 'did NOT wait for'} the unlink, then: ${show(x.racer)}; delivery ${JSON.stringify(e.unlink_pair)}`);

      // ── 0327: the atomic write on the sim's real schema (single session, committed) ──
      const send = async body => parse((await query(wrap(`zzw20-atomic-${randomUUID().slice(0, 8)}`, body))).at(-1)?.out);
      const valid = await send(c.recordValid);
      const bad = await send(c.recordBadFlag);
      const duplicate = await send(c.recordDuplicate);
      e = await evidence(query, f);
      record('atomic write', valid.ok && valid.value?.item_ids?.length === 2 && !bad.ok && bad.code === '23514' && !duplicate.ok && duplicate.code === '23505'
        && Number(e.atomic.deliveries) === 1 && Number(e.atomic.lines) === 2 && Number(e.atomic.credits) === 1,
        `valid: ${show(valid)}; bad flag: ${show(bad)}; duplicate invoice: ${show(duplicate)}; rows left: ${JSON.stringify(e.atomic)}`);
    }
  } finally {
    await query(retireSQL(f));
    log(`retired fixture configuration (shop, user, vendor, SKU deactivated). Kept as history: deliveries ${f.dOverride}, ${f.dNotes}, ${f.dUnlink} and any dated 2099-02-01 with notes ${f.tag}; receipts ${f.rOverride}, ${f.rNotes}, ${f.rUnlink}, ${f.mailReceipt}; inbound message ${f.message}.`);
  }
  return { refused: false, results };
}

export async function main(args = process.argv.slice(2), env = process.env, log = console.log) {
  let query;
  try {
    const ref = projectRef(args, true);
    assert.ok(env.SUPABASE_ACCESS_TOKEN, 'Set SUPABASE_ACCESS_TOKEN explicitly');
    query = managementQuery(ref, env.SUPABASE_ACCESS_TOKEN);
  } catch (e) { log(`REFUSED: ${e.message}`); return 2; }
  const { refused: notRunnable, results } = await runProof(query, log);
  if (notRunnable) return 2;
  const failed = results.filter(r => r.pass === false);
  log(failed.length ? `FAILED: ${failed.map(r => r.name).join(', ')}` : `ALL PASS (${results.filter(r => r.pass).length} proven, ${results.filter(r => r.pass === null).length} skipped)`);
  return failed.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
