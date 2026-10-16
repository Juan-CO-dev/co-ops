import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import * as config from '@/lib/landing/config';
import { proxy } from '@/proxy';
afterEach(() => vi.restoreAllMocks());
it('grants geolocation only on landing when configured shops support the opt-in feature', async () => {
  const base = config.loadLandingConfig({ LANDING_HOSTS:'eat.example.test', SITE_ORIGIN:'https://eat.example.test', STAFF_ORIGIN:'https://staff.example.test' });
  const loader = vi.spyOn(config, 'loadLandingConfig');
  for (const enabled of [false, true]) {
    loader.mockReturnValue({ ...base, nearbyEnabled: enabled, stores: base.stores.map(s => ({ ...s, coordinates: enabled ? { latitude:38, longitude:-77 } : null })) });
    for (const host of ['eat.example.test','staff.example.test']) {
      const response = await proxy(new NextRequest(`https://${host}/eat`, {headers:{host}}));
      expect(response.headers.get('permissions-policy')).toContain(enabled && host === 'eat.example.test' ? 'geolocation=(self)' : 'geolocation=()');
    }
  }
});
