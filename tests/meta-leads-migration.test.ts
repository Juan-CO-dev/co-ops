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
    // build 2
    'created lead stores the Meta email as a note, never as the identity', 'superseded v2 checkbox text version refused',
    'claim parks the row as unknown before any send', 'sent restores created, pairs the token with the snapshot erasure',
    'a second result never rewrites a sent row', 'an attached submission never claims an email',
    'unknown keeps the token, erases the snapshot, parks the lead', 'second email to one address inside 24 h is capped in SQL',
    'failed records the undelivered token and erases the snapshot', 'suppressed names configuration and counts no attempt',
    'sent without token and provider id is refused by CHECK',
    'portal continuation attaches ONLY a draft quote to the owned open lead', 'attach creates no lead and no stage event',
    'a lead with a live quote falls back to a new portal lead', 'create branch stores every intake column like today',
    'another customer never attaches to a lead they do not own', 'a confirmed lead is never reopened by the portal',
    'attach fills a null lead location from the intake', 'unknown location refused', 'blank contact name refused', 'unknown customer refused',
  ]) expect(output).toContain(evidence);
}, 250_000);
