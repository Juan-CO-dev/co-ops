import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import roster from '@/config/tenant/landing-products.json';
import { products, validateProducts } from '@/lib/landing/products';
import { LineupPhoto } from '@/components/landing/LineupPhoto';
import { CARD_VISIBLE, focalPosition, STAGE_VISIBLE } from '@/lib/landing/fighter-select-shared';
import { foundCount, GUIDE_STEP_AT, GUIDE_STEP_BAND, guideStepRootMargin, nextUnfound, stepReached, stepTarget } from '@/lib/landing/field-guide-shared';

const css = readFileSync('app/eat/landing-v2.css', 'utf8');
// Mirrors the CSS: a cover crop showing `visible` of the 2:3 photo's height at object-position p.
const crop = (focusY: number, visible: number) => {
  const p = focalPosition(focusY, visible) / 100;
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
      expect(html, product.id).toContain(`--focal-stage:${focalPosition(product.focusY, STAGE_VISIBLE)}%`);
      expect(html, product.id).toContain(`--focal-card:${focalPosition(product.focusY, CARD_VISIBLE)}%`);
      expect(html, product.id).toContain(`data-focal-y="${product.focusY}"`);
    }
    // Plain percentages, no calc()/clamp() over a custom property: WebKit resolved that to the top edge.
    expect(css).toContain('.landing-v3-stage-media [data-landing-photo] img { object-position: 50% var(--focal-stage, 50%); }');
    expect(css).toContain('.landing-v3-roster button img { object-position: 50% var(--focal-card, 50%); }');
    expect(focalPosition(0.68, STAGE_VISIBLE)).toBe(86);
    expect(focalPosition(0.68, CARD_VISIBLE)).toBe(100);
    expect(focalPosition(0.2, STAGE_VISIBLE)).toBe(0);
    expect(focalPosition(Number.NaN, STAGE_VISIBLE)).toBe(50);
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
  // Laptop polish (Juan 2026-11-13): four ingredients sit in the photo's top quarter, so finds tied
  // to the photo's visibility bunched at the top and a laptop scroll skipped them. Finds are now
  // paced EVENLY along a pinned runway, one step marker per word.
  it('paces the six finds evenly along the runway, leaving room for the order action', () => {
    expect(GUIDE_STEP_AT).toHaveLength(6);
    const gaps = GUIDE_STEP_AT.slice(1).map((at, index) => at - GUIDE_STEP_AT[index]!);
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0]!, 10);
    expect(GUIDE_STEP_AT[0]).toBeGreaterThan(0);
    expect(GUIDE_STEP_AT[5]).toBeLessThanOrEqual(0.8);
  });
  it('builds the top-tenth trigger band in pixels of the viewport height (never a percentage)', () => {
    expect(GUIDE_STEP_BAND).toBe(0.1);
    expect(guideStepRootMargin(768)).toBe('0px 0px -691px 0px');
    expect(guideStepRootMargin(844)).toBe('0px 0px -760px 0px');
    expect(guideStepRootMargin(730)).toBe('0px 0px -657px 0px');
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(guideStepRootMargin(bad)).toBe('0px 0px -0px 0px');
    expect(guideStepRootMargin(900)).not.toMatch(/%/);
  });
  it('a reached marker makes its words due, forward only', () => {
    expect(stepReached(true, 400)).toBe(true);
    expect(stepReached(false, 400)).toBe(false);
    // First report after a reload or a jump: the whole marker is already above the viewport.
    expect(stepReached(false, -1)).toBe(true);
    expect(stepReached(false, 0)).toBe(false);
    for (const bad of [Number.NaN, Number.NEGATIVE_INFINITY]) expect(stepReached(false, bad)).toBe(false);
    expect(stepTarget(0, 0, true, 6)).toBe(1);
    expect(stepTarget(1, 3, true, 6)).toBe(4);
    expect(stepTarget(4, 1, true, 6)).toBe(4);
    expect(stepTarget(4, 5, false, 6)).toBe(4);
    expect(stepTarget(2, 9, true, 6)).toBe(6);
    expect(stepTarget(2, -1, true, 6)).toBe(2);
  });
  it('finds the first unfound word next, so a tapped word is never found twice', () => {
    expect(nextUnfound(0, 6)).toBe(0);
    expect(nextUnfound(0b000001, 6)).toBe(1);
    expect(nextUnfound(0b000101, 6)).toBe(1);
    expect(nextUnfound(0b111111, 6)).toBe(-1);
    expect(foundCount(0b101101, 6)).toBe(4);
  });
  it('uses one observer on the step markers: no scroll listener, no per-frame layout reads', () => {
    const source = readFileSync('components/landing/FieldGuideFigure.tsx', 'utf8');
    expect(source).toContain('rootMargin:guideStepRootMargin(bandHeight)');
    expect(source.match(/new IntersectionObserver/g)).toHaveLength(1);
    // Rebuilt only when the viewport height changes (debounced), never per scroll.
    expect(source).toContain("window.addEventListener('resize',viewportChanged)");
    expect(source).toContain("window.removeEventListener('resize',viewportChanged)");
    // The CSS places the markers with the same top-tenth band the observer uses.
    expect(css).toContain('top: calc(10svh - 16px + var(--guide-step, 0) * var(--guide-runway));');
    expect(source).not.toMatch(/addEventListener\(\s*['"]scroll/);
    expect(source).not.toMatch(/requestAnimationFrame|getBoundingClientRect\(\)\.top/);
  });
});
