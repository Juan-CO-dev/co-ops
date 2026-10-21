import {revealPill} from './helpers/sticky';
import { portBase } from '../../../scripts/landing/e2e-ports.cjs';
import {test,expect} from '@playwright/test';
test('actual order actions share Pixel/CAPI IDs and count once per click',async({page,context})=>{
  await context.addCookies([{name:'landing_consent',value:'accepted',url:`http://localhost:${portBase}`}]);
  await page.route('https://connect.facebook.net/**',route=>route.fulfill({contentType:'application/javascript',body:'/* offline pixel queue */'}));
  const events:Record<string,unknown>[]=[];const counts:Record<string,unknown>[]=[];
  await page.route('**/api/landing/events',route=>{events.push(route.request().postDataJSON());return route.fulfill({status:204});});
  await page.route('**/api/landing/order-click',route=>{counts.push(route.request().postDataJSON());return route.fulfill({status:204});});
  await page.route('**/api/landing/ad-code',route=>route.fulfill({json:{ad:'subsim-photo'}}));
  await page.goto('/?ad=subsim-photo&fbclid=Valid_123');
  await expect(page.locator('#landing-meta-pixel')).toHaveCount(1);
  // Keep the page available to inspect dispatch; this does not replace the native href/navigation tests.
  await page.evaluate(()=>document.addEventListener('click',event=>{if((event.target as Element).closest('a[href*="appfront"]'))event.preventDefault();},true));
  const order=page.locator('a[href*="appfront"]').first();await order.click();
  await expect.poll(()=>counts.length).toBe(1);await expect.poll(()=>events.length).toBe(1);
  const first=events[0]!;expect(first.event_name).toBe('OrderClick');expect(first.ad).toBe('subsim-photo');
  const pixel=await page.evaluate(()=>window.fbq?.queue?.find(args=>args[1]==='OrderClick'));
  expect(pixel?.[0]).toBe('trackCustom');expect(pixel?.[3]).toEqual({eventID:first.event_id});
  expect(Object.keys(counts[0]!).sort()).toEqual(['ad','store']);
  await order.click();await expect.poll(()=>counts.length).toBe(2);await expect.poll(()=>events.length).toBe(2);
  expect(events[1]!.event_id).not.toBe(first.event_id);
});

for(const placement of ['sticky','shops','footer']) test(`${placement} hover and dwell are silent; native clicks share Pixel/CAPI IDs`,async({page})=>{
  await page.route('https://connect.facebook.net/**',route=>route.fulfill({contentType:'application/javascript',body:'/* offline */'}));
  const events:Record<string,unknown>[]=[];const counters:Record<string,unknown>[]=[];
  await page.route('**/api/landing/events',route=>{events.push(route.request().postDataJSON());return route.fulfill({status:204});});
  await page.route('**/api/landing/order-click',route=>{counters.push(route.request().postDataJSON());return route.fulfill({status:204});});
  await page.goto('/');await page.locator('[data-landing-consent]').getByRole('button').first().click();
  await page.evaluate(()=>document.addEventListener('click',event=>{if((event.target as Element).closest('a[href*="appfront"]'))event.preventDefault();},true));
  // v4.2: the sticky links live in the Order pill's shop sheet; opening it emits nothing.
  if(placement==='sticky'){await (await revealPill(page)).click();await page.waitForTimeout(300);expect(events).toEqual([]);expect(counters).toEqual([]);}
  const link=page.locator(`[data-landing-placement="${placement}"]`).first();
  await link.hover();await link.focus();await page.waitForTimeout(1100);
  await link.dispatchEvent('pointerdown',{button:0});await link.dispatchEvent('pointerup',{button:0});
  expect(events).toEqual([]);expect(counters).toEqual([]);
  await link.click();await expect.poll(()=>events.length).toBe(1);await expect.poll(()=>counters.length).toBe(1);
  expect(events[0]).toMatchObject({event_name:'OrderClick',placement,store:'capitol-hill'});
  const pixel=await page.evaluate(()=>window.fbq?.queue?.find(args=>args[1]==='OrderClick'));
  expect(pixel?.[3]).toEqual({eventID:events[0]!.event_id});
  await link.click();await expect.poll(()=>events.length).toBe(2);expect(events[1]!.event_id).not.toBe(events[0]!.event_id);
});
