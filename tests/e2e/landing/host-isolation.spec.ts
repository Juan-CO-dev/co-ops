import { portBase } from '../../../scripts/landing/e2e-ports.cjs';
import { test, expect } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
const pinnedBlocked = ['/api/locations','/api/users/login-options','/order','/order/start','/verify','/reset-password','/api/auth/pin','/api/auth/password','/api/auth/logout','/api/auth/verify','/api/auth/password-reset-request','/api/auth/password-reset','/api/portal/test','/api/webhooks/test','/api/cron/test','/admin/a.png','/dashboard','/training','/jobs','/icon.png','/apple-icon.png','/opengraph-image.png','/eat/extra'];
const exemptRoutes = ['api/portal','api/webhooks','api/cron','order'].flatMap(prefix => (readdirSync(join(process.cwd(),'app',prefix),{recursive:true}) as string[]).filter(file => /(?:route|page)\.tsx?$/.test(file)).map(file => '/' + prefix + '/' + file.replace(/\\/g,'/').replace(/(?:route|page)\.tsx?$/,'').replace(/\[.*?\]/g,'fixture').replace(/\/$/,'')));
const blocked = [...new Set([...pinnedBlocked,...exemptRoutes])];
for (const method of ['GET','HEAD','POST']) test(`landing refuses every staff/exempt path: ${method}`, async ({ request }) => {
  for (const path of blocked) {
    let response = await request.fetch(path, { method, headers: { cookie:'co_ops_session=invalid; co_ops_portal=invalid; co_shop=fixture' }, maxRedirects:0 });
    if (path.endsWith('/')) {
      expect(response.status(), path).toBe(308);
      expect(response.headers()['set-cookie']).toBeUndefined();
      response = await request.fetch(path.replace(/\/+$/, ''), { method, maxRedirects:0 });
    }
    expect(response.status(), path).toBe(404);
    expect(response.headers()['set-cookie'],path).toBeUndefined();
    expect(response.headers()['permissions-policy']).toContain('geolocation=()');
  }
});
test('canonical redirects use configured origin, not supplied host', async ({ request }) => {
  for (const [path, target] of [['/eat','/'], ['/eat/privacy','/privacy']]) {
    const response = await request.get(path!, {maxRedirects:0, headers:{host:'eat.example.test','x-forwarded-host':'eat.example.test'}});
    expect(response.status()).toBe(301);
    expect(response.headers().location).toBe(`https://localhost:${portBase}${target}`);
  }
});
test('all host matrix rows and runtime headers', async ({ request }) => {
  for (const host of [`localhost:${portBase}`,'eat.example.test','preview.example.test']) {
    for (const path of ['/', '/privacy', '/brand/co-icon.png', '/admin']) {
      const response = await request.get(path,{headers:{host,'x-forwarded-host':host}, maxRedirects:0});
      expect(response.status()).toBe(path === '/admin' ? 404 : 200);
      const csp = response.headers()['content-security-policy-report-only']!;
      expect(csp.match(/default-src/g)).toHaveLength(1);
      expect(csp).toContain('connect.facebook.net');
      expect(csp).not.toContain('graph.facebook');
      expect(response.headers()['permissions-policy']).toContain('geolocation=()');
      expect(response.headers()['set-cookie']).toBeUndefined();
      if(path === '/') { expect(response.headers()['cache-control']).toContain('no-store'); expect(response.headers()['cache-control']).toContain('private'); }
    }
  }
  for (const host of [`127.0.0.1:${portBase}`,'unlisted.vercel.app']) {
    for (const path of ['/eat','/eat/privacy','/api/landing/events','/api/landing/order-click']) {
      const response = await request.get(path,{headers:{host,'x-forwarded-host':host}, maxRedirects:0});
      expect(response.status()).toBe(404); expect(response.headers()['content-security-policy-report-only']).not.toContain('facebook');
    }
  }
  for(const host of [`localhost:${portBase + 1}`,'eat.example.test']) for(const path of ['/eat','/api/landing/events']) {
    const response=await request.get(`http://localhost:${portBase + 1}${path}`,{headers:{host,'x-forwarded-host':host},maxRedirects:0});
    expect(response.status()).toBe(404); expect(response.headers()['content-security-policy-report-only']).not.toContain('facebook');
  }
});
test('invalid or disagreeing hosts leave staff available and landing dormant', async ({ request }) => {
  for(const headers of [
    {'x-forwarded-host':'evil.test'},
    {'x-forwarded-host':`localhost:${portBase + 1}`},
    {'x-forwarded-host':'localhost.,evil.test'},
    {host:'localhost.', 'x-forwarded-host':'localhost.'},
    {host:'user@localhost', 'x-forwarded-host':'user@localhost'},
  ] as Record<string, string>[]) {
    const root = await request.get('/', {headers, maxRedirects:0});
    expect(root.status()).toBe(200);
    expect(await root.text()).not.toContain('Your next great lunch.');
    expect(root.headers()['content-security-policy-report-only']).not.toContain('facebook');
    const admin = await request.get('/admin', {headers, maxRedirects:0});
    expect(admin.status()).toBe(307);
    for (const path of ['/eat','/eat/privacy','/api/landing/events','/api/landing/order-click']) {
      expect((await request.get(path,{headers,maxRedirects:0})).status()).toBe(404);
    }
  }
});
test('local optimizer cannot bypass isolation', async ({ request }) => {
  for(const target of ['/admin/a.png','/icon.png','https://evil.test/a.png','/brand/unknown.png']) {
    const response=await request.get('/_next/image',{params:{url:target,w:64,q:75}}); expect(response.status()).toBe(404);
  }
});
test('staff root and empty-env root omit all trackers, even with accepted consent', async ({page,request})=>{
  for(const url of [`http://127.0.0.1:${portBase}/`,`http://localhost:${portBase + 1}/`]) {
    const response=await request.get(url); expect(response.status()).toBe(200); expect(await response.text()).not.toContain('connect.facebook.net');
    const meta:string[]=[]; page.on('request',r=>{if(/facebook\.com|facebook\.net/.test(r.url()))meta.push(r.url());});
    await page.goto(url); await page.evaluate(()=>localStorage.setItem('landing-consent','accepted'));
    await page.reload(); expect(meta).toEqual([]); await expect(page.locator('script[src*="facebook"],link[href*="facebook"]')).toHaveCount(0);
  }
});


test('HTML and RSC are private and no-store, with distinct content per host',async ({request})=>{
  for(const rsc of [false,true]) {
    const response=await request.get(rsc?'/?_rsc=fixture':'/',{headers:rsc?{RSC:'1'}:{}});
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(response.headers()['cache-control']).toContain('private');
    const landingContent = await response.text();
    expect(landingContent).toContain('Your next great lunch.');
    const staff=await request.get(`http://127.0.0.1:${portBase}`+(rsc?'/?_rsc=fixture':'/'),{headers:rsc?{RSC:'1'}:{}});
    expect(staff.status()).toBe(200);
    const staffContent = await staff.text();
    expect(staffContent).not.toContain('Your next great lunch.');
    expect(staffContent).not.toBe(landingContent);
    expect(staff.headers()['content-security-policy-report-only']).not.toContain('facebook');
  }
});

for (const [path, canonical] of [['/order/','/order'],['/admin/','/admin'],['/api/locations/','/api/locations'],['/foo//','/foo'],['/privacy/','/privacy']]) {
  test(`landing slash canonicalization terminates: ${path}`, async ({request,baseURL}) => {
    let url = new URL(path!, baseURL);
    const seen = new Set([url.href]);
    const maxHops = path!.includes('//') ? 2 : 1;
    let response = await request.get(url.href, {maxRedirects:0});
    let hops = 0;
    expect(response.headers()['set-cookie']).toBeUndefined();
    while (response.status() >= 300 && response.status() < 400) {
      expect(response.headers()['set-cookie']).toBeUndefined();
      expect(++hops).toBeLessThanOrEqual(maxHops);
      expect(response.status()).toBe(308);
      url = new URL(response.headers().location!, url);
      expect(url.origin).toBe(new URL(baseURL!).origin);
      expect(seen.has(url.href)).toBe(false);
      seen.add(url.href);
      response = await request.get(url.href, {maxRedirects:0});
    }
    expect(response.headers()['set-cookie']).toBeUndefined();
    expect(hops).toBeGreaterThanOrEqual(1);
    expect(url.pathname).toBe(canonical);
    expect(response.status()).toBe(canonical === '/privacy' ? 200 : 404);
    expect(response.headers().location).toBeUndefined();
  });
}

test('measurement routes enforce Origin; unconfigured CAPI is dormant and enabled counter fails closed without its database',async ({request})=>{
  const headers={origin:`https://localhost:${portBase}`,cookie:'landing_consent=accepted'};
  const event={event_name:'OrderClick',event_id:crypto.randomUUID(),event_time:Math.floor(Date.now()/1000),consent:'accepted',source_url:`https://localhost:${portBase}/`,store:'capitol-hill',ad:'unattributed',placement:'hero'};
  for(const [path,data] of [['/api/landing/events',event],['/api/landing/order-click',{store:'capitol-hill',ad:'unattributed'}]] as const) {
    const accepted=await request.post(path,{headers,data});expect(accepted.status()).toBe(path.endsWith('order-click') ? 503 : 204);expect(accepted.headers()['set-cookie']).toBeUndefined();
    expect((await request.post(path,{headers:{cookie:headers.cookie},data})).status()).toBe(403);
    expect((await request.post(path,{headers:{...headers,origin:'https://evil.test'},data})).status()).toBe(403);
    expect((await request.post(path,{headers:{...headers,dnt:'1'},data})).status()).toBe(403);
  }
});
