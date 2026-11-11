import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('0296 real-DDL ACL, attach-only, artifact, revision and authorization proof', () => {
  const output = execFileSync(process.execPath, ['scripts/sql-harness-0296.mjs'], {
    encoding: 'utf8', timeout: 240_000,
  });
  expect(output).toContain('PASS 0296:');
  expect(output).toContain('broken permissive ACL variant detected');
  expect(output).toContain('all writers leave customer rows byte-for-byte unchanged');
  expect(output).toContain('followup preserves customer/lead/quote attachment without draft');
  expect(output).toContain('assignee scope/state/role rechecked');
  expect(output).toContain('catering_customers: all writes forbidden before inbox writers');
  expect(output).toContain('catering_pipeline: all writes forbidden before inbox writers');
  expect(output).toContain('catering_quotes: all writes forbidden before inbox writers');
  expect(output).toContain('record_catering_inbound: source contains no artifact writes');
  expect(output).toContain('finalize_catering_inbound: source contains no artifact writes');
  expect(output).toContain('act_on_catering_inbox: source contains no artifact writes');
  expect(output).toContain('inactive duplicate email refuses identity');
  expect(output).toContain('re-finalize at current revision refused');
  expect(output).toContain('null lead assignee falls back to scoped catering manager');
  expect(output).toContain('ineligible lead assignee falls back to scoped catering manager');
  expect(output).toContain('different user session refused');
  expect(output).toContain('ours without lead or quote refused');
  expect(output).toContain('noncanonical or invalid sender refused');
  expect(output).toContain('final artifact snapshots unchanged with all guards active');
  expect(output).toContain('needs_human: supplied draft refused');
  expect(output).toContain('needs_human: followup preserves verdict and strips draft');
  expect(output).toContain('noise: supplied draft refused');
  expect(output).toContain('noise: followup preserves verdict and strips draft');
  expect(output).toContain('notification: supplied draft refused');
  expect(output).toContain('notification: followup preserves verdict and strips draft');
  expect(output).toContain('concurrency requires separate sim proof');
}, 250_000);
