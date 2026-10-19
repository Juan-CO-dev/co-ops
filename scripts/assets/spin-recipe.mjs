// Reviewed recipe for the scroll/drag-driven Crunchy Boi turntable (landing v3).
// DRAWN (AI REFERENCE) source: never presented as a real photo, never morphed into one.
// Provenance lives here and in the sidecar only; nothing visible on the page.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const SPIN_RECIPE = Object.freeze({
  id: 'crunchy-boi-spin',
  sourceId: 'spin-rgba-frames',
  dir: 'C:/Users/conta/co-3d/spin-ad/masters/png-16x9-rgba-AI-REFERENCE-drawn',
  // 241 master frames are one seamless revolution (240 == 0); every 5th = 7.5 degrees.
  count: 48,
  step: 5,
  // Union alpha bounding box of the revolution plus 8 px, measured 2026-10-19.
  crop: Object.freeze({ left: 239, top: 153, width: 1508, height: 792 }),
  width: 540,
  height: 284,
  quality: 70,
  alphaQuality: 80,
  effort: 6,
  frameMaxBytes: 40000,
  maxBytes: 1100000,
});

export const spinSourceName = index => `crunchy-boi-spin-${String(index * SPIN_RECIPE.step).padStart(3, '0')}.png`;
export const spinFrameStem = index => `crunchy-boi-spin-f${String(index).padStart(2, '0')}`;

/** One digest over the sampled master frames, in order. */
export function spinSourceDigest(dir = SPIN_RECIPE.dir) {
  const hash = createHash('sha256');
  for (let i = 0; i < SPIN_RECIPE.count; i++) hash.update(createHash('sha256').update(readFileSync(`${dir}/${spinSourceName(i)}`)).digest('hex'));
  return hash.digest('hex');
}

/** Encodes one frame exactly as shipped; the inventory re-runs it with --sources. */
export async function encodeSpinFrame(sharp, index, dir = SPIN_RECIPE.dir) {
  const r = SPIN_RECIPE;
  return sharp(`${dir}/${spinSourceName(index)}`).extract(r.crop).resize({ width: r.width }).webp({ quality: r.quality, alphaQuality: r.alphaQuality, effort: r.effort }).toBuffer();
}
