import { LANDING_PLACEMENTS } from "../../../lib/landing/tracking-schema-shared";
import { test, expect } from "@playwright/test";
import { landingTenantConfig } from "../../../config/tenant/landing";

test("all direct and catering destinations match approved tenant config",async ({page})=>{
  await page.goto("/");
  // The Field Guide's order action mounts once its figure hydrates.
  await expect(page.locator('[data-landing-placement="guide"]').first()).toBeAttached();
  expect(await page.locator("[data-landing-placement]").evaluateAll(links=>[...new Set(links.map(link=>link.getAttribute("data-landing-placement")))].sort())).toEqual([...LANDING_PLACEMENTS].sort());
  for (const store of landingTenantConfig.stores) {
    const links = page.getByRole("link",{name:`Order ${store.orderLabel}`,exact:true});
    // Shop card and footer; the select screen's, crunch story's and Field Guide's copies sit in closed sheets.
    await expect(links).toHaveCount(2);
    // v4: the hero button also names the street and today's closing time from the same config.
    const hero = page.locator("[data-hero-actions]").getByRole("link",{name:new RegExp(`^Order ${store.orderLabel} · ${store.street}( · til [0-9]{1,2}(:[0-9]{2})? (AM|PM))?$`)});
    await expect(hero).toHaveCount(1);
    await expect(hero).toHaveAttribute("href",store.orderUrl);
    for (const link of [...await links.all(), hero]) {
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
