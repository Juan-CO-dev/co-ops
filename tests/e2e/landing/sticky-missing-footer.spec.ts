import {test,expect} from '@playwright/test';
import {portBase} from '../../../scripts/landing/e2e-ports.cjs';

// v4.2: the pill does not depend on the footer. A page without footer orders still shows it
// between order surfaces once consent is answered, and keeps it away while the notice shows.
test('rendered page without footer orders keeps the pill working through scroll',async({page,context})=>{
 const origin=`http://localhost:${portBase+5}`;
 await page.goto(`${origin}/?__fixture_no_footer=1`);
 await expect(page.locator('footer .landing-v2-orders')).toHaveCount(0);
 const pill=page.locator('[data-sticky-order] .landing-v42-pill');
 const max=await page.evaluate(()=>document.documentElement.scrollHeight-innerHeight);
 for(const y of [400,1000,max/2,max]){await page.evaluate(v=>scrollTo(0,v),y);await page.waitForTimeout(450);await expect(pill).toBeHidden();}
 await context.addCookies([{name:'landing_consent',value:'rejected',url:origin}]);
 await page.goto(`${origin}/?__fixture_no_footer=1`);
 await expect(page.locator('.landing-v2-consent')).toBeHidden();
 let shown=false;
 for(let y=900;y<=max&&!shown;y+=200){await page.evaluate(v=>scrollTo(0,v),y);await page.waitForTimeout(450);shown=await pill.isVisible();}
 expect(shown).toBe(true);
});
