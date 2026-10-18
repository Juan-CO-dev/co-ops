import { heroMedia } from '../../../lib/landing/media';
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const proof = JSON.parse(readFileSync(resolve('assets/verification/hero/provenance.json'),'utf8')) as {entry:{sha256:string};fixtureFiles:{path:string;sha256:string}[]};

// Private controls are fulfilled only inside this test; never copied to public/.
for (const subject of ['spin','control']) for (const color of ['yellow','ink']) {
  test(`decoder proof at 375px: ${subject} on ${color}`, async ({page,browserName}, testInfo) => {
    test.skip(browserName === 'webkit' && process.platform !== 'darwin', 'Playwright WebKit lacks H.264 decoding on this platform; real-iPhone Safari preview check required.');
    const videoPath = subject === 'spin' && color === 'yellow'
      ? 'public' + heroMedia.spin : `assets/verification/hero/${subject}-${color}.mp4`;
    const referencePath = `assets/verification/hero/${subject}-${color}-reference.png`;
    for(const path of [videoPath,referencePath]) {
      const expected=path.startsWith('public/')?proof.entry.sha256:proof.fixtureFiles.find(file=>file.path===path)?.sha256;
      expect(createHash('sha256').update(readFileSync(resolve(path))).digest('hex')).toBe(expected);
    }
    await page.route('http://media-proof.invalid/**', async route => {
      const video = route.request().url().endsWith('.mp4');
      await route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:video?'video/mp4':'image/png',body:readFileSync(resolve(video?videoPath:referencePath))});
    });
    await page.setViewportSize({width:375,height:812});
    await page.setContent('<style>body{margin:0}video,img{display:block;width:375px;height:375px}</style><video crossorigin="anonymous" muted playsinline preload="auto" src="http://media-proof.invalid/export.mp4"></video><img crossorigin="anonymous" src="http://media-proof.invalid/reference.png" alt="Decoder reference">');
    await expect.poll(() => page.locator('video').evaluate((video:HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
    await expect.poll(() => page.locator('video').evaluate((video:HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(0);
    await expect.poll(() => page.locator('img').evaluate((image:HTMLImageElement) => image.complete && image.naturalWidth>0)).toBe(true);
    const difference = await page.evaluate(() => {
      const video=document.querySelector('video')!;
      const image=document.querySelector('img')!;
      function pixels(source:CanvasImageSource) {
        const canvas=document.createElement('canvas');canvas.width=375;canvas.height=375;
        const context=canvas.getContext('2d')!;context.drawImage(source,0,0,375,375);
        return context.getImageData(0,0,375,375).data;
      }
      const actual=pixels(video), reference=pixels(image);
      let sum=0;
      for(let i=0;i<actual.length;i++) if(i%4!==3) sum+=Math.abs(actual[i]!-reference[i]!);
      return {mean:sum/(375*375*3),corner:Array.from(actual.slice(0,3)),referenceCorner:Array.from(reference.slice(0,3))};
    });
    // H.264 is lossy and yuv420p subsamples chroma. Mean RGB error <=8/255
    // allows encoding noise while a black alpha rectangle fails by a wide margin.
    expect(difference.mean).toBeLessThanOrEqual(8);
    for(let channel=0;channel<3;channel++) expect(Math.abs(difference.corner[channel]!-difference.referenceCorner[channel]!)).toBeLessThanOrEqual(5);
    // Preserve the first-frame pixel comparison above, then prove native motion.
    const initial=await page.locator('video').evaluate(async(video:HTMLVideoElement)=>{const time=video.currentTime;await video.play();return time;});
    await expect.poll(()=>page.locator('video').evaluate((video:HTMLVideoElement)=>video.currentTime)).toBeGreaterThan(initial);
    await page.locator('video').evaluate((video:HTMLVideoElement)=>video.pause());
    await testInfo.attach('decoder-difference',{body:JSON.stringify(difference),contentType:'application/json'});
    await page.screenshot({path:testInfo.outputPath(`${subject}-${color}-375.png`),fullPage:true});
  });
}
