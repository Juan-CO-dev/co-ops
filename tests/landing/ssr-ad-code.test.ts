import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ stores: vi.fn(), lookup: vi.fn(), signal: undefined as AbortSignal | undefined }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: 'eat.example.test' }) }));
vi.mock('@/lib/landing/stores', () => ({ loadPublicLandingStores: mocks.stores }));
vi.mock('@/lib/supabase-server', () => ({ getServiceRoleClient: () => {
  const query = { select: () => query, eq: () => query, limit: () => query,
    abortSignal: (signal: AbortSignal) => { mocks.signal = signal; return query; }, maybeSingle: mocks.lookup };
  return { from: () => query };
} }));
import LandingPage from '@/app/eat/page';
import PrivacyPage from '@/app/eat/privacy/page';
import { resolveAdCode } from '@/lib/landing/ad-codes-server';
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
it('starts the ad lookup while stores are still pending', async () => {
  vi.stubEnv('LANDING_HOSTS', 'eat.example.test'); vi.stubEnv('SITE_ORIGIN', 'https://eat.example.test'); vi.stubEnv('STAFF_ORIGIN', 'https://staff.example.test');
  let release!: () => void;
  mocks.stores.mockImplementation(() => new Promise(resolve => { release = () => resolve([]); }));
  mocks.lookup.mockResolvedValue({ data: { code: 'campaign' }, error: null });
  const rendering = LandingPage({ searchParams: Promise.resolve({ ad: 'campaign' }) });
  try { await vi.waitFor(() => expect(mocks.lookup).toHaveBeenCalledOnce()); }
  finally { release(); }
  expect(await rendering).toBeTruthy();
});
it('real SSR resolver and privacy page fall back at 300 ms without waiting for provider', async () => {
  vi.useFakeTimers(); mocks.lookup.mockImplementation(() => new Promise(() => {}));
  const resolved = resolveAdCode('campaign');
  await vi.advanceTimersByTimeAsync(299); expect(mocks.signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1); expect(await resolved).toBe('unattributed'); expect(mocks.signal?.aborted).toBe(true);
  const privacy = PrivacyPage({ searchParams: Promise.resolve({ ad: 'campaign' }) });
  await vi.advanceTimersByTimeAsync(299); expect(mocks.signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1); expect(await privacy).toBeTruthy(); expect(mocks.signal?.aborted).toBe(true);
});
