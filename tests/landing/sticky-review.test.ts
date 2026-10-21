import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import en from '@/lib/i18n/en.json';
import es from '@/lib/i18n/es.json';

const source=readFileSync('components/landing/StickyOrderBar.tsx','utf8');
const shared=readFileSync('lib/landing/sticky-order-shared.ts','utf8');
const css=readFileSync('app/eat/landing-v2.css','utf8');
it('is one pill that opens the shop chooser at the sticky placement, not two shop buttons',()=>{
  expect(source).toContain('<OrderSheet eager');
  expect(source).toContain('placement="sticky"');
  expect(source).not.toContain('<OrderLink');
});
it('decides from observers and attributes only: no scroll listener, no layout reads, no storage',()=>{
  expect(source).toContain('new IntersectionObserver');
  expect(source).not.toMatch(/addEventListener\('scroll'/);
  expect(source).not.toContain('getBoundingClientRect');
  for(const text of [source,shared])expect(text).not.toMatch(/sessionStorage|localStorage|landing_order_minimized/);
});
it('hides only the pill, never its sheet (visibility and pointer-events are inherited)',()=>{
  expect(css).toContain('.landing-v2 .landing-v2-sticky[data-visible="false"] .landing-v42-pill');
  expect(css).toContain('.landing-v2 .landing-v2-sticky dialog { pointer-events: auto; }');
  expect(css).not.toMatch(/\.landing-v2-sticky\[data-visible="false"\]\s*\{/);
});
it('reserves no rail: one root padding declaration, no rail variables',()=>{
  expect(css.match(/padding-bottom:/g)).toHaveLength(1);
  expect(css).not.toMatch(/--landing-(header-)?rail-(height|bottom)/);
  expect(css.match(/100svh - 52px - 740px/g)).toHaveLength(1);
});
it('removes the old bar strings in both languages together and adds the pill label',()=>{
  for(const dictionary of [en,es] as Record<string,string>[]){
    for(const key of ['landing.sticky.name','landing.sticky.hint1','landing.sticky.minimize','landing.sticky.restore'])expect(dictionary[key],key).toBeUndefined();
    expect(dictionary['landing.sticky.order']).toBeTruthy();
  }
  expect(en['landing.sticky.order']).toBe('Order');
  expect(es['landing.sticky.order']).toBe('Pide');
});
