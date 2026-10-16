import { test, expect } from "@playwright/test";

test("seven-section skeleton stays useful without JavaScript", async ({browser,baseURL}) => {
  const context = await browser.newContext({javaScriptEnabled:false,viewport:{width:375,height:812}});
  const page = await context.newPage();
  await page.goto(baseURL!);
  await expect(page.locator("main h1")).toHaveCount(1);
  await expect(page.locator("main > section")).toHaveCount(7);
  await expect(page.getByRole("link",{name:"Order Capitol Hill"}).first()).toBeVisible();
  await page.locator("summary").click();
  await expect(page.locator("details p")).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const link of await page.locator("main a,header a,summary").all()) {
    const box = await link.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  await context.close();
});

test("reduced motion and missing IntersectionObserver leave content visible", async ({page}) => {
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.addInitScript(()=>{Object.defineProperty(window,"IntersectionObserver",{value:undefined,configurable:true});});
  await page.goto("/");
  await page.locator("summary").scrollIntoViewIfNeeded();
  await expect(page.locator("summary")).toBeVisible();
  await expect(page.locator("summary")).toHaveCSS("opacity","1");
});
