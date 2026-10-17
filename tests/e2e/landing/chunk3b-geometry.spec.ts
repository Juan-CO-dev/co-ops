import {test,expect} from '@playwright/test';

for(const language of ['en','es']) for(const viewport of [{width:375,height:667},{width:375,height:812},{width:1440,height:900}]) {
  test(`prototype hero and consent exclusion ${language} ${viewport.width}x${viewport.height}`,async({page},info)=>{
    await page.setViewportSize(viewport);
    await page.goto(`/?lang=${language}`);
    await page.evaluate(()=>document.fonts.ready);
    await expect(page.locator('.landing-v2-consent')).toHaveAttribute('data-flow','false');
    await expect(page.locator('.landing-v2')).toHaveAttribute('data-consent-flow','false');
    const geometry=await page.evaluate(()=>{
      const box=(selector:string)=>document.querySelector(selector)!.getBoundingClientRect().toJSON();
      return {photo:box('#hero img'),actions:box('[data-hero-actions]'),copy:box('.landing-v2-hero-copy'),consent:box('.landing-v2-consent'),overflow:document.documentElement.scrollWidth>innerWidth};
    });
    const intersects=(a:typeof geometry.photo,b:typeof geometry.photo)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
    expect(intersects(geometry.consent,geometry.photo)).toBe(false);
    expect(intersects(geometry.consent,geometry.actions)).toBe(false);
    expect(geometry.consent.height).toBeLessThanOrEqual(120);
    expect(geometry.overflow).toBe(false);
    await expect(page.locator('#hero-title span')).toHaveCount(2);
    if(viewport.width===375){
      expect(geometry.photo.top-geometry.actions.bottom).toBeLessThanOrEqual(40);
      expect(geometry.photo.bottom).toBeLessThanOrEqual(geometry.consent.top+1);
      expect(geometry.photo.height).toBeGreaterThanOrEqual(viewport.height*.4);
      expect(geometry.actions.bottom).toBeLessThanOrEqual(392);
    }else{
      expect(geometry.consent.width).toBeLessThanOrEqual(380);
      expect(geometry.consent.left).toBeLessThanOrEqual(16);
      expect(geometry.consent.right).toBeLessThanOrEqual(geometry.photo.left);
      expect(geometry.consent.bottom).toBeLessThanOrEqual(geometry.photo.bottom);
      expect(geometry.consent.top).toBeGreaterThanOrEqual(geometry.photo.top);
      expect(Math.abs((geometry.copy.top+geometry.copy.bottom)/2-(geometry.photo.top+geometry.photo.bottom)/2)).toBeLessThanOrEqual(1);
    }
    for(const link of await page.locator('[data-hero-actions] a').all()){
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await link.focus();await expect(link).toBeFocused();
    }
    await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});
    await page.screenshot({path:`tmp/landing-v2/chunk3b/${info.project.name}-${language}-${viewport.width}x${viewport.height}.png`});
    await info.attach('geometry.json',{body:JSON.stringify(geometry,null,2),contentType:'application/json'});
  });
}

test('short desktop keeps consent between the actions and food in flow',async({page})=>{
  await page.setViewportSize({width:768,height:667});
  await page.goto('/');
  await expect(page.locator('.landing-v2-consent')).toHaveAttribute('data-flow','true');
  const actions=(await page.locator('[data-hero-actions]').boundingBox())!;
  const consent=(await page.locator('.landing-v2-consent').boundingBox())!;
  const photo=(await page.locator('#hero img').boundingBox())!;
  expect(actions.y+actions.height).toBeLessThanOrEqual(consent.y);
  expect(consent.y+consent.height).toBeLessThanOrEqual(photo.y);
});
