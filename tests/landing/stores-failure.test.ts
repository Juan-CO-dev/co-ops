import { afterEach, expect, it, vi } from 'vitest';
import { loadPublicLandingStores } from '@/lib/landing/stores';

const { query, client } = vi.hoisted(() => ({ query: vi.fn(), client: vi.fn() }));
vi.mock('@/lib/supabase-server', () => ({ getServiceRoleClient: client }));
afterEach(() => vi.restoreAllMocks());

it.each(['result', 'rejection', 'client'] as const)('refuses shop loading on %s with one PII-free class/message', async kind => {
  const sensitive = 'private@example.test secret-provider-detail';
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  client.mockImplementation(() => {
    if (kind === 'client') throw new TypeError(sensitive);
    return { from: () => ({ select: () => ({ eq: () => ({ in: query }) }) }) };
  });
  if (kind === 'rejection') query.mockRejectedValue(new Error(sensitive));
  else query.mockResolvedValue({ data: null, error: { message: sensitive } });
  await expect(loadPublicLandingStores()).resolves.toEqual([]);
  expect(log).toHaveBeenCalledExactlyOnceWith('LandingStoreLoadError: Public shop information unavailable');
});
