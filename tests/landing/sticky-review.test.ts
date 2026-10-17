import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';

const source=readFileSync('components/landing/StickyOrderBar.tsx','utf8');
const css=readFileSync('app/eat/landing-v2.css','utf8');
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
