import { textureMedia } from '@/lib/landing/media';
import cateringProvenance from '../../assets/provenance/v2-l118-720.json';
import boxProvenance from '../../assets/provenance/v2-l082-480.json';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Shops } from '@/components/landing/Shops';
import { Footer } from '@/components/landing/Footer';
import { Catering } from '@/components/landing/Catering';
import landingMap from '@/config/tenant/landing-map.json';
import { loadLandingConfig } from '@/lib/landing/config';
import { projectLandingStores } from '@/lib/landing/stores';

const config=loadLandingConfig({STAFF_ORIGIN:'https://staff.example.test'});
const stores=projectLandingStores([{code:'MEP',name:'Public shop',address:'Test public address',phone:'202-555-0100'}],config);
describe('remaining landing sections',()=>{
  it('shows the qualified Uber Eats destination only with the loaded Dupont shop',()=>{
    const all=projectLandingStores([{code:'MEP',name:'',address:null,phone:null},{code:'EM',name:'',address:null,phone:null}],config);
    for(const language of ['en','es'] as const) {
      const html=renderToStaticMarkup(createElement(Shops,{stores:all,language}));
      expect(html.match(/ubereats\.com/g)).toHaveLength(1);
      expect(html).toContain('Uber Eats (Dupont)');
      expect(renderToStaticMarkup(createElement(Shops,{stores,language}))).not.toContain('ubereats.com');
      expect(renderToStaticMarkup(createElement(Footer,{config,stores:all,language}))).not.toContain('ubereats.com');
    }
  });
  it('renders the self-hosted street map with a pin per shop and never a visitor dot on the server',()=>{
    const all=projectLandingStores([{code:'MEP',name:'',address:null,phone:null},{code:'EM',name:'',address:null,phone:null}],config);
    const html=renderToStaticMarkup(createElement(Shops,{stores:all,language:'en'}));
    expect(html).toContain(`src="${landingMap.image}"`);
    expect(html.match(/data-map-pin="/g)).toHaveLength(2);
    expect(html).not.toContain('data-map-you');
    expect(html).toContain('openstreetmap.org/copyright');
    expect(html).not.toMatch(/tile\.openstreetmap|maps\.googleapis|api\.mapbox|maplibre/);
    const invalid=all.map(store=>({...store,coordinates:null}));
    expect(renderToStaticMarkup(createElement(Shops,{stores:invalid,language:'en'})).match(/data-map-pin="/g)).toBeNull();
  });
  it('renders verified hours and formatted selectable phone text without fabricated distances',()=>{
    const html=renderToStaticMarkup(createElement(Shops,{stores,language:'en'}));
    expect(html).toContain('526 8th St SE Ste A'); expect(html).toContain('(202) 621-8645');
    expect(html).toContain('Daily 10:30am');
    expect(html).toContain('tel:+12026218645'); expect(html).toContain('appfront.app');
    expect(html).not.toContain('walking'); expect(html).not.toContain('Find my nearest');
  });
  it('retains Toast and inquiry destinations with translated buttons',()=>{
    const html=renderToStaticMarkup(createElement(Catering,{config,language:'es'}));
    expect(config.cateringPortalLive).toBe(false);
    expect(html).toContain(config.cateringUrl); expect(html).toContain(config.inquiryUrl);
    expect(html).not.toContain('<form');
    // v3: two distinct approved real photos (spread + box inset) and one decorative sprite.
    expect(html.match(/<img /g)).toHaveLength(3);
    expect(html.match(/<img [^>]*alt=""/g)).toHaveLength(1);
    expect(html).toContain(`src="${textureMedia.catering.src}"`);
    expect(html).toContain(`srcSet="${textureMedia.catering.srcSet}"`);
    expect(html).toContain('width="720" height="1080"');
    expect(html).toContain(`src="${textureMedia.cateringBox.src}"`);
    expect(textureMedia.catering.src).not.toBe(textureMedia.crossSection.src);
    expect(cateringProvenance).toMatchObject({sourceId:'L118',publicPath:textureMedia.catering.src,classification:'real-photo',mode:'resize-only'});
    expect(boxProvenance).toMatchObject({sourceId:'L082',publicPath:textureMedia.cateringBox.src,classification:'real-photo',mode:'resize-only'});
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('<noscript>');
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
