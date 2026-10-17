import { ConsentNotice } from "@/components/landing/ConsentNotice";
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Hero } from '@/components/landing/Hero';
import { CateringLink } from '@/components/landing/CateringLink';
import { serverT } from '@/lib/i18n/server';
import { loadLandingConfig } from '@/lib/landing/config';
import { heroMedia } from '@/lib/landing/media';
import inventory from '@/config/tenant/landing-assets.json';

vi.mock('@/components/landing/TrackingProvider', () => ({
  LandingConsentSlot: () => null,
  useLandingTracking: () => ({ dispatch: vi.fn(), sectionView: vi.fn(), allowed: false }),
}));

function attribute(tag: string, name: string) {
  return new RegExp(`\\s${name}="([^"]*)"`, 'i').exec(tag)?.[1];
}

describe('server-rendered hero poster', () => {
  for (const language of ['en', 'es'] as const) it(`shares responsive preload and image candidates in ${language}`, () => {
    const html = renderToStaticMarkup(createElement(Hero, { language, config: loadLandingConfig({}), ad: 'unattributed' }));
    const images = html.match(/<img\b[^>]*>/g) ?? [];
    const preloads = (html.match(/<link\b[^>]*>/g) ?? []).filter(tag => attribute(tag, 'rel') === 'preload' && attribute(tag, 'as') === 'image');
    expect(html).toContain('landing-v2-hero-copy');
    expect(html).toContain('id="landing-consent-slot"');
    expect(html).toContain('data-hero-actions');
    // The same first-screen catering action now lives in the header.
    const catering = renderToStaticMarkup(createElement(CateringLink, {config:loadLandingConfig({}),language}));
    expect(catering).toContain(loadLandingConfig({}).cateringUrl.replaceAll('&', '&amp;'));
    expect(catering).toContain(serverT(language,'landing.catering.short'));
    expect(images).toHaveLength(1);
    expect(preloads).toHaveLength(1);
    const img = images[0]!;
    const preload = preloads[0]!;
    const expectedSrcSet = [320, 480, 640, 960, 1280].map(width => {
      const asset = inventory.find(entry => entry.id === `v2-p013-${width}`);
      expect(asset, `approved ${width}px derivative`).toBeDefined();
      return `${asset!.path} ${width}w`;
    }).join(', ');
    expect(attribute(img, 'srcSet')).toBe(expectedSrcSet);
    expect(attribute(preload, 'imageSrcSet')).toBe(expectedSrcSet);
    const sizes = '(min-width: 768px) 50vw, 100vw';
    expect(attribute(img, 'sizes')).toBe(sizes);
    expect(attribute(preload, 'imageSizes')).toBe(sizes);
    expect(attribute(img, 'src')).toBe(heroMedia.poster);
    expect(attribute(img, 'width')).toBe('960');
    expect(attribute(img, 'height')).toBe('1440');
    expect(attribute(img, 'loading')).toBe('eager');
    expect(attribute(img, 'fetchPriority')).toBe('high');
    expect(attribute(preload, 'fetchPriority')).toBe('high');
    expect(attribute(img, 'alt')).toBeTruthy();
    const lines=serverT(language,'landing.hero.title').split('\n');
    expect(lines).toHaveLength(2);
    expect(html).toContain(`<h1 id="hero-title"><span>${lines[0]}</span><span>\n${lines[1]}</span></h1>`);
    expect(html).toContain(serverT(language,'landing.hero.eyebrow'));
    expect(html).toContain(serverT(language,'landing.hero.body'));
    expect(html).toContain(serverT(language,'landing.hero.foot'));
    expect(html).not.toMatch(/<video\b|opacity-0|visibility:\s*hidden|animate-/);
  });
});

 it('server-renders the ordinary consent dock without a hydration layout jump',()=>{
   const html=renderToStaticMarkup(createElement(ConsentNotice,{choice:'unknown',labels:{notice:'Notice',accept:'Accept',reject:'Reject',settings:'Settings',withdraw:'Withdraw',privacy:'Privacy'},onChoose:()=>{}}));
   expect(html).toContain('data-flow="false"');
 });
