import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Shops } from '@/components/landing/Shops';
import { Footer } from '@/components/landing/Footer';
import { Catering } from '@/components/landing/Catering';
import { loadLandingConfig } from '@/lib/landing/config';
import { projectLandingStores } from '@/lib/landing/stores';

const config=loadLandingConfig({STAFF_ORIGIN:'https://staff.example.test'});
const stores=projectLandingStores([{code:'MEP',name:'Public shop',address:'Test public address',phone:'202-555-0100'}],config);
describe('remaining landing sections',()=>{
  it('renders only supplied shop facts, phone as selectable text, no fabricated hours or distances',()=>{
    const html=renderToStaticMarkup(createElement(Shops,{stores,language:'en'}));
    expect(html).toContain('526 8th St SE Ste A'); expect(html).toContain('+12026218645');
    expect(html).toContain('tel:+12026218645'); expect(html).toContain('appfront.app');
    expect(html).not.toContain('walking'); expect(html).not.toContain('Find my nearest');
  });
  it('retains Toast and inquiry destinations with translated buttons',()=>{
    const html=renderToStaticMarkup(createElement(Catering,{config,language:'es'}));
    expect(config.cateringPortalLive).toBe(false);
    expect(html).toContain(config.cateringUrl); expect(html).toContain(config.inquiryUrl);
    expect(html).not.toContain('<form'); expect(html).not.toContain('<img');
    expect(html).not.toContain('Start a catering order');
  });
  it('omits missing footer destinations and repeats only loaded addresses',()=>{
    const html=renderToStaticMarkup(createElement(Footer,{config,stores,language:'en'}));
    expect(html).toContain('526 8th St SE Ste A'); expect(html).toContain('/privacy?lang=en');
    expect(html).toContain('DoorDash'); expect(html).not.toContain('Gift cards');
  });
  it('puts configured delivery links last and retains native non-order links',()=>{
    const html=renderToStaticMarkup(createElement(Footer,{config:{...config,footerLinks:[{key:'doordash',url:'https://example.test/delivery'},{key:'gift-cards',url:'https://example.test/gifts'},{key:'instagram',url:'https://example.test/social'}]},stores,language:'en'}));
    expect(html.indexOf('https://example.test/delivery')).toBeGreaterThan(html.indexOf('https://example.test/social'));
    expect(html).toContain('referrerPolicy="origin"'); expect(html).toContain('rel="noopener"');
  });
});
