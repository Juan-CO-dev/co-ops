import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import roster from '@/config/tenant/landing-products.json';
import { products, validateProducts } from '@/lib/landing/products';
import { LineupPhoto } from '@/components/landing/LineupPhoto';
import { foundCount, GUIDE_SCROLL_THRESHOLDS, nextUnfound, scrollFoundTarget } from '@/lib/landing/field-guide-shared';

const css = readFileSync('app/eat/landing-v2.css', 'utf8');
// Mirrors the CSS: a cover crop showing `visible` of the 2:3 photo's height at object-position p.
const crop = (focusY: number, visible: number) => {
  const p = Math.min(1, Math.max(0, (focusY - visible / 2) / (1 - visible)));
  return { top: p * (1 - visible), bottom: p * (1 - visible) + visible };
};

describe('v4.1: every fighter photo is framed on its own sub', () => {
  it('pins a focal point for EVERY roster item (none left at the default)', () => {
    expect(roster).toHaveLength(10);
    for (const item of roster) {
      expect(Object.hasOwn(item, 'focusY'), item.id).toBe(true);
      expect(Number.isFinite(item.focusY), item.id).toBe(true);
      expect(item.focusY, item.id).toBeGreaterThan(0);
      expect(item.focusY, item.id).toBeLessThan(1);
    }
    // Real values, read off each photo: no item sits on the old centre default.
    expect(roster.filter(item => item.focusY === 0.5).map(item => item.id)).toEqual([]);
  });
  it('fails closed on a missing or altered focal point', () => {
    const product = products[0]!;
    expect(() => validateProducts([{ ...product, focusY: Number.NaN }])).toThrow();
    expect(() => validateProducts([{ ...product, focusY: product.focusY + 0.01 }])).toThrow();
    expect(() => validateProducts(products)).not.toThrow();
  });
  it('renders the focal point on the photo wrapper and both crops read it', () => {
    for (const product of products) {
      const html = renderToStaticMarkup(createElement(LineupPhoto, { src: product.image, small: product.smallImage, width: product.width, height: product.height, alt: '', focusY: product.focusY }));
      expect(html, product.id).toContain(`--focal-y:${product.focusY}`);
      expect(html, product.id).toContain(`data-focal-y="${product.focusY}"`);
    }
    expect(css).toContain('.landing-v3-stage-media [data-landing-photo] img { object-position: 50% clamp(0%, calc(var(--focal-y, .5) * 200% - 50%), 100%); }');
    expect(css).toContain('.landing-v3-roster button img { object-position: 50% clamp(0%, calc(var(--focal-y, .5) * 300% - 100%), 100%); }');
  });
  it('each crop (4:3 stage, 1:1 card) keeps the sub centre well inside the frame', () => {
    for (const item of roster) {
      for (const visible of [0.5, 2 / 3]) {
        const window = crop(item.focusY, visible);
        expect(item.focusY - window.top, `${item.id} ${visible}`).toBeGreaterThanOrEqual(visible * 0.3);
        expect(window.bottom - item.focusY, `${item.id} ${visible}`).toBeGreaterThanOrEqual(Math.min(visible * 0.3, 1 - item.focusY));
      }
    }
  });
});

describe('v4.1: scroll-driven Field Guide progress', () => {
  it('maps photo visibility to a target, all six once fully in view or scrolled past', () => {
    expect(scrollFoundTarget(0, 600, 6)).toBe(0);
    expect(scrollFoundTarget(1 / 12, 500, 6)).toBe(0);
    expect(scrollFoundTarget(2 / 12, 480, 6)).toBe(1);
    expect(scrollFoundTarget(0.5, 300, 6)).toBe(3);
    expect(scrollFoundTarget(11 / 12, 40, 6)).toBe(6);
    expect(scrollFoundTarget(1, 120, 6)).toBe(6);
    expect(scrollFoundTarget(0.4, -10, 6)).toBe(6);
    expect(scrollFoundTarget(0, -900, 6)).toBe(6);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) expect(scrollFoundTarget(bad, 0, 6)).toBe(0);
    // Monotonic in visibility while entering from below.
    let previous = 0;
    for (const ratio of GUIDE_SCROLL_THRESHOLDS) { const next = scrollFoundTarget(ratio, 100, 6); expect(next).toBeGreaterThanOrEqual(previous); previous = next; }
    expect(previous).toBe(6);
  });
  it('finds the first unfound word next, so a tapped word is never found twice', () => {
    expect(nextUnfound(0, 6)).toBe(0);
    expect(nextUnfound(0b000001, 6)).toBe(1);
    expect(nextUnfound(0b000101, 6)).toBe(1);
    expect(nextUnfound(0b111111, 6)).toBe(-1);
    expect(foundCount(0b101101, 6)).toBe(4);
  });
  it('uses one observer with stepped thresholds: no scroll listener, no timers on first paint', () => {
    const source = readFileSync('components/landing/FieldGuideFigure.tsx', 'utf8');
    expect(source).toContain('threshold:GUIDE_SCROLL_THRESHOLDS');
    expect(source).not.toMatch(/addEventListener\(\s*['"]scroll/);
    expect(source).not.toMatch(/requestAnimationFrame|getBoundingClientRect\(\)\.top/);
  });
});
