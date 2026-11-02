import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/0289_marketing_scorecard.sql', 'utf8');
describe('0289 marketing migration', () => {
  it('is an atomic, gated migration with owner and effective-ACL assertions', () => {
    expect(sql.replace(/^--.*$/gm, '').trim()).toMatch(/^begin;/);
    expect(sql.trim()).toMatch(/commit;$/);
    for (const pin of ['NOT YET APPLIED', 'AFTER 0287 (0288 reserved)', 'ROLLOUT:', 'VERIFY:', 'ROLLBACK:', '0289: already installed', 'function owner must own every touched table', 'has_any_column_privilege', 'service_role above SELECT ceiling']) expect(sql).toContain(pin);
    expect(sql.replace(/^--.*$/gm, '')).not.toMatch(/for all|on delete cascade/i);
  });
  it('pins empty-table ET rekey, lock serialization, and the Toast-only threshold', () => {
    expect(sql.indexOf('in access exclusive mode')).toBeLessThan(sql.indexOf('0289: counter must be empty'));
    expect(sql).toContain('primary key(day_et, store_key, ad_slot)');
    expect(sql).toContain("at time zone 'America/New_York'");
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('in share row exclusive mode');
    expect(sql).toContain('for share');
    expect(sql).toContain('amount_cents <= 500000');
    expect(sql).toContain('amount_cents > 500000');
    expect(sql).toContain('subtotal_cents > 500000');
    expect(sql).toContain('p_to - p_from > 27');
    expect(sql).toContain('p_to - p_from > 365');
  });
  it('executes the real migrations and adversarial SQL proofs offline', () => {
    const output = execFileSync(process.execPath, ['scripts/sql-harness-0289.mjs'], { encoding: 'utf8', timeout: 120_000 });
    expect(output).toMatch(/0289 SQL harness: \d+ checks passed/);
  }, 130_000);
});
