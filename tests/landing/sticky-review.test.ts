import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {STICKY_SHOW_CLEARANCE} from '@/lib/landing/sticky-order-shared';

const source=readFileSync('components/landing/StickyOrderBar.tsx','utf8');
const css=readFileSync('app/eat/landing-v2.css','utf8');
it('uses the policy clearance for observer margins and the released hero state',()=>{
  expect(STICKY_SHOW_CLEARANCE).toBe(120);
  expect(source).toMatch(/import\s*\{[^}]*STICKY_SHOW_CLEARANCE[^}]*\}\s*from ['"]@\/lib\/landing\/sticky-order-shared/);
  expect(source).toContain('rootMargin:`${STICKY_SHOW_CLEARANCE}px 0px 0px 0px`');
  expect(source).toContain('rootMargin:`${STICKY_SHOW_CLEARANCE}px 0px ${STICKY_SHOW_CLEARANCE}px 0px`');
  expect(source).toContain('heroClear?-(STICKY_SHOW_CLEARANCE + 1):-1');
  expect(source).toContain('heroClear=!entry.isIntersecting');
});
it('returns inert before constructing observers when the footer is missing',()=>{
  const guard=source.indexOf('if(!footer)return;');
  expect(guard).toBeGreaterThan(source.indexOf("const footer=root.querySelector"));
  expect(guard).toBeLessThan(source.indexOf('new IntersectionObserver'));
  expect(source).toContain('useState(false)');
  expect(source).toContain('inert={!visible} aria-hidden={!visible}');
});
it('connects expanded state to the actual heading',()=>{
  expect(source).toContain('id="landing-sticky-heading"');
  expect(source).toContain('aria-controls="landing-sticky-heading"');
});
it('keeps the hint stable across rail appearances',()=>{
  expect(source).not.toContain('setAppearance');
});
it('does not tie the consent bottom to rail visibility',()=>{
  const rules=css.match(/[^{}]*landing-v2-consent[^{}]*\{[^{}]*\}/g)??[];
  expect(rules.join('\n')).not.toContain('--landing-rail-height');
});
it('has one root padding declaration and one desktop consent placement',()=>{
  expect(css.match(/padding-bottom:/g)).toHaveLength(1);
  expect(css.match(/100svh - 52px - 740px/g)).toHaveLength(1);
});
it('puts the Spanish question marks around the question',()=>{
  const es=JSON.parse(readFileSync('lib/i18n/es.json','utf8'));
  expect(es['landing.sticky.hint1']).toBe('psst, ¿almorzamos?');
});
