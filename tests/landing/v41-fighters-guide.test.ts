import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import roster from '@/config/tenant/landing-products.json';
import { products, validateProducts } from '@/lib/landing/products';
import { LineupPhoto } from '@/components/landing/LineupPhoto';
import { CARD_VISIBLE, focalPosition, STAGE_VISIBLE } from '@/lib/landing/fighter-select-shared';
import { findsNow, findsSettled, foundCount, GUIDE_FLUSH_AT, GUIDE_RUNWAY_SCREENS, GUIDE_STEP_AT, GUIDE_STEP_BAND, GUIDE_WORDS_ABOVE, guideStepRootMargin, leaderPath, leaderStart, nextUnfound, stepReached, stepTarget } from '@/lib/landing/field-guide-shared';
import { fieldGuideAnchors } from '@/lib/landing/crave-motion-shared';

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
  // Laptop polish (Juan 2026-11-13): "the pointers don't all deploy before someone even gets to the
  // full field guide photo" and "the last pointers are pointing once the full picture is in the
  // screen". The guide pins while the reader scrolls a runway; the six finds are paced evenly along
  // it, all of them inside the pinned stretch, where the whole photo is on screen (measured per
  // viewport in tests/e2e/landing/crave-field-guide.spec.ts).
  it('paces the six finds evenly inside the pinned runway, never at its edges', () => {
    expect(GUIDE_STEP_AT).toHaveLength(6);
    const gaps = GUIDE_STEP_AT.slice(1).map((at, index) => at - GUIDE_STEP_AT[index]!);
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0]!, 10);
    // The first find waits a tenth of the runway past the pin (about 0.18 of a screen): the photo
    // is pinned and whole before any pointer deploys.
    expect(GUIDE_STEP_AT[0]).toBeGreaterThanOrEqual(0.1);
    expect(GUIDE_STEP_AT[0] * GUIDE_RUNWAY_SCREENS).toBeGreaterThanOrEqual(0.18 - 1e-9);
    // The last find lands with a fifth of the runway (0.36 of a screen) still pinned.
    expect(GUIDE_STEP_AT[5]).toBeLessThanOrEqual(0.8);
    expect((1 - GUIDE_STEP_AT[5]) * GUIDE_RUNWAY_SCREENS).toBeGreaterThanOrEqual(0.36 - 1e-9);
    // Juan: "scroll pace seems good". The runway stays 1.8 screens, and the CSS uses the same.
    expect(GUIDE_RUNWAY_SCREENS).toBe(1.8);
    expect(css).toContain('--guide-runway: 180svh;');
  });
  it('a step marker fires exactly at its runway fraction (marker offset = trigger band - pin top)', () => {
    // Pin top 16px, band = top tenth (10svh): marker k at 10svh - 16px + at*runway inside the guide
    // reaches the band when the guide's top is at 16px - at*runway, i.e. runway progress = at.
    const vh = 730, runway = GUIDE_RUNWAY_SCREENS * vh;
    for (const at of GUIDE_STEP_AT) {
      const marker = vh * GUIDE_STEP_BAND - 16 + at * runway;
      const guideTopAtFire = vh * GUIDE_STEP_BAND - marker;
      expect((16 - guideTopAtFire) / runway).toBeCloseTo(at, 10);
    }
    // Pinned the whole runway: the photo is the largest 2:3 box the pin leaves, never taller.
    expect(css).toContain('.landing-v5-guide-pin { position: sticky; top: 16px; min-height: calc(100svh - 32px);');
    expect(css).toContain('.landing-v5-guide-photo { width: min(100cqw, 100cqh * 2 / 3); }');
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
  // Astra review (PR #543): the one-per-beat walk must not carry on after the photo has scrolled away.
  it('walks one find per beat inside the runway, and flushes every queued find at the flush line', () => {
    // Normal scrolling staggers: one word now, the rest wait their beat.
    expect(findsNow(0, 1, 6, false)).toEqual([0]);
    expect(findsNow(0b000001, 4, 6, false)).toEqual([1]);
    expect(findsNow(0b000011, 2, 6, false)).toEqual([]);
    // A tapped word is never found twice.
    expect(findsNow(0b000101, 6, 6, false)).toEqual([1]);
    // The flush line: every word not yet found lands at once, whatever the target says.
    expect(findsNow(0b000011, 3, 6, true)).toEqual([2, 3, 4, 5]);
    expect(findsNow(0, 0, 6, true)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(findsNow(0b010101, 6, 6, true)).toEqual([1, 3, 5]);
    expect(findsNow(0b111111, 6, 6, true)).toEqual([]);
    expect(findsNow(0b111111, 6, 6, false)).toEqual([]);
    // Still pinned (the pin lets go at 1), past the last find with room for a fast flick to land there.
    expect(GUIDE_FLUSH_AT).toBeGreaterThan(GUIDE_STEP_AT[5]! + 0.1);
    expect(GUIDE_FLUSH_AT).toBeLessThan(1);
  });
  it('is settled only when all six are found and no line is still drawing', () => {
    expect(findsSettled(0b111111, 0, 6)).toBe(true);
    // Six found, the sixth line still drawing: not settled (a fast exit must still flush).
    expect(findsSettled(0b111111, 0b100000, 6)).toBe(false);
    expect(findsSettled(0b111111, 0b111111, 6)).toBe(false);
    expect(findsSettled(0b011111, 0, 6)).toBe(false);
    expect(findsSettled(0, 0, 6)).toBe(false);
  });
  it('keeps the observer on until every word is found, and cancels every timer on flush, calm and unmount', () => {
    const source = readFileSync('components/landing/FieldGuideFigure.tsx', 'utf8');
    // The flush line is observed by the ONE observer, beside the step markers.
    expect(source).toContain('for(const marker of [...steps.current,flushLine.current,root.current])if(marker)observer.observe(marker);');
    // Jumping clean past the guide (no marker touches the band) flushes too: the guide leaves the band above.
    expect(source).toContain('flushed||=!entry.isIntersecting&&entry.boundingClientRect.bottom<0;');
    expect(source).toContain('data-guide-flush');
    // Reaching the full target no longer disconnects the observer (the flush line must still report).
    expect(source).not.toContain('if(target>=total)stop();');
    // Nor does finding the sixth word: the observer is released only when every line has drawn.
    expect(source).not.toContain('if(mask===all)stop();');
    expect(source).toContain('if(findsSettled(mask,inFlight,total))stop();');
    const flush = source.slice(source.indexOf('const flush=()=>{'), source.indexOf('};', source.indexOf('const flush=()=>{')));
    expect(flush).toContain('clearTimeout(advance)');
    expect(flush).toContain('for(const timer of draws)clearTimeout(timer)');
    expect(flush).toContain('stop()');
    // Flush completes every line still drawing.
    expect(flush).toContain('inFlight=0');
    expect(flush).toContain('setDrawing(0)');
    // Unmount still clears the walk and every draw timer.
    expect(source).toContain('return ()=>{resize.disconnect();stop();clearTimeout(advance);for(const timer of draws)clearTimeout(timer);');
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

describe('laptop polish: the Field Guide pointers are spread out and never tangle', () => {
  type Box = { left: number; top: number; width: number; height: number; right: number; bottom: number };
  type Pt = { x: number; y: number };
  const box = (left: number, top: number, width: number, height: number): Box => ({ left, top, width, height, right: left + width, bottom: top + height });
  // Sample the cubic leaderPath() emits.
  const sample = (d: string): Pt[] => {
    const [x0, y0, x1, y1, x2, y2, x3, y3] = d.match(/-?[\d.]+/g)!.map(Number) as [number, number, number, number, number, number, number, number];
    return Array.from({ length: 81 }, (_, i) => { const t = i / 80, u = 1 - t; return { x: u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, y: u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3 }; });
  };
  const cross = (a: Pt, b: Pt, c: Pt, d: Pt) => {
    const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  };
  // The real layouts: laptop (480px guide, the photo height-limited and centred), phone (the photo
  // spans the column; narrow chips stand the pickup above the name) and a short phone (375x667).
  const layouts = {
    laptop: { width: 480, chip: 44, photo: box(85, 52, 310, 465) },
    phone: { width: 346, chip: 66, photo: box(0, 74, 346, 519) },
    shortPhone: { width: 331, chip: 66, photo: box(46, 74, 239, 358) },
  };
  for (const [name, layout] of Object.entries(layouts)) it(`${name}: six distinct points, no leader crosses another leader or another word`, () => {
    const column = (layout.width - 16) / 3;
    const words = fieldGuideAnchors.map((anchor, index) => {
      const above = index < GUIDE_WORDS_ABOVE, slot = above ? index : index - GUIDE_WORDS_ABOVE;
      return { id: anchor.id, rect: box(slot * (column + 8), above ? 0 : layout.photo.bottom + 8, column, layout.chip) };
    });
    const leaders = fieldGuideAnchors.map((anchor, index) => {
      const to = { x: layout.photo.left + anchor.x * layout.photo.width, y: layout.photo.top + anchor.y * layout.photo.height };
      return { id: anchor.id, to, points: sample(leaderPath(leaderStart(words[index]!.rect, layout.photo), to)) };
    });
    // Spread: every pair of points at least 12% of the photo's width apart.
    for (let i = 0; i < leaders.length; i++) for (let j = i + 1; j < leaders.length; j++)
      expect(Math.hypot(leaders[i]!.to.x - leaders[j]!.to.x, leaders[i]!.to.y - leaders[j]!.to.y), `${leaders[i]!.id}/${leaders[j]!.id}`).toBeGreaterThan(layout.photo.width * 0.12);
    // Clear of the photo's edges (the 6px dot and its stroke stay well inside).
    for (const leader of leaders) {
      expect(leader.to.x - layout.photo.left).toBeGreaterThan(24);
      expect(layout.photo.right - leader.to.x).toBeGreaterThan(24);
      expect(leader.to.y - layout.photo.top).toBeGreaterThan(24);
      expect(layout.photo.bottom - leader.to.y).toBeGreaterThan(24);
    }
    // No two leaders cross.
    for (let i = 0; i < leaders.length; i++) for (let j = i + 1; j < leaders.length; j++) {
      const a = leaders[i]!.points, b = leaders[j]!.points;
      let crossed = false;
      for (let p = 1; p < a.length && !crossed; p++) for (let q = 1; q < b.length && !crossed; q++) crossed = cross(a[p - 1]!, a[p]!, b[q - 1]!, b[q]!);
      expect(crossed, `${leaders[i]!.id} crosses ${leaders[j]!.id}`).toBe(false);
    }
    // No leader runs over another word (a point strictly inside another chip).
    for (const leader of leaders) for (const word of words) if (word.id !== leader.id)
      expect(leader.points.some(pt => pt.x > word.rect.left && pt.x < word.rect.right && pt.y > word.rect.top && pt.y < word.rect.bottom), `${leader.id} over ${word.id}`).toBe(false);
  });
  it('a word starts its leader on the edge that faces the photo', () => {
    const photo = { top: 100, bottom: 500 };
    expect(leaderStart({ left: 0, width: 100, top: 0, bottom: 44 }, photo)).toEqual({ x: 50, y: 44 });
    expect(leaderStart({ left: 200, width: 100, top: 508, bottom: 552 }, photo)).toEqual({ x: 250, y: 508 });
    expect(GUIDE_WORDS_ABOVE).toBe(3);
    // The top three point into the photo's upper half, the bottom three into its lower half.
    expect(fieldGuideAnchors.slice(0, GUIDE_WORDS_ABOVE).every(anchor => anchor.y < 0.5)).toBe(true);
    expect(fieldGuideAnchors.slice(GUIDE_WORDS_ABOVE).every(anchor => anchor.y > 0.5)).toBe(true);
  });
});
