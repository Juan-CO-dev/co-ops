import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('0300 real-DDL ledger, privilege ceiling, intake and explicit consent proof', () => {
  const output = execFileSync(process.execPath, ['scripts/sql-harness-0300.mjs'], {
    encoding: 'utf8', timeout: 240_000,
  });
  for (const evidence of [
    'PASS ', 'concurrent same-email invocations create one lead plus attach',
    'bounded Unicode raw keys fit ledger byte ceiling', 'permissive ACL sabotage caught', 'failed migration rolls back',
    'same customer second submission attaches', 'attach does not modify any lead column',
    'confirmed needs human', 'out needs human', 'multiple candidates need human',
    'explicit tick creates consent event', 'evidence replay is idempotent',
    'receipt alone creates no consent', 'relay refused', 'suppressed hash refused',
    'disabled cannot be claimed', 'stale worker cannot write',
    'token requires snapshot nulling', 'closed errors reject arbitrary provider text',
    'backstop house lease excludes overlap', 'two-session sim proof remains required',
  ]) expect(output).toContain(evidence);
}, 250_000);
