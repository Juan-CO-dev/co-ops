import { test, expect } from '@playwright/test';
import inventory from '../../../config/tenant/landing-assets.json';

test('hydration preserves the original server-rendered hero poster before scrolling', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'landing_consent', value: 'rejected', url: baseURL! }]);
  await page.addInitScript(() => {
    const probe: { original: Element | null; removed: boolean } = { original: null, removed: false };
    (window as Window & { heroPosterProbe?: typeof probe }).heroPosterProbe = probe;
    new MutationObserver(records => {
      for (const record of records) {
        for (const added of record.addedNodes) {
          if (!probe.original && added instanceof Element) {
            probe.original = added.matches('#hero img') ? added : added.querySelector('#hero img');
          }
        }
        for (const removed of record.removedNodes) {
          if (probe.original && (removed === probe.original || removed.contains(probe.original))) probe.removed = true;
        }
      }
      if (!probe.original) probe.original = document.querySelector('#hero img');
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto('/?lang=en', { waitUntil: 'load' });
  // SSR starts with unknown consent. Only the TrackingProvider effect reads
  // the rejected cookie and collapses this panel; no click/scroll is needed.
  await expect(page.locator('aside > button[aria-expanded]')).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => {
    const probe = (window as Window & { heroPosterProbe?: { original: Element | null; removed: boolean } }).heroPosterProbe;
    return { captured: !!probe?.original, removed: probe?.removed, same: probe?.original === document.querySelector('#hero img'), scrollY };
  })).toEqual({ captured: true, removed: false, same: true, scrollY: 0 });
  await expect(page.locator('#hero img')).toBeVisible();
});

for (const width of [320, 640, 768, 1024]) {
  test(`no-JS poster sizes matches painted width at ${width}px`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    try {
      const page = await context.newPage();
      await page.goto(baseURL!, { waitUntil: 'load' });
      const geometry = await page.locator('#hero img').evaluate(async element => {
        await document.fonts.ready;
        const image = element as HTMLImageElement;
        const box = image.getBoundingClientRect();
        // object-contain can paint narrower than its full-width element box.
        const paintedWidth = Math.min(box.width, box.height * 750 / 1125);
        const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
        return { paintedWidth, height: box.height, rem, sizes: image.sizes };
      });
      const declaredWidth = width >= 640 ? 18.666667 * geometry.rem : Math.min(width - 5 * geometry.rem, 18.666667 * geometry.rem);
      expect(geometry.sizes).toBe('(min-width: 640px) 18.666667rem, min(calc(100vw - 5rem), 18.666667rem)');
      expect(Math.abs(geometry.paintedWidth - declaredWidth)).toBeLessThan(1);
      expect(geometry.height).toBeLessThanOrEqual(28 * geometry.rem + 0.1);
    } finally {
      await context.close();
    }
  });
}

for (const language of ['en', 'es'] as const) {
  for (const deviceScaleFactor of [1, 2, 3]) {
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      test(`SSR poster ${language} DPR ${deviceScaleFactor}, motion ${reducedMotion}`, async ({ browser, baseURL }) => {
        // A new context isolates the HTTP cache and candidate selection for every DPR.
        const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 375, height: 812 }, deviceScaleFactor, reducedMotion });
        try {
          const page = await context.newPage();
          // The original 750px file is also a legitimate no-JS lineup image.
          // Count hero-only derivatives; the SSR test rejects a second fallback preload.
          const posterPaths = inventory.filter(asset => /^hero-poster-\d+$/.test(asset.id)).map(asset => asset.path);
          const requests: string[] = [];
          page.on('request', request => {
            const pathname = new URL(request.url()).pathname;
            if (posterPaths.includes(pathname)) requests.push(pathname);
          });
          await page.goto(`${baseURL}/?lang=${language}`, { waitUntil: 'load' });
          const poster = page.locator('#hero img');
          const heading = page.locator('#hero-title');
          await expect(poster).toBeVisible();
          await expect(heading).toBeVisible();
          await expect(heading).not.toBeEmpty();
          const expected = inventory.find(asset => asset.id === `hero-poster-${deviceScaleFactor * 320}`);
          expect(expected).toBeDefined();
          expect(await poster.evaluate(image => new URL((image as HTMLImageElement).currentSrc).pathname)).toBe(expected!.path);
          expect(await poster.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
          expect(requests).toEqual([expected!.path]);
          // No hydration can rescue these assertions: scripts are disabled.
          for (const target of [poster, heading]) {
            const masking = await target.evaluate(element => {
              const problems: string[] = [];
              for (let node: Element | null = element; node; node = node.parentElement) {
                const style = getComputedStyle(node);
                if (style.opacity !== '1' || style.visibility !== 'visible' || style.display === 'none' || style.animationName !== 'none' || style.transform !== 'none' || style.clipPath !== 'none' || style.clip !== 'auto') {
                  problems.push(`${node.tagName}#${node.id}: ${style.opacity}/${style.visibility}/${style.display}/${style.animationName}/${style.transform}/${style.clipPath}/${style.clip}`);
                }
              }
              return problems;
            });
            expect(masking).toEqual([]);
          }
        } finally {
          await context.close();
        }
      });
    }
  }
}

test('only the hero receives an image preload on the full page', async ({page}) => {
 await page.goto('/');
 const hints=page.locator('link[rel="preload"][as="image"]');
 await expect(hints).toHaveCount(1);
 await expect(hints).toHaveAttribute('imagesrcset', /crunchy-boi-014/);
});
