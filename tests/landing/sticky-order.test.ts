import {describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {blocksPill,createPillPolicy,PILL_COMPACT_MAX_HEIGHT,PILL_SHOW_DWELL_MS,registerOrderControl,STATIC_ORDER_CONTROL_SELECTOR,stickyPillVisible,subscribeOrderControls,USABLE_RATIO,usableRatio,type PillFacts} from '@/lib/landing/sticky-order-shared';

const clear:PillFacts={orderInView:false,consentShowing:false,pageHidden:false,sheetOpen:false};
describe('v4.2 Order pill: shows only where no other order control is usable on screen',()=>{
  it('is hidden by a usable order control, the consent notice or a hidden page — never by viewport height',()=>{
    expect(stickyPillVisible(clear)).toBe(true);
    for(const patch of [{orderInView:true},{consentShowing:true},{pageHidden:true}])
      expect(stickyPillVisible({...clear,...patch}),JSON.stringify(patch)).toBe(false);
    expect(Object.keys(clear)).not.toContain('visualHeight');
  });
  it('never pulls its trigger out from under its own open sheet',()=>{
    expect(stickyPillVisible({...clear,orderInView:true,consentShowing:true,sheetOpen:true})).toBe(true);
  });
  it('watches the order controls themselves, never their cards or sections',()=>{
    const selectors=STATIC_ORDER_CONTROL_SELECTOR.split(', ');
    for(const selector of ['[data-hero-actions] [data-landing-placement]','[data-guide-cta]','#shops [data-landing-placement]','.landing-v4-catering-act [data-landing-placement]','footer [data-landing-placement]'])
      expect(selectors).toContain(selector);
    // v4.2's whole-container targets are gone: a card heading or ingredients on screen is not a way to order.
    for(const container of ['[data-hero-actions]','.landing-v3-plate','.landing-v4-crave-cta','.landing-v4-catering-act','footer'])
      expect(selectors).not.toContain(container);
    // The sheet triggers register their current element (links, then the button).
    const sheet=readFileSync('components/landing/OrderSheet.tsx','utf8');
    expect(sheet).toContain('registerOrderControl(element)');
    expect(sheet.match(/data-order-control/g)).toHaveLength(2);
  });
  it('a control counts once half of it is on screen',()=>{
    expect(USABLE_RATIO).toBe(.5);
    expect(usableRatio(.49)).toBe(false);
    expect(usableRatio(.5)).toBe(true);
  });
  it('a reserved Field Guide slot blocks only once its action is revealed',()=>{
    const el=(ready:string|null)=>({getAttribute:(name:string)=>name==='data-ready'?ready:null});
    expect(blocksPill(el('false'))).toBe(false);
    expect(blocksPill(el('true'))).toBe(true);
    expect(blocksPill(el(null))).toBe(true);
  });
  it('short and landscape viewports keep a compact pill (CSS at the same boundary)',()=>{
    const css=readFileSync('app/eat/landing-v2.css','utf8');
    expect(css).toContain(`@media (max-height: ${PILL_COMPACT_MAX_HEIGHT}px) {\n  .landing-v2 .landing-v2-sticky { right: 8px;`);
    expect(css).toMatch(/@media \(max-height: 499px\) \{[^}]*\}\s*\.landing-v2 \.landing-v42-pill \{ min-height: 44px;/);
  });
});
describe('order-control registry',()=>{
  it('replays current controls to a new subscriber and reports swaps',()=>{
    const a={id:'a'} as unknown as Element,b={id:'b'} as unknown as Element;
    const offA=registerOrderControl(a);
    const listener=vi.fn();
    const unsubscribe=subscribeOrderControls(listener);
    expect(listener).toHaveBeenCalledWith(a,true);
    offA();expect(listener).toHaveBeenCalledWith(a,false);
    const offB=registerOrderControl(b);expect(listener).toHaveBeenCalledWith(b,true);
    unsubscribe();offB();
    expect(listener).not.toHaveBeenCalledWith(b,false);
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
