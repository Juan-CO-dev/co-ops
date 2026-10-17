import { test, expect } from "@playwright/test";
import en from "../../../lib/i18n/en.json";
import es from "../../../lib/i18n/es.json";
test.use({locale:'es-MX'});

for (const language of ["en","es"] as const) test(`every section and control renders in ${language}`,async ({page})=>{
  await page.goto(`/?lang=${language}`);
  const dictionary = language === "es" ? es : en;
  for (const section of ["hero","field-guide","lineup","subdex","shops","catering","footer"] as const) {
    await expect(page.locator(`#${section}-title`)).toHaveText(dictionary[`landing.${section}.title`]);
    await expect(page.locator(`#${section}`)).toContainText(dictionary[`landing.${section}.body`]);
  }
  for (const card of await page.locator('[data-lineup] li').all()) {
    await expect(card.locator('[data-ingredients]')).toContainText(language === 'es' ? 'pan para sub' : 'sub roll');
  }
  await expect(page.locator('#footer a[href*="spotapps.co"]')).toHaveText(dictionary['landing.footer.careers']);
  await expect(page.locator('#footer a[href*="facebook"]')).toHaveCount(0);
  await expect(page.getByRole("navigation",{name:dictionary["landing.language"]})).toBeVisible();
  const held = page.locator('#field-guide');
  await expect(held).toContainText(dictionary['landing.field-guide.body']);
  await expect(held.locator('img,picture,video')).toHaveCount(0);
  expect(await held.innerHTML()).not.toContain('/media/');
  await expect(page.getByRole("button",{name:dictionary["landing.consent.accept"],exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:dictionary["landing.consent.reject"],exact:true})).toBeVisible();
  expect((await page.context().cookies()).some(c=>/lang/i.test(c.name))).toBe(false);
});

test("query wins over language header and toggle drops unapproved query",async ({page})=>{
  await page.setExtraHTTPHeaders({"Accept-Language":"es-MX"});
  await page.goto("/?lang=en&ad=subsim-photo&email=private@example.com");
  await expect(page.locator("h1")).toHaveText(en["landing.hero.title"]);
  await page.getByRole("link",{name:"ES",exact:true}).click();
  await expect(page.locator("h1")).toHaveText(es["landing.hero.title"]);
  expect(new URL(page.url()).searchParams.get("ad")).toBe("subsim-photo");
  expect(page.url()).not.toContain("email");
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText(es["landing.hero.title"]);
});
