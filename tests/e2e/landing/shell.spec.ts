import { test, expect } from "@playwright/test";

test("eight-section skeleton stays useful without JavaScript", async ({browser,baseURL}) => {
  const context = await browser.newContext({javaScriptEnabled:false,reducedMotion:'no-preference',viewport:{width:375,height:812}});
  const page = await context.newPage();
  await page.goto(baseURL!);
  await expect(page.locator("main h1")).toHaveCount(1);
  expect(await page.locator('main > section').evaluateAll(sections=>sections.map(section=>section.id))).toEqual(['hero','crave','lineup','field-guide','subdex','catering','shops','footer']);
  await expect(page.getByRole("link",{name:"Order Capitol Hill"}).first()).toBeVisible();
  await expect(page.locator('div:has(> details)')).toHaveCSS('opacity','1');
  await page.locator("summary").click();
  await expect(page.locator("details p")).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const link of await page.locator("main a,header a,summary,aside a").all()) {
    const box = await link.boundingBox();
    expect(box?.height,(await link.textContent())??"unnamed target").toBeGreaterThanOrEqual(44);
  }
  await context.close();
});

for (const reducedMotion of ['reduce','no-preference'] as const) test(`missing IntersectionObserver leaves Reveal visible with motion ${reducedMotion}`, async ({page}) => {
  await page.emulateMedia({reducedMotion});
  await page.addInitScript(()=>{Object.defineProperty(window,"IntersectionObserver",{value:undefined,configurable:true});});
  await page.goto("/");
  await page.locator("summary").scrollIntoViewIfNeeded();
  await expect(page.locator("summary")).toBeVisible();
  await expect(page.locator('div:has(> details)')).toHaveCSS("opacity","1");
});

test('reduced motion leaves Reveal visible with IntersectionObserver available', async ({page}) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/');
  await expect(page.locator('div:has(> details)')).toHaveCSS('opacity','1');
});
