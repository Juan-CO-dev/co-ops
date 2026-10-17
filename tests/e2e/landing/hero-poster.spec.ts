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
        // Full-bleed object-cover paints the entire element, with uniform cropping.
        const paintedWidth = box.width;
        const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
        return { paintedWidth, height: box.height, rem, sizes: image.sizes };
      });
      const declaredWidth = width >= 768 ? width / 2 : width;
      expect(geometry.sizes).toBe('(min-width: 768px) 50vw, 100vw');
      expect(Math.abs(geometry.paintedWidth - declaredWidth)).toBeLessThan(1);
      // Full-bleed replacement for r2 P3-F's obsolete 28rem contained-poster cap:
      // desktop is the prototype's 740px stage; mobile reserves header/copy/consent.
      if (width >= 768) expect(geometry.height).toBe(740);
      else if (width >= 330) {
        expect(geometry.height).toBeGreaterThanOrEqual(360);
        expect(geometry.height).toBeLessThanOrEqual(900 - 52 - 120);
      } else {
        // Narrow accessibility fallback preserves the original 2:3 image ratio.
        expect(geometry.height).toBe(width * 1.5);
      }
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
          const posterPaths = inventory.filter(asset => /^v2-p013-\d+$/.test(asset.id)).map(asset => asset.path);
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
          const expected = inventory.find(asset => asset.id === `v2-p013-${({1:480,2:960,3:1280} as Record<number,number>)[deviceScaleFactor]}`);
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
 await expect(hints).toHaveAttribute('imagesrcset', /v2-p013/);
});
