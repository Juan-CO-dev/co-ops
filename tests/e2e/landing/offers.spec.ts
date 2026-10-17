import {test,expect} from '@playwright/test';
test('non-offer ads never add a discount or vendor tracking query',async({page})=>{
  await page.goto('/?ad=subsim-photo&promo=FAKE&email=private@example.com');
  await expect(page.locator('main')).toBeVisible();
  for(const href of await page.locator('a[href^="https://"]').evaluateAll(anchors=>anchors.map(a=>(a as HTMLAnchorElement).href))){expect(href).not.toMatch(/promo=|email=|ad=|fbclid=/);}
  await expect(page.getByText('FAKE',{exact:false})).toHaveCount(0);
});
