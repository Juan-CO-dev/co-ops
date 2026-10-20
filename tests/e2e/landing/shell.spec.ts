import { test, expect } from "@playwright/test";

test("eight-section skeleton stays useful without JavaScript", async ({browser,baseURL}) => {
  const context = await browser.newContext({javaScriptEnabled:false,reducedMotion:'no-preference',viewport:{width:375,height:812}});
  const page = await context.newPage();
  await page.goto(baseURL!);
  await expect(page.locator("main h1")).toHaveCount(1);
  expect(await page.locator('main > section').evaluateAll(sections=>sections.map(section=>section.id))).toEqual(['hero','crave','lineup','field-guide','catering','shops','footer']);
  await expect(page.getByRole("link",{name:"Order Capitol Hill"}).first()).toBeVisible();
  // v4: the one-question FAQ is gone; the Field Guide words are the content that must stay readable.
  await expect(page.locator('details')).toHaveCount(0);
  await expect(page.locator('#field-guide [data-anatomy-label]').first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const targets=await page.locator("main a,header a,summary,aside a").evaluateAll(nodes=>nodes.filter(node=>!node.closest("dialog")).map(node=>({height:node.getBoundingClientRect().height,label:node.textContent??"unnamed target"})));
  for(const {height,label} of targets)expect(height,label).toBeGreaterThanOrEqual(44);
  await context.close();
});

for (const reducedMotion of ['reduce','no-preference'] as const) test(`missing IntersectionObserver leaves Reveal visible with motion ${reducedMotion}`, async ({page}) => {
  await page.emulateMedia({reducedMotion});
  await page.addInitScript(()=>{Object.defineProperty(window,"IntersectionObserver",{value:undefined,configurable:true});});
  await page.goto("/");
  const words=page.locator('#field-guide [data-anatomy-label]').first();
  await words.scrollIntoViewIfNeeded();
  await expect(words).toBeVisible();
  await expect(page.locator('#field-guide .landing-v2-field-guide')).toHaveCSS("opacity","1");
});

test('reduced motion leaves Reveal visible with IntersectionObserver available', async ({page}) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/');
  await expect(page.locator('#field-guide .landing-v2-field-guide')).toHaveCSS('opacity','1');
});
