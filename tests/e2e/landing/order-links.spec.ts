import { LANDING_PLACEMENTS } from "../../../lib/landing/tracking-schema-shared";
import { test, expect } from "@playwright/test";
import { landingTenantConfig } from "../../../config/tenant/landing";

test("all direct and catering destinations match approved tenant config",async ({page})=>{
  await page.goto("/");
  expect(await page.locator("[data-landing-placement]").evaluateAll(links=>[...new Set(links.map(link=>link.getAttribute("data-landing-placement")))].sort())).toEqual([...LANDING_PLACEMENTS].sort());
  for (const store of landingTenantConfig.stores) {
    const links = page.getByRole("link",{name:`Order ${store.orderLabel}`,exact:true});
    // Hero, shop card and footer; the select screen's copy sits in its closed sheet.
    await expect(links).toHaveCount(3);
    for (const link of await links.all()) {
      await expect(link).toHaveAttribute("href",store.orderUrl);
      await expect(link).toHaveAttribute("referrerpolicy","origin");
      await expect(link).toHaveAttribute("rel",/noopener/);
    }
  }
  await expect(page.getByRole("link",{name:"Start a catering order",exact:true})).toHaveAttribute("href",landingTenantConfig.cateringUrl);
  await expect(page.getByRole("link",{name:"Ask us about catering",exact:true})).toHaveAttribute("href",landingTenantConfig.inquiryUrl);
});

test('native ordering navigates with JavaScript disabled and no query forwarding',async ({browser,baseURL})=>{
  const context=await browser.newContext({javaScriptEnabled:false});
  const page=await context.newPage();
  await page.route('https://complimentsonlysubs.appfront.app/**',route=>route.fulfill({contentType:'text/html',body:'<h1>Ordering destination fixture</h1>'}));
  await page.goto(baseURL+'/?ad=subsim-photo&fbclid=Valid_123');
  await page.getByRole('link',{name:'Order Capitol Hill',exact:true}).first().click();
  await expect(page).toHaveURL(landingTenantConfig.stores[0]!.orderUrl);
  await context.close();
});
