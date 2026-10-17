import { portBase } from '../../../scripts/landing/e2e-ports.cjs';
import { test, expect } from "@playwright/test";
test("real poster and native ordering anchors are reserved in SSR without JS",async({browser,baseURL})=>{
 const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:375,height:812}});const page=await context.newPage();
 const media:string[]=[];page.on("request",r=>{if(/mp4|webm|_next\/image/.test(r.url()))media.push(r.url());});
 await page.goto(baseURL!);const hero=page.locator("#hero");const poster=hero.getByRole("img",{name:"Crunchy Boi sub"});
 await expect(poster).toHaveAttribute("width","960");await expect(poster).toHaveAttribute("height","1440");
 await expect(hero.getByRole("link",{name:"Order Capitol Hill"})).toHaveAttribute("href",/appfront/);
 await expect(hero.getByRole("link",{name:"Order Dupont"})).toHaveAttribute("href",/appfront/);
 expect(await poster.getAttribute("src")).not.toContain("/_next/image");expect(media).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(375);
 await page.screenshot({path:test.info().outputPath("hero-375.png"),fullPage:true});await context.close();
});
test("hero has no initial motion request and uses its own bilingual metadata",async({page})=>{
 const media:string[]=[];page.on("request",r=>{if(/\.(mp4|webm)/.test(r.url()))media.push(r.url());});
 await page.goto("/");await expect(page.locator("#hero img")).toBeVisible();expect(await page.locator("#hero img").getAttribute("src")).not.toContain("/_next/image");expect(media).toEqual([]);
 for(const language of ["en","es"]){await page.goto(`/?lang=${language}`);await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href",`https://localhost:${portBase}/?lang=${language}`);expect(await page.title()).not.toContain("Operations Platform");const description=await page.locator('meta[name="description"]').getAttribute("content");expect(description).toBeTruthy();await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content",description!);}
});
