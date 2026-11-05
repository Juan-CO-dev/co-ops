import {test,expect} from '@playwright/test';
import {landingTenantConfig} from '../../../config/tenant/landing';
import {itemOrderUrl} from '../../../lib/landing/item-order-url-shared';

for(const language of ['en','es'])test(`every direct order group sends its pickup/delivery choice (${language})`,async({page})=>{
  const events:Record<string,unknown>[]=[],counts:Record<string,unknown>[]=[];
  await page.route('https://connect.facebook.net/**',route=>route.fulfill({body:'/* offline */'}));
  await page.route('**/api/landing/events',route=>{events.push(route.request().postDataJSON());return route.fulfill({status:204});});
  await page.route('**/api/landing/order-click',route=>{counts.push(route.request().postDataJSON());return route.fulfill({status:204});});
  await page.route('**/api/landing/ad-code',route=>route.fulfill({json:{ad:'subsim-photo'}}));
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(`/?lang=${language}&ad=subsim-photo`);
  await page.locator('[data-landing-consent] button').first().click();
  await expect(page.locator('#landing-meta-pixel')).toHaveCount(1);
  await page.evaluate(()=>document.addEventListener('click',event=>{if((event.target as Element).closest('a'))event.preventDefault();},true));
  let taps=0;
  for(const placement of ['hero','sticky','lineup','shops','footer','crave','guide']){
    const links=page.locator(`a[data-landing-placement="${placement}"][data-landing-mode]`);
    await expect(links).toHaveCount(3);
    const item=['lineup','crave','guide'].includes(placement)?'crunchy-boi':undefined;
    for(const store of landingTenantConfig.stores){
      const link=links.filter({hasText:store.orderLabel});
      await expect(link).toHaveAttribute('data-landing-mode','pickup');
      await expect(link).toHaveAttribute('href',itemOrderUrl(store,item));
      await expect(link).toContainText(language==='en'?'Pickup at':'Recoger en');
      await link.evaluate(el=>(el as HTMLAnchorElement).click());
      await expect.poll(()=>events.length).toBe(++taps);
      await expect.poll(()=>counts.length).toBe(taps);
      expect(events.at(-1)).toMatchObject({event_name:'OrderClick',mode:'pickup',placement,store:store.key,ad:'subsim-photo',...(item?{item}:{})});
      expect(counts.at(-1)).toEqual({store:store.key,ad:'subsim-photo',intent:'pickup'});
    }
    const delivery=page.locator(`a[data-landing-placement="${placement}"][data-landing-mode="delivery"]`);
    await expect(delivery).toHaveCount(1);
    await expect(delivery).toHaveText(language==='en'?'Delivery':'Entrega a domicilio');
    await expect(delivery).toHaveAttribute('href',landingTenantConfig.deliveryUrl);
    await delivery.evaluate(el=>(el as HTMLAnchorElement).click());
    await expect.poll(()=>events.length).toBe(++taps);
    await expect.poll(()=>counts.length).toBe(taps);
    expect(events.at(-1)).toMatchObject({event_name:'OrderClick',mode:'delivery',placement,ad:'subsim-photo',...(item?{item}:{})});
    expect(events.at(-1)).not.toHaveProperty('store');
    expect(counts.at(-1)).toEqual({ad:'subsim-photo',intent:'delivery'});
  }
});

test('directions require consent and send FindLocation plus visit intent for each shop',async({page})=>{
  const events:Record<string,unknown>[]=[],counts:Record<string,unknown>[]=[];
  await page.route('https://connect.facebook.net/**',route=>route.fulfill({body:'/* offline */'}));
  await page.route('**/api/landing/events',route=>{events.push(route.request().postDataJSON());return route.fulfill({status:204});});
  await page.route('**/api/landing/order-click',route=>{counts.push(route.request().postDataJSON());return route.fulfill({status:204});});
  await page.goto('/');
  await page.evaluate(()=>document.addEventListener('click',event=>{if((event.target as Element).closest('a'))event.preventDefault();},true));
  const directions=page.locator('a[data-directions]');
  await directions.first().evaluate(el=>(el as HTMLAnchorElement).click());
  expect(events).toEqual([]);expect(counts).toEqual([]);
  await page.locator('[data-landing-consent] button').first().click();
  await expect(page.locator('#landing-meta-pixel')).toHaveCount(1);
  for(const [index,store] of landingTenantConfig.stores.entries()){
    await page.locator(`a[data-directions="${store.key}"]`).evaluate(el=>(el as HTMLAnchorElement).click());
    await expect.poll(()=>events.length).toBe(index+1);
    await expect.poll(()=>counts.length).toBe(index+1);
    expect(events[index]).toMatchObject({event_name:'FindLocation',store:store.key,placement:'shops'});
    expect(events[index]).not.toHaveProperty('mode');
    expect(counts[index]).toEqual({ad:'unattributed',store:store.key,intent:'visit'});
    const queued=await page.evaluate(()=>window.fbq?.queue?.filter(args=>args[1]==='FindLocation'));
    expect(queued?.at(-1)).toEqual(['track','FindLocation',{ad:'unattributed',store:store.key,placement:'shops'},{eventID:events[index]?.event_id}]);
  }
});
