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
  it('executes the real migrations and the adversarial SQL proofs offline', () => {
    const output = execFileSync(process.execPath, ['scripts/sql-harness-0333.mjs'], { encoding: 'utf8', timeout: 120_000 });
    expect(output).toMatch(/0333 SQL harness: \d+ checks passed/);
  }, 130_000);
});
