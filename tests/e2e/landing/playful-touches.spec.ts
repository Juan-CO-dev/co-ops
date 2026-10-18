import {test,expect} from '@playwright/test';
for(const language of ['en','es'])for(const width of [375,1440])for(const scale of [1,2]){
 test(`playful reserved bounds ${language} ${width} text ${scale}`,async({page})=>{
  await page.setViewportSize({width,height:width===375?812:900});
  await page.goto(`/?lang=${language}`);
  if(scale===2)await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  const slots=page.locator('[data-playful-slot]');await expect(slots).toHaveCount(6);
  for(const slot of await slots.all()){
   // BUILD explicitly omits T1 where the mobile hero has no safe gutter.
   if(width===375&&await slot.getAttribute('data-playful-slot')==='hero'){
    await expect(slot).toBeHidden();continue;
   }
   await slot.evaluate(element=>element.scrollIntoView());await page.waitForTimeout(100);
   if(await slot.getAttribute('data-touch')!=='checker-peek')await expect.soft(slot.locator('img')).toBeVisible();
   await expect(slot).toHaveAttribute('aria-hidden','true');
   if(await slot.getAttribute('data-touch')!=='checker-peek')await expect(slot.locator('img')).toHaveAttribute('alt','');
   await expect(slot).toHaveCSS('pointer-events','none');
   expect(await slot.evaluate(node=>{
    const box=node.getBoundingClientRect();
    // The reserved box encloses ALL transform keyframes, stronger than one sampled pose.
    const protectedNodes=[...document.querySelectorAll('[data-landing-photo],main h1,main h2,main h3,main p,main a,main button')].filter(other=>!other.closest('[data-playful-slot], [data-sticky-order]'));
    return protectedNodes.filter(other=>{const r=other.getBoundingClientRect();return Math.max(0,Math.min(box.right,r.right)-Math.max(box.left,r.left))*Math.max(0,Math.min(box.bottom,r.bottom)-Math.max(box.top,r.top))>0;}).map(n=>n.tagName+':'+n.textContent?.slice(0,40));
   })).toEqual([]);
   // Sample the actual CSS recipe in one browser evaluation. Separate protocol
   // round trips let the real timeout remove the animation between samples.
   expect(await slot.evaluate(node=>{
    const previous=node.getAttribute('data-playing');node.setAttribute('data-playing','true');
    const art=node.firstElementChild!;
    const animations=art.getAnimations();animations.forEach(animation=>animation.pause());
    const bounds=[0,150,300,600,1000].map(time=>{
     animations.forEach(animation=>animation.currentTime=time);
     const s=node.getBoundingClientRect(),a=art.getBoundingClientRect();
     return a.left>=s.left&&a.right<=s.right&&a.top>=s.top&&a.bottom<=s.bottom;
    });
    node.setAttribute('data-playing',previous??'false');return bounds;
   })).toEqual([true,true,true,true,true]);
  }
 });
}
test('decorations defer image requests, remain static with reduced motion and never intercept orders',async({page})=>{
 const requested:string[]=[];page.on('request',r=>{if(r.url().includes('/touch-'))requested.push(r.url());});
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/?lang=en');await page.waitForTimeout(250);
 expect(requested).toHaveLength(0);
 await page.locator('[data-playful-slot="lineup"]').scrollIntoViewIfNeeded();
 await expect(page.locator('[data-playful-slot="lineup"] img')).toBeVisible();
 await expect(page.locator('[data-playful-slot][data-playing="true"]')).toHaveCount(0);
 await expect(page.locator('[data-playful-slot] a,[data-playful-slot] button')).toHaveCount(0);
});
