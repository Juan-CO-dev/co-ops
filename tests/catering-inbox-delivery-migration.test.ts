import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('0298 real-DDL delivery proof: ceilings, switches, claim/finish fencing, caps, revalidation, mode', () => {
  const output = execFileSync(process.execPath, ['scripts/sql-harness-0298.mjs'], { encoding: 'utf8', timeout: 240_000 });
  expect(output).toContain('PASS 0298:');
  for (const line of [
    'lease job set drift refused by preflight', 'refused migration leaves no partial schema', 'second application refused',
    'catering_inbox_thread_limits: complete table/column ACL and RLS', 'claim_catering_inbox_delivery: definer/search_path/execution ceiling',
    'delivery cron lease claims once per window', 'settings still shadow at revision 0 after 0298',
    'catering manager cannot change the mode', 'GM cannot change the mode', 'mode change is revision-checked',
    'shadow: cron claim refused', 'shadow: human claim refused', 'off: cron claim refused', 'off: human claim refused', 'refused claims append no event',
    'CGS switches to live; live_since and actor stamped', 'activation never bulk-sends an old shadow draft (cron refuses not_new)',
    'human claim of an old draft: token, server-selected recipient, idempotency key, frozen content', 'a live lease refuses a second claim',
    'a wrong fencing token cannot finish', 'sent never returns to draft (claim refused)', 'sent never returns to draft (service_role holds no UPDATE)',
    'identical claim request replays without a second attempt', 'retry takes a new attempt but reuses its daily reservation', 'cron stops after three attempts',
    'fourth reply to one thread in a UTC day refused', 'the cap binds humans too', 'retry under a full cap reuses its reservation',
    'handled message cannot be sent (cron)', 'handled message cannot be sent (human)', 'escalations are cron-only',
    'escalation body may not carry a token-bearing link', 'escalation goes to the assignee in the assignee language', 'escalation freezes one row and takes no customer-thread slot',
    'auto-submitted mail is never replied to', 'deactivated customer blocks the old draft', 'closed lead blocks the old draft',
    'expired lease is marked ambiguous and refused, not reclaimed', 'the late holder cannot finish', 'ambiguous is never auto-resent',
    'revoked session cannot send', 'one reply draft per message', 'concurrency requires separate sim proof',
  ]) expect(output).toContain(line);
}, 250_000);
