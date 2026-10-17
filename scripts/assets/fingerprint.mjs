import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { sha256, safeOutput } from './inventory.mjs';
import { TOUCH_RECIPES } from './touch-recipes.mjs';

/** Content addressing is required before publishing any immutable landing media. */
export function fingerprintAssets(root = process.cwd()) {
  const manifestPath = resolve(root, 'assets/approved-media.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const replacements = new Map();
  for (const entry of manifest.media) {
    if (!entry.publicPath.startsWith('/media/')) continue;
    const oldPath = entry.publicPath;
    const file = safeOutput(root, 'public' + oldPath);
    if (sha256(file) !== entry.sha256) throw new Error('Cannot fingerprint changed bytes');
    let stem = oldPath.replace(/\.[^.]+$/, '').replace(/-[a-f0-9]{12}$/, '');
    // Reviewed touch filenames have an exact recipe; classification stays in
    // provenance rather than inserting a second suffix on a repeat run.
    if (entry.classification === 'drawn' && !Object.hasOwn(TOUCH_RECIPES, entry.id) && !stem.endsWith('-drawn')) stem += '-drawn';
    const next = `${stem}-${entry.sha256.slice(0, 12)}${oldPath.slice(oldPath.lastIndexOf('.'))}`;
    if (next !== oldPath) {
      const dest = safeOutput(root, 'public' + next);
      if (existsSync(dest)) {
        if (sha256(dest) !== entry.sha256) throw new Error('Fingerprint destination changed');
        unlinkSync(file);
      } else renameSync(file, dest);
      replacements.set(oldPath, next);
      entry.publicPath = next;
      const sidePath = safeOutput(root, entry.sidecar);
      const sidecar = JSON.parse(readFileSync(sidePath, 'utf8'));
      sidecar.publicPath = next;
      writeFileSync(sidePath, JSON.stringify(sidecar, null, 2) + '\n');
    }
  }
  const productsPath = resolve(root, 'config/tenant/landing-products.json');
  const products = JSON.parse(readFileSync(productsPath, 'utf8'));
  for (const product of products) for (const key of ['image', 'smallImage']) product[key] = replacements.get(product[key]) ?? product[key];
  writeFileSync(productsPath, JSON.stringify(products, null, 2) + '\n');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  // Only public paths enter the edge/client graph, never master paths or provenance.
  const runtimePath = resolve(root, 'config/tenant/landing-assets.json');
  const runtime = JSON.parse(readFileSync(runtimePath, 'utf8'));
  // Dimensions are optional public metadata; retain them from the authoritative
  // provenance entry whenever a runtime consumer already uses that shape.
  const dimensioned = new Set(runtime.filter(e => e.width !== undefined || e.height !== undefined).map(e => e.id));
  writeFileSync(runtimePath, JSON.stringify(manifest.media.map(e => ({ id: e.id, path: e.publicPath, ...(dimensioned.has(e.id) ? {width:e.width,height:e.height} : {}) })), null, 2) + '\n');
  return replacements;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) fingerprintAssets();
