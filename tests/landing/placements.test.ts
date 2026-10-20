import { expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createLandingTracker } from '@/lib/landing/tracking-client';
import { LANDING_PLACEMENTS, parseLandingEvent } from '@/lib/landing/tracking-schema-shared';

it('accepts every rendered CTA placement on both client and server', () => {
  const layout = readFileSync('app/eat/layout.tsx', 'utf8');
  expect(layout).toContain('allowedPlacements={LANDING_PLACEMENTS}');
  expect(layout).toMatch(/import \{ LANDING_PLACEMENTS \} from "@\/lib\/landing\/tracking-schema-shared"/);
  const allowedPlacements = LANDING_PLACEMENTS;
  // Discover literal component placements plus the page's conditional key placements.
  const files = ['app/eat/page.tsx', ...readdirSync('components/landing').filter(n => n.endsWith('.tsx')).map(n => `components/landing/${n}`)];
  const placements = new Set<string>();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/placement=["']([^"']+)["']/g)) placements.add(m[1]!);
    if (text.includes('placement={key}')) {
      const condition = text.match(/\{\((key === "[^"]+"(?: \|\| key === "[^"]+")*)\) &&[^\n]*placement=\{key\}/);
      expect(condition, file).not.toBeNull();
      for (const match of condition![1]!.matchAll(/key === "([^"]+)"/g)) placements.add(match[1]!);
    }
  }
  expect([...placements].sort()).toEqual(['catering','crave','footer','guide','hero','lineup','shops','sticky']);
  expect([...placements].sort()).toEqual([...LANDING_PLACEMENTS].sort());
  for (const placement of placements) {
    const post = vi.fn(), pixel = vi.fn();
    const tracker = createLandingTracker({serverApproved:true,pixelId:'123456789',capiEnabled:true,sourceUrl:'https://eat.example/',allowedStores:['dupont'],allowedAds:[],allowedPlacements}, {post,pixel,loadPixel:vi.fn(),revokePixel:vi.fn(),uuid:()=> '12345678-1234-4123-8123-123456789abc',now:()=>123000});
    tracker.setConsent(true); tracker.dispatch('OrderClick',{store:'dupont',placement});
    expect(pixel, placement).toHaveBeenCalledOnce();
    expect(post, placement).toHaveBeenCalledTimes(2);
    expect(parseLandingEvent(post.mock.calls[0]?.[1], 'https://eat.example', 123000),placement).not.toBeNull();
  }
});
