import {test,expect} from '@playwright/test';

for (const language of ['en','es']) test(`375px reflow at 200% text size and keyboard targets (${language})`, async ({page}) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(`/?lang=${language}`);
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const control of await page.locator('main a,header a,summary,aside button').all()) {
    if (!await control.isVisible()) continue;
    const rect = await control.boundingBox();
    expect(rect?.height).toBeGreaterThanOrEqual(44);
    expect(rect?.width).toBeGreaterThanOrEqual(44);
    await control.focus();
    await expect(control).toBeFocused();
  }
});
