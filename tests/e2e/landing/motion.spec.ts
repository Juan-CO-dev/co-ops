import { test, expect } from "@playwright/test";
import { heroMedia } from "../../../lib/landing/media";
async function trigger(page: import("@playwright/test").Page) {
 await page.locator('[data-testid="hero-motion"]').scrollIntoViewIfNeeded();
 await page.evaluate(()=>window.dispatchEvent(new Event("scroll")));
}
for(const preference of ["reduce","save-data"] as const)test(`${preference} downloads no motion`,async({page})=>{
 if(preference==="reduce")await page.emulateMedia({reducedMotion:"reduce"});
 else await page.addInitScript(()=>Object.defineProperty(navigator,"connection",{value:{saveData:true,addEventListener(){},removeEventListener(){}}}));
 const requests:string[]=[];page.on("request",r=>{if(/\.(mp4|webm)/.test(r.url()))requests.push(r.url());});
 await page.goto("/");await trigger(page);await expect(page.locator("#hero img")).toBeVisible();await page.waitForTimeout(250);
 expect(requests).toEqual([]);await expect(page.locator("#hero video")).toHaveCount(0);
});
for(const failure of ["decode","autoplay"] as const)test(`${failure} retains the real poster`,async({page,browserName})=>{
 test.skip(failure === 'decode' && browserName === 'webkit' && process.platform !== 'darwin', 'Playwright WebKit lacks H.264 decoding on this platform; poster/fallback checks remain active.');
 let requested=false;
 if(failure==="decode")await page.route(`**${heroMedia.spin}`,route=>{requested=true;return route.fulfill({status:200,contentType:"video/mp4",body:"invalid video"});});
 else await page.addInitScript(()=>{HTMLMediaElement.prototype.play=()=>{Reflect.set(window,"motionPlayAttempted",true);return Promise.reject(new DOMException("blocked","NotAllowedError"));};});
 await page.goto("/");await trigger(page);await expect(page.locator("#hero img")).toBeVisible();
 if(failure==="decode")await expect.poll(()=>requested).toBe(true);else await expect.poll(()=>page.evaluate(()=>Reflect.get(window,"motionPlayAttempted"))).toBe(true);
 await expect(page.locator("#hero video")).toHaveCount(0);await expect(page.getByRole("button",{name:"Pause spin"})).toHaveCount(0);
});
test("one MP4 starts after trigger, pauses by keyboard and offscreen, preserves geometry",async({page,browserName})=>{
 test.skip(browserName === 'webkit' && process.platform !== 'darwin', 'Playwright WebKit lacks H.264 decoding on this platform; real-iPhone Safari preview check required.');
 const urls=new Set<string>();page.on("request",r=>{if(/\.(mp4|webm)/.test(r.url()))urls.add(r.url());});
 await page.goto("/");expect(urls.size).toBe(0);
 const frame=page.locator('[data-testid="hero-motion"]');const initial=await frame.boundingBox();
 await trigger(page);const video=page.locator("#hero video");
 await expect(video).toHaveCSS("opacity","1");expect([...urls]).toEqual([new URL(heroMedia.spin, page.url()).href]);
 expect((await frame.boundingBox())?.height).toBe(initial?.height);
 const pause=page.getByRole("button",{name:"Pause spin"});await pause.focus();await page.keyboard.press("Enter");
 await expect(page.getByRole("button",{name:"Play spin"})).toBeVisible();expect(await video.evaluate(v=>(v as HTMLVideoElement).paused)).toBe(true);
 await page.getByRole("button",{name:"Play spin"}).click();await expect(video).toHaveCSS("opacity","1");
 await page.locator("#footer").scrollIntoViewIfNeeded();await expect.poll(()=>video.evaluate(v=>(v as HTMLVideoElement).paused)).toBe(true);
 await trigger(page);await expect(video).toHaveCSS("opacity","1");
 await page.evaluate(()=>{Object.defineProperty(document,"visibilityState",{value:"hidden",configurable:true});document.dispatchEvent(new Event("visibilitychange"));});
 await expect.poll(()=>video.evaluate(v=>(v as HTMLVideoElement).paused)).toBe(true);
});

test("stalled playback keeps the photo and exposes no unusable control",async({page})=>{
 await page.addInitScript(()=>{HTMLMediaElement.prototype.play=()=>{Reflect.set(window,"motionPlayAttempted",true);return new Promise(()=>{});};});
 await page.goto("/");await trigger(page);
 await expect.poll(()=>page.evaluate(()=>Reflect.get(window,"motionPlayAttempted"))).toBe(true);
 await expect(page.locator("#hero img")).toBeVisible();await expect(page.getByRole("button",{name:"Pause spin"})).toHaveCount(0);
 await expect(page.locator("#hero video")).toHaveCount(0,{timeout:10000});
});

for (const stalledEvent of ["waiting", "stalled", "silent-freeze"] as const) test(`playing watchdog recovers from ${stalledEvent} despite repeated scroll`, async ({page}) => {
 await page.addInitScript(() => {
  HTMLMediaElement.prototype.play = function () { this.dispatchEvent(new Event("playing")); return Promise.resolve(); };
 });
 await page.goto("/", {waitUntil:"domcontentloaded"}); await trigger(page);
 await expect(page.getByRole("button", {name:"Pause spin"})).toBeVisible();
 await page.locator("#hero video").evaluate((video, event) => { if(event !== "silent-freeze") video.dispatchEvent(new Event(event)); }, stalledEvent);
 const scrolling = await page.evaluate(() => window.setInterval(() => window.dispatchEvent(new Event("scroll")), 100));
 try {
  await expect(page.locator("#hero video")).toHaveCount(0, {timeout:10000});
  await expect(page.locator("#hero img")).toBeVisible();
  await expect(page.getByRole("button", {name:"Pause spin"})).toHaveCount(0);
 } finally { await page.evaluate(id => clearInterval(id), scrolling); }
});
