import { test, expect } from '@playwright/test';
import { portBase } from '../../../scripts/landing/e2e-ports.cjs';
import { landingTenantConfig } from '../../../config/tenant/landing';

test('production and same-origin preview metadata agree with raw headers', async ({request,page}) => {
  for (const [port,indexable] of [[portBase,true],[portBase+3,false]] as const) for(const lang of ['en','es']) for(const path of ['/','/privacy']) {
    const response=await request.get(`http://localhost:${port}${path}?lang=${lang}&utm_source=ignored`,{headers:{'x-landing-indexable':indexable?'0':'1'}});
    expect(response.headers()['x-robots-tag']).toBe(indexable?undefined:'noindex, nofollow');
    const html=await response.text();
    expect(html).toContain(`<link rel="canonical" href="https://localhost:${port}${path === "/" ? "" : path}"`);
    expect(html).toContain(`name="robots" content="${indexable?'index, follow':'noindex, nofollow'}"`);
  }
  for(const lang of ['en','es']) {
    await page.goto(`/?lang=${lang}`);
    const graph=JSON.parse(await page.locator('script[type="application/ld+json"]').innerText());
    expect(graph['@graph']).toHaveLength(2);
    for(const [i,store] of landingTenantConfig.stores.entries()) {
      const node=graph['@graph'][i];
      expect(node.telephone).toBe(store.phone); expect(node.address).toEqual({'@type':'PostalAddress',...store.structuredAddress});
      expect(node.geo).toEqual({'@type':'GeoCoordinates',...store.coordinates});
      expect(node.hasMenu).toBe(store.orderUrl);
      await expect(page.locator(`a[href="tel:${store.phone}"]`).first()).toContainText(store.phoneDisplay);
      await expect(page.getByText(store.address,{exact:true}).first()).toBeVisible();
      await expect(page.getByText(store.hours![lang as 'en'|'es'],{exact:true}).first()).toBeVisible();
    }
  }
});

test('alternating canonical, alias and preview hosts never share robots or sitemap', async ({request}) => {
  for(const [port,host,indexable] of [[portBase,`localhost:${portBase}`,true],[portBase,'preview.example.test',false],[portBase+3,`localhost:${portBase+3}`,false],[portBase,`localhost:${portBase}`,true]] as const) {
    for(const path of ['/robots.txt','/sitemap.xml']) {
      const response=await request.get(`http://localhost:${port}${path}`,{headers:{host,'x-forwarded-host':host}});
      expect(response.headers()['cache-control']).toBe('private, no-store');
      const body=await response.text();
      if(path==='/robots.txt') expect(body).toBe(indexable?`User-agent: *\nAllow: /\nSitemap: https://localhost:${port}/sitemap.xml\n`:'User-agent: *\nDisallow: /\n');
      else expect(body.match(/<loc>/g)?.length ?? 0).toBe(indexable?2:0);
    }
  }
});
