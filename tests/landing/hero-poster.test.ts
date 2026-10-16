import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Hero } from '@/components/landing/Hero';
import { loadLandingConfig } from '@/lib/landing/config';
import { heroMedia } from '@/lib/landing/media';
import inventory from '@/config/tenant/landing-assets.json';

vi.mock('@/components/landing/TrackingProvider', () => ({
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
    expect(images).toHaveLength(1);
    expect(preloads).toHaveLength(1);
    const img = images[0]!;
    const preload = preloads[0]!;
    const expectedSrcSet = [320, 640, 960].map(width => {
      const asset = inventory.find(entry => entry.id === `hero-poster-${width}`);
      expect(asset, `approved ${width}px derivative`).toBeDefined();
      return `${asset!.path} ${width}w`;
    }).join(', ');
    expect(attribute(img, 'srcSet')).toBe(expectedSrcSet);
    expect(attribute(preload, 'imageSrcSet')).toBe(expectedSrcSet);
    const sizes = '(min-width: 640px) 18.666667rem, min(calc(100vw - 5rem), 18.666667rem)';
    expect(attribute(img, 'sizes')).toBe(sizes);
    expect(attribute(preload, 'imageSizes')).toBe(sizes);
    expect(attribute(img, 'src')).toBe(heroMedia.poster);
    expect(attribute(img, 'width')).toBe('750');
    expect(attribute(img, 'height')).toBe('1125');
    expect(attribute(img, 'loading')).toBe('eager');
    expect(attribute(img, 'fetchPriority')).toBe('high');
    expect(attribute(preload, 'fetchPriority')).toBe('high');
    expect(attribute(img, 'alt')).toBeTruthy();
    expect(html).toMatch(/<h1\b[^>]*id="hero-title"[^>]*>[^<]+<\/h1>/);
    expect(html).not.toMatch(/<video\b|opacity-0|visibility:\s*hidden|animate-/);
  });
});
