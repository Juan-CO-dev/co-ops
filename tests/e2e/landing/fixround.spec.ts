import {test,expect} from '@playwright/test';
import {landingTenantConfig} from '../../../config/tenant/landing';

for(const language of ['en','es']) test(`consent target and first-visit toggle ${language}`,async({page,context})=>{
  await page.goto(`/?lang=${language}`);
  const notice=page.locator('.landing-v2-consent');
  const privacy=notice.locator('a');
  await expect(privacy).toBeVisible();
  const box=(await privacy.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);
  await expect(privacy).toHaveCSS('align-items','center');
  await expect(privacy).toHaveCSS('justify-content','center');
  await expect(privacy).toHaveAttribute('href',`/privacy?lang=${language}`);
  const toggle=notice.locator(':scope > button');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded','false');
  expect((await context.cookies()).filter(c=>c.name==='landing_consent')).toEqual([]);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded','true');
  await expect(privacy).toBeVisible();
});

test('mid-page sections carry no repeated shop-link pairs',async({page})=>{
  await page.goto('/');
  // v4: the crunch story and the Field Guide end on ONE order action each; their shop pair lives only in its closed sheet.
  await expect(page.locator('#field-guide dialog a[href*="appfront.app"]')).toHaveCount(2);
  for(const section of ['crave','field-guide']) {
    await expect(page.locator(`#${section} a[href*="appfront.app"]:not(dialog a)`)).toHaveCount(0);
    await expect(page.locator(`#${section} dialog a[href*="appfront.app"]`)).toHaveCount(2);
    await expect(page.locator(`#${section} dialog`)).toBeHidden();
  }
  // The select screen's shop choice lives only in its closed sheet.
  await expect(page.locator('#lineup a[href*="appfront.app"]')).toHaveCount(2);
  await expect(page.locator('#lineup dialog a[href*="appfront.app"]')).toHaveCount(2);
  await expect(page.locator('#lineup dialog')).toBeHidden();
  await expect(page.locator('#footer a[href*="appfront.app"]')).toHaveCount(2);
});
