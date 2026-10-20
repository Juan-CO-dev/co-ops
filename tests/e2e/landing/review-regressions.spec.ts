import { portBase } from '../../../scripts/landing/e2e-ports.cjs';
import { test, expect } from '@playwright/test';

for (const language of ['en','es']) test(`dead Supabase URL preserves a 200 landing page in ${language}`, async ({page}) => {
  const response = await page.goto(`http://localhost:${portBase + 3}/?lang=${language}`, {waitUntil:'domcontentloaded'});
  expect(response?.status()).toBe(200);
  for (const section of ['hero','lineup','catering']) await expect(page.locator(`#${section}`)).toBeVisible();
  await expect(page.locator('#shops [data-shop]')).toHaveCount(2);
  await expect(page.locator('#footer address')).toHaveCount(2);
  await expect(page.locator('#footer a[href^="/privacy"]')).toBeVisible();
});

test('not-found chrome renders its wordmark on the landing host', async ({page}) => {
  await page.goto(`http://localhost:${portBase + 5}/?__fixture_not_found=1`, {waitUntil:'domcontentloaded'});
  const root = page.locator('main');
  await expect(root.getByRole('heading', {name:'Page not found'})).toBeVisible();
  await expect.poll(() => root.locator('img').evaluate((img:HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
});

test('production responses pin metadata, brand and API cache policy', async ({request}) => {
  for (const path of ['/robots.txt','/sitemap.xml','/brand/co-wordmark.svg','/brand/landing-icon.png','/eat/icon.png','/eat/apple-icon.png','/favicon.ico']) {
    const response = await request.get(path);
    expect(response.status(),path).toBe(200);
    expect(response.headers()['cache-control'],path).toBe(['/robots.txt','/sitemap.xml'].includes(path)?'private, no-store':'public, max-age=300');
  }
  for (const path of ['/api/landing/events','/api/landing/order-click']) {
    const response = await request.post(path, {data:{}});
    expect(response.status()).toBe(403);
    expect(response.headers()['cache-control']).toBe('no-store');
  }
});

test('fixture coordinates produce exactly one merged Permissions-Policy on landing only', async ({request,page}) => {
  for (const [origin,expected] of [[`http://localhost:${portBase + 5}`,'camera=(), microphone=(), geolocation=(self)'],[`http://127.0.0.1:${portBase + 5}`,'camera=(self), microphone=(), geolocation=()']]) {
    const response = await request.get(`${origin}/`);
    expect(response.status()).toBe(200);
    const policies = response.headersArray().filter(header=>header.name.toLowerCase()==='permissions-policy');
    expect(policies).toHaveLength(1);
    expect(policies[0]?.value).toBe(expected);
  }
  await page.goto(`http://localhost:${portBase + 5}/`, {waitUntil:'domcontentloaded'});
  await expect(page.getByRole('button',{name:'Which shop is closer?'})).toBeVisible();
});

test('configured delivery clicks retain their actual placement without a shop counter', async ({page}) => {
  const events: Record<string,unknown>[] = [], counters:unknown[] = [];
  await page.route('https://connect.facebook.net/**', route=>route.fulfill({contentType:'application/javascript',body:'/* offline pixel */'}));
  await page.route('**/api/landing/events', route=>{events.push(route.request().postDataJSON());return route.fulfill({status:204});});
  await page.route('**/api/landing/order-click', route=>{counters.push(route.request().postDataJSON());return route.fulfill({status:204});});
  await page.goto(`http://localhost:${portBase + 5}/`, {waitUntil:'domcontentloaded'});
  await page.locator('[data-landing-consent]').getByRole('button').first().click();
  for (const [name,vendor,placement,store,selector] of [['Uber Eats (Dupont)','ubereats','shops','dupont','#shops [data-shop="dupont"]'],['Order on DoorDash','doordash','footer',undefined,'#footer']] as const) {
    const link = page.locator(selector).getByRole('link',{name,exact:true});
    await link.evaluate(el=>el.addEventListener('click',event=>event.preventDefault()));
    await link.click();
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect.poll(()=>events.some(event=>event.vendor===vendor)).toBe(true);
    const event = events.find(event=>event.vendor===vendor)!;
    expect(event).toMatchObject({event_name:'OrderClick',placement,vendor});
    expect(event.store).toBe(store);
    const queued = await page.evaluate(v=>window.fbq?.queue?.find(args=>args[1]==='OrderClick' && (args[2] as Record<string,string>).vendor===v),vendor);
    expect(queued).toEqual(['trackCustom','OrderClick',{ad:'unattributed',placement,vendor,...(store?{store}:{})},{eventID:event.event_id}]);
  }
  expect(events).toHaveLength(2); expect(counters).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(375);
});
