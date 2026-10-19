// node scripts/assets/export-sprites.mjs
// Copies each reviewed pixel sprite byte-for-byte to a content-hashed public path and
// records its approval entry + sidecar. Unchanged sources re-run as a no-op.
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { SPRITES, SPRITE_DIR, SPRITE_MAX_BYTES } from './sprite-recipe.mjs';
import { writeRuntimeInventory } from './runtime-inventory.mjs';

export async function exportSprites(root = process.cwd()) {
  const manifestPath = resolve(root, 'assets/approved-media.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const ids = new Set(SPRITES.map(s => s.id));
  for (const file of readdirSync(resolve(root, 'public/media'))) if (/^pixel-[a-z0-9-]+-[a-f0-9]{12}\.png$/.test(file)) rmSync(resolve(root, 'public/media', file));
  const entries = [];
  for (const sprite of SPRITES) {
    const bytes = readFileSync(`${SPRITE_DIR}/${sprite.source}`);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== sprite.sha256) throw Error(`Sprite source changed: ${sprite.id}`);
    if (bytes.length > SPRITE_MAX_BYTES) throw Error(`Sprite over budget: ${sprite.id}`);
    const { width, height, hasAlpha } = await sharp(bytes).metadata();
    if (!hasAlpha) throw Error(`Sprite without alpha: ${sprite.id}`);
    const publicPath = `/media/${sprite.id}-${sha256.slice(0, 12)}.png`;
    writeFileSync(resolve(root, 'public' + publicPath), bytes);
    const entry = { id: sprite.id, kind: 'sprite', classification: 'drawn', publicPath, sourcePath: `pixel-bank:${sprite.source}`, sourceSha256: sha256, sha256, bytes: bytes.length, maxBytes: SPRITE_MAX_BYTES, width, height, sidecar: `assets/provenance/${sprite.id}.json`, command: 'node scripts/assets/export-sprites.mjs', provenance: 'DRAWN (AI) pixel sprite; byte-for-byte copy; decorative only' };
    writeFileSync(resolve(root, entry.sidecar), JSON.stringify(entry, null, 2) + '\n');
    entries.push(entry);
  }
  manifest.media = [...manifest.media.filter(e => !(e.kind === 'sprite' || ids.has(e.id))), ...entries];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  writeRuntimeInventory(root, manifest);
  return entries;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  exportSprites().then(e => console.log(`Sprites: ${e.length}`)).catch(e => { console.error(e.message); process.exitCode = 1; });
}
