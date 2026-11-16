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
    'a receipt without an email hash is never claimable', 'per-address advisory lock is transaction-scoped and released after the claim',
    'portal continuation attaches ONLY a draft quote to the owned open lead', 'attach creates no lead and no stage event',
    'a lead with a live quote answers attached=false and writes nothing', 'an unknown lead id answers attached=false',
    'another customer never attaches to a lead they do not own', 'a confirmed lead is never reopened by the portal',
    'attach fills a null lead location from the intake', 'unknown location refused', 'blank contact name refused', 'unknown customer refused',
    'attach without a lead id is refused (the plain portal path never calls this)',
  ]) expect(output).toContain(evidence);
}, 250_000);

it('0336 real-DDL ad refs: signatures, write-once fences, privileges and rollback compatibility', () => {
  const output = execFileSync(process.execPath, ['scripts/sql-harness-0336.mjs'], {
    encoding: 'utf8', timeout: 240_000,
  });
  for (const evidence of [
    'PASS ', 'real 0300 applied', '0300 body drift refused', 'extra meta_lead_record overload refused',
    'missing five-argument function refused', 'pre-existing ad_id column refused as already applied', 'missing 0300 ledger refused',
    'CRLF copy of the 0300 body passes the fingerprint', 'table grant sabotage caught', 'column grant sabotage caught',
    'function grant sabotage caught', 'PUBLIC function grant sabotage caught', 'file ends with the PostgREST schema reload, then commit',
    're-apply refused by name', 'exactly one meta_lead_record (no ambiguous overload)', 'the five-argument signature is gone',
    'no column grants on meta_lead_events', 'anon cannot call the live writer', 'authenticated cannot call the backfill helper',
    'old five-argument named call inserts (PostgREST shape)', 'old call leaves every new column NULL',
    'old worker apply creates the lead after 0336', 'old worker failure write works after 0336',
    'seven-argument named call inserts', "receipt 202: '' / malformed / over-long stored as NULL",
    'duplicate receipt leaves the row byte-identical', 'live writer: wrong lease is stale_lease', 'live writer: an expired lease is stale_lease',
    'live writer: a stored ad_id is never overwritten', 'live writer: never touches state or lease',
    'backfill: refuses a received receipt', 'backfill: refuses a retry receipt', 'backfill: refuses a processing receipt', 'backfill: refuses a disabled receipt',
    'backfill: every other needs_human column byte-identical', 'backfill: never overwrites a stored id',
    'documented rollback: the 0300 call works with the columns kept', 'two-session sim proof remains required',
  ]) expect(output).toContain(evidence);
}, 250_000);
