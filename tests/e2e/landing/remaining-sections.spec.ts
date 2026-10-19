import {test,expect} from '@playwright/test';
import {landingTenantConfig} from '../../../config/tenant/landing';
import {textureMedia} from '../../../lib/landing/media';

test('remaining sections keep facts, destinations and translation honest',async({page})=>{
  const photoPaths=new Set([textureMedia.catering.src,...textureMedia.catering.srcSet.split(', ').map(candidate=>candidate.split(' ')[0])]);
  const photoRequests:string[]=[];
  page.on('request',request=>{if(photoPaths.has(new URL(request.url()).pathname))photoRequests.push(request.url());});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/?lang=es',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#catering a').first()).toHaveAttribute('href',landingTenantConfig.cateringUrl);
  await expect(page.locator('#catering a').nth(1)).toHaveAttribute('href',landingTenantConfig.inquiryUrl);
  // The catering photo URL attaches only when the section nears the viewport.
  expect(photoRequests).toEqual([]);
  await expect(page.locator('#catering img')).toHaveCount(0);
  await expect(page.locator('#catering form')).toHaveCount(0);
  await page.locator('#catering').scrollIntoViewIfNeeded();
  await expect(page.locator('#catering [data-landing-photo] img')).toBeVisible();
  await expect.poll(()=>photoRequests.length).toBeGreaterThan(0);
  await expect(page.locator('#catering [data-landing-photo] img')).toHaveAttribute('src',textureMedia.catering.src);
  await expect(page.locator('#footer')).toContainText('526 8th St SE Ste A');
  const footerDestinations=landingTenantConfig.footerLinks.filter(link=>link.key!=='uber-eats').map(link=>link.url).sort();
  expect((await page.locator('#footer nav a').evaluateAll(links=>links.map(link=>link.getAttribute('href')))).sort()).toEqual(footerDestinations);
  const uber=landingTenantConfig.footerLinks.find(link=>link.key==='uber-eats')!;
  await expect(page.locator('#shops a[href="'+uber.url+'"]')).toHaveCount(1);
  await expect(page.locator('[data-shop="dupont"] a[href="'+uber.url+'"]')).toBeVisible();
  await expect(page.locator('#footer a[href="'+uber.url+'"]')).toHaveCount(0);
  await expect(page.locator('#footer a[href^="/privacy"]')).toHaveAttribute('href','/privacy?lang=es');
});
