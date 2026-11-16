import { refundEventAmounts, type RefundEventRow } from '@/lib/catering/refund-events-shared';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// W26 B139 / W26-2 b / B140: migration 0333 (file only until CC applies it on sim, then prod on Juan's word).
const sql = readFileSync('supabase/migrations/0333_marketing_entry_moves_and_refund_time.sql', 'utf8');
const source = readFileSync('supabase/migrations/0289_marketing_scorecard.sql', 'utf8');
const body = (text: string, name: string) => {
  const start = text.indexOf(`function public.${name}(`);
  return text.slice(start, text.indexOf('end $$;', start));
};
const lines = (text: string) => text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('--'));

describe('0333 marketing entry moves, spend removal and refund time', () => {
  it('is one gated, atomic, file-only migration', () => {
    expect(sql.replace(/^--.*$/gm, '').trim()).toMatch(/^begin;/);
    expect(sql.trim()).toMatch(/commit;$/);
    for (const pin of ['NOT YET APPLIED', '0333: 0289 not installed', '0333: apply 0303 first', '0333: already installed',
      '0333: record_marketing_manual_entry drifted', 'service_role above SELECT ceiling', 'function owner mismatch', 'APP (same PR, W26)']) expect(sql).toContain(pin);
    expect(sql).not.toMatch(/APPLIED TO (SIM|PROD)/);
    expect(sql.replace(/^--.*$/gm, '')).not.toMatch(/for all|on delete cascade|delete from|truncate (table )?public/i);
  });
  it('re-emits record_marketing_manual_entry from 0289: validation, lock and insert carried line for line', () => {
    const old = lines(body(source, 'record_marketing_manual_entry'));
    const now = lines(body(sql, 'record_marketing_manual_entry'));
    const validation = old.slice(old.findIndex(l => l.startsWith('perform public.marketing_assert_actor')), old.findIndex(l => l.startsWith("then raise exception 'entry_invalid'")) + 1);
    const insert = old.slice(old.findIndex(l => l.startsWith('insert into public.marketing_manual_entries')));
    const lock = old.filter(l => l.startsWith('perform pg_advisory_xact_lock'));
    for (const block of [validation, insert, lock]) {
      expect(block.length).toBeGreaterThan(0);
      const at = now.indexOf(block[0]!);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(now.slice(at, at + block.length)).toEqual(block);
    }
    // The correction looks its head up by id and binds the series; removed heads never count.
    expect(sql).toContain('where e.id = p_corrects');
    expect(sql).toContain('v_head.kind <> p_kind or v_head.location_id is distinct from p_location_id');
    expect(sql.match(/and not e\.voided/g)?.length).toBeGreaterThanOrEqual(3);
  });
  it('adds the removal as an append-only correction and the per-event refund ledger with its backfill', () => {
    expect(sql).toContain('add column voided boolean not null default false');
    expect(sql).toContain('check (not voided or corrects_id is not null)');
    expect(sql).toContain('drop index public.marketing_manual_entries_root;');
    expect(sql).toContain("if v_series.kind not in ('meta_spend','promo_spend') then raise exception 'entry_invalid'");
    // B140 review r1: one append-only row per refund EVENT (partial ones too), never a stamp on the payment row.
    expect(sql).toContain('create table public.catering_payment_refund_events (');
    expect(sql).toContain('stripe_event_id text primary key');
    expect(sql).toContain('cumulative_refunded_cents bigint not null check (cumulative_refunded_cents >= 0)');
    expect(sql).toContain('grant select, insert on table public.catering_payment_refund_events to service_role;');
    expect(sql).toContain("coalesce(nullif(a.metadata->>'stripe_event_id', ''), 'audit:' || a.id::text)");
    expect(sql).not.toMatch(/alter table public\.catering_payments/);
    expect(sql).not.toContain("<> 'true'");
  });
  it('reads audit_log by its REAL columns: occurred_at, never created_at (fix round 3)', () => {
    // The live audit_log (Foundation Spec DDL; 0044's verified column list) has occurred_at and no created_at.
    expect(sql).toContain('a.occurred_at');
    expect(sql).not.toMatch(/\ba\.created_at\b/);
    expect(sql).not.toMatch(/table_name='audit_log'[^;]*'created_at'/);
    // The harness builds audit_log from that real DDL, never a hand-written fixture.
    const harness = readFileSync('scripts/sql-harness-0333.mjs', 'utf8');
    expect(harness).toContain("readFileSync('docs/CO-OPS_Foundation_Spec_v1.3.md'");
    expect(harness).toContain('${auditCreate}');
    expect(harness).not.toMatch(/create table audit_log\(/);
  });
  it('executes the real migrations and the adversarial SQL proofs offline; the backfilled rows read back right (review r2)', () => {
    const output = execFileSync(process.execPath, ['scripts/sql-harness-0333.mjs'], { encoding: 'utf8', timeout: 120_000 });
    expect(output).toMatch(/0333 SQL harness: \d+ checks passed/);
    // Migration → reader: the rows the backfill stored, fed to the digest's own derivation.
    const line = output.split('\n').find((l) => l.startsWith('0333 refund events: '));
    const rows = JSON.parse(line!.slice('0333 refund events: '.length)) as RefundEventRow[];
    const at = (k: string) => rows.find((r) => r.stripe_event_id === k)?.refunded_at;
    expect(Object.fromEntries(refundEventAmounts(rows))).toMatchObject({
      evt_tue: 1000, evt_wed: 9000,             // delayed delivery: $10 then $90
      evt_part104: 1000, evt_final104: 4000,    // final delivered before the partial (no audit row): $10 then $40
      evt_part105: 2000, evt_final105: 4000,    // audit-only partial (approximate time) before a ledger final
    });
    // The $10 is Tuesday's (event time), never Wednesday's (delivery / audit time).
    expect(Date.parse(at('evt_tue')!)).toBe(Date.parse('2026-11-03T15:00:00Z'));
    expect(Date.parse(at('evt_part104')!)).toBe(Date.parse('2026-11-04T10:00:00Z'));
    for (const v of refundEventAmounts(rows).values()) expect(v).toBeGreaterThanOrEqual(0);
  }, 130_000);
  it('backfills from the webhook ledger at the Stripe event time, the audit trail only as an approximate fallback (review r2)', () => {
    expect(sql).toContain("if to_regclass('public.stripe_events') is null then raise exception '0333: stripe_events missing (0204)'");
    expect(sql).toContain("from public.stripe_events e");
    expect(sql).toContain("where e.type = 'charge.refunded' and e.outcome is distinct from 'location_mismatch'");
    expect(sql).toContain("then least(to_timestamp(l.created_txt::bigint), l.received_at) end as event_time");
    expect(sql).toContain('refunded_at_approximate boolean not null default false');
    expect(sql).toContain("join public.catering_payments p on p.provider_ref = f.payment_intent and p.status in ('paid','refunded')");
  });
});
