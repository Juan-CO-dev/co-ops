import {test,expect} from '@playwright/test';
import {portBase} from '../../../scripts/landing/e2e-ports.cjs';

test('rendered page without footer orders keeps its rail hidden and inert through scroll',async({page})=>{
 await page.goto(`http://localhost:${portBase+5}/?__fixture_no_footer=1`);
 await expect(page.locator('.landing-v2')).toHaveAttribute('data-consent-flow',/^(true|false)$/);
 await expect(page.locator('footer .landing-v2-orders')).toHaveCount(0);
 const rail=page.locator('[data-sticky-order]');
 const states=await rail.evaluate(async element=>{
  await document.fonts.ready;
  const samples:{visible:string|undefined;inert:boolean;hidden:string|null;visibility:string}[]=[];
  const sample=()=>samples.push({visible:(element as HTMLElement).dataset.visible,inert:(element as HTMLElement).inert,hidden:element.getAttribute('aria-hidden'),visibility:getComputedStyle(element).visibility});
  const observer=new MutationObserver(sample);observer.observe(element,{attributes:true});
  try{
   sample();const max=document.documentElement.scrollHeight-innerHeight;
   for(const y of [400,1000,max/2,max,0]){
    scrollTo(0,y);await new Promise(resolve=>setTimeout(resolve,450));sample();
   }
  }finally{observer.disconnect();}
  return samples;
 });
 expect(states.length).toBeGreaterThan(5);
 for(const state of states)expect(state).toEqual({visible:'false',inert:true,hidden:'true',visibility:'hidden'});
 await expect(rail).toBeHidden();await expect(rail).toHaveAttribute('inert','');
});
