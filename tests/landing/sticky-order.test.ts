import {describe,expect,it} from 'vitest';
import {blocksPill,createPillPolicy,IN_CONTENT_ORDER_SELECTOR,PILL_MIN_VISUAL_HEIGHT,PILL_SHOW_DWELL_MS,stickyPillVisible,type PillFacts} from '@/lib/landing/sticky-order-shared';

const clear:PillFacts={orderInView:false,consentShowing:false,pageHidden:false,visualHeight:844,sheetOpen:false};
describe('v4.2 Order pill: shows only where no other order control is on screen',()=>{
  it('is hidden by any in-content order surface, the consent notice, a hidden page or a short viewport',()=>{
    expect(stickyPillVisible(clear)).toBe(true);
    for(const patch of [{orderInView:true},{consentShowing:true},{pageHidden:true},{visualHeight:PILL_MIN_VISUAL_HEIGHT-1}])
      expect(stickyPillVisible({...clear,...patch}),JSON.stringify(patch)).toBe(false);
  });
  it('never pulls its trigger out from under its own open sheet',()=>{
    expect(stickyPillVisible({...clear,orderInView:true,consentShowing:true,sheetOpen:true})).toBe(true);
  });
  it('watches the hero, every in-content order surface and the footer',()=>{
    for(const selector of ['[data-hero-actions]','.landing-v3-plate','.landing-v4-crave-cta','[data-guide-cta]','.landing-v4-shop-order','.landing-v4-catering-act','footer'])
      expect(IN_CONTENT_ORDER_SELECTOR.split(', ')).toContain(selector);
  });
  it('a reserved Field Guide slot blocks only once its action is revealed',()=>{
    const el=(ready:string|null)=>({getAttribute:(name:string)=>name==='data-ready'?ready:null});
    expect(blocksPill(el('false'))).toBe(false);
    expect(blocksPill(el('true'))).toBe(true);
    expect(blocksPill(el(null))).toBe(true);
  });
});
describe('show dwell: hide at once, appear only after the screen stays clear',()=>{
  it('waits the dwell before showing, and restarts it after any hide',()=>{
    const policy=createPillPolicy();
    expect(policy.update(clear,0)).toEqual({visible:false,wait:PILL_SHOW_DWELL_MS});
    expect(policy.update(clear,PILL_SHOW_DWELL_MS-1)).toEqual({visible:false,wait:1});
    expect(policy.update(clear,PILL_SHOW_DWELL_MS).visible).toBe(true);
    expect(policy.update({...clear,orderInView:true},1000)).toEqual({visible:false,wait:null});
    expect(policy.update(clear,1001).visible).toBe(false);
    expect(policy.update(clear,1001+PILL_SHOW_DWELL_MS).visible).toBe(true);
  });
  it('an open sheet shows at once and stays',()=>{
    const policy=createPillPolicy();
    expect(policy.update({...clear,sheetOpen:true,orderInView:true},0).visible).toBe(true);
    expect(policy.update(clear,1).visible).toBe(true);
  });
});
