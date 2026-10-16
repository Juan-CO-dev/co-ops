import { expect, it } from 'vitest';
import { heartbeat, latestReport } from '../../scripts/landing/check-monitor-heartbeat.mjs';
const now = Date.parse('2026-10-16T12:00:00Z');
it.each([null, 'invalid', '2026-10-16T09:59:59Z', '2026-10-16T12:01:00Z'])('alerts for missing, invalid, stale or future heartbeat %s', value => {
 expect(heartbeat(value, now)).toMatchObject({ ok: false, reviewRequired: true, pauseRequired: false });
});
it('accepts a completed report up to exactly two hours old', () => {
 expect(heartbeat('2026-10-16T10:00:00Z', now).ok).toBe(true);
});
it('ignores skipped and running jobs and expired or unrelated artifacts', async () => {
 const runs = [{ id: 1, status: 'completed', conclusion: 'skipped' }, { id: 2, status: 'in_progress' }, { id: 3, status: 'completed', conclusion: 'failure' }];
 const artifacts = async () => [
  { name: 'money-path-report', expired: true, created_at: '2026-10-16T12:00:00Z' },
  { name: 'unrelated', expired: false, created_at: '2026-10-16T12:00:00Z' },
  { name: 'money-path-report', expired: false, created_at: '2026-10-16T11:00:00Z' },
 ];
 expect(await latestReport(runs, artifacts)).toBe('2026-10-16T11:00:00Z');
 expect(await latestReport(runs.slice(0, 2), artifacts)).toBe(null);
});
