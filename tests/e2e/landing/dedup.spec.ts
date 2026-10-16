import {test,expect} from '@playwright/test';
test('actual order actions share Pixel/CAPI IDs and count once per click',async({page,context})=>{
  await context.addCookies([{name:'landing_consent',value:'accepted',url:'http://localhost:43170'}]);
  await page.route('https://connect.facebook.net/**',route=>route.fulfill({contentType:'application/javascript',body:'/* offline pixel queue */'}));
  const events:Record<string,unknown>[]=[];const counts:Record<string,unknown>[]=[];
  await page.route('**/api/landing/events',route=>{events.push(route.request().postDataJSON());return route.fulfill({status:204});});
  await page.route('**/api/landing/order-click',route=>{counts.push(route.request().postDataJSON());return route.fulfill({status:204});});
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
