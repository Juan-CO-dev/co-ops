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
  expect(output).toContain('concurrency requires separate sim proof');
}, 250_000);
