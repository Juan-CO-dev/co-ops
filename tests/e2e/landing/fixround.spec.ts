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
  const toggle=notice.locator(':scope > button');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded','false');
  expect((await context.cookies()).filter(c=>c.name==='landing_consent')).toEqual([]);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded','true');
  await expect(privacy).toBeVisible();
});

test('mid-page shop choices are light native links with their own placements',async({page})=>{
  await page.goto('/');
  for(const placement of ['crave','lineup','field-guide','subdex']) {
    const links=page.locator(`#${placement} a[data-landing-placement="${placement}"]`);
    await expect(links).toHaveCount(2);
    for(const [index,link] of (await links.all()).entries()) {
      await expect(link).toHaveAttribute('href',landingTenantConfig.stores[index]!.orderUrl);
      await expect(link).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
      await expect(link).toHaveCSS('text-decoration-line','underline');
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  }
  await expect(page.locator('#footer a[href*="appfront.app"]')).toHaveCount(2);
});
