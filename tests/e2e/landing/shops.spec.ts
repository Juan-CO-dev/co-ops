import {test,expect} from '@playwright/test';
import {fixtureBundle} from './fixture-bundle';

for (const javaScriptEnabled of [true,false]) test(`shop facts and native links work at 375px, JS ${javaScriptEnabled}`,async({browser,baseURL})=>{
  const context=await browser.newContext({javaScriptEnabled,viewport:{width:375,height:812},reducedMotion:'reduce'});
  const page=await context.newPage();
  await page.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(){throw new Error('Unsolicited geolocation');}}}));
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(baseURL!,{waitUntil:'domcontentloaded'});
  const shops=page.locator('#shops');await shops.scrollIntoViewIfNeeded();
  await expect(shops.locator('[data-shop]')).toHaveCount(2);
  await expect(shops).toContainText('526 8th St SE Ste A');await expect(shops).toContainText('2029 P St NW Front 1');
  await expect(shops.locator('a[href="tel:+12026218645"]')).toHaveCount(1);
  await expect(shops.locator('a[href="tel:+12027944638"]')).toHaveCount(1);
  await expect(shops.locator('a[href="tel:+12026218645"]')).toHaveText('(202) 621-8645');
  await expect(shops.locator('a[href="tel:+12027944638"]')).toHaveText('(202) 794-4638');
  await expect(shops.locator('[data-shop="dupont"] a[href*="ubereats.com"]')).toHaveText('Uber Eats (Dupont)');
  await expect(shops.locator('[data-shop="capitol-hill"] a[href*="ubereats.com"]')).toHaveCount(0);
  await expect(page.locator('footer a[href*="ubereats.com"]')).toHaveCount(0);
  await expect(shops).toContainText('Daily 10:30am–6pm');
  await expect(shops).toContainText('Daily 10:30am–8pm');
  await expect(shops.locator('[data-shop-map]')).toContainText('Schematic');
  await expect(shops.locator('a[href*="google.com/maps"]')).toHaveCount(2);
  await expect(shops.locator('a[href*="openstreetmap.org/copyright"]')).toHaveCount(1);
  await expect(shops.getByRole('button',{name:'Find my nearest shop'})).toHaveCount(1);
  for(const link of await shops.getByRole('link').all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(375);
  await page.locator('#subdex').scrollIntoViewIfNeeded();
  await expect(page.locator('#subdex img')).toBeVisible();
  await expect.poll(() => page.locator('#subdex img').evaluate((img:HTMLImageElement) => img.complete && img.naturalWidth === 720)).toBe(true);
  await expect(page.locator('#subdex video')).toHaveCount(0);
  await page.screenshot({path:test.info().outputPath('subdex-375.png')});
  await shops.scrollIntoViewIfNeeded();
  await page.screenshot({path:test.info().outputPath('shops-375.png')});
  expect(errors).toEqual([]);await context.close();
});

// Exercise the client with fictional coordinates, independently of the tenant facts.
const fixtureSource=`import React from 'react';import {createRoot} from 'react-dom/client';import {NearbyShop} from './components/landing/NearbyShop';
const root=document.createElement('div');root.id='nearby-fixture';document.body.append(root);
createRoot(root).render(<NearbyShop language="en" labels={{nearest:'Find my nearest shop',locating:'Locating',unavailable:'You can still choose either shop',straightLine:'Sorted by straight-line distance',distance:'{distance} miles away',offer:'Offer',call:{},order:{'capitol-hill':'Order far','dupont':'Order near'}}} stores={[{key:'capitol-hill',name:'Far fixture',orderLabel:'Far fixture',address:null,phone:null,hours:null,coordinates:{latitude:0,longitude:2},orderUrl:'https://example.test/far'},{key:'dupont',name:'Near fixture',orderLabel:'Near fixture',address:null,phone:null,hours:null,coordinates:{latitude:0,longitude:1},orderUrl:'https://example.test/near'}]}/>);`;

for(const outcome of ['granted','denied','timeout','unavailable'] as const)test(`nearest shop is click-only and preserves links: ${outcome}`,async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.evaluate(result=>{
    Reflect.set(window,'geoCalls',0);
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:result==='unavailable'?undefined:{getCurrentPosition(success:PositionCallback,error:PositionErrorCallback){
      Reflect.set(window,'geoCalls',Number(Reflect.get(window,'geoCalls'))+1);
      if(result==='granted')success({coords:{latitude:0,longitude:0}} as GeolocationPosition);
      else error({code:result==='denied'?1:3} as GeolocationPositionError);
    }}});
  },outcome);
  const before=await page.evaluate(()=>({local:{...localStorage},session:{...sessionStorage},cookie:document.cookie}));
  await page.addScriptTag({content:await fixtureBundle(fixtureSource)});
  const fixture=page.locator('#nearby-fixture');
  await expect(fixture.getByRole('button')).toBeVisible();
  expect(await page.evaluate(()=>Reflect.get(window,'geoCalls'))).toBe(0);
  await fixture.getByRole('button').click();
  if(outcome==='granted'){
    await expect(fixture.locator('article').first()).toContainText('Near fixture');
    await expect(fixture).toContainText('straight-line distance');
    await expect(fixture).toContainText('69.1 miles');
  }else{
    await expect(fixture.locator('article').first()).toContainText('Far fixture');
    await expect(fixture.getByRole('status')).toContainText('You can still choose either shop');
  }
  await expect(fixture.getByRole('link')).toHaveCount(2);
  expect(await page.evaluate(()=>({local:{...localStorage},session:{...sessionStorage},cookie:document.cookie}))).toEqual(before);
});
