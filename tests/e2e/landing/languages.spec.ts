import { textureMedia } from '../../../lib/landing/media';
import { test, expect } from "@playwright/test";
import en from "../../../lib/i18n/en.json";
import es from "../../../lib/i18n/es.json";
test.use({locale:'es-MX'});

for(const language of ['en','es'] as const)test(`no visible asset classification tags in ${language}`,async({page})=>{
  await page.goto(`/?lang=${language}`);
  for(const section of await page.locator('main section').all()){
    await section.scrollIntoViewIfNeeded();
    await expect(page.locator('.landing-v2-page')).not.toContainText(/\b(?:Illustrated|Ilustrad\w*|AI|Drawn|Edited|Dibujad\w*|Editad\w*|Generad\w*|IA)\b/i);
  }
});

for (const language of ["en","es"] as const) test(`every section and control renders in ${language}`,async ({page})=>{
  await page.goto(`/?lang=${language}`);
  const dictionary = language === "es" ? es : en;
  for (const section of ["hero","field-guide","lineup","shops","catering","footer"] as const) {
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
  await expect(held.locator('img:not(.landing-v3-pixel),picture,video')).toHaveCount(0);
  expect(await held.locator('noscript').textContent()).toContain(textureMedia.crossSection.src);
  await expect(page.getByRole("button",{name:dictionary["landing.consent.accept"],exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:dictionary["landing.consent.reject"],exact:true})).toBeVisible();
  expect((await page.context().cookies()).some(c=>/lang/i.test(c.name))).toBe(false);
  await held.scrollIntoViewIfNeeded();
  const photo=held.locator('[data-landing-photo] img');
  // Exact section image inventory: one real photo, no decoration.
  await expect(held.locator('img:not(.landing-v3-pixel)')).toHaveCount(1);
  await expect(held.locator('img.landing-v3-pixel')).toHaveCount(6);
  for(const pickup of await held.locator('img.landing-v3-pixel').all())await expect(pickup).toHaveAttribute('alt','');
  await expect(photo).toHaveCount(1);
  await expect(photo).toHaveAttribute('src',textureMedia.crossSection.src);
  await expect(photo).toHaveAttribute('srcset',textureMedia.crossSection.srcSet);
  await expect(photo).toHaveAttribute('width','720');
  await expect(photo).toHaveAttribute('height','1080');
  await expect(photo).toHaveAttribute('alt',dictionary['landing.texture.cross-alt']);
  await expect(held.locator('video')).toHaveCount(0);
  await expect(held.locator('[data-field-ingredients]')).toHaveText(dictionary['landing.lineup.ingredients.crunchy-boi']);
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
