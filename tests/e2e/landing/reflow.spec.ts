import {test,expect} from '@playwright/test';

for (const language of ['en','es']) test(`375px reflow at 200% text size and keyboard targets (${language})`, async ({page}) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(`/?lang=${language}`);
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  // ResizeObserver applies the accessible in-flow layout after the font resize.
  await expect(page.locator('.landing-v2-consent')).toHaveAttribute('data-flow','true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Order sheets enhance as their section nears the viewport: visit them first so the control
  // inventory below is the settled page (their native-link fallback is covered by the no-JS specs).
  for (const section of ['crave','lineup','field-guide']) await page.locator(`#${section}`).scrollIntoViewIfNeeded();
  await expect(page.locator('main .landing-v3-direct-orders')).toHaveCount(0);
  await page.evaluate(() => scrollTo(0, 0));
  for (const control of await page.locator('main a,header a,summary,aside button,aside a').all()) {
    if (!await control.isVisible()) continue;
    const rect = await control.boundingBox();
    expect(rect?.height).toBeGreaterThanOrEqual(44);
    expect(rect?.width).toBeGreaterThanOrEqual(44);
    await control.focus();
    await expect(control).toBeFocused();
  }
});
