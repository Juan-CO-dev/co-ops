import { portBase } from '../../../scripts/landing/e2e-ports.cjs';
import { test, expect } from '@playwright/test';
import { approvedFiles } from '../../approved-files';

test('landing pages cannot cache; immutable media and framework chunks can', async ({ request }) => {
  for (const path of ['/', '/privacy', '/?_rsc=cache-test', '/missing', '/robots.txt', '/sitemap.xml']) {
    const response = await request.get(path, { headers: path.includes('_rsc') ? { RSC: '1' } : {} });
    expect(response.headers()['cache-control']).toContain('private');
    expect(response.headers()['cache-control']).toContain('no-store');
  }
  const html = await (await request.get('/')).text();
  const chunk = html.match(/src="([^" ]*\/_next\/static\/[^" ]+\.js[^" ]*)"/)?.[1];
  expect(chunk).toBeTruthy();
  const staticResponse = await request.get(chunk!);
  expect(staticResponse.status()).toBe(200);
  expect(staticResponse.headers()['cache-control']).toContain('public');
  expect(staticResponse.headers()['cache-control']).toContain('immutable');
  for (const asset of approvedFiles.filter(e => e.publicPath.startsWith('/media/'))) {
    const response = await request.get(asset.publicPath);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    const staff = await request.get(`http://127.0.0.1:${portBase}` + asset.publicPath, { maxRedirects: 0 });
    expect(staff.status()).toBe(404);
    expect(staff.headers()['set-cookie']).toBeUndefined();
  }
});
