/** Offline 0344 proof (item 21 PR 1). Ephemeral in-memory PGlite only: no credentials, no network.
 * Builds a minimal schema, loads the REAL 0221 toast_orders_latest view and the REAL 0232 sales_report_assert_window
 * and sales_report_catering_values bodies, then applies the REAL 0344 file and proves:
 *   the privilege ceiling and deny-all RLS; the ring code (shape, generation only when enabled, idempotent, immutable,
 *   ezCater leads refused, the format-collision guard); the settings constraints (no auto switch without a backfill
 *   floor, Toast-origin listing only with origin auto-link); the decision chains (one head per key, same-key successors,
 *   append-only); the planner (both evidence paths for the ring code, the Toast-origin expansion order -> every live
 *   check, the amount rule on house catering options only, dual code, ezCater ownership read from the RAW is_current
 *   row so a recapture never releases it, the unlink tombstone, the window bound, code-only note input); the status
 *   view (links at the lead's own shop only, mismatch, no-ring, lost and ezCater leads out); the orphans view; and the
 *   pipeline partition summing EXACTLY to the unchanged 0232 value.
 * Nothing here writes ezcater_toast_links from a 0344 function (the stub rows are fixtures inserted by the harness).
 */
import { PGlite } from '@electric-sql/pglite';
import { H1, H2, H3, H4, EZ, LOST, H7, SHOP, OTHER, ACTOR, id, migration, schema as baseSchema, ring } from './sql-harness-0344-lib.mjs';

let checks = 0;
function check(ok, message) { checks++; if (!ok) throw new Error(`FAIL: ${message}`); }
async function refuses(db, sql, code, message) {
  try { await db.exec(sql); } catch (e) { check(String(e.message).includes(code), `${message} (got ${e.message})`); return; }
  check(false, `${message}: did not refuse`);
}

const schema = db => baseSchema(db, check);
const plan = async (db, args = {}) => (await db.query(
  `select * from plan_catering_toast($1, $2, $3, $4) order by lead_id, check_guid`,
  [args.shop ?? SHOP, args.from ?? '2026-11-01', args.to ?? '2026-11-30', JSON.stringify(args.notes ?? [])])).rows;
const status = async (db, lead) => (await db.query(`select * from catering_reconciliation_status where lead_id = $1`, [lead])).rows[0];

async function main() {
  // 0. The format-collision guard refuses a database whose ezCater numbers have the house shape.
  {
    const db = new PGlite();
    await schema(db);
    await db.exec(`insert into ezcater_orders(order_number) values ('co-acd34')`);
    await refuses(db, migration, 'ring_code_format_collides_with_ezcater', 'collision guard');
  }

  const db = new PGlite();
  await schema(db);
  await db.exec(`insert into ezcater_orders(order_number, location_id) values ('ABC-123', '${SHOP}')`);
  await db.exec(migration);

  // 1. Ceiling and RLS.
  const pol = await db.query(`select count(*)::int n from pg_policies where tablename in ('catering_toast_settings','catering_toast_link_decisions','catering_toast_links')`);
  check(pol.rows[0].n === 12, 'twelve deny-all policies');
  for (const t of ['catering_toast_settings', 'catering_toast_link_decisions', 'catering_toast_links']) {
    const p = (await db.query(`select has_table_privilege('service_role', $1, 'select') s, has_table_privilege('service_role', $1, 'insert') i,
      has_table_privilege('service_role', $1, 'update') u, has_table_privilege('authenticated', $1, 'select') a`, [`public.${t}`])).rows[0];
    check(p.s && !p.i && !p.u && !p.a, `${t}: service_role SELECT only, users nothing`);
  }
  for (const f of ['plan_catering_toast(uuid,date,date,jsonb)', 'catering_pipeline_reconciliation(uuid,date,date)', 'ensure_catering_ring_code(uuid)']) {
    const p = (await db.query(`select has_function_privilege('authenticated', $1, 'execute') a, has_function_privilege('service_role', $1, 'execute') s`, [`public.${f}`])).rows[0];
    check(!p.a && p.s, `${f}: service_role only`);
  }

  // Leads. H1 portal (quote 500.00 accepted), H2 Toast-origin, H3 house by amount, H4 no ring, EZ ezCater, LOST lost, H7 other code.
  await db.exec(`insert into catering_pipeline(id, location_id, event_date, stage, lead_source, headcount, estimated_revenue_cents) values
    ('${H1}', '${SHOP}', '2026-11-20', 'confirmed', 'portal', 20, 45000),
    ('${H2}', '${SHOP}', '2026-11-20', 'confirmed', 'toast_catering', 10, 12000),
    ('${H3}', '${SHOP}', '2026-11-21', 'completed', null, 15, 30000),
    ('${H4}', '${SHOP}', '2026-11-22', 'out', 'portal', 5, null),
    ('${EZ}', '${SHOP}', '2026-11-20', 'confirmed', 'ezcater', 30, 70000),
    ('${LOST}', '${SHOP}', '2026-11-20', 'lost', 'portal', 5, 9000),
    ('${H7}', '${SHOP}', '2026-11-25', 'confirmed', 'portal', 5, 8000);
    insert into catering_quotes(pipeline_id, total_cents, status, version) values ('${H1}', 50000, 'accepted', 2), ('${H1}', 40000, 'sent', 1);
    insert into ezcater_orders(lead_id, location_id, order_number) values ('${EZ}', '${SHOP}', 'XYZ-789');`);

  // 2. Ring code.
  await refuses(db, `select ensure_catering_ring_code('${H1}')`, 'ring_code_disabled', 'no code while the shop is off');
  await refuses(db, `insert into catering_toast_settings(location_id, auto_link_enabled) values ('${SHOP}', true)`, 'catering_toast_settings_auto_needs_floor', 'auto without a floor');
  await refuses(db, `insert into catering_toast_settings(location_id, include_toast_origin_leads) values ('${SHOP}', true)`, 'catering_toast_settings_origin_listing', 'origin listing without origin auto-link');
  await db.exec(`insert into catering_toast_settings(location_id, enabled, ring_code_enabled) values ('${SHOP}', true, true)`);
  await db.exec(`update catering_pipeline set ring_code = 'CO-ACD34' where id = '${H7}'`);
  const code1 = (await db.query(`select ensure_catering_ring_code('${H1}') c`)).rows[0].c;
  check(/^CO-[ACDEFGHJKLMNPQRTUVWXY34679]{5}$/.test(code1) && /[34679]/.test(code1), `code shape ${code1}`);
  check((await db.query(`select ensure_catering_ring_code('${H1}') c`)).rows[0].c === code1, 'idempotent');
  await refuses(db, `update catering_pipeline set ring_code = 'CO-ACD34' where id = '${H1}'`, 'ring_code_immutable', 'immutable once set');
  await db.exec(`update catering_pipeline set stage = 'out' where id = '${H1}'; update catering_pipeline set stage = 'confirmed' where id = '${H1}'`);
  check(true, 'other updates are untouched by the trigger');
  await refuses(db, `select ensure_catering_ring_code('${EZ}')`, 'ezcater_lead', 'ezCater leads never get a house code');
  await refuses(db, `update catering_pipeline set ring_code = 'CO-ACDE' where id = '${H3}'`, 'catering_pipeline_ring_code_shape', 'shape check');
  await refuses(db, `update catering_pipeline set ring_code = 'co-acd34' where id = '${H3}'`, 'catering_pipeline_ring_code_shape', 'lowercase refused by shape');
  await refuses(db, `update catering_pipeline set ring_code = 'CO-ACD34' where id = '${H4}'`, 'catering_pipeline_ring_code_uq', 'a code is never reused');
  const codes = new Set();
  for (let i = 0; i < 40; i++) {
    const lead = id('3100', i);
    await db.exec(`insert into catering_pipeline(id, location_id, event_date, stage, lead_source) values ('${lead}', '${SHOP}', '2026-01-01', 'lost', 'portal')`);
    codes.add((await db.query(`select ensure_catering_ring_code('${lead}') c`)).rows[0].c);
  }
  check(codes.size === 40, 'generation draws distinct codes');

  // 3. Decision chains.
  const D1 = id('4000', 1), D2 = id('4000', 2), D3 = id('4000', 3);
  await db.exec(`insert into catering_toast_link_decisions(id, lead_id, kind, location_id, order_guid, check_guid, actor_id) values ('${D1}', '${H1}', 'link', '${SHOP}', 'O1', 'C1', '${ACTOR}')`);
  await refuses(db, `insert into catering_toast_link_decisions(lead_id, kind, location_id, order_guid, check_guid, actor_id) values ('${H1}', 'unlink', '${SHOP}', 'O1', 'C1', '${ACTOR}')`,
    'catering_toast_decisions_one_root', 'a second root for one key');
  await refuses(db, `insert into catering_toast_link_decisions(lead_id, kind, location_id, order_guid, check_guid, actor_id, supersedes_id) values ('${H1}', 'unlink', '${SHOP}', 'O1', 'OTHER', '${ACTOR}', '${D1}')`,
    'decision_chain_key_mismatch', 'a successor on another key');
  await refuses(db, `insert into catering_toast_link_decisions(lead_id, kind, actor_id, reason_code, supersedes_id) values ('${H1}', 'no_ring_expected', '${ACTOR}', 'comped', '${D1}')`,
    'decision_chain_key_mismatch', 'a lead decision cannot succeed a pair decision');
  await db.exec(`insert into catering_toast_link_decisions(id, lead_id, kind, location_id, order_guid, check_guid, actor_id, supersedes_id) values ('${D2}', '${H1}', 'unlink', '${SHOP}', 'O1', 'C1', '${ACTOR}', '${D1}')`);
  await refuses(db, `insert into catering_toast_link_decisions(lead_id, kind, location_id, order_guid, check_guid, actor_id, supersedes_id) values ('${H1}', 'link', '${SHOP}', 'O1', 'C1', '${ACTOR}', '${D1}')`,
    'catering_toast_link_decisions_supersedes_id_key', 'a fork of the chain');
  await refuses(db, `update catering_toast_link_decisions set kind = 'link' where id = '${D2}'`, 'catering_toast_decisions_append_only', 'no update');
  await refuses(db, `delete from catering_toast_link_decisions where id = '${D2}'`, 'catering_toast_decisions_append_only', 'no delete');
  await refuses(db, `insert into catering_toast_link_decisions(lead_id, kind, actor_id) values ('${H1}', 'link', '${ACTOR}')`, 'catering_toast_decisions_', 'a pair kind needs a check');
  await refuses(db, `insert into catering_toast_link_decisions(lead_id, kind, actor_id) values ('${H4}', 'no_ring_expected', '${ACTOR}')`, 'catering_toast_decisions_reason', 'no ring needs a reason code');
  await db.exec(`insert into catering_toast_link_decisions(id, lead_id, kind, actor_id, reason_code) values ('${D3}', '${H4}', 'no_ring_expected', '${ACTOR}', 'paid_outside_toast')`);
  const heads = (await db.query(`select id from catering_toast_decision_heads order by id`)).rows.map(r => r.id);
  check(JSON.stringify(heads) === JSON.stringify([D2, D3].sort()), 'one head per key');

  // 4. Toast rings.
  // O1: H1's code typed as an open item's NAME on C1 (path a), 500.00; C1v voided.
  await ring(db, id('5000', 1), { order: 'O1', date: '2026-11-20', checks: [{ guid: 'C1', total: 50000, names: ['Catering ' + code1] }, { guid: 'C1v', total: 50000, voided: true, names: [code1] }] });
  // O2: no name, the code only in a SPECIAL_REQUEST note (path b) -> passed in as a code by the ephemeral lookup.
  await ring(db, id('5000', 2), { order: 'O2', date: '2026-11-21', checks: [{ guid: 'C2', total: 1000, names: ['Turkey Sub'] }] });
  // O3: the Toast-origin order of H2, two checks (a split), plus a voided one.
  await ring(db, id('5000', 3), { order: 'O3', date: '2026-11-20', checks: [{ guid: 'C3a', total: 6000 }, { guid: 'C3b', total: 6000 }, { guid: 'C3v', total: 1, voided: true }] });
  await db.exec(`insert into toast_catering_orders(location_id, order_guid, business_date, lead_id) values ('${SHOP}', 'O3', '2026-11-20', '${H2}')`);
  // O4 / O5 / O6: amount candidates for H3 (300.00) -- on Catering, on Dine In, on the ezCater option.
  await ring(db, id('5000', 4), { order: 'O4', date: '2026-11-21', checks: [{ guid: 'C4', total: 31000 }] });
  await ring(db, id('5000', 5), { order: 'O5', date: '2026-11-21', option: 'do-dine', checks: [{ guid: 'C5', total: 30000 }] });
  await ring(db, id('5000', 6), { order: 'O6', date: '2026-11-21', option: 'do-ez', checks: [{ guid: 'C6', total: 30000 }] });
  // O7: H7's code AND an ezCater number of this shop on one check (dual code).
  await ring(db, id('5000', 7), { order: 'O7', date: '2026-11-25', checks: [{ guid: 'C7', total: 8000, names: ['CO-ACD34 ABC-123'] }] });
  // O8: H7's code on a check ezCater owns (raw is_current link on an OLDER snapshot: a recapture never releases it).
  await ring(db, id('5000', 8), { order: 'O8', date: '2026-11-25', checks: [{ guid: 'C8', total: 8000, names: ['co-acd34'] }] });
  await db.exec(`insert into ezcater_toast_links(order_id, snapshot_id, location_id, toast_snapshot_id, order_guid, check_guid, selection_guid, business_date, evidence)
    values ('${id('6000', 1)}', '${id('6000', 2)}', '${SHOP}', '${id('5999', 8)}', 'O8', 'C8', 's', '2026-11-25', 'normalized_code')`);

  await refuses(db, `select * from plan_catering_toast('${SHOP}', '2026-11-01', '2027-01-15', '[]')`, 'catering_toast_window_too_wide', 'window bound');
  for (const bad of [[{ location_id: SHOP, order_guid: 'O2', check_guid: 'C2', code: 'call 202 555 0199' }], [{ order_guid: 'O2', check_guid: 'C2', code: 'CO-ACD34' }], { code: 'x' }]) {
    let refused = false;
    try { await plan(db, { notes: bad }); } catch (e) { refused = String(e.message).includes('catering_toast_note_codes_invalid'); }
    check(refused, `note input refused: ${JSON.stringify(bad)}`);
  }

  const rows = await plan(db, { notes: [{ location_id: SHOP, order_guid: 'O2', check_guid: 'C2', code: code1 }] });
  const by = (lead, guid) => rows.find(r => r.lead_id === lead && r.check_guid === guid);
  check(by(H1, 'C1')?.evidence === 'ring_code' && by(H1, 'C1').amount_mismatch === false && by(H1, 'C1').lead_value_cents === 50000, 'path a: name -> ring_code, valued by the accepted quote');
  check(!by(H1, 'C1v'), 'a voided check is never a candidate');
  check(by(H1, 'C2')?.evidence === 'ring_code' && by(H1, 'C2').amount_mismatch === true, 'path b: the note code -> ring_code; 10.00 vs 500.00 is a mismatch');
  check(!(await plan(db)).some(r => r.check_guid === 'C2' && r.lead_id === H1), 'without the note code C2 is not a ring-code candidate');
  check(by(H2, 'C3a')?.evidence === 'toast_origin' && by(H2, 'C3b')?.evidence === 'toast_origin' && !by(H2, 'C3v'), 'origin expands to every live check of the order');
  check(by(H3, 'C4')?.evidence === 'amount_date', 'amount on a house catering option');
  check(!by(H3, 'C5') && !by(H3, 'C6'), 'amount never on dine-in or the ezCater option');
  check(by(H7, 'C7')?.dual_code === true && by(H7, 'C7').owner === null, 'dual code flagged on an unowned check');
  check(by(H7, 'C8')?.owner === 'ezcater', 'ezCater ownership read from the raw is_current row (snapshot-independent)');
  check(by(H1, 'C1')?.blocked === true, 'the unlink head is a tombstone for that pair');
  check(!rows.some(r => [EZ, LOST].includes(r.lead_id)), 'no ezCater or lost lead is planned');
  check(rows.every(r => r.location_id === SHOP), 'one shop');

  // A recapture of O1 (new snapshot, same logical check) keeps the pair blocked and the evidence.
  await ring(db, id('5000', 11), { order: 'O1', date: '2026-11-20', checks: [{ guid: 'C1', total: 50000, names: [code1] }] });
  const re = (await plan(db)).find(r => r.lead_id === H1 && r.check_guid === 'C1');
  check(re?.blocked === true && re.toast_snapshot_id === id('5000', 11), 'recapture: same pair, still blocked');

  // 5. Status.
  check((await status(db, H1)).status === 'not_rung_in_toast', 'H1 not rung while unlinked (a suggestion never clears it)');
  check((await status(db, H4)).status === 'no_ring_expected', 'H4 no ring expected');
  check(!(await status(db, EZ)) && !(await status(db, LOST)), 'ezCater and lost leads are not house rows');
  check((await status(db, H2)).toast_origin === true, 'H2 is a Toast-origin lead');
  // Links are fixtures written as the owner here (PR 3 adds the writer).
  await db.exec(`insert into catering_toast_links(lead_id, location_id, order_guid, check_guid, toast_snapshot_id, evidence)
    values ('${H3}', '${SHOP}', 'O4', 'C4', '${id('5000', 4)}', 'ring_code')`);
  check((await status(db, H3)).status === 'matched', 'H3 matched (310.00 vs 300.00 is within tolerance)');
  await db.exec(`insert into catering_toast_links(lead_id, location_id, order_guid, check_guid, toast_snapshot_id, evidence)
    values ('${H3}', '${SHOP}', 'O5', 'C5', '${id('5000', 5)}', 'ring_code')`);
  const s3 = await status(db, H3);
  check(s3.status === 'amount_mismatch' && Number(s3.linked_cents) === 61000 && Number(s3.amount_diff_cents) === 31000, 'several checks are summed; 610.00 vs 300.00 mismatches');
  await refuses(db, `insert into catering_toast_links(lead_id, location_id, order_guid, check_guid, toast_snapshot_id, evidence)
    values ('${H1}', '${SHOP}', 'O4', 'C4', '${id('5000', 4)}', 'ring_code')`, 'catering_toast_links_one_lead_per_check', 'one house lead per check');
  await refuses(db, `insert into catering_toast_links(lead_id, location_id, order_guid, check_guid, toast_snapshot_id, evidence)
    values ('${H1}', '${SHOP}', 'O9', 'C9', '${id('5000', 4)}', 'manual')`, 'catering_toast_links_manual_decision', 'a manual link names its decision');
  check(rows.find(r => r.lead_id === H3 && r.check_guid === 'C4')?.owner === null, '(before the link)');
  check((await plan(db)).find(r => r.lead_id === H3 && r.check_guid === 'C4')?.owner === 'house', 'a linked check is house-owned in the plan');
  // The lead moves shop: its old link no longer counts.
  await db.exec(`update catering_pipeline set location_id = '${OTHER}' where id = '${H3}'`);
  check((await status(db, H3)).status === 'not_rung_in_toast', 'a link at the old shop never counts at the new one');
  await db.exec(`update catering_pipeline set location_id = '${SHOP}' where id = '${H3}'`);
  // The linked check is voided in a recapture: the lead returns to the list.
  await ring(db, id('5000', 14), { order: 'O4', date: '2026-11-21', checks: [{ guid: 'C4', total: 31000, voided: true }] });
  await ring(db, id('5000', 15), { order: 'O5', date: '2026-11-21', option: 'do-dine', checks: [{ guid: 'C5', total: 30000, voided: true }] });
  check((await status(db, H3)).status === 'not_rung_in_toast', 'a voided linked check returns the lead to the not-rung list');

  // 6. Orphans: live house-catering checks no source owns, not Toast-origin orders.
  const orphans = (await db.query(`select order_guid, check_guid from catering_toast_orphans where location_id = '${SHOP}' order by 1, 2`)).rows.map(r => `${r.order_guid}/${r.check_guid}`);
  check(orphans.includes('O1/C1') && orphans.includes('O7/C7') && !orphans.includes('O3/C3a') && !orphans.includes('O5/C5') && !orphans.includes('O8/C8') && !orphans.includes('O6/C6'),
    `orphans ${orphans.join(',')}`);

  // 7. The partition sums EXACTLY to the unchanged 0232 value.
  await db.exec(`insert into catering_toast_links(lead_id, location_id, order_guid, check_guid, toast_snapshot_id, evidence)
    values ('${H1}', '${SHOP}', 'O7', 'C7', '${id('5000', 7)}', 'ring_code')`);
  const base = (await db.query(`select sales_report_catering_values('${SHOP}', '2026-11-15', '2026-11-30') v`)).rows[0].v;
  const part = (await db.query(`select catering_pipeline_reconciliation('${SHOP}', '2026-11-15', '2026-11-30') v`)).rows[0].v;
  const baseTotal = Number(base.completed_value_cents) + Number(base.confirmed_value_cents);
  const parts = Object.values(part.parts);
  check(Number(part.total_value_cents) === baseTotal, `partition total ${part.total_value_cents} = 0232 ${baseTotal}`);
  check(parts.reduce((a, p) => a + Number(p.value_cents), 0) === baseTotal, 'parts sum to the total');
  check(Number(part.total_events) === Number(base.completed_events) + Number(base.confirmed_events), 'events match 0232');
  check(Number(part.total_unvalued) === Number(base.completed_unvalued) + Number(base.confirmed_unvalued), 'unvalued counted, never zeroed');
  check(Number(part.parts.ezcater_sourced?.value_cents) === 70000, 'ezCater stays IN pipeline value (Juan answer 6), labelled');
  check(Number(part.parts.rung_in_toast?.value_cents) === 50000, 'H1 rung (linked)');
  check(Number(part.parts.toast_origin?.value_cents) === 12000, 'H2 Toast-origin');
  check(Number(part.parts.no_ring_expected?.unvalued) === 1, 'H4 no ring, unvalued');
  check(Number(part.parts.not_rung?.value_cents) === 38000, 'H3 + H7 not rung');
  await refuses(db, `select catering_pipeline_reconciliation('${SHOP}', '2026-10-01', '2026-11-30')`, 'sales_report_window_too_wide', 'the 0232 window rule');

  // 8. No 0344 function writes an ezCater link, and links stay empty for real writers (none exist yet).
  const writers = (await db.query(`select p.proname from pg_proc p where p.proname in ('plan_catering_toast','catering_pipeline_reconciliation','ensure_catering_ring_code')
    and p.prosrc ~* '(insert into|update|delete from)\\s+public\\.(ezcater_toast_links|catering_toast_links|catering_toast_link_decisions)'`)).rows;
  check(writers.length === 0, 'no 0344 function writes a link or a decision');

  console.log(`sql-harness-0344: ${checks} checks passed`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
