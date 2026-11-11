import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  send: vi.fn(async (_message: unknown) => ({id:'mail'})),
  audit: vi.fn(),
}));
vi.mock('@/lib/supabase-server', () => ({ getServiceRoleClient: () => ({
  from: (table: string) => {
    expect(table).toBe('catering_portal_tokens');
    return {
      update: (patch: Record<string, unknown>) => ({ eq: (_key: string, email: string) => ({
        is: () => ({ gt: (_column: string, now: string) => {
          for (const row of state.rows) if (row.email === email && row.consumed_at == null && String(row.expires_at) > now) Object.assign(row, patch);
          return Promise.resolve({error:null});
        } }),
      }) }),
      insert: async (row: Record<string, unknown>) => { state.rows.push(row); return {error:null}; },
    };
  },
}) }));
vi.mock('@/lib/portal/rate-limit', () => ({checkAndRecord: async () => true}));
vi.mock('@/lib/portal/auth', () => ({generateToken: () => 'new-token', hashToken: async () => 'new-hash'}));
vi.mock('@/lib/portal/session', () => ({createCustomerSession: vi.fn()}));
vi.mock('@/lib/portal/draft', () => ({createDraftFromIntake: vi.fn()}));
vi.mock('@/lib/email', () => ({sendEmail:state.send}));
vi.mock('@/lib/audit', () => ({audit:state.audit}));
import { requestMagicLink } from '@/lib/portal/magic-link';

afterEach(() => {vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers();});
it('malformed origin does not strand a superseded token: replacement, delivery and audit complete', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-11T12:00:00Z'));
  vi.stubEnv('PORTAL_ORIGIN','https://invalid.test/path');
  vi.stubEnv('PORTAL_HOSTS','invalid.test'); vi.stubEnv('STAFF_ORIGIN','https://staff.test');
  vi.stubEnv('NEXT_PUBLIC_APP_URL','https://legacy.test'); vi.stubEnv('PORTAL_MAGIC_LINK_ALLOWLIST','*');
  const log = vi.spyOn(console,'error').mockImplementation(() => {});
  state.rows.push({email:'customer@example.test', token_hash:'old-hash', consumed_at:null, expires_at:'2026-11-11T12:20:00.000Z'});
  await expect(requestMagicLink({email:'customer@example.test'})).resolves.toBeUndefined();
  expect(state.rows[0]?.expires_at).toBe('2026-11-11T12:00:00.000Z');
  expect(state.rows[1]).toMatchObject({token_hash:'new-hash',expires_at:'2026-11-11T12:30:00.000Z'});
  expect(state.send).toHaveBeenCalledWith(expect.objectContaining({text:expect.stringContaining('https://legacy.test/order/verify?token=new-token')}));
  expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({action:'portal.magic_link_requested'}));
  expect(log).toHaveBeenCalledWith('[portal] invalid identity; customer links remain dormant');
});
