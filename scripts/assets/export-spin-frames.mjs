// node scripts/assets/export-spin-frames.mjs
// Derives the 48-frame WebP-alpha turntable from the pinned RGBA master sequence,
// writes content-hashed public files, the sidecar, the approval entry and the
// public runtime inventory. Re-running on unchanged sources is a byte-identical no-op.
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { SPIN_RECIPE, spinFrameStem, spinSourceDigest, encodeSpinFrame } from './spin-recipe.mjs';
import { writeRuntimeInventory } from './runtime-inventory.mjs';

export async function exportSpinFrames(root = process.cwd()) {
  const r = SPIN_RECIPE;
  const sourceSha256 = spinSourceDigest();
  if (sourceSha256 !== r.sourceSha256) throw Error('Spin master frames differ from the reviewed digest');
  // Build and validate the complete set first; publish only after every frame passes.
  const encoded = [];
  for (let i = 0; i < r.count; i++) {
    const bytes = await encodeSpinFrame(sharp, i);
    const meta = await sharp(bytes).metadata();
    if (meta.width !== r.width || meta.height !== r.height || !meta.hasAlpha) throw Error(`Frame ${i}: unexpected output ${meta.width}x${meta.height} alpha=${meta.hasAlpha}`);
    if (bytes.length > r.frameMaxBytes) throw Error(`Frame ${i} over budget: ${bytes.length}`);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    encoded.push({ bytes, sha256, publicPath: `/media/${spinFrameStem(i)}-${sha256.slice(0, 12)}.webp` });
  }
  if (encoded.reduce((sum, frame) => sum + frame.bytes.length, 0) > r.maxBytes) throw Error('Sequence over budget');
  for (const frame of encoded) writeFileSync(resolve(root, 'public' + frame.publicPath), frame.bytes);
  const keep = new Set(encoded.map(frame => frame.publicPath.slice('/media/'.length)));
  for (const file of readdirSync(resolve(root, 'public/media'))) if (/^crunchy-boi-spin-f\d\d-[a-f0-9]{12}\.webp$/.test(file) && !keep.has(file)) rmSync(resolve(root, 'public/media', file));
  const frames = encoded.map(({ publicPath, sha256, bytes }) => ({ publicPath, sha256, bytes: bytes.length }));
  const bytes = frames.reduce((sum, frame) => sum + frame.bytes, 0);
  if (bytes > r.maxBytes) throw Error(`Sequence over budget: ${bytes}`);
  const entry = {
    id: r.id, kind: 'sequence', classification: 'drawn',
    sourcePath: `source:${r.sourceId}`, sourceSha256,
    width: r.width, height: r.height, count: r.count, step: r.step, crop: r.crop,
    quality: r.quality, alphaQuality: r.alphaQuality, effort: r.effort,
    tool: { sharp: sharp.versions.sharp, vips: sharp.versions.vips, webp: sharp.versions.webp },
    bytes, maxBytes: r.maxBytes, frames,
    sidecar: `assets/provenance/${r.id}.json`,
    command: 'node scripts/assets/export-spin-frames.mjs',
    provenance: 'DRAWN (AI REFERENCE) Crunchy Boi spin master; crop/resize/encode only; never shown as a real photo',
  };
  writeFileSync(resolve(root, entry.sidecar), JSON.stringify(entry, null, 2) + '\n');
  const manifestPath = resolve(root, 'assets/approved-media.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.media = [...manifest.media.filter(e => e.id !== r.id), entry];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const sourcesPath = resolve(root, 'assets/source-manifest.json');
  const sources = JSON.parse(readFileSync(sourcesPath, 'utf8'));
  sources.externalSources = [...sources.externalSources.filter(s => s.id !== r.sourceId), { id: r.sourceId, path: r.dir, sha256: sourceSha256, kind: 'frame-sequence-digest' }];
  writeFileSync(sourcesPath, JSON.stringify(sources, null, 2) + '\n');
  writeRuntimeInventory(root, manifest);
  return entry;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  exportSpinFrames().then(e => console.log(`Spin frames: ${e.count} frames, ${e.bytes} bytes`)).catch(e => { console.error(e.message); process.exitCode = 1; });
}
