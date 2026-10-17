import {test,expect,type Page} from '@playwright/test';
import {heroMedia} from '../../../lib/landing/media';

async function reachSpin(page:Page) {
  await page.locator('.landing-v2-spin').scrollIntoViewIfNeeded();
}

for(const preference of ['reduce','save-data'] as const)test(`${preference} downloads no automatic motion`,async({page})=>{
  if(preference==='reduce')await page.emulateMedia({reducedMotion:'reduce'});
  else await page.addInitScript(()=>Object.defineProperty(navigator,'connection',{value:{saveData:true,addEventListener(){},removeEventListener(){}}}));
  const requests:string[]=[];page.on('request',r=>{if(/\.(mp4|webm)/.test(r.url()))requests.push(r.url());});
  await page.goto('/');await reachSpin(page);await page.waitForTimeout(250);
  expect(requests).toEqual([]);
  await expect(page.locator('.landing-v2-spin video')).not.toHaveAttribute('src',/./);
  await expect(page.locator('#hero video')).toHaveCount(0);
  await expect(page.locator('#hero img')).toBeVisible();
});

for(const failure of ['decode','play-rejection'] as const)test(`${failure} retains the static hero and explicit retry control`,async({page,browserName})=>{
  test.skip(failure==='decode' && browserName==='webkit' && process.platform!=='darwin','Playwright WebKit lacks H.264 decoding on this platform; native Safari evidence remains required.');
  let requested=false;
  if(failure==='decode')await page.route(`**${heroMedia.spin}`,route=>{requested=true;return route.fulfill({status:200,contentType:'video/mp4',body:'invalid video'});});
  else await page.addInitScript(()=>{HTMLMediaElement.prototype.play=function(){if(this.closest('.landing-v2-spin'))Reflect.set(window,'spinPlayAttempted',true);return Promise.reject(new DOMException('blocked','NotAllowedError'));};});
  await page.goto('/');await reachSpin(page);
  const play=page.locator('.landing-v2-spin button');await play.click();
  if(failure==='decode')await expect.poll(()=>requested).toBe(true);
  else await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'spinPlayAttempted'))).toBe(true);
  await expect(page.locator('#hero img')).toBeVisible();
  await expect(page.locator('#hero video')).toHaveCount(0);
  await expect(play).toBeEnabled();
  await expect(page.locator('.landing-v2-spin video')).toHaveAttribute('controls','');
});

test('keyboard Play attaches one source and preserves reserved geometry',async({page})=>{
  await page.addInitScript(()=>{HTMLMediaElement.prototype.play=function(){if(this.closest('.landing-v2-spin'))Reflect.set(window,'spinPlayedSource',this.getAttribute('src'));return Promise.resolve();};});
  await page.goto('/');await reachSpin(page);
  const video=page.locator('.landing-v2-spin video');
  const before=await video.boundingBox();await expect(video).not.toHaveAttribute('src',/./);
  await page.locator('.landing-v2-spin button').focus();await page.keyboard.press('Enter');
  await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'spinPlayedSource'))).toBe(heroMedia.spin);
  await expect(video).toHaveAttribute('src',heroMedia.spin);
  await expect(video).toHaveAttribute('controls','');
  expect((await video.boundingBox())?.height).toBe(before?.height);
  await expect(page.locator('#hero video')).toHaveCount(0);
});

test('pending manual playback leaves the hero and retry control usable',async({page})=>{
  await page.addInitScript(()=>{HTMLMediaElement.prototype.play=function(){if(this.closest('.landing-v2-spin'))Reflect.set(window,'spinPlayAttempted',true);return new Promise(()=>{});};});
  await page.goto('/');await reachSpin(page);await page.locator('.landing-v2-spin button').click();
  await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'spinPlayAttempted'))).toBe(true);
  await expect(page.locator('#hero img')).toBeVisible();
  await expect(page.locator('.landing-v2-spin button')).toBeEnabled();
  await expect(page.locator('.landing-v2-spin video')).toHaveAttribute('controls','');
});

for(const event of ['scroll','resize','visibilitychange'])test(`${event} never substitutes for explicit Play`,async({page})=>{
  await page.goto('/');await reachSpin(page);
  await page.evaluate(event=>{(event==='visibilitychange'?document:window).dispatchEvent(new Event(event));},event);
  await expect(page.locator('.landing-v2-spin video')).not.toHaveAttribute('src',/./);
  await expect(page.locator('#hero video')).toHaveCount(0);
});
