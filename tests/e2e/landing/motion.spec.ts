import {test,expect} from '@playwright/test';

// v3: the page has no video element anywhere; motion is scroll/drag driven.
for (const consent of ['unset','accepted','rejected'] as const) test(`initial hero is image-only before scroll with ${consent} consent`,async({page,context,baseURL})=>{
  if(consent!=='unset') await context.addCookies([{name:'landing_consent',value:consent,url:baseURL!}]);
  const requests:string[]=[];
  page.on('request',request=>{if(/\.(mp4|webm|mov)(\?|$)/.test(request.url()))requests.push(request.url());});
  await page.goto('/');
  await expect(page.locator('#hero img')).toBeVisible();
  await expect(page.locator('video')).toHaveCount(0);
  expect(await page.evaluate(()=>scrollY)).toBe(0);
  expect(requests).toEqual([]);
});

test('no native video controls or play buttons anywhere after a full scroll',async({page})=>{
  const requests:string[]=[];
  page.on('request',request=>{if(/\.(mp4|webm|mov)(\?|$)/.test(request.url()))requests.push(request.url());});
  await page.goto('/');
  for(const section of await page.locator('main section').all())await section.scrollIntoViewIfNeeded();
  await expect(page.locator('video')).toHaveCount(0);
  await expect(page.locator('[controls]')).toHaveCount(0);
  await expect(page.getByRole('button',{name:/play|reproduc/i})).toHaveCount(0);
  expect(requests).toEqual([]);
});
